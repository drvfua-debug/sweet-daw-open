import { clamp, copyChannels, gainToDb, rmsOfChannels, sanitizeFloat32 } from "@/audio/repair/dspMath";

export type SweetFinalRepairModuleKind =
  | "dereverb-lite"
  | "peak-restore-lite"
  | "hum-tone-reducer-lite"
  | "plosive-breath-tamer-lite"
  | "stereo-phase-guard"
  | "transient-sustain-split";

export interface SweetFinalRepairParams {
  module: SweetFinalRepairModuleKind;
  amount: number;
  focus?: "vocal" | "drums" | "bass" | "full-mix" | "stem";
  protect?: Array<"vocal-clarity" | "drum-attack" | "low-end" | "air" | "stereo-image">;
  safeMode: boolean;
}

export interface SweetTransientSustainAnalysis {
  transientEnvelope: Float32Array;
  sustainEnvelope: Float32Array;
  transientDensity: number;
  sustainSmearScore: number;
  frameStep: number;
  sampleAccurate: boolean;
}

export interface SweetFinalRepairProcessResult {
  channels: Float32Array[];
  removed: Float32Array[];
  appliedModules: SweetFinalRepairModuleKind[];
  warnings: string[];
  analysis: SweetTransientSustainAnalysis;
  metrics: {
    inputRmsDb: number;
    outputRmsDb: number;
    rmsDeltaDb: number;
    inputPeak: number;
    outputPeak: number;
    stereoCorrelation?: number;
  };
}

type FinalRepairContext = {
  sampleRate: number;
  analysis: SweetTransientSustainAnalysis;
  warnings: string[];
};

const MAX_TRANSIENT_ANALYSIS_FRAMES = 262_144;

