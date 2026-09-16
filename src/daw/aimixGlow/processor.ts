import { AIMIX_GLOW_PRESETS, DEFAULT_AIMIX_GLOW_SETTINGS } from "./presets";
import type { AimixGlowAnalysis, AimixGlowAudioChannel, AimixGlowResult, AimixGlowSettings } from "./types";

export type AimixGlowProcessOptions = {
  copyInput?: boolean;
  vocalSidechain?: AimixGlowAudioChannel[] | null;
};

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

type BasicMetrics = {
  peakDb: number;
  lufsApprox: number;
  rmsDb: number;
  durationSec: number;
};

const EPS = 1e-12;
const LUFS_FROM_RMS_OFFSET_DB = -1.2;

export function resolveAimixGlowSettings(raw: Partial<AimixGlowSettings> = {}): AimixGlowSettings {
  const preset = raw.preset && raw.preset in AIMIX_GLOW_PRESETS ? raw.preset : DEFAULT_AIMIX_GLOW_SETTINGS.preset;
  const presetDefaults = preset === "custom" ? DEFAULT_AIMIX_GLOW_SETTINGS : { ...DEFAULT_AIMIX_GLOW_SETTINGS, ...AIMIX_GLOW_PRESETS[preset as keyof typeof AIMIX_GLOW_PRESETS] };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : presetDefaults.enabled,
    preset,
    amount: clamp(raw.amount ?? presetDefaults.amount, 0, 100),
    vocalKey: clamp(raw.vocalKey ?? presetDefaults.vocalKey, 0, 100),
    recover: clamp(raw.recover ?? presetDefaults.recover, 0, 100),
    gloss: clamp(raw.gloss ?? presetDefaults.gloss, 0, 100),
    air: clamp(raw.air ?? presetDefaults.air, 0, 100),
    tame: clamp(raw.tame ?? presetDefaults.tame, 0, 100),
    outputMatch: typeof raw.outputMatch === "boolean" ? raw.outputMatch : presetDefaults.outputMatch,
    quality: raw.quality === "preview" ? "preview" : "offlineHighQuality",
  };
}

