export type SoftClipperMode = "soft" | "medium" | "hard";

export type SoftClipperParams = {
  mode?: SoftClipperMode;
  driveDb: number;
  ceilingDb: number;
  knee: number;
  hardness: number;
  mix: number;
  outputDb: number;
};

export function softClipSample(sample: number, params: SoftClipperParams): number {
  const clean = sanitizeSample(sample);
  const shapedParams = resolveSoftClipperParams(params);
  const driven = clean * dbToGain(shapedParams.driveDb);
  const clipped = softClipDrivenSample(driven, shapedParams);
  const mixed = clean * (1 - shapedParams.mix) + clipped * shapedParams.mix;
  return clamp(mixed * dbToGain(shapedParams.outputDb), -1, 1);
}

export function processSoftClipperBuffer(
  channels: Float32Array[],
  params: SoftClipperParams,
  options: { copy?: boolean } = {},
): Float32Array[] {
  const shapedParams = resolveSoftClipperParams(params);
  const output = options.copy === false ? channels : channels.map((channel) => new Float32Array(channel));

  for (const channel of output) {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = softClipSample(channel[index] ?? 0, shapedParams);
    }
  }

  return output;
}

export function buildSoftClipperCurve(params: SoftClipperParams, length = 2048): Float32Array<ArrayBuffer> {
  const shapedParams = resolveSoftClipperParams({ ...params, driveDb: 0, mix: 1, outputDb: 0 });
  const size = Math.max(16, Math.floor(length));
  const curve = new Float32Array(size) as Float32Array<ArrayBuffer>;
  for (let index = 0; index < size; index += 1) {
    const sample = (index * 2) / (size - 1) - 1;
    curve[index] = softClipDrivenSample(sample, shapedParams);
  }
  return curve;
}

export function resolveSoftClipperParams(params: SoftClipperParams): Required<SoftClipperParams> {
  const mode = params.mode === "hard" || params.mode === "medium" || params.mode === "soft" ? params.mode : "soft";
  const modeParams = resolveModeParams(mode);
  return {
    mode,
    driveDb: clampFinite(params.driveDb, 0, 12, 2),
    ceilingDb: clampFinite(params.ceilingDb, -6, -0.1, -1),
    knee: clampFinite(params.knee, 0, 1, modeParams.knee),
    hardness: clampFinite(params.hardness, 0, 1, modeParams.hardness),
    mix: clampFinite(params.mix, 0, 1, 0.65),
    outputDb: clampFinite(params.outputDb, -12, 6, -0.3),
  };
}

function softClipDrivenSample(sample: number, params: Required<SoftClipperParams>): number {
  const x = sanitizeSample(sample);
  const ceiling = dbToGain(params.ceilingDb);
  const sign = Math.sign(x);
  const abs = Math.abs(x);
  const kneeStart = ceiling * (1 - 0.55 * params.knee);
  if (abs <= kneeStart) return x;

  const over = abs - kneeStart;
  const range = Math.max(1e-6, ceiling - kneeStart);
  const hardnessScale = 1 + params.hardness * 5;
  const shaped = kneeStart + (range * Math.tanh((over / range) * hardnessScale)) / Math.tanh(hardnessScale);
  return sign * Math.min(ceiling, shaped);
}

function resolveModeParams(mode: SoftClipperMode) {
  if (mode === "hard") return { knee: 0.22, hardness: 0.78 };
  if (mode === "medium") return { knee: 0.38, hardness: 0.55 };
  return { knee: 0.55, hardness: 0.35 };
}

function sanitizeSample(sample: number) {
  return Number.isFinite(sample) ? sample : 0;
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function clampFinite(value: number, min: number, max: number, fallback: number) {
  return clamp(Number.isFinite(value) ? value : fallback, min, max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
