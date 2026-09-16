import { describe, expect, it } from "vitest";
import { analyzeRenderedBuffer, buildRenderedDamageGuard } from "./renderDamageGuard";

function makeSineBuffer(frequency: number, amplitude: number, sampleRate = 48000, length = 8192) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * amplitude;
    left[index] = value;
    right[index] = value;
  }
  return {
    length,
    numberOfChannels: 2,
    sampleRate,
    getChannelData(channel: number) {
      return channel === 0 ? left : right;
    },
  };
}

describe("render damage guard", () => {
  it("extracts basic rendered audio metrics", () => {
    const metrics = analyzeRenderedBuffer(makeSineBuffer(440, 0.25));

    expect(metrics.peakDb).toBeLessThan(0);
    expect(metrics.rmsDb).toBeLessThan(metrics.peakDb);
    expect(metrics.crestFactorDb).toBeGreaterThan(0);
  });

  it("flags risky rendered after states", () => {
    const before = makeSineBuffer(440, 0.2);
    const after = makeSineBuffer(9000, 0.95);
    const result = buildRenderedDamageGuard(before, after, ["track-1"]);

    expect(result.damageGuardReport.allowed).toBe(false);
    expect(result.damageGuardReport.warnings[0]).toContain("offline-rendered");
    expect(result.abCompareReport.beforeLabel).toBe("Rendered Before");
  });
});
