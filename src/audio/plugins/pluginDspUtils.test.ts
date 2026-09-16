import { describe, expect, it } from "vitest";
import { clamp, dbToGain, finiteNumber, finiteSample, gainToDb, sanitizeFrequency, sanitizeQ } from "./pluginDspUtils";

describe("plugin DSP utilities", () => {
  it("keeps NaN and infinite values out of DSP calculations", () => {
    expect(finiteNumber(Number.NaN, 7)).toBe(7);
    expect(finiteNumber(Number.POSITIVE_INFINITY, -2)).toBe(-2);
    expect(finiteSample(Number.NaN)).toBe(0);
    expect(finiteSample(2)).toBe(1);
    expect(finiteSample(-2)).toBe(-1);
  });

  it("sanitizes common Web Audio parameter ranges", () => {
    expect(clamp(99, 0, 3)).toBe(3);
    expect(sanitizeQ(100)).toBe(24);
    expect(sanitizeFrequency(96000, 1000, 48000)).toBe(23999);
  });

  it("converts gain and dB consistently", () => {
    expect(dbToGain(0)).toBeCloseTo(1, 6);
    expect(gainToDb(1)).toBeCloseTo(0, 6);
    expect(gainToDb(0)).toBeLessThan(-170);
  });
});