export function processAimixGlow(
  inputChannels: AimixGlowAudioChannel[],
  sampleRate: number,
  rawSettings: Partial<AimixGlowSettings> = {},
  options: AimixGlowProcessOptions = {},
): AimixGlowResult {
  assertValidAudio(inputChannels, sampleRate);
  const settings = resolveAimixGlowSettings(rawSettings);
  const warnings: string[] = [];
  const actions: string[] = [];
  const channels = options.copyInput === false ? sanitizeChannelsInPlace(inputChannels, warnings) : cloneAndSanitizeChannels(inputChannels, warnings);
  const vocalSidechain = normalizeSidechain(options.vocalSidechain, getCommonLength(channels));
  const before = analyzeAimixGlow(channels, sampleRate, vocalSidechain);
  let outputMatchGainDb = 0;

  if (!settings.enabled || settings.amount <= 0) {
    actions.push("AIMIX Glow bypassed");
    return { channels, before, after: before, outputMatchGainDb, actions, warnings };
  }

  const amt = settings.amount / 100;
  const recoverAmt = amt * (settings.recover / 100);
  const glossAmt = amt * (settings.gloss / 100);
  const airAmt = amt * (settings.air / 100);
  const tameAmt = amt * (settings.tame / 100);
  const vocalKeyScale = settings.vocalKey / 100;
  const fallbackScale = before.vocalAvailable ? 1 : 0.52;
  const vocalActivity = clamp(before.vocalActivityMean * vocalKeyScale * fallbackScale, 0, 1);

  const presetShape = getPresetShape(settings.preset);
  const deharshDb = -presetShape.maxGuardReductionDb * tameAmt * Math.max(before.sibilanceRisk, before.harshnessRisk, before.fakeAirRisk) * (0.55 + 0.45 * vocalActivity);
  if (deharshDb < -0.05) {
    applyPeakingToChannels(channels, sampleRate, 6400, deharshDb * 0.65, 2.2);
    applyPeakingToChannels(channels, sampleRate, 9200, deharshDb * 0.45, 2.0);
    actions.push(`Dynamic De-harsh ${deharshDb.toFixed(2)} dB`);
  } else {
    actions.push("Dynamic De-harsh idle");
  }

  const presenceBoostDb = presetShape.maxPresenceBoostDb * recoverAmt * before.presenceDeficit * (0.35 + 0.65 * vocalActivity) * (1 - 0.55 * before.harshnessRisk);
  if (presenceBoostDb > 0.03) {
    applyPeakingToChannels(channels, sampleRate, 2100, presenceBoostDb * 0.55, 1.0);
    applyPeakingToChannels(channels, sampleRate, 3700, presenceBoostDb, 1.08);
    actions.push(`Vocal Presence Recover +${presenceBoostDb.toFixed(2)} dB`);
  } else {
    actions.push("Vocal Presence Recover idle");
  }

  const glossDrive = 1.05 + Math.min(0.3, glossAmt * 0.8 * (0.35 + vocalActivity));
  const glossMix = clamp(glossAmt * (0.08 + 0.18 * vocalActivity) * (1 - 0.5 * before.fakeAirRisk), 0, 0.12);
  if (glossMix > 0.004) {
    applySoftGloss(channels, glossDrive, glossMix);
    applyPeakingToChannels(channels, sampleRate, 7600, Math.min(0.18, glossMix * 1.3), 1.3);
    actions.push(`Harmonic Gloss ${(glossMix * 100).toFixed(1)}%`);
  } else {
    actions.push("Harmonic Gloss idle");
  }

  const sideGuard = before.midSideHighRisk > 0.5 ? 0.45 : 1;
  const airBoostDb = presetShape.maxAirBoostDb * airAmt * before.airDeficit * (0.25 + 0.75 * vocalActivity) * (1 - 0.7 * before.sibilanceRisk) * (1 - 0.7 * before.fakeAirRisk) * sideGuard;
  if (airBoostDb > 0.03) {
    applyPeakingToChannels(channels, sampleRate, 9800, airBoostDb * 0.65, 1.2);
    applyHighShelfToChannels(channels, sampleRate, 11800, airBoostDb * 0.45, 0.72);
    actions.push(`Air Recovery +${airBoostDb.toFixed(2)} dB`);
  } else {
    actions.push("Air Recovery guarded");
  }

  const guardDb = -presetShape.maxGuardReductionDb * tameAmt * Math.max(before.sibilanceRisk, before.fakeAirRisk, before.midSideHighRisk * 0.75) * 0.55;
  if (guardDb < -0.04) {
    applyPeakingToChannels(channels, sampleRate, 11200, guardDb, 1.35);
    actions.push(`Fake Air Guard ${guardDb.toFixed(2)} dB`);
  } else {
    actions.push("Fake Air Guard idle");
  }

  if (settings.outputMatch) {
    const current = analyzeBasicMetrics(channels, sampleRate);
    const matchGainDb = clamp(before.inputLufsApprox - current.lufsApprox, -6, 6);
    outputMatchGainDb = round2(matchGainDb);
    if (Math.abs(matchGainDb) > 0.05) applyGain(channels, dbToGain(matchGainDb));
    actions.push(`Output Match ${formatSignedDb(matchGainDb)}`);
  } else {
    actions.push("Output Match bypassed");
  }

  const safety = applyPeakCeiling(channels, -1.5);
  if (safety.gainReductionDb > 0.05) {
    actions.push(`Pre-master safety trim ${safety.gainReductionDb.toFixed(2)} dB`);
    warnings.push("AIMIX Glow needed safety trim before mastering.");
  }

  clampChannels(channels);
  const after = analyzeAimixGlow(channels, sampleRate, vocalSidechain);
  if (!before.vocalAvailable) warnings.push("Vocal Key: unavailable / mix-only fallback. Glow intensity was reduced.");
  if (after.inputTruePeakDb > -1.2) warnings.push("AIMIX Glow output is close to full scale. Use Mastering true-peak limiting before release export.");

  return { channels, before, after, outputMatchGainDb, actions, warnings };
}

