import { describe, expect, it } from "vitest";
import { applyDownOnlyPeakSafetyToChannels } from "./AudioExportSafety";

describe("applyDownOnlyPeakSafetyToChannels", () => {
  it("attenuates only when samples exceed the ceiling", () => {
    const channels = [new Float32Array([0.25, -1.2, 0.5])];
    const report = applyDownOnlyPeakSafetyToChannels(channels, -1);

    expect(report.action).toBe("attenuated");
    expect(report.appliedGainDb).toBeLessThan(0);
    expect(Math.max(...Array.from(channels[0]).map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 0.000001);
  });

  it("never boosts quiet audio", () => {
    const channels = [new Float32Array([0.05, -0.1, 0.2])];
    const before = Array.from(channels[0]);
    const report = applyDownOnlyPeakSafetyToChannels(channels, -1);

    expect(report.action).toBe("none");
    expect(report.appliedGainDb).toBe(0);
    expect(Array.from(channels[0])).toEqual(before);
  });

  it("sanitizes invalid samples without amplifying the rest", () => {
    const channels = [new Float32Array([0.2, Number.NaN, Number.POSITIVE_INFINITY, -0.3])];
    const report = applyDownOnlyPeakSafetyToChannels(channels, -1);

    expect(report.action).toBe("sanitized");
    expect(report.invalidSampleCount).toBe(2);
    expect(channels[0][0]).toBeCloseTo(0.2, 6);
    expect(channels[0][1]).toBe(0);
    expect(channels[0][2]).toBe(0);
    expect(channels[0][3]).toBeCloseTo(-0.3, 6);
    expect(report.appliedGainDb).toBe(0);
  });
});
