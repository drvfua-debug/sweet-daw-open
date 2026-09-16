import { describe, expect, it } from "vitest";
import { analyzeRepairIssues } from "@/audio/repair/repairAnalysis";
import { applySpectralBrushOperationsToChannels, brushOperationToRepairRegion, buildSpectralProblemHeatmapFrames, createSpectralBrushOperation } from "../spectralBrushOps";
import { createSweetSpectralSelection } from "../spectralSelection";
import type { Clip } from "@/daw/model/Project";

const clip: Clip = {
  id: "clip-1",
  trackId: "track-1",
  fileId: "file-1",
  timelineStartSec: 0,
  sourceStartSec: 0,
  durationSec: 1,
  gainDb: 0,
  fadeInSec: 0,
  fadeOutSec: 0,
  reverse: false,
  stretchRatio: null,
  pitchShiftSemitones: null,
  lockedToGrid: false,
  role: "other",
  intentTags: [],
  actionHistory: [],
  movementLocked: false,
  insertChain: [],
};

describe("Spectral Editor Pro Lite brush operations", () => {
  it("creates normalized time-frequency selections", () => {
    const selection = createSweetSpectralSelection({ startSec: 1, endSec: 0.5, minHz: 9000, maxHz: 3000, shape: "rectangle" });
    expect(selection.startSec).toBe(0.5);
    expect(selection.endSec).toBe(1);
    expect(selection.minHz).toBe(3000);
    expect(selection.maxHz).toBe(9000);
  });

  it("maps brush operations into saved repair regions", () => {
    const operation = createSpectralBrushOperation({
      kind: "chirp-soften",
      amount: 0.5,
      selection: createSweetSpectralSelection({ startSec: 0.1, endSec: 0.3, minHz: 7000, maxHz: 13000, shape: "rectangle" }),
    });
    const region = brushOperationToRepairRegion(operation, { clip, fileId: clip.fileId, trackId: clip.trackId });
    expect(region.clipId).toBe(clip.id);
    expect(region.operation).toBe("dechirp_lite");
    expect(region.fixed).toBe(false);
    expect(region.enabled).toBe(true);
  });

  it("attenuates only the selected time range and creates removed material", () => {
    const sampleRate = 1000;
    const input = new Float32Array(1000).fill(1);
    const operation = createSpectralBrushOperation({
      kind: "attenuate",
      amount: 1,
      selection: createSweetSpectralSelection({ startSec: 0.2, endSec: 0.4, shape: "time-range", featherTimeSec: 0 }),
    });
    const result = applySpectralBrushOperationsToChannels([input], sampleRate, [operation]);
    expect(result.appliedOperationIds).toContain(operation.id);
    expect(result.channels[0]?.[300]).toBeLessThan(0.5);
    expect(result.channels[0]?.[100]).toBeCloseTo(1, 3);
    expect(result.removed[0]?.[300]).toBeGreaterThan(0.5);
  });

  it("smooths a short click without muting the whole clip", () => {
    const sampleRate = 1000;
    const input = new Float32Array(1000);
    input[500] = 1;
    const operation = createSpectralBrushOperation({
      kind: "click-smooth",
      amount: 1,
      selection: createSweetSpectralSelection({ startSec: 0.49, endSec: 0.51, shape: "time-range", featherTimeSec: 0 }),
    });
    const result = applySpectralBrushOperationsToChannels([input], sampleRate, [operation]);
    expect(result.channels[0]?.[500]).toBeLessThan(0.7);
    expect(result.channels[0]?.[100]).toBeCloseTo(0, 3);
  });

  it("builds problem heatmap scores from repair analysis", () => {
    const sampleRate = 1000;
    const input = new Float32Array(1000);
    input[300] = 1;
    const analysis = analyzeRepairIssues([input], sampleRate, { durationSec: 1, frameMs: 50 });
    const frames = buildSpectralProblemHeatmapFrames(analysis);
    expect(frames.length).toBeGreaterThan(0);
    expect(Math.max(...frames.map((frame) => frame.scores.clickRisk))).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.scores.clipRisk >= 0 && frame.scores.clipRisk <= 1)).toBe(true);
  });
});