export function analyzeAimixGlow(
  channels: AimixGlowAudioChannel[],
  sampleRate: number,
  vocalSidechain?: AimixGlowAudioChannel[] | null,
): AimixGlowAnalysis {
  assertValidAudio(channels, sampleRate);
  const length = getCommonLength(channels);
  const basic = analyzeBasicMetrics(channels, sampleRate);
  const vocal = normalizeSidechain(vocalSidechain, length);
  const activity = buildVocalActivity(vocal ?? channels, sampleRate, Boolean(vocal));
  const bodyDb = estimateBandRmsDb(channels, sampleRate, 300, 1500, "mid");
  const presenceDb = estimateBandRmsDb(channels, sampleRate, 1500, 5000, "mid");
  const sibilanceDb = estimateBandRmsDb(vocal ?? channels, sampleRate, 5500, 9000, "mid");
  const airDb = estimateBandRmsDb(channels, sampleRate, 9000, 15500, "mid");
  const ultraAirDb = estimateBandRmsDb(channels, sampleRate, 10000, 16000, "side");
  const sideHighDb = estimateBandRmsDb(channels, sampleRate, 8000, 16000, "side");
  const midHighDb = estimateBandRmsDb(channels, sampleRate, 8000, 16000, "mid");
  const presenceToBodyDb = presenceDb - bodyDb;
  const airToPresenceDb = airDb - presenceDb;
  const sibilanceToPresenceDb = sibilanceDb - presenceDb;
  const sideToMidHighDb = sideHighDb - midHighDb;
  const targetPresenceToBodyDb = 0;
  const targetAirToPresenceDb = -16;
  const sibilanceRisk = smoothstep(-16, -7, sibilanceToPresenceDb);
  const harshnessRisk = smoothstep(2, 9, Math.max(presenceToBodyDb - 1.5, sibilanceToPresenceDb + 10));
  const presenceDeficit = smoothstep(0, 6, targetPresenceToBodyDb - presenceToBodyDb);
  const airDeficit = smoothstep(0, 8, targetAirToPresenceDb - airToPresenceDb);
  const midSideHighRisk = smoothstep(-3, 5, sideToMidHighDb);
  const fakeAirRisk = clamp01(
    0.35 * smoothstep(-24, -12, ultraAirDb - presenceDb)
    + 0.25 * smoothstep(-8, 3, sideToMidHighDb)
    + 0.25 * smoothstep(-18, -7, sibilanceToPresenceDb)
    + 0.15 * sibilanceRisk,
  );

  return {
    sampleRate,
    durationSec: round2(length / sampleRate),
    inputLufsApprox: basic.lufsApprox,
    inputTruePeakDb: round2(basic.peakDb + estimateInterSamplePeakMarginDb(channels, length)),
    vocalAvailable: Boolean(vocal),
    vocalActivityMean: round3(activity.mean),
    vocalActivityFrames: activity.frames,
    sibilanceRisk: round3(sibilanceRisk),
    harshnessRisk: round3(harshnessRisk),
    presenceDeficit: round3(presenceDeficit),
    airDeficit: round3(airDeficit),
    fakeAirRisk: round3(fakeAirRisk),
    midSideHighRisk: round3(midSideHighRisk),
    recommendedIntensity: round3(clamp01((presenceDeficit * 0.35 + airDeficit * 0.25 + (1 - fakeAirRisk) * 0.15 + activity.mean * 0.25))),
  };
}

function getPresetShape(preset: AimixGlowSettings["preset"]) {
  switch (preset) {
    case "vocalBreath":
      return { maxPresenceBoostDb: 1.8, maxAirBoostDb: 1.2, maxGuardReductionDb: 1.2 };
    case "darkGloss":
      return { maxPresenceBoostDb: 0.8, maxAirBoostDb: 0.4, maxGuardReductionDb: 1.8 };
    case "brightButSafe":
      return { maxPresenceBoostDb: 1.1, maxAirBoostDb: 1.4, maxGuardReductionDb: 2.8 };
    case "cleanGlow":
      return { maxPresenceBoostDb: 0.9, maxAirBoostDb: 0.7, maxGuardReductionDb: 0.8 };
    case "aiStemRescue":
    case "custom":
    default:
      return { maxPresenceBoostDb: 1.4, maxAirBoostDb: 0.8, maxGuardReductionDb: 2.2 };
  }
}

function buildVocalActivity(channels: AimixGlowAudioChannel[], sampleRate: number, vocalAvailable: boolean) {
  const length = getCommonLength(channels);
  const frameSize = Math.max(256, Math.min(4096, Math.round(sampleRate * 0.046)));
  const hopSize = Math.max(128, Math.floor(frameSize / 4));
  const energies: number[] = [];
  for (let start = 0; start < length; start += hopSize) {
    let sum = 0;
    let count = 0;
    const end = Math.min(length, start + frameSize);
    for (let index = start; index < end; index += 1) {
      const sample = readMidSample(channels, index);
      sum += sample * sample;
      count += 1;
    }
    energies.push(gainToDb(Math.sqrt(sum / Math.max(1, count))));
  }
  const floor = percentile(energies, 20);
  let env = 0;
  let sumActivity = 0;
  const frames = new Float32Array(energies.length);
  let frameIndex = 0;
  for (const energy of energies) {
    const relative = smoothstep(floor + 6, floor + 18, energy);
    const absolute = smoothstep(-44, -24, energy);
    const target = Math.max(relative, vocalAvailable ? absolute * 0.95 : absolute * 0.35) * (vocalAvailable ? 1 : 0.55);
    env += (target - env) * (target > env ? 0.35 : 0.08);
    const activity = clamp01(env);
    frames[frameIndex] = activity;
    frameIndex += 1;
    sumActivity += activity;
  }
  return { mean: energies.length > 0 ? clamp01(sumActivity / energies.length) : 0, frames };
}

