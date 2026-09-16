import { describe, expect, it } from "vitest";
import type { PeakMaximizerReport } from "@/audio/dsp/PeakMaximizer";
import {
  OfflineRenderMemoryPreflightError,
  PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING,
  SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER,
  assertOfflineRenderMemoryWithinBudget,
  createPeakMaximizerRenderWarnings,
  estimateOfflineRenderMemoryBytes,
} from "./OfflineRenderer";
import { capPeakMaximizerOversample, resolveEngineProcessingBudget } from "./EngineQualityMode";

describe("Sweet DAW offline render processing order", () => {
  it("keeps repair before unmask and peak safety after the master bus", () => {
    expect(SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER).toEqual([
      "clip_region_repair",
      "aimix_unmask",
      "clip_gain",
      "clip_pan",
      "clip_insert_chain",
      "track_corrective_eq",
      "character",
      "compressor_leveler",
      "insert_plugin_chain",
      "vocal_duck",
      "vocal_image_layer",
      "pan_spatial",
      "track_gain",
      "sends_ambience",
      "mix_bus_trim",
      "master_corrective_eq",
      "master_compressor",
      "master_insert_chain",
      "master_gain",
      "limiter_or_peak_maximizer",
      "final_output_trim",
      "export_peak_safety",
    ]);
    expect(SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("clip_region_repair")).toBeLessThan(
      SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("aimix_unmask"),
    );
    expect(SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("clip_insert_chain")).toBeLessThan(
      SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("track_corrective_eq"),
    );
    expect(SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("sends_ambience")).toBeLessThan(
      SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("mix_bus_trim"),
    );
    expect(SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("master_gain")).toBeLessThan(
      SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.indexOf("limiter_or_peak_maximizer"),
    );
    expect(SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER.at(-1)).toBe("export_peak_safety");
  });

  it("uses EngineQualityMode budgets to cap heavy PeakMax export settings", () => {
    const mobile = resolveEngineProcessingBudget("mobile-export");
    const desktop = resolveEngineProcessingBudget("desktop-export");

    expect(capPeakMaximizerOversample("4x", mobile.peakMaxOversampleCap)).toBe("2x");
    expect(capPeakMaximizerOversample("4x", desktop.peakMaxOversampleCap)).toBe("4x");
    expect(mobile.allowCandidateRender).toBe(false);
    expect(desktop.allowCandidateRender).toBe(true);
  });

  it("converts PeakMaximizer memory bypass reports into render warnings", () => {
    const warnings = createPeakMaximizerRenderWarnings(makePeakMaxReport({ memoryExceeded: true }));

    expect(warnings).toContain(PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING);
    expect(warnings.join(" ")).toContain("final peak trim only");
  });

  it("detects unsafe long renders before OfflineAudioContext allocation", () => {
    const estimate = estimateOfflineRenderMemoryBytes({
      frameCount: 48000 * 60 * 45,
      channels: 2,
      sampleRate: 48000,
      includePeakMaximizer: true,
      peakMaximizerMemoryBytes: 128 * 1024 * 1024,
    });

    expect(estimate).toBeGreaterThan(128 * 1024 * 1024);
    expect(() => assertOfflineRenderMemoryWithinBudget({
      frameCount: 48000 * 60 * 45,
      channels: 2,
      sampleRate: 48000,
      includePeakMaximizer: true,
      peakMaximizerMemoryBytes: 128 * 1024 * 1024,
      memoryBudgetBytes: 96 * 1024 * 1024,
    })).toThrow(OfflineRenderMemoryPreflightError);
  });
});

function makePeakMaxReport(patch: Partial<PeakMaximizerReport> = {}): PeakMaximizerReport {
  return {
    inputPeakDb: -1,
    outputPeakDb: -1,
    truePeakEstimateDb: -1,
    maxGainReductionDb: 0,
    avgGainReductionDb: 0,
    appliedDriveDb: 0,
    truePeakTrimDb: 0,
    limitedSamples: 0,
    effectiveOversample: "off",
    memoryBudgetBytes: 16 * 1024 * 1024,
    estimatedMemoryBytes: 64 * 1024 * 1024,
    memoryFallbackApplied: true,
    memoryExceeded: false,
    ...patch,
  };
}
