export type OnsetDetectionResult = {
  onsetsSec: number[];
  analyzedDurationSec: number;
  analysisVersion: string;
};

type OnsetDetectionOptions = {
  maxAnalysisSec?: number;
  sensitivity?: number;
  minGapSec?: number;
};

const ANALYSIS_VERSION = "onset-lite-v1";

export function detectOnsetsFromBuffer(
  buffer: AudioBuffer,
  {
    maxAnalysisSec = 60,
    sensitivity = 0.55,
    minGapSec = 0.08,
  }: OnsetDetectionOptions = {},
): OnsetDetectionResult {
  const analyzedDurationSec = Math.min(buffer.duration, maxAnalysisSec);
  const sampleLimit = Math.min(buffer.length, Math.floor(analyzedDurationSec * buffer.sampleRate));
  const hopSize = Math.max(256, Math.floor(buffer.sampleRate / 120));
  const frameCount = Math.floor(sampleLimit / hopSize);

  if (frameCount < 8) {
    return { onsetsSec: [], analyzedDurationSec, analysisVersion: ANALYSIS_VERSION };
  }

  const energies = buildEnergyEnvelope(buffer, frameCount, hopSize);
  const novelty = energies.map((energy, index) => Math.max(0, energy - averageBefore(energies, index, 4) * 1.08));
  const threshold = percentile(novelty, 0.82) * (0.7 + (1 - sensitivity) * 0.9);
  const minGapFrames = Math.max(1, Math.round(minGapSec / (hopSize / buffer.sampleRate)));
  const onsetsSec: number[] = [];
  let lastOnsetFrame = -minGapFrames;

  for (let index = 2; index < novelty.length - 1; index += 1) {
    const isPeak = novelty[index] > threshold && novelty[index] >= novelty[index - 1] && novelty[index] >= novelty[index + 1];
    if (!isPeak || index - lastOnsetFrame < minGapFrames) continue;
    onsetsSec.push(Number(((index * hopSize) / buffer.sampleRate).toFixed(4)));
    lastOnsetFrame = index;
  }

  return {
    onsetsSec,
    analyzedDurationSec,
    analysisVersion: ANALYSIS_VERSION,
  };
}

function buildEnergyEnvelope(buffer: AudioBuffer, frameCount: number, hopSize: number) {
  const energies = new Array<number>(frameCount).fill(0);
  const channelCount = Math.min(buffer.numberOfChannels, 2);
  const sampleStep = Math.max(1, Math.floor(hopSize / 96));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    const end = Math.min(buffer.length, start + hopSize);
    let energy = 0;
    let reads = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += sampleStep) {
        energy += Math.abs(data[sample] ?? 0);
        reads += 1;
      }
    }

    energies[frame] = reads > 0 ? energy / reads : 0;
  }

  return energies;
}

function averageBefore(values: number[], index: number, count: number) {
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

function percentile(values: number[], ratio: number) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index] ?? 0;
}