function estimateBandRmsDb(channels: AimixGlowAudioChannel[], sampleRate: number, lowHz: number, highHz: number, mode: "mid" | "side") {
  const length = getCommonLength(channels);
  const hp = makeHighpass(sampleRate, lowHz, 0.707);
  const lp = makeLowpass(sampleRate, highHz, 0.707);
  let hpState = createBiquadState();
  let lpState = createBiquadState();
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    const input = mode === "side" ? readSideSample(channels, index) : readMidSample(channels, index);
    const high = processBiquadSample(input, hp, hpState);
    const band = processBiquadSample(high, lp, lpState);
    sum += band * band;
  }
  return gainToDb(Math.sqrt(sum / Math.max(1, length)));
}

function applyPeakingToChannels(channels: AimixGlowAudioChannel[], sampleRate: number, frequency: number, gainDb: number, q: number) {
  applyBiquadToChannels(channels, makePeaking(sampleRate, frequency, gainDb, q));
}

function applyHighShelfToChannels(channels: AimixGlowAudioChannel[], sampleRate: number, frequency: number, gainDb: number, q: number) {
  applyBiquadToChannels(channels, makeHighShelf(sampleRate, frequency, gainDb, q));
}

function applyBiquadToChannels(channels: AimixGlowAudioChannel[], coefficients: BiquadCoefficients) {
  for (const channel of channels) {
    let state = createBiquadState();
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = sanitizeSample(processBiquadSample(channel[index] ?? 0, coefficients, state));
    }
  }
}

function applySoftGloss(channels: AimixGlowAudioChannel[], drive: number, mix: number) {
  const safeDrive = clamp(drive, 1.01, 1.35);
  const norm = Math.tanh(safeDrive);
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const dry = channel[index] ?? 0;
      const wet = Math.tanh(safeDrive * dry) / norm;
      channel[index] = sanitizeSample(dry + (wet - dry) * mix);
    }
  }
}

function analyzeBasicMetrics(channels: AimixGlowAudioChannel[], sampleRate: number): BasicMetrics {
  const length = getCommonLength(channels);
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      const sample = sanitizeSample(channel[index] ?? 0);
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
      count += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  const rmsDb = gainToDb(rms);
  return {
    peakDb: round2(gainToDb(peak)),
    lufsApprox: round2(rmsDb + LUFS_FROM_RMS_OFFSET_DB),
    rmsDb: round2(rmsDb),
    durationSec: round2(length / sampleRate),
  };
}

function normalizeSidechain(sidechain: AimixGlowAudioChannel[] | null | undefined, length: number) {
  if (!sidechain || sidechain.length === 0) return null;
  const common = getCommonLength(sidechain);
  if (!Number.isFinite(common) || common <= 0) return null;
  const usable = Math.min(length, common);
  if (usable <= 0) return null;
  return sidechain.map((channel) => channel.subarray(0, usable));
}

function cloneAndSanitizeChannels(inputChannels: AimixGlowAudioChannel[], warnings: string[]): AimixGlowAudioChannel[] {
  let replaced = 0;
  const sampleCount = getCommonLength(inputChannels);
  const channels = inputChannels.map((channel) => {
    const copy = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = channel[index] ?? 0;
      if (Number.isFinite(sample)) copy[index] = sample;
      else {
        copy[index] = 0;
        replaced += 1;
      }
    }
    return copy;
  });
  if (replaced > 0) warnings.push(`AIMIX Glow replaced ${replaced} invalid samples with silence.`);
  return channels;
}

function sanitizeChannelsInPlace(inputChannels: AimixGlowAudioChannel[], warnings: string[]): AimixGlowAudioChannel[] {
  let replaced = 0;
  for (const channel of inputChannels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index] ?? 0;
      if (!Number.isFinite(sample)) {
        channel[index] = 0;
        replaced += 1;
      }
    }
  }
  if (replaced > 0) warnings.push(`AIMIX Glow replaced ${replaced} invalid samples with silence.`);
  return inputChannels;
}

