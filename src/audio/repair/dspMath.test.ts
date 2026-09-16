import { describe, expect, it } from "vitest";
import { applyEqualPowerFade, clamp, dbToGain, gainToDb, sanitizeFloat32, secondsToSample } from "./dspMath";

describe("repair dsp math", () => {
  it("clamps and sanitizes unsafe values", () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(sanitizeFloat32(Number.POSITIVE_INFINITY)).toBe(0);
    expect(Math.abs(sanitizeFloat32(4))).toBeLessThanOrEqual(1.25);
  });

  it("converts db/gain and sample indexes safely", () => {
    expect(dbToGain(-6)).toBeGreaterThan(0);
    expect(gainToDb(1)).toBeCloseTo(0, 5);
    expect(secondsToSample(-1, 48000, 100)).toBe(0);
    expect(secondsToSample(10, 10, 20)).toBe(20);
    expect(applyEqualPowerFade(0.5)).toBeGreaterThan(0.7);
  });
});