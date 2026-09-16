import { describe, expect, it } from "vitest";
import { SweetAnalysisCache } from "./analysisCache";
import { createChunkPlan } from "./chunkPlan";
import { SweetProcessingQueue, runChunked } from "./processingJobs";

describe("chunked processing queue v0.4", () => {
  it("creates a chunk plan that covers every frame without gaps", () => {
    const plan = createChunkPlan({ sampleRate: 48000, totalFrames: 48000 * 11, preferredChunkSeconds: 2, overlapSeconds: 0.1 });

    expect(plan.sampleRate).toBe(48000);
    expect(plan.totalFrames).toBe(528000);
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks[0]?.startFrame).toBe(0);
    expect(plan.chunks.at(-1)?.endFrame).toBe(plan.totalFrames);

    for (let index = 0; index < plan.chunks.length; index += 1) {
      const chunk = plan.chunks[index]!;
      expect(Number.isFinite(chunk.startFrame)).toBe(true);
      expect(Number.isFinite(chunk.endFrame)).toBe(true);
      expect(chunk.endFrame).toBeGreaterThan(chunk.startFrame);
      if (index > 0) expect(chunk.startFrame).toBe(plan.chunks[index - 1]!.endFrame);
    }
  });

  it("keeps overlap read ranges inside the source bounds", () => {
    const plan = createChunkPlan({ sampleRate: 44100, totalFrames: 44100 * 5 + 123, preferredChunkSeconds: 1, overlapSeconds: 0.25 });

    for (const chunk of plan.chunks) {
      expect(chunk.readStartFrame).toBeGreaterThanOrEqual(0);
      expect(chunk.readEndFrame).toBeLessThanOrEqual(plan.totalFrames);
      expect(chunk.readStartFrame).toBeLessThanOrEqual(chunk.startFrame);
      expect(chunk.readEndFrame).toBeGreaterThanOrEqual(chunk.endFrame);
    }
  });

  it("respects maxChunks by increasing chunk size instead of dropping frames", () => {
    const plan = createChunkPlan({ sampleRate: 1000, totalFrames: 10000, preferredChunkSeconds: 1, maxChunks: 3 });

    expect(plan.chunks.length).toBeLessThanOrEqual(3);
    expect(plan.chunks[0]?.startFrame).toBe(0);
    expect(plan.chunks.at(-1)?.endFrame).toBe(10000);
  });

  it("runs chunks with monotonic progress and combines results", async () => {
    const plan = createChunkPlan({ sampleRate: 1000, totalFrames: 5000, preferredChunkSeconds: 1 });
    const percents: number[] = [];

    const result = await runChunked({
      plan,
      onProgress: (progress) => percents.push(progress.percent),
      processChunk: (chunk) => chunk.endFrame - chunk.startFrame,
      combine: (values) => values.reduce((sum, value) => sum + value, 0),
    });

    expect(result).toBe(5000);
    expect(percents[0]).toBe(0);
    expect(percents.at(-1)).toBe(100);
    for (let index = 1; index < percents.length; index += 1) {
      expect(percents[index]!).toBeGreaterThanOrEqual(percents[index - 1]!);
      expect(Number.isFinite(percents[index]!)).toBe(true);
    }
  });

  it("stops with AbortError when cancelled", async () => {
    const plan = createChunkPlan({ sampleRate: 1000, totalFrames: 5000, preferredChunkSeconds: 1 });
    const controller = new AbortController();
    let processed = 0;

    await expect(runChunked({
      plan,
      signal: controller.signal,
      processChunk: (chunk) => {
        processed += 1;
        if (processed === 2) controller.abort();
        return chunk.index;
      },
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(processed).toBe(2);
  });

  it("tracks queue state, cancellation, cleanup, and summaries", () => {
    const queue = new SweetProcessingQueue();
    const id = queue.enqueue({ id: "job-1", kind: "spectrogram", priority: 10, params: { fileId: "file-1" } });

    expect(id).toBe("job-1");
    expect(queue.getJob(id)?.status).toBe("queued");
    queue.updateStatus(id, "running", { progress: { completedChunks: 1, totalChunks: 4, percent: 25, currentLabel: "Chunk 1/4" } });
    expect(queue.getSummary()).toMatchObject({ runningJobs: 1, currentPercent: 25 });
    queue.cancel(id);
    expect(queue.getJob(id)?.status).toBe("cancelled");
    expect(queue.getSummary().cancelledJobs).toBe(1);
    queue.clearDone();
    expect(queue.getJobs()).toHaveLength(0);
  });

  it("aborts an attached controller when queue.cancel(jobId) is called", () => {
    const queue = new SweetProcessingQueue();
    const id = queue.enqueue({ id: "job-abort", kind: "export-render", priority: 1, params: {} });
    const controller = new AbortController();

    queue.attachAbortController(id, controller);
    expect(controller.signal.aborted).toBe(false);
    queue.cancel(id);

    expect(controller.signal.aborted).toBe(true);
    expect(queue.getJob(id)?.status).toBe("cancelled");
  });

  it("keeps analysis cache bounded and version-aware", () => {
    const cache = new SweetAnalysisCache<number>(2);
    cache.set("a", 1, "v1");
    cache.set("b", 2, "v1");
    expect(cache.get("a", "v2")).toBeUndefined();
    expect(cache.get("a", "v1")).toBe(1);
    cache.set("c", 3, "v1");
    expect(cache.keys().sort()).toEqual(["a", "c"]);
  });
});