function applyPeakCeiling(channels: AimixGlowAudioChannel[], ceilingDb: number) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
  }
  const ceiling = dbToGain(ceilingDb);
  if (peak <= ceiling || peak <= 0) return { gainReductionDb: 0 };
  const gain = ceiling / peak;
  applyGain(channels, gain);
  return { gainReductionDb: round2(-gainToDb(gain)) };
}

function applyGain(channels: AimixGlowAudioChannel[], gain: number) {
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] = sanitizeSample((channel[index] ?? 0) * gain);
  }
}

function clampChannels(channels: AimixGlowAudioChannel[]) {
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] = Math.max(-1, Math.min(1, sanitizeSample(channel[index] ?? 0)));
  }
}

function readMidSample(channels: AimixGlowAudioChannel[], index: number) {
  if (channels.length === 1) return channels[0]?.[index] ?? 0;
  return ((channels[0]?.[index] ?? 0) + (channels[1]?.[index] ?? 0)) * 0.5;
}

function readSideSample(channels: AimixGlowAudioChannel[], index: number) {
  if (channels.length < 2) return 0;
  return ((channels[0]?.[index] ?? 0) - (channels[1]?.[index] ?? 0)) * 0.5;
}

function assertValidAudio(channels: AimixGlowAudioChannel[], sampleRate: number) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("AIMIX Glow received an invalid sample rate.");
  if (channels.length === 0) throw new Error("AIMIX Glow cannot process audio without channels.");
  const sampleCount = getCommonLength(channels);
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) throw new Error("AIMIX Glow cannot process empty audio.");
}

function getCommonLength(channels: AimixGlowAudioChannel[]) {
  return Math.min(...channels.map((channel) => channel.length));
}

function makeHighpass(sampleRate: number, frequency: number, q: number): BiquadCoefficients {
  const omega = 2 * Math.PI * clamp(frequency, 10, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  return normalizeBiquad((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

function makeLowpass(sampleRate: number, frequency: number, q: number): BiquadCoefficients {
  const omega = 2 * Math.PI * clamp(frequency, 20, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  return normalizeBiquad((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

function makePeaking(sampleRate: number, frequency: number, gainDb: number, q: number): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const omega = 2 * Math.PI * clamp(frequency, 20, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  return normalizeBiquad(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
}

function makeHighShelf(sampleRate: number, frequency: number, gainDb: number, q: number): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const omega = 2 * Math.PI * clamp(frequency, 20, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * Math.max(0.1, q));
  const sqrtA = Math.sqrt(a);
  return normalizeBiquad(
    a * ((a + 1) + (a - 1) * cos + 2 * sqrtA * alpha),
    -2 * a * ((a - 1) + (a + 1) * cos),
    a * ((a + 1) + (a - 1) * cos - 2 * sqrtA * alpha),
    (a + 1) - (a - 1) * cos + 2 * sqrtA * alpha,
    2 * ((a - 1) - (a + 1) * cos),
    (a + 1) - (a - 1) * cos - 2 * sqrtA * alpha,
  );
}

function normalizeBiquad(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefficients {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function createBiquadState() {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquadSample(input: number, coefficients: BiquadCoefficients, state: ReturnType<typeof createBiquadState>) {
  const y0 = coefficients.b0 * input + coefficients.b1 * state.x1 + coefficients.b2 * state.x2 - coefficients.a1 * state.y1 - coefficients.a2 * state.y2;
  state.x2 = state.x1;
  state.x1 = input;
  state.y2 = state.y1;
  state.y1 = y0;
  return sanitizeSample(y0);
}

function estimateInterSamplePeakMarginDb(channels: AimixGlowAudioChannel[], sampleCount: number) {
  let maxDelta = 0;
  for (const channel of channels) {
    for (let index = 1; index < sampleCount; index += 1) {
      maxDelta = Math.max(maxDelta, Math.abs((channel[index] ?? 0) - (channel[index - 1] ?? 0)));
    }
  }
  return clamp(maxDelta * 0.35, 0.1, 0.35);
}

function percentile(values: number[], amount: number) {
  if (values.length === 0) return -120;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((amount / 100) * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[index] ?? -120;
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, EPS));
  return t * t * (3 - 2 * t);
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function gainToDb(gain: number) {
  return gain > 0 ? 20 * Math.log10(Math.max(gain, EPS)) : -120;
}

function formatSignedDb(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} dB`;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