export function applySweetFinalRepairModulesToChannels(
  inputChannels: Float32Array[],
  sampleRate: number,
  params: SweetFinalRepairParams[],
): SweetFinalRepairProcessResult {
  const original = copyChannels(inputChannels);
  const channels = copyChannels(inputChannels);
  const analysis = analyzeTransientSustain(channels, sampleRate);
  const warnings: string[] = [];
  const appliedModules: SweetFinalRepairModuleKind[] = [];
  const context: FinalRepairContext = { sampleRate: Math.max(1, sampleRate), analysis, warnings };
  if (!analysis.sampleAccurate) {
    warnings.push("Long final repair input used block envelope fallback to reduce mobile memory use.");
  }

  for (const rawParam of params) {
    const param = normalizeFinalRepairParams(rawParam);
    if (param.amount <= 0) continue;
    if (param.module === "transient-sustain-split") {
      warnings.push("Transient/Sustain Split is an analysis utility; audio is unchanged.");
      continue;
    }
    const before = copyChannels(channels);
    try {
      if (param.module === "dereverb-lite") applyDereverbTailShortenLite(channels, param, context);
      else if (param.module === "peak-restore-lite") applyPeakRestoreLite(channels, param, context);
      else if (param.module === "hum-tone-reducer-lite") applyHumToneReducerLite(channels, param, context);
      else if (param.module === "plosive-breath-tamer-lite") applyPlosiveBreathTamerLite(channels, param, context);
      else if (param.module === "stereo-phase-guard") applyStereoPhaseGuard(channels, param, context);
      sanitizeChannels(channels);
      appliedModules.push(param.module);
    } catch (error) {
      channels.splice(0, channels.length, ...before);
      warnings.push(`${param.module} bypassed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const removed = subtractChannels(original, channels);
  const inputRms = rmsOfChannels(original);
  const outputRms = rmsOfChannels(channels);
  return {
    channels,
    removed,
    appliedModules,
    warnings,
    analysis,
    metrics: {
      inputRmsDb: round2(gainToDb(inputRms)),
      outputRmsDb: round2(gainToDb(outputRms)),
      rmsDeltaDb: round2(gainToDb(outputRms) - gainToDb(inputRms)),
      inputPeak: round4(maxAbsOfChannels(original)),
      outputPeak: round4(maxAbsOfChannels(channels)),
      stereoCorrelation: channels.length >= 2 ? round4(stereoCorrelation(channels[0] ?? new Float32Array(), channels[1] ?? new Float32Array())) : undefined,
    },
  };
}

export function analyzeTransientSustain(channels: Float32Array[], sampleRate: number): SweetTransientSustainAnalysis {
  const length = channels[0]?.length ?? 0;
  const frameStep = length > MAX_TRANSIENT_ANALYSIS_FRAMES ? Math.ceil(length / MAX_TRANSIENT_ANALYSIS_FRAMES) : 1;
  const envelopeLength = Math.max(1, Math.ceil(length / frameStep));
  const transientEnvelope = new Float32Array(envelopeLength);
  const sustainEnvelope = new Float32Array(envelopeLength);
  const fastAlpha = smoothingAlpha(0.006, sampleRate);
  const slowAlpha = smoothingAlpha(0.09, sampleRate);
  let fast = 0;
  let slow = 0;
  let transientHits = 0;
  let smearSum = 0;

  for (let frameIndex = 0; frameIndex < envelopeLength; frameIndex += 1) {
    const mono = monoAbsForBlock(channels, frameIndex * frameStep, Math.min(length, (frameIndex + 1) * frameStep));
    fast += fastAlpha * (mono - fast);
    slow += slowAlpha * (mono - slow);
    const transient = Math.max(0, fast - slow * 1.08);
    const sustain = Math.max(0, slow - transient * 0.35);
    transientEnvelope[frameIndex] = transient;
    sustainEnvelope[frameIndex] = sustain;
    if (transient > Math.max(0.015, slow * 0.42)) transientHits += 1;
    smearSum += clamp(sustain / Math.max(0.005, fast + sustain), 0, 1);
  }

  return {
    transientEnvelope,
    sustainEnvelope,
    transientDensity: round4(transientHits / Math.max(1, envelopeLength)),
    sustainSmearScore: round4(smearSum / Math.max(1, envelopeLength)),
    frameStep,
    sampleAccurate: frameStep === 1,
  };
}

function applyDereverbTailShortenLite(channels: Float32Array[], params: SweetFinalRepairParams, context: FinalRepairContext) {
  const depth = params.amount * (params.safeMode ? 0.18 : 0.28) * (params.protect?.includes("vocal-clarity") ? 0.72 : 1);
  const length = channels[0]?.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const transient = analysisValueAt(context.analysis.transientEnvelope, index, context.analysis.frameStep);
    const sustain = analysisValueAt(context.analysis.sustainEnvelope, index, context.analysis.frameStep);
    const tailWeight = clamp((sustain - transient * 1.7) / Math.max(0.01, sustain + transient), 0, 1);
    const gain = 1 - depth * tailWeight;
    for (const channel of channels) channel[index] = sanitizeFloat32((channel[index] ?? 0) * gain);
  }
}

function applyPeakRestoreLite(channels: Float32Array[], params: SweetFinalRepairParams, context: FinalRepairContext) {
  const peakBefore = maxAbsOfChannels(channels);
  if (peakBefore > 0.97) {
    context.warnings.push("Peak Restore was reduced because the signal is already close to ceiling.");
  }
  const boost = params.amount * (params.safeMode ? 0.065 : 0.1) * (params.protect?.includes("drum-attack") ? 0.84 : 1);
  const length = channels[0]?.length ?? 0;
  for (let index = 0; index < length; index += 1) {
    const transient = analysisValueAt(context.analysis.transientEnvelope, index, context.analysis.frameStep);
    const sustain = analysisValueAt(context.analysis.sustainEnvelope, index, context.analysis.frameStep);
    const transientWeight = clamp(transient / Math.max(0.012, sustain + transient), 0, 1);
    const gain = 1 + boost * transientWeight;
    for (const channel of channels) channel[index] = sanitizeFloat32((channel[index] ?? 0) * gain);
  }
  softLimitPeak(channels, params.safeMode ? 0.97 : 0.985);
}

function applyHumToneReducerLite(channels: Float32Array[], params: SweetFinalRepairParams, context: FinalRepairContext) {
  const mono = mixToMono(channels);
  const candidates = detectNarrowToneCandidates(mono, context.sampleRate, params);
  if (candidates.length === 0) {
    context.warnings.push("Hum/Tone Reducer found no stable narrowband candidate.");
    return;
  }

  const maxCandidates = params.safeMode ? 4 : 7;
  for (const candidate of candidates.slice(0, maxCandidates)) {
    const mix = clamp(params.amount * candidate.confidence * (params.safeMode ? 0.48 : 0.68), 0, 0.78);
    for (const channel of channels) applyNotchBlendInPlace(channel, context.sampleRate, candidate.hz, candidate.q, mix);
  }
}

function applyPlosiveBreathTamerLite(channels: Float32Array[], params: SweetFinalRepairParams, context: FinalRepairContext) {
  tameMouthClicks(channels, context.sampleRate, params.amount * (params.safeMode ? 0.72 : 1));
  if (!params.protect?.includes("low-end")) tamePlosiveLowBursts(channels, context.sampleRate, params);
  if (!params.protect?.includes("air")) tameBreathHighNoise(channels, context.sampleRate, params);
}

function applyStereoPhaseGuard(channels: Float32Array[], params: SweetFinalRepairParams, context: FinalRepairContext) {
  if (channels.length < 2) {
    context.warnings.push("Stereo Phase Guard needs stereo input; mono input was unchanged.");
    return;
  }
  const left = channels[0];
  const right = channels[1];
  if (!left || !right) return;
  const corrBefore = stereoCorrelation(left, right);
  const lowAlpha = smoothingAlphaFromFrequency(120, context.sampleRate);
  const lowDepth = params.protect?.includes("stereo-image") ? params.amount * 0.32 : params.amount * (params.safeMode ? 0.62 : 0.82);
  const fullSideDepth = corrBefore < 0.05 ? params.amount * 0.1 : 0;
  let lowSide = 0;
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    lowSide += lowAlpha * (side - lowSide);
    const highSide = side - lowSide;
    const guardedSide = highSide * (1 - fullSideDepth) + lowSide * (1 - lowDepth);
    left[index] = sanitizeFloat32(mid + guardedSide);
    right[index] = sanitizeFloat32(mid - guardedSide);
  }

  const corrAfter = stereoCorrelation(left, right);
  if (corrAfter < -0.2) context.warnings.push("Stereo Phase Guard could not fully stabilize negative correlation.");
}

function normalizeFinalRepairParams(input: SweetFinalRepairParams): SweetFinalRepairParams {
  return {
    module: input.module,
    amount: clamp(input.amount, 0, 1),
    focus: input.focus ?? "stem",
    protect: Array.isArray(input.protect) ? input.protect : [],
    safeMode: input.safeMode !== false,
  };
}

function detectNarrowToneCandidates(channel: Float32Array, sampleRate: number, params: SweetFinalRepairParams) {
  const nyquist = sampleRate * 0.5;
  const allowLowToneRepair = params.focus !== "bass" && !params.protect?.includes("low-end");
  const lowCandidates = allowLowToneRepair ? [50, 60, 100, 120, 150, 180, 200, 240].filter((hz) => hz < nyquist * 0.85) : [];
  const highCandidates = [6000, 7200, 8400, 9600, 10800, 12000, 13200].filter((hz) => hz < nyquist * 0.85 && !params.protect?.includes("air"));
  const candidates: Array<{ hz: number; confidence: number; q: number }> = [];
  for (const hz of [...lowCandidates, ...highCandidates]) {
    const center = toneEnergy(channel, sampleRate, hz);
    const nearA = toneEnergy(channel, sampleRate, hz * 0.94);
    const nearB = toneEnergy(channel, sampleRate, hz * 1.06);
    const neighbor = Math.max(1e-8, (nearA + nearB) * 0.5);
    const ratio = center / neighbor;
    const confidence = clamp((ratio - 1.18) / 2.8, 0, 1);
    if (confidence > 0.08 && center > 0.0015) candidates.push({ hz, confidence, q: hz < 300 ? 24 : 38 });
  }
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function applyNotchBlendInPlace(channel: Float32Array, sampleRate: number, hz: number, q: number, mix: number) {
  const w0 = (2 * Math.PI * hz) / Math.max(1, sampleRate);
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(1, q));
  const b0 = 1;
  const b1 = -2 * cos;
  const b2 = 1;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const x0 = channel[index] ?? 0;
    const notch = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = notch;
    channel[index] = sanitizeFloat32(x0 * (1 - mix) + notch * mix);
  }
}

function tameMouthClicks(channels: Float32Array[], sampleRate: number, amount: number) {
  const radius = Math.max(1, Math.floor(sampleRate * (0.0004 + amount * 0.0018)));
  for (const channel of channels) {
    const rms = localRms(channel);
    const threshold = Math.max(0.12, rms * (paramsThresholdScale(amount)));
    for (let index = 1; index < channel.length - 1; index += 1) {
      const prev = channel[index - 1] ?? 0;
      const current = channel[index] ?? 0;
      const next = channel[index + 1] ?? 0;
      const diff = Math.abs(current - prev) + Math.abs(current - next);
      if (diff < threshold || Math.abs(current) < rms * 2.4) continue;
      const left = Math.max(0, index - radius);
      const right = Math.min(channel.length - 1, index + radius);
      const leftValue = channel[left] ?? 0;
      const rightValue = channel[right] ?? leftValue;
      for (let cursor = left; cursor <= right; cursor += 1) {
        const t = (cursor - left) / Math.max(1, right - left);
        const target = leftValue + (rightValue - leftValue) * t;
        channel[cursor] = sanitizeFloat32((channel[cursor] ?? 0) * (1 - amount) + target * amount);
      }
      index += radius;
    }
  }
}

function tamePlosiveLowBursts(channels: Float32Array[], sampleRate: number, params: SweetFinalRepairParams) {
  const alpha = smoothingAlphaFromFrequency(165, sampleRate);
  const depth = params.amount * (params.safeMode ? 0.42 : 0.58);
  for (const channel of channels) {
    let low = 0;
    let lowEnv = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const input = channel[index] ?? 0;
      low += alpha * (input - low);
      lowEnv += smoothingAlpha(0.05, sampleRate) * (Math.abs(low) - lowEnv);
      const burst = clamp((Math.abs(low) - Math.max(0.035, lowEnv * 2.1)) / Math.max(0.02, lowEnv + Math.abs(low)), 0, 1);
      channel[index] = sanitizeFloat32(input - low * depth * burst);
    }
  }
}

function tameBreathHighNoise(channels: Float32Array[], sampleRate: number, params: SweetFinalRepairParams) {
  const lowAlpha = smoothingAlphaFromFrequency(params.focus === "vocal" ? 2800 : 3800, sampleRate);
  const envAlpha = smoothingAlpha(0.045, sampleRate);
  const depth = params.amount * (params.safeMode ? 0.12 : 0.18);
  for (const channel of channels) {
    let low = 0;
    let highEnv = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const input = channel[index] ?? 0;
      low += lowAlpha * (input - low);
      const high = input - low;
      highEnv += envAlpha * (Math.abs(high) - highEnv);
      const softNoise = clamp((highEnv - 0.012) / 0.08, 0, 1);
      channel[index] = sanitizeFloat32(low + high * (1 - depth * softNoise));
    }
  }
}

function softLimitPeak(channels: Float32Array[], ceiling: number) {
  const peak = maxAbsOfChannels(channels);
  if (peak <= ceiling || peak <= 0) return;
  const trim = ceiling / peak;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] = sanitizeFloat32((channel[index] ?? 0) * trim);
  }
}

function subtractChannels(original: Float32Array[], processed: Float32Array[]) {
  return original.map((channel, channelIndex) => {
    const next = new Float32Array(channel.length);
    const after = processed[channelIndex] ?? new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) next[index] = sanitizeFloat32((channel[index] ?? 0) - (after[index] ?? 0));
    return next;
  });
}

function mixToMono(channels: Float32Array[]) {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] ?? 0;
    mono[index] = sum / Math.max(1, channels.length);
  }
  return mono;
}

function monoAbsForBlock(channels: Float32Array[], start: number, end: number) {
  let sum = 0;
  let count = 0;
  for (let index = start; index < end; index += 1) {
    for (const channel of channels) {
      sum += Math.abs(channel[index] ?? 0);
      count += 1;
    }
  }
  return sum / Math.max(1, count);
}

function analysisValueAt(envelope: Float32Array, sampleIndex: number, frameStep: number) {
  const frameIndex = Math.min(envelope.length - 1, Math.max(0, Math.floor(sampleIndex / Math.max(1, frameStep))));
  return envelope[frameIndex] ?? 0;
}

function localRms(channel: Float32Array) {
  let sum = 0;
  for (const sample of channel) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, channel.length));
}

function maxAbsOfChannels(channels: Float32Array[]) {
  let peak = 0;
  for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function stereoCorrelation(left: Float32Array, right: Float32Array) {
  const length = Math.min(left.length, right.length);
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    ll += l * l;
    rr += r * r;
    lr += l * r;
  }
  return clamp(lr / Math.sqrt(Math.max(1e-12, ll * rr)), -1, 1);
}

function toneEnergy(channel: Float32Array, sampleRate: number, hz: number) {
  let real = 0;
  let imag = 0;
  const step = (2 * Math.PI * hz) / Math.max(1, sampleRate);
  for (let index = 0; index < channel.length; index += 1) {
    const angle = step * index;
    const sample = channel[index] ?? 0;
    real += sample * Math.cos(angle);
    imag -= sample * Math.sin(angle);
  }
  return Math.hypot(real, imag) / Math.max(1, channel.length);
}

function smoothingAlpha(timeSec: number, sampleRate: number) {
  return 1 - Math.exp(-1 / Math.max(1, timeSec * sampleRate));
}

function smoothingAlphaFromFrequency(frequency: number, sampleRate: number) {
  const dt = 1 / Math.max(1, sampleRate);
  const rc = 1 / (2 * Math.PI * Math.max(1, frequency));
  return dt / (rc + dt);
}

function sanitizeChannels(channels: Float32Array[]) {
  for (const channel of channels) for (let index = 0; index < channel.length; index += 1) channel[index] = sanitizeFloat32(channel[index] ?? 0);
}

function paramsThresholdScale(amount: number) {
  return clamp(9 - amount * 4, 3.5, 9);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}
