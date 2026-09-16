import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@/daw/model/Project";
import type { SweetExportStabilityPlan } from "./ExportStabilityPlanner";

const mocks = vi.hoisted(() => {
  const writeChunk = vi.fn(async () => undefined);
  const cleanup = vi.fn(async () => undefined);
  return {
    writeChunk,
    cleanup,
    renderProjectOfflineChunked: vi.fn(async (_project, _registry, options) => {
      await options.onChunk?.({
        index: 0,
        startSec: 0,
        endSec: 0.01,
        channels: [new Float32Array(441), new Float32Array(441)],
      });
      return { renderedChunks: 1, totalChunks: 1, renderedTrackBatches: 1, boundarySmoothing: true };
    }),
    createWavExportWriter: vi.fn(async () => ({
      storageMode: "memory",
      fallbackReason: null,
      writeChunk,
      finish: async () => new Blob([new Uint8Array(48)], { type: "audio/wav" }),
      abort: async () => undefined,
      cleanup,
      getWrittenFrames: () => 441,
    })),
  };
});

vi.mock("@/audio/engine/ChunkedOfflineRenderer", () => ({
  renderProjectOfflineChunked: mocks.renderProjectOfflineChunked,
}));
vi.mock("@/audio/export/WavStreamingEncoder", () => ({
  createWavExportWriter: mocks.createWavExportWriter,
}));
vi.mock("@/audio/engine/StreamingWavSource", () => ({
  releaseStreamableProjectBuffers: async () => ({ releasedFileIds: [], releasedBytes: 0, retainedFileIds: [] }),
}));

import { exportMasterWavWithStableRenderer } from "./StableMasterExport";

describe("exportMasterWavWithStableRenderer", () => {
  it("continues master WAV export even when an old plan carries a split/package strategy", async () => {
    const project = createEmptyProject();
    const plan: SweetExportStabilityPlan = {
      strategy: "split-stem-package",
      risk: "high",
      reason: ["test"],
      sampleRate: 44100,
      durationSec: 0.01,
      trackCount: 40,
      clipCount: 40,
      activeStemCount: 40,
      repairRegionCount: 0,
      unmaskOperationCount: 0,
      heavyPluginCount: 0,
      estimatedFullRenderMb: 120,
      estimatedPeakMemoryMb: 480,
      memoryBudgetMb: 384,
      chunkSec: 0.25,
      renderPaddingSec: 0.1,
      trackBatchSize: 1,
      maxZipPartMb: 768,
      allowSingleZip: false,
      allowFullOfflineRender: false,
      retryPlan: [{ chunkSec: 0.25, trackBatchSize: 1, sampleRate: 44100 }],
      warnings: [],
    };

    const result = await exportMasterWavWithStableRenderer(project, { plan });
    expect(result.blob.type).toBe("audio/wav");
    expect(mocks.writeChunk).toHaveBeenCalled();
    await result.cleanup();
    expect(mocks.cleanup).toHaveBeenCalled();
  });
});
