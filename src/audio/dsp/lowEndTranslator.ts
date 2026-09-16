export type LowEndTranslatorMode = "subToBass" | "808Audibility" | "warmBass";

export type LowEndTranslatorParams = {
  mode: LowEndTranslatorMode;
  amount: number;
  drive: number;
  sourceLowHz: number;
  translateHz: number;
  upperHarmonicHz: number;
  lowCutHz: number;
  subGuardHz: number;
  subGuardDb: number;
  mix: number;
  outputDb: number;
  monoSafe: boolean;
};

const DEFAULTS: LowEndTranslatorParams = {
  mode: "subToBass",
  amount: 0.24,
  drive: 0.16,
  sourceLowHz: 58,
  translateHz: 115,
  upperHarmonicHz: 185,
  lowCutHz: 30,
  subGuardHz: 55,
  subGuardDb: -0.7,
  mix: 0.16,
  outputDb: -0.4,
  monoSafe: true,
};

export function sanitizeLowEndTranslatorParams(params: Partial<LowEndTranslatorParams> = {}): LowEndTranslatorParams {
  const mode = params.mode === "808Audibility" || params.mode === "warmBass" || params.mode === "subToBass"
    ? params.mode
    : DEFAULTS.mode;
  return {
    mode,
    amount: clamp(readNumber(params.amount, DEFAULTS.amount), 0, 1),
    drive: clamp(readNumber(params.drive, DEFAULTS.drive), 0, 1),
    sourceLowHz: clamp(readNumber(params.sourceLowHz, DEFAULTS.sourceLowHz), 35, 95),
    translateHz: clamp(readNumber(params.translateHz, DEFAULTS.translateHz), 75, 180),
    upperHarmonicHz: clamp(readNumber(params.upperHarmonicHz, DEFAULTS.upperHarmonicHz), 120, 320),
    lowCutHz: clamp(readNumber(params.lowCutHz, DEFAULTS.lowCutHz), 22, 45),
    subGuardHz: clamp(readNumber(params.subGuardHz, DEFAULTS.subGuardHz), 45, 85),
    subGuardDb: clamp(readNumber(params.subGuardDb, DEFAULTS.subGuardDb), -2.5, 0),
    mix: clamp(readNumber(params.mix, DEFAULTS.mix), 0, 0.5),
    outputDb: clamp(readNumber(params.outputDb, DEFAULTS.outputDb), -8, 3),
    monoSafe: typeof params.monoSafe === "boolean" ? params.monoSafe : DEFAULTS.monoSafe,
  };
}

export function shapeLowEndTranslatorSample(sample: number, params: LowEndTranslatorParams): number {
  const safeSample = sanitizeSample(sample);
  const safe = sanitizeLowEndTranslatorParams(params);
  if (safe.mix <= 0 || safe.amount <= 0) return applyOutput(safeSample, safe.outputDb);

  const modeTone = safe.mode === "808Audibility" ? 1.18 : safe.mode === "warmBass" ? 0.82 : 1;
  const drive = 1 + safe.drive * 5.5 + safe.amount * 1.4;
  const driven = safeSample * drive;
  const odd = Math.tanh(driven) / Math.tanh(drive);
  const even = (safeSample * safeSample * Math.sign(safeSample || 1)) * safe.amount * 0.24 * modeTone;
  const translated = clamp(odd * (0.86 + safe.amount * 0.1) + even, -1, 1);
  const mixed = safeSample * (1 - safe.mix) + translated * safe.mix;
  return clamp(applyOutput(mixed, safe.outputDb), -1, 1);
}

export function buildLowEndTranslatorCurve(params: Partial<LowEndTranslatorParams> = {}, samples = 2048) {
  const safe = sanitizeLowEndTranslatorParams(params);
  const length = Math.max(64, Math.floor(samples));
  const curve = new Float32Array(length);
  const curveParams = {
    ...safe,
    mix: 1,
    outputDb: 0,
  };
  for (let index = 0; index < length; index += 1) {
    const sample = (index * 2) / (length - 1) - 1;
    curve[index] = shapeLowEndTranslatorSample(sample, curveParams);
  }
  return curve;
}

export function processLowEndTranslatorBuffer<T extends Float32Array<ArrayBufferLike>>(
  channels: T[],
  params: Partial<LowEndTranslatorParams> = {},
  options: { copy?: boolean; sampleRate?: number } = {},
): T[] {
  const safe = sanitizeLowEndTranslatorParams(params);
  const output = options.copy === false ? channels : channels.map((channel) => new Float32Array(channel) as T);
  if (safe.mix <= 0 || safe.amount <= 0) {
    for (const channel of output) {
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = shapeLowEndTranslatorSample(channel[index] ?? 0, safe);
      }
    }
    return output;
  }

  const sampleRate = clamp(readNumber(options.sampleRate, 44100), 8000, 192000);
  for (const channel of output) processLowEndTranslatorChannel(channel, safe, sampleRate);
  if (safe.monoSafe && output.length >= 2) applyMonoSafeLowSide(output[0]!, output[1]!, sampleRate);
  return output;
}

