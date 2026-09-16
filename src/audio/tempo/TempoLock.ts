export type TempoLockMode = "gentle" | "tight" | "hard";

export type TempoLockOptions = {
  targetBpm: number;
  downbeatOffsetSec?: number;
  mode?: TempoLockMode;
  strength?: number;
  maxWarpPercent?: number;
  maxAnalysisSec?: number;
};

export type TempoLockAnalysis = {
  targetBpm: number;
  estimatedBpm: number;
  confidence: number;
  sourceBeatCount: number;
  lockedBeatCount: number;
  sourceDurationSec: number;
  outputDurationSec: number;
  maxWarpPercent: number;
  medianWarpPercent: number;
  warning?: string;
};

export type TempoLockMap = {
  sourceAnchorsSec: number[];
  targetAnchorsSec: number[];
  targetBpm: number;
  strength: number;
  analysis: TempoLockAnalysis;
};

export type TempoLockRenderOptions = {
  grainMs?: number;
  hopRatio?: number;
};

type NoveltyEnvelope = {
  values: Float32Array;
  frameRate: number;
  durationSec: number;
};

type TrackedBeat = {
  sourceSec: number;
  score: number;
  locked: boolean;
};

const MODE_CONFIG: Record<TempoLockMode, { strength: number; maxWarpPercent: number; searchWindowBeats: number }> = {
  gentle: { strength: 0.55, maxWarpPercent: 0.04, searchWindowBeats: 0.16 },
  tight: { strength: 0.82, maxWarpPercent: 0.075, searchWindowBeats: 0.22 },
  hard: { strength: 1, maxWarpPercent: 0.12, searchWindowBeats: 0.28 },
};

export function createTempoLockMap(buffer: AudioBuffer, options: TempoLockOptions): TempoLockMap {
  const targetBpm = clamp(options.targetBpm, 20, 300);
  const mode = options.mode ?? "hard";
  const config = MODE_CONFIG[mode];
  const strength = clamp(options.strength ?? config.strength, 0, 1);
  const maxWarpPercent = clamp(options.maxWarpPercent ?? config.maxWarpPercent, 0.01, 0.25);
  const analysisDurationSec = Math.min(buffer.duration, Math.max(8, options.maxAnalysisSec ?? 240));
  const envelope = buildNoveltyEnvelope(buffer, analysisDurationSec);
  const estimatedBpm = foldBpmTowardTarget(estimateBpmFromNovelty(envelope), targetBpm);
  const beatSec = 60 / targetBpm;
  const firstBeatSec = findFirstBeatSec(envelope, beatSec, options.downbeatOffsetSec);
  const trackedBeats = trackBeatAnchors(envelope, firstBeatSec, beatSec, buffer.duration, config.searchWindowBeats);
  const anchors = buildWarpAnchors(trackedBeats, beatSec, buffer.duration, strength, maxWarpPercent);
  const stats = calculateWarpStats(anchors.sourceAnchorsSec, anchors.targetAnchorsSec);
  const lockedBeatCount = trackedBeats.filter((beat) => beat.locked).length;
  const beatConfidence = trackedBeats.length > 0 ? lockedBeatCount / trackedBeats.length : 0;
  const meanScore = trackedBeats.length > 0 ? trackedBeats.reduce((sum, beat) => sum + Math.min(1, beat.score), 0) / trackedBeats.length : 0;
  const confidence = clamp(beatConfidence * 0.62 + meanScore * 0.38, 0, 1);
  const warning = trackedBeats.length < 8
    ? "Not enough reliable beats were found; the map falls back to conservative global timing."
    : confidence < 0.45
      ? "Beat confidence is low. Check the rendered result against a click before replacing the originals."
      : undefined;

  return {
    sourceAnchorsSec: anchors.sourceAnchorsSec,
    targetAnchorsSec: anchors.targetAnchorsSec,
    targetBpm,
    strength,
    analysis: {
      targetBpm,
      estimatedBpm,
      confidence,
      sourceBeatCount: trackedBeats.length,
      lockedBeatCount,
      sourceDurationSec: buffer.duration,
      outputDurationSec: anchors.targetAnchorsSec[anchors.targetAnchorsSec.length - 1] ?? buffer.duration,
      maxWarpPercent: stats.maxWarpPercent,
      medianWarpPercent: stats.medianWarpPercent,
      warning,
    },
  };
}

