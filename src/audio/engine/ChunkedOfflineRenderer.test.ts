import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@/daw/model/Project";
import { applyChunkBoundarySmoothing, renderProjectOfflineChunked, resolveAdaptiveSourceChunkSec } from "./ChunkedOfflineRenderer";

describe("renderProjectOfflineChunked", () => {
  it("honors AbortSignal before starting OfflineAudioContext work", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderProjectOfflineChunked(createEmptyProject(), undefined, {
        sampleRate: 44100,
        chunkSec: 1,
        renderPaddingSec: 0.1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("smooths internal chunk edges without muting the chunk", () => {
    const channel = Float32Array.from([1, -1, 1, -1, 0.8, -0.8, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1]);

    applyChunkBoundarySmoothing([channel], 44100, 1, 3);

    expect(Math.abs(channel[1])).toBeLessThan(1);
    expect(Math.abs(channel[channel.length - 2]!)).toBeLessThan(1);
    expect(Math.max(...Array.from(channel).map(Math.abs))).toBeGreaterThan(0.5);
  });

  it("shrinks time windows as stem count grows instead of rejecting the render", () => {
    const eightStems = resolveAdaptiveSourceChunkSec({
      requestedChunkSec: 2,
      renderPaddingSec: 0.75,
      activeTrackCount: 8,
      sampleRate: 48000,
    });
    const manyStems = resolveAdaptiveSourceChunkSec({
      requestedChunkSec: 2,
      renderPaddingSec: 0.75,
      activeTrackCount: 96,
      sampleRate: 48000,
    });

    expect(eightStems).toBe(2);
    expect(manyStems).toBe(0.25);
  });
});