function processLowEndTranslatorChannel<T extends Float32Array<ArrayBufferLike>>(channel: T, params: LowEndTranslatorParams, sampleRate: number) {
  const source = new Float32Array(channel);
  const invalid = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    if (!Number.isFinite(source[index])) invalid[index] = 1;
    source[index] = sanitizeSample(source[index] ?? 0);
  }
  const lowBand = applyBandPass(source, sampleRate, params.sourceLowHz, 0.9);
  const harmonic = new Float32Array(channel.length);
  const harmonicDrive = 1 + params.drive * 7 + params.amount * 2;
  for (let index = 0; index < harmonic.length; index += 1) {
    const low = lowBand[index] ?? 0;
    const driven = Math.tanh(low * harmonicDrive);
    harmonic[index] = driven - low * 0.35;
  }

  const translated = applyBandPass(harmonic, sampleRate, params.translateHz, 1.15);
  const upper = applyBandPass(harmonic, sampleRate, params.upperHarmonicHz, 1.05);
  const guardedDry = applyHighPass(source, sampleRate, params.lowCutHz);
  applyLowShelfTrimInPlace(guardedDry, sampleRate, params.subGuardHz, params.subGuardDb);

  const modeTone = params.mode === "808Audibility" ? 1.25 : params.mode === "warmBass" ? 0.78 : 1;
  const wetGain = params.mix * params.amount * modeTone;
  const outputGain = 10 ** (params.outputDb / 20);
  for (let index = 0; index < channel.length; index += 1) {
    const dry = guardedDry[index] ?? 0;
    const wet = (translated[index] ?? 0) + (upper[index] ?? 0) * 0.55;
    channel[index] = invalid[index] ? 0 : clamp((dry + wet * wetGain) * outputGain, -1, 1);
  }
}

function applyHighPass(input: Float32Array, sampleRate: number, cutoffHz: number) {
  const low = applyLowPass(input, sampleRate, cutoffHz);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) output[index] = (input[index] ?? 0) - (low[index] ?? 0);
  return output;
}

function applyLowPass(input: Float32Array, sampleRate: number, cutoffHz: number) {
  const output = new Float32Array(input.length);
  const alpha = onePoleAlpha(cutoffHz, sampleRate);
  let state = 0;
  for (let index = 0; index < input.length; index += 1) {
    state += alpha * ((input[index] ?? 0) - state);
    output[index] = state;
  }
  return output;
}

function applyBandPass(input: Float32Array, sampleRate: number, centerHz: number, q: number) {
  const high = Math.min(sampleRate * 0.45, centerHz * (1 + 1 / Math.max(0.35, q)));
  const low = Math.max(20, centerHz / (1 + 1 / Math.max(0.35, q)));
  const lowPassed = applyLowPass(input, sampleRate, high);
  const lowRemoved = applyLowPass(input, sampleRate, low);
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) output[index] = (lowPassed[index] ?? 0) - (lowRemoved[index] ?? 0);
  return output;
}

function applyLowShelfTrimInPlace(channel: Float32Array, sampleRate: number, cutoffHz: number, gainDb: number) {
  if (gainDb >= -0.001) return;
  const low = applyLowPass(channel, sampleRate, cutoffHz);
  const gain = 10 ** (gainDb / 20);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] += (low[index] ?? 0) * (gain - 1);
  }
}

function applyMonoSafeLowSide(left: Float32Array, right: Float32Array, sampleRate: number) {
  const length = Math.min(left.length, right.length);
  const side = new Float32Array(length);
  for (let index = 0; index < length; index += 1) side[index] = ((left[index] ?? 0) - (right[index] ?? 0)) * 0.5;
  const lowSide = applyLowPass(side, sampleRate, 120);
  for (let index = 0; index < length; index += 1) {
    const trim = (lowSide[index] ?? 0) * 0.85;
    left[index] = clamp((left[index] ?? 0) - trim, -1, 1);
    right[index] = clamp((right[index] ?? 0) + trim, -1, 1);
  }
}

function onePoleAlpha(cutoffHz: number, sampleRate: number) {
  const x = Math.exp((-2 * Math.PI * clamp(cutoffHz, 1, sampleRate * 0.45)) / sampleRate);
  return clamp(1 - x, 0.00001, 1);
}

function applyOutput(sample: number, outputDb: number) {
  return sample * (10 ** (outputDb / 20));
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
