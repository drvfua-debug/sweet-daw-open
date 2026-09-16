import { beforeEach, describe, expect, it } from "vitest";
import { clearPluginCurveCache, getCachedWaveShaperCurve, getPluginCurveCacheSize } from "./pluginCurveCache";

describe("plugin curve cache", () => {
  beforeEach(() => clearPluginCurveCache());

  it("reuses sanitized waveshaper curves for identical keys", () => {
    const first = getCachedWaveShaperCurve("shape", 4, () => new Float32Array([Number.NaN, -2, 0.25, 2]));
    const second = getCachedWaveShaperCurve("shape", 4, () => new Float32Array([0, 0, 0, 0]));

    expect(second).toBe(first);
    expect(Array.from(first)).toEqual([0, -1, 0.25, 1]);
    expect(getPluginCurveCacheSize()).toBe(1);
  });

  it("separates entries by sample count", () => {
    getCachedWaveShaperCurve("shape", 4, (samples) => new Float32Array(samples));
    getCachedWaveShaperCurve("shape", 8, (samples) => new Float32Array(samples));
    expect(getPluginCurveCacheSize()).toBe(2);
  });
});