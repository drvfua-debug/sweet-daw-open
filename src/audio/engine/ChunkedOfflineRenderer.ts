import { audioBufferRegistry, type AudioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { renderProjectSliceOffline } from "@/audio/engine/OfflineRenderer";
import { getProjectDurationSec } from "@/audio/engine/TrackGraph";
import type { Project } from "@/daw/model/Project";
import { createChunkPlan } from "@/lib/audio/chunkPlan";
import { createAbortError, createProgress } from "@/lib/audio/processingJobs";
import type { SweetProcessingJobProgress } from "@/lib/audio/processingTypes";

export type ChunkedProjectRenderOptions = {
  sampleRate: 44100 | 48000;
  chunkSec: number;
  renderPaddingSec: number;
  trackBatchSize?: number;
  sourceWindowBudgetBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SweetProcessingJobProgress) => void;
  onChunk?: (chunk: {
    index: number;
    startSec: number;
    endSec: number;
    channels: Float32Array[];
  }) => Promise<void> | void;
};

export type ChunkedProjectRenderSummary = {
  renderedChunks: number;
  totalChunks: number;
  renderedTrackBatches: number;
  boundarySmoothing: boolean;
};

export function resolveAdaptiveSourceChunkSec(input: {
  requestedChunkSec: number;
  renderPaddingSec: number;
  activeTrackCount: number;
  sampleRate: number;
  sourceWindowBudgetBytes?: number;
}) {
  const sourceBytesPerSec = Math.max(1, input.activeTrackCount) * Math.max(1, input.sampleRate) * 2 * Float32Array.BYTES_PER_ELEMENT;
  const sourceWindowBudgetBytes = input.sourceWindowBudgetBytes ?? 48 * 1024 * 1024;
  const paddingSec = Math.max(0, input.renderPaddingSec) * 2;
  const sourceBoundChunkSec = Math.max(0.25, sourceWindowBudgetBytes / sourceBytesPerSec - paddingSec);
  return Math.max(0.25, Math.min(Math.max(0.25, input.requestedChunkSec), sourceBoundChunkSec));
}

export async function renderProjectOfflineChunked(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: ChunkedProjectRenderOptions,
): Promise<ChunkedProjectRenderSummary> {
  const sampleRate = options.sampleRate;
  const durationSec = Math.max(0.1, getProjectDurationSec({ clips: project.clips }));
  const referenceTrackIds = new Set(
    project.tracks.filter((track) => track.role === "reference" || track.type === "reference").map((track) => track.id),
  );
  const activeTrackCount = new Set(
    project.clips.filter((clip) => !referenceTrackIds.has(clip.trackId)).map((clip) => clip.trackId),
  ).size;
  const effectiveChunkSec = resolveAdaptiveSourceChunkSec({
    requestedChunkSec: options.chunkSec,
    renderPaddingSec: options.renderPaddingSec,
    activeTrackCount,
    sampleRate,
    sourceWindowBudgetBytes: options.sourceWindowBudgetBytes,
  });
  const plan = createChunkPlan({
    sampleRate,
    totalFrames: Math.ceil(durationSec * sampleRate),
    preferredChunkSeconds: effectiveChunkSec,
    overlapSeconds: 0,
  });
  const startedAt = Date.now();
  let renderedChunks = 0;

  options.onProgress?.(createProgress(0, plan.chunks.length, "Preparing stable render", startedAt));
  throwIfAborted(options.signal);

  for (const chunk of plan.chunks) {
    throwIfAborted(options.signal);
    const startSec = chunk.startFrame / sampleRate;
    const endSec = chunk.endFrame / sampleRate;
    options.onProgress?.(createProgress(renderedChunks, plan.chunks.length, `Rendering chunk ${chunk.index + 1}/${plan.chunks.length}`, startedAt));
    const channels = await renderProjectSliceOffline(project, registry, {
      startSec,
      endSec,
      preRollSec: options.renderPaddingSec,
      postRollSec: options.renderPaddingSec,
    }, { sampleRate });
    applyChunkBoundarySmoothing(channels, sampleRate, chunk.index, plan.chunks.length);
    throwIfAborted(options.signal);
    await options.onChunk?.({
      index: chunk.index,
      startSec,
      endSec,
      channels,
    });
    channels.length = 0;
    renderedChunks += 1;
    options.onProgress?.(createProgress(renderedChunks, plan.chunks.length, `Encoded chunk ${chunk.index + 1}/${plan.chunks.length}`, startedAt));
    await yieldToMainThread();
  }

  return {
    renderedChunks,
    totalChunks: plan.chunks.length,
    renderedTrackBatches: 1,
    boundarySmoothing: true,
  };
}

export function applyChunkBoundarySmoothing(
  channels: Float32Array[],
  sampleRate: number,
  chunkIndex: number,
  totalChunks: number,
) {
  const smoothFrames = Math.min(Math.max(4, Math.round(sampleRate * 0.0004)), Math.floor((channels[0]?.length ?? 0) / 8));
  if (smoothFrames <= 1) return;
  for (const channel of channels) {
    if (chunkIndex > 0) {
      for (let index = 1; index < smoothFrames; index += 1) {
        channel[index] = smoothSample(channel, index);
      }
    }
    if (chunkIndex < totalChunks - 1) {
      const start = Math.max(1, channel.length - smoothFrames);
      for (let frame = start; frame < channel.length - 1; frame += 1) {
        channel[frame] = smoothSample(channel, frame);
      }
    }
  }
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw createAbortError("Export job cancelled.");
}

function yieldToMainThread() {
  const requestIdle = (globalThis as typeof globalThis & { requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number }).requestIdleCallback;
  if (typeof requestIdle === "function") {
    return new Promise<void>((resolve) => requestIdle(() => resolve(), { timeout: 24 }));
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function smoothSample(channel: Float32Array, index: number) {
  const previous = channel[index - 1] ?? 0;
  const current = channel[index] ?? 0;
  const next = channel[index + 1] ?? current;
  return sanitizeSample(previous * 0.25 + current * 0.5 + next * 0.25);
}
