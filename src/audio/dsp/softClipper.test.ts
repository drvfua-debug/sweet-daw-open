import { describe, expect, it } from "vitest";
import { processSoftClipperBuffer, softClipSample } from "./softClipper";

const baseParams = {
  mode: "soft" as const,
  driveDb: 0,
  ceilingDb: -1,
  knee: 0.55,
  hardness: 0.35,
  mix: 1,
  outputDb: 0,
};

describe("soft clipper DSP", () => {
  it("softly catches samples above the ceiling", () => {
    const out = softClipSample(1.6, baseParams);
    expect(out).toBeLessThanOrEqual(10 ** (-1 / 20));
    expect(out).toBeGreaterThan(0.65);
  });

  it("keeps small samples nearly unchanged before the knee", () => {
    expect(softClipSample(0.12, baseParams)).toBeCloseTo(0.12, 5);
    expect(softClipSample(-0.12, baseParams)).toBeCloseTo(-0.12, 5);
  });

  it("is symmetric for positive and negative samples", () => {
    const pos = softClipSample(1.4, { ...baseParams, hardness: 0.78 });
    const neg = softClipSample(-1.4, { ...baseParams, hardness: 0.78 });
    expect(pos).toBeCloseTo(-neg, 5);
  });

  it("sanitizes NaN and Infinity", () => {
    expect(softClipSample(Number.NaN, baseParams)).toBe(0);
    expect(softClipSample(Number.POSITIVE_INFINITY, baseParams)).toBe(0);
  });

  it("preserves channel count and duration", () => {
    const left = new Float32Array([0, 0.5, 1.4, -1.4]);
    const right = new Float32Array([0.1, -0.1, 0.8, -0.8]);
    const out = processSoftClipperBuffer([left, right], baseParams);

    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(left.length);
    expect(out[1]).toHaveLength(right.length);
    expect(out[0]).not.toBe(left);
  });

  it("mix 0 is dry when output gain is neutral", () => {
    const source = new Float32Array([0.2, 0.9, -0.9]);
    const out = processSoftClipperBuffer([source], { ...baseParams, driveDb: 8, mix: 0, outputDb: 0 });
    expect(Array.from(out[0])).toEqual(Array.from(source));
  });

  it("drive increases clipping pressure without creating invalid samples", () => {
    const dryDriven = 0.7 * 10 ** (8 / 20);
    const out = softClipSample(0.7, { ...baseParams, driveDb: 8, hardness: 0.6 });
    expect(out).toBeLessThan(dryDriven);
    expect(Number.isFinite(out)).toBe(true);
  });
});