export function renderTempoLockedBuffer(
  buffer: AudioBuffer,
  map: TempoLockMap,
  options: TempoLockRenderOptions = {},
): AudioBuffer {
  const outputDurationSec = Math.max(0.05, map.targetAnchorsSec[map.targetAnchorsSec.length - 1] ?? buffer.duration);
  const outputLength = Math.max(1, Math.ceil(outputDurationSec * buffer.sampleRate));
  const output = new AudioBuffer({
    length: outputLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });

  const outputChannels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => output.getChannelData(channel));
  const inputChannels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
  const norm = new Float32Array(outputLength);
  const grainSize = makeEven(clampInt(Math.round(buffer.sampleRate * ((options.grainMs ?? 38) / 1000)), 768, 4096));
  const hopSize = Math.max(128, Math.round(grainSize * clamp(options.hopRatio ?? 0.5, 0.25, 0.75)));
  const halfGrain = Math.floor(grainSize / 2);
  const window = createHannWindow(grainSize);

  for (let outCenter = 0; outCenter <= outputLength + halfGrain; outCenter += hopSize) {
    const targetSec = outCenter / buffer.sampleRate;
    const sourceCenter = mapTargetToSourceSec(targetSec, map) * buffer.sampleRate;
    const outStart = outCenter - halfGrain;
    const sourceStart = sourceCenter - halfGrain;

    for (let grainIndex = 0; grainIndex < grainSize; grainIndex += 1) {
      const outIndex = outStart + grainIndex;
      if (outIndex < 0 || outIndex >= outputLength) continue;
      const weight = window[grainIndex] ?? 0;
      if (weight <= 0) continue;
      const sourceIndex = sourceStart + grainIndex;

      for (let channel = 0; channel < inputChannels.length; channel += 1) {
        outputChannels[channel][outIndex] += readLinear(inputChannels[channel], sourceIndex) * weight;
      }
      norm[outIndex] += weight;
    }
  }

  for (let index = 0; index < outputLength; index += 1) {
    const gain = norm[index] || 0;
    if (gain > 1e-5) {
      for (const channel of outputChannels) {
        channel[index] = softClamp(channel[index] / gain);
      }
      continue;
    }

    const sourceSec = mapTargetToSourceSec(index / buffer.sampleRate, map);
    const sourceIndex = sourceSec * buffer.sampleRate;
    for (let channel = 0; channel < inputChannels.length; channel += 1) {
      outputChannels[channel][index] = readLinear(inputChannels[channel], sourceIndex);
    }
  }

  return output;
}

export function mapTargetToSourceSec(targetSec: number, map: TempoLockMap): number {
  const targets = map.targetAnchorsSec;
  const sources = map.sourceAnchorsSec;
  if (targets.length === 0 || sources.length === 0) return Math.max(0, targetSec);
  if (targetSec <= targets[0]) return Math.max(0, targetSec);

  let low = 0;
  let high = targets.length - 1;
  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if ((targets[mid] ?? 0) <= targetSec) low = mid;
    else high = mid;
  }

  const targetA = targets[low] ?? 0;
  const targetB = targets[low + 1] ?? targetA;
  const sourceA = sources[low] ?? 0;
  const sourceB = sources[low + 1] ?? sourceA;
  const span = targetB - targetA;
  if (span <= 1e-6) return sourceA;
  const ratio = clamp((targetSec - targetA) / span, 0, 1);
  return sourceA + (sourceB - sourceA) * ratio;
}

function buildNoveltyEnvelope(buffer: AudioBuffer, analysisDurationSec: number): NoveltyEnvelope {
  const sampleRate = buffer.sampleRate;
  const hopSize = clampInt(Math.round(sampleRate / 94), 384, 1024);
  const sampleLimit = Math.min(buffer.length, Math.floor(analysisDurationSec * sampleRate));
  const frameCount = Math.max(1, Math.floor(sampleLimit / hopSize));
  const energy = new Float32Array(frameCount);
  const channelCount = Math.min(buffer.numberOfChannels, 2);
  const sampleStep = Math.max(1, Math.floor(hopSize / 64));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    const end = Math.min(sampleLimit, start + hopSize);
    let total = 0;
    let reads = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += sampleStep) {
        const current = data[sample] ?? 0;
        const previous = data[Math.max(0, sample - sampleStep)] ?? current;
        total += Math.abs(current - previous) * 1.75 + Math.abs(current) * 0.25;
        reads += 1;
      }
    }

    energy[frame] = reads > 0 ? total / reads : 0;
  }

  const novelty = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    novelty[frame] = Math.max(0, energy[frame] - averageBefore(energy, frame, 7) * 1.04);
  }

  const scale = percentile(novelty, 0.95) || maxValue(novelty) || 1;
  for (let frame = 0; frame < novelty.length; frame += 1) {
    novelty[frame] = Math.min(1.5, novelty[frame] / scale);
  }

  return {
    values: novelty,
    frameRate: sampleRate / hopSize,
    durationSec: frameCount / (sampleRate / hopSize),
  };
}

function estimateBpmFromNovelty(envelope: NoveltyEnvelope) {
  const values = envelope.values;
  if (values.length < 16) return 120;
  const minBpm = 55;
  const maxBpm = 210;
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * envelope.frameRate));
  const maxLag = Math.min(values.length - 2, Math.ceil((60 / minBpm) * envelope.frameRate));
  let bestLag = Math.max(minLag, Math.round((60 / 120) * envelope.frameRate));
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = lag; index < values.length; index += 1) {
      const current = values[index] ?? 0;
      const previous = values[index - lag] ?? 0;
      score += current * previous;
      leftEnergy += current * current;
      rightEnergy += previous * previous;
    }
    const normalized = score / Math.max(1e-6, Math.sqrt(leftEnergy * rightEnergy));
    if (normalized > bestScore) {
      bestScore = normalized;
      bestLag = lag;
    }
  }

  return clamp(60 / (bestLag / envelope.frameRate), minBpm, maxBpm);
}

function foldBpmTowardTarget(estimatedBpm: number, targetBpm: number) {
  let bpm = estimatedBpm;
  while (bpm < targetBpm * 0.72) bpm *= 2;
  while (bpm > targetBpm * 1.42) bpm /= 2;
  return Number(bpm.toFixed(2));
}

function findFirstBeatSec(envelope: NoveltyEnvelope, beatSec: number, downbeatOffsetSec?: number) {
  if (typeof downbeatOffsetSec === "number" && downbeatOffsetSec > 0.01 && downbeatOffsetSec < beatSec * 4) {
    return findPeakNear(envelope, downbeatOffsetSec, Math.min(0.16, beatSec * 0.25)).sec;
  }

  const phaseSteps = Math.max(12, Math.round(beatSec * envelope.frameRate));
  const beatsToScore = Math.max(8, Math.min(32, Math.floor(envelope.durationSec / beatSec)));
  let bestPhase = 0;
  let bestScore = -Infinity;

  for (let step = 0; step < phaseSteps; step += 1) {
    const phaseSec = (step / phaseSteps) * beatSec;
    let score = 0;
    for (let beat = 0; beat < beatsToScore; beat += 1) {
      const weight = 1 - beat / (beatsToScore * 1.8);
      score += findPeakNear(envelope, phaseSec + beat * beatSec, Math.min(0.07, beatSec * 0.14)).score * weight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phaseSec;
    }
  }

  return findPeakNear(envelope, bestPhase, Math.min(0.12, beatSec * 0.22)).sec;
}

function trackBeatAnchors(
  envelope: NoveltyEnvelope,
  firstBeatSec: number,
  beatSec: number,
  durationSec: number,
  searchWindowBeats: number,
): TrackedBeat[] {
  if (!Number.isFinite(firstBeatSec) || durationSec < beatSec * 4) return [];
  const beats: TrackedBeat[] = [];
  const searchRadiusSec = clamp(beatSec * searchWindowBeats, 0.055, 0.24);
  const threshold = Math.max(0.09, percentile(envelope.values, 0.68) * 0.62);
  const maxBeats = Math.min(4096, Math.ceil(durationSec / beatSec) + 3);
  let predictedSec = firstBeatSec;

  for (let beatIndex = 0; beatIndex < maxBeats && predictedSec < durationSec - 0.02; beatIndex += 1) {
    if (predictedSec > envelope.durationSec + searchRadiusSec) break;
    const peak = findPeakNear(envelope, predictedSec, searchRadiusSec);
    const locked = peak.score >= threshold;
    const sourceSec = locked ? peak.sec : predictedSec;
    if (sourceSec >= 0 && sourceSec < durationSec) {
      beats.push({ sourceSec, score: peak.score, locked });
    }
    predictedSec = sourceSec + beatSec;
  }

  return beats.filter((beat, index, list) => index === 0 || beat.sourceSec > (list[index - 1]?.sourceSec ?? -1) + 0.08);
}

function buildWarpAnchors(
  beats: TrackedBeat[],
  beatSec: number,
  durationSec: number,
  strength: number,
  maxWarpPercent: number,
) {
  const usableBeats = beats.filter((beat) => beat.sourceSec > 0.025 && beat.sourceSec < durationSec - 0.025);
  if (usableBeats.length < 4) {
    return {
      sourceAnchorsSec: [0, durationSec],
      targetAnchorsSec: [0, durationSec],
    };
  }

  const sourceAnchorsSec = [0];
  const rawTargetAnchorsSec = [0];
  const firstSourceBeatSec = usableBeats[0]?.sourceSec ?? 0;

  usableBeats.forEach((beat, index) => {
    const sourceSec = beat.sourceSec;
    if (sourceSec <= (sourceAnchorsSec[sourceAnchorsSec.length - 1] ?? 0) + 0.04) return;
    const idealTargetSec = firstSourceBeatSec + index * beatSec;
    const blendedTargetSec = sourceSec + (idealTargetSec - sourceSec) * strength;
    sourceAnchorsSec.push(sourceSec);
    rawTargetAnchorsSec.push(Math.max(0, blendedTargetSec));
  });

  if ((sourceAnchorsSec[sourceAnchorsSec.length - 1] ?? 0) < durationSec - 0.02) {
    const lastSource = sourceAnchorsSec[sourceAnchorsSec.length - 1] ?? 0;
    const lastTarget = rawTargetAnchorsSec[rawTargetAnchorsSec.length - 1] ?? lastSource;
    sourceAnchorsSec.push(durationSec);
    rawTargetAnchorsSec.push(lastTarget + (durationSec - lastSource));
  }

  return {
    sourceAnchorsSec,
    targetAnchorsSec: clampTargetDeltas(sourceAnchorsSec, rawTargetAnchorsSec, maxWarpPercent),
  };
}

function clampTargetDeltas(sourceAnchorsSec: number[], rawTargetAnchorsSec: number[], maxWarpPercent: number) {
  const targetAnchorsSec = [rawTargetAnchorsSec[0] ?? 0];
  for (let index = 1; index < sourceAnchorsSec.length; index += 1) {
    const sourceDelta = Math.max(0.02, (sourceAnchorsSec[index] ?? 0) - (sourceAnchorsSec[index - 1] ?? 0));
    const rawDelta = Math.max(0.02, (rawTargetAnchorsSec[index] ?? 0) - (rawTargetAnchorsSec[index - 1] ?? 0));
    const ratio = clamp(rawDelta / sourceDelta, 1 - maxWarpPercent, 1 + maxWarpPercent);
    targetAnchorsSec.push((targetAnchorsSec[targetAnchorsSec.length - 1] ?? 0) + sourceDelta * ratio);
  }
  return targetAnchorsSec;
}

function calculateWarpStats(sourceAnchorsSec: number[], targetAnchorsSec: number[]) {
  const warpPercents: number[] = [];
  for (let index = 1; index < sourceAnchorsSec.length; index += 1) {
    const sourceDelta = (sourceAnchorsSec[index] ?? 0) - (sourceAnchorsSec[index - 1] ?? 0);
    const targetDelta = (targetAnchorsSec[index] ?? 0) - (targetAnchorsSec[index - 1] ?? 0);
    if (sourceDelta <= 1e-6) continue;
    warpPercents.push(Math.abs(targetDelta / sourceDelta - 1) * 100);
  }
  const sorted = [...warpPercents].sort((a, b) => a - b);
  return {
    maxWarpPercent: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    medianWarpPercent: Number((sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2)),
  };
}

function findPeakNear(envelope: NoveltyEnvelope, sec: number, radiusSec: number) {
  const centerFrame = Math.round(sec * envelope.frameRate);
  const radiusFrames = Math.max(1, Math.round(radiusSec * envelope.frameRate));
  const from = clampInt(centerFrame - radiusFrames, 0, envelope.values.length - 1);
  const to = clampInt(centerFrame + radiusFrames, 0, envelope.values.length - 1);
  let bestFrame = clampInt(centerFrame, 0, envelope.values.length - 1);
  let bestScore = envelope.values[bestFrame] ?? 0;

  for (let frame = from; frame <= to; frame += 1) {
    const score = envelope.values[frame] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestFrame = frame;
    }
  }

  return {
    sec: bestFrame / envelope.frameRate,
    score: bestScore,
  };
}

function createHannWindow(length: number) {
  const window = new Float32Array(length);
  const denominator = Math.max(1, length - 1);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / denominator);
  }
  return window;
}

function readLinear(data: Float32Array, index: number) {
  if (index <= 0) return data[0] ?? 0;
  const maxIndex = data.length - 1;
  if (index >= maxIndex) return data[maxIndex] ?? 0;
  const left = Math.floor(index);
  const frac = index - left;
  return (data[left] ?? 0) * (1 - frac) + (data[left + 1] ?? 0) * frac;
}

function averageBefore(values: Float32Array, index: number, count: number) {
  let total = 0;
  let reads = 0;
  for (let offset = 1; offset <= count; offset += 1) {
    const value = values[index - offset];
    if (typeof value !== "number") continue;
    total += value;
    reads += 1;
  }
  return reads > 0 ? total / reads : values[index] ?? 0;
}

function percentile(values: Float32Array | number[], ratio: number) {
  const sorted = Array.from(values).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = clampInt(Math.floor(sorted.length * ratio), 0, sorted.length - 1);
  return sorted[index] ?? 0;
}

function maxValue(values: Float32Array | number[]) {
  let max = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? 0;
    if (value > max) max = value;
  }
  return max;
}

function softClamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value > 1.2) return 1.2;
  if (value < -1.2) return -1.2;
  return value;
}

function makeEven(value: number) {
  return value % 2 === 0 ? value : value + 1;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}
