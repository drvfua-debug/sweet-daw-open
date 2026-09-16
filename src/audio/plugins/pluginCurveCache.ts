import { sanitizeCurve } from "./pluginDspUtils";

export type WaveShaperCurve = Float32Array<ArrayBuffer>;

const curveCache = new Map<string, WaveShaperCurve>();
const MAX_CURVE_CACHE_SIZE = 96;

export function getCachedWaveShaperCurve(key: string, samples: number, factory: (samples: number) => Float32Array): WaveShaperCurve {
  const safeSamples = Math.max(2, Math.floor(samples));
  const cacheKey = `${key}:n=${safeSamples}`;
  const cached = curveCache.get(cacheKey);
  if (cached) return cached;

  const curve = sanitizeCurve(factory(safeSamples)) as WaveShaperCurve;
  if (curve.length !== safeSamples) {
    throw new Error(`WaveShaper curve length mismatch for ${key}: expected ${safeSamples}, got ${curve.length}`);
  }
  if (curveCache.size >= MAX_CURVE_CACHE_SIZE) {
    const firstKey = curveCache.keys().next().value;
    if (typeof firstKey === "string") curveCache.delete(firstKey);
  }
  curveCache.set(cacheKey, curve);
  return curve;
}

export function getPluginCurveCacheSize(): number {
  return curveCache.size;
}

export function clearPluginCurveCache(): void {
  curveCache.clear();
}
