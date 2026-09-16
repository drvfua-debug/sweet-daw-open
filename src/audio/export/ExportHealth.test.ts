import { describe, expect, it } from "vitest";
import { analyzeAndSanitizeExportChannels, createExportHealthAccumulator, formatExportHealthWarnings } from "./ExportHealth";

describe("analyzeAndSanitizeExportChannels", () => {
  it("repairs invalid samples and reports clipping risk", () => {
    const channel = Float32Array.from([0, Number.NaN, Number.POSITIVE_INFINITY, 1.1, -0.99]);
    const report = analyzeAndSanitizeExportChannels([channel]);

    expect(channel[1]).toBe(0);
    expect(channel[2]).toBe(0);
    expect(report.nanSamples).toBe(1);
    expect(report.infSamples).toBe(1);
    expect(report.clippedSamples).toBe(1);
    expect(report.nearClipSamples).toBe(2);
    expect(formatExportHealthWarnings(report).length).toBeGreaterThan(0);
  });

  it("marks fully silent output", () => {
    const report = analyzeAndSanitizeExportChannels([new Float32Array(16)]);

    expect(report.silent).toBe(true);
    expect(report.silentChunks).toBe(1);
    expect(report.maxConsecutiveSilentChunks).toBe(1);
    expect(formatExportHealthWarnings(report)).toContain("Export health detected a silent render.");
  });

  it("streams chunk health without keeping a full PCM copy", () => {
    const accumulator = createExportHealthAccumulator();
    accumulator.add([Float32Array.from([0, Number.NaN, 0.25])]);
    accumulator.add([new Float32Array(8)]);
    accumulator.add([new Float32Array(8)]);
    accumulator.add([new Float32Array(8)]);

    const report = accumulator.finish();

    expect(report.nanSamples).toBe(1);
    expect(report.silent).toBe(false);
    expect(report.silentChunks).toBe(3);
    expect(report.maxConsecutiveSilentChunks).toBe(3);
    expect(formatExportHealthWarnings(report).join(" ")).toContain("consecutive silent chunk");
  });
});
