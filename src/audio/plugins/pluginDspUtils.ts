export type SafeAudioParamOptions = {
  smooth?: boolean;
  timeConstant?: number;
  fallback?: number;
  min?: number;
  max?: number;
};

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function finiteSample(value: number): number {
  return Number.isFinite(value) ? clamp(value, -1, 1) : 0;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function dbToGain(db: number): number {
  return 10 ** (finiteNumber(db, 0) / 20);
}

export function gainToDb(gain: number): number {
  const safeGain = Math.max(1e-9, finiteNumber(gain, 0));
  return 20 * Math.log10(safeGain);
}

export function sanitizeDb(value: unknown, fallback = 0, min = -24, max = 12): number {
  return clamp(finiteNumber(value, fallback), min, max);
}

export function sanitizeQ(value: unknown, fallback = 0.7): number {
  return clamp(finiteNumber(value, fallback), 0.05, 24);
}

export function sanitizeFrequency(value: unknown, fallback: number, sampleRate = 48000, minHz = 20): number {
  const nyquist = Math.max(minHz + 1, sampleRate / 2 - 1);
  return clamp(finiteNumber(value, fallback), minHz, nyquist);
}

export function roundForCache(value: number, precision = 4): number {
  const scale = 10 ** precision;
  return Math.round(finiteNumber(value, 0) * scale) / scale;
}

export function safeSetAudioParam(param: AudioParam, value: number, time: number, options: SafeAudioParamOptions = {}): void {
  const min = options.min ?? -Number.MAX_SAFE_INTEGER;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const safeValue = clamp(finiteNumber(value, options.fallback ?? 0), min, max);
  const safeTime = Math.max(0, finiteNumber(time, 0));
  try {
    if (options.smooth) {
      param.setTargetAtTime(safeValue, safeTime, Math.max(0.001, options.timeConstant ?? 0.01));
      return;
    }
    param.setValueAtTime(safeValue, safeTime);
  } catch {
    try {
      param.value = safeValue;
    } catch {
      // Some browsers can reject direct writes on disconnected/offline params. Ignore safely.
    }
  }
}

export function sanitizeCurve(curve: Float32Array): Float32Array {
  for (let index = 0; index < curve.length; index += 1) {
    curve[index] = finiteSample(curve[index] ?? 0);
  }
  return curve;
}

export function equalPowerDryWet(mix: number): { dry: number; wet: number } {
  const safeMix = clamp01(mix);
  return {
    dry: Math.cos(safeMix * Math.PI / 2),
    wet: Math.sin(safeMix * Math.PI / 2),
  };
}
