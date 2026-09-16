import { renderProjectOfflineChunked } from "@/audio/engine/ChunkedOfflineRenderer";
import { createExportHealthAccumulator, formatExportHealthWarnings } from "@/audio/export/ExportHealth";
import { createWavExportWriter, type WavExportWriter } from "@/audio/export/WavStreamingEncoder";
import type { DitherOptions, WavBitDepth } from "@/audio/export/WavEncoder";
import type { AudioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { audioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { releaseStreamableProjectBuffers } from "@/audio/engine/StreamingWavSource";
import { dbToGain } from "@/audio/engine/TrackGraph";
import type { Project } from "@/daw/model/Project";
import { createSweetExportProcessingReportFromProject } from "@/lib/audio/exportQueue";
import type { SweetProcessingJobProgress } from "@/lib/audio/processingTypes";
import { createExportStabilityReport, type SweetExportStabilityPlan } from "./ExportStabilityPlanner";

export type StableMasterWavExportResult = {
  blob: Blob;
  report: ReturnType<typeof createSweetExportProcessingReportFromProject>;
  retryCount: number;
  cleanup: () => Promise<void>;
};

export type StableMasterWavExportOptions = {
  plan: SweetExportStabilityPlan;
  registry?: AudioBufferRegistry;
  signal?: AbortSignal;
  onProgress?: (progress: SweetProcessingJobProgress) => void;
};

export async function exportMasterWavWithStableRenderer(
  project: Project,
  options: StableMasterWavExportOptions,
): Promise<StableMasterWavExportResult> {
  const registry = options.registry ?? audioBufferRegistry;
  const failedChunks: Array<{ index: number; reason: string }> = [];
  const warnings = [...options.plan.reason, "Stable Chunked Render was used. Boundary smoothing and render padding were applied."];
  const released = await releaseStreamableProjectBuffers(project, registry);
  if (released.releasedFileIds.length > 0) {
    warnings.push(`Released ${formatMemoryMb(released.releasedBytes)}MB of decoded PCM before chunk rendering; source WAV ranges are read on demand.`);
  }

  for (let attemptIndex = 0; attemptIndex < options.plan.retryPlan.length; attemptIndex += 1) {
    const attempt = options.plan.retryPlan[attemptIndex];
    if (!attempt) continue;
    const sampleRate = attempt.sampleRate ?? options.plan.sampleRate;
    const totalFrames = Math.ceil(options.plan.durationSec * sampleRate);
    let writer: WavExportWriter | null = null;
    try {
      const peakGain = project.master.exportNormalizePeak
        ? await scanPeakGain(project, registry, options.plan, attempt.chunkSec, sampleRate, options.signal, options.onProgress)
        : 1;
      writer = await createWavExportWriter({
        sampleRate,
        channels: 2,
        bitDepth: project.master.exportBitDepth,
        dither: resolveExportDither(project.master.exportBitDepth, project.master.exportDither),
        normalizePeak: false,
        totalFrames,
        maxBlobBytes: Number.POSITIVE_INFINITY,
      });
      const healthAccumulator = createExportHealthAccumulator();
      const summary = await renderProjectOfflineChunked(project, registry, {
        sampleRate,
        chunkSec: attempt.chunkSec,
        trackBatchSize: attempt.trackBatchSize,
        renderPaddingSec: options.plan.renderPaddingSec,
        signal: options.signal,
        onProgress: options.onProgress,
        onChunk: async ({ channels }) => {
          const outputChannels = peakGain === 1 ? channels : scaleChannels(channels, peakGain);
          healthAccumulator.add(outputChannels);
          await writer?.writeChunk(outputChannels);
          outputChannels.splice(0);
          channels.splice(0);
        },
      });
      const health = healthAccumulator.finish();
      const healthWarnings = formatExportHealthWarnings(health);
      const stability = createExportStabilityReport(options.plan, {
        retryCount: attemptIndex,
        fallbackUsed: true,
        renderedChunks: summary.renderedChunks,
        renderedTrackBatches: summary.renderedTrackBatches,
        failedChunks,
        warnings: [...warnings, ...healthWarnings],
        boundarySmoothing: summary.boundarySmoothing,
      });
      const report = createSweetExportProcessingReportFromProject(project, {
        durationSec: totalFrames / sampleRate,
        sampleRate,
        channels: 2,
        stability,
        health,
        wiring: {
          repairRegions: true,
          aimixUnmask: true,
          masterPolish2: false,
          finalRepairModules: false,
        },
      });
      const blob = await writer.finish();
      const completedWriter = writer;
      return {
        blob,
        report,
        retryCount: attemptIndex,
        cleanup: () => completedWriter.cleanup(),
      };
    } catch (error) {
      await writer?.abort();
      if (options.signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      failedChunks.push({ index: attemptIndex, reason });
      if (!isRetryableExportError(error) || attemptIndex === options.plan.retryPlan.length - 1) {
        throw new Error(`Stable master export failed after ${attemptIndex + 1} attempt(s): ${reason}`);
      }
    }
  }

  throw new Error("Stable master export failed before rendering started.");
}

function resolveExportDither(bitDepth: WavBitDepth, dither: boolean | DitherOptions) {
  return bitDepth === "pcm16" ? dither : false;
}

async function scanPeakGain(
  project: Project,
  registry: AudioBufferRegistry,
  plan: SweetExportStabilityPlan,
  chunkSec: number,
  sampleRate: 44100 | 48000,
  signal: AbortSignal | undefined,
  onProgress: ((progress: SweetProcessingJobProgress) => void) | undefined,
) {
  let peak = 0;
  await renderProjectOfflineChunked(project, registry, {
    sampleRate,
    chunkSec,
    renderPaddingSec: plan.renderPaddingSec,
    signal,
    onProgress: (progress) => onProgress?.({ ...progress, currentLabel: `Peak scan ${progress.currentLabel ?? ""}`.trim() }),
    onChunk: ({ channels }) => {
      peak = Math.max(peak, measurePeak(channels));
    },
  });
  if (peak <= 0) return 1;
  return Math.min(16, dbToGain(project.master.exportPeakTargetDb ?? -1) / peak);
}

function scaleChannels(channels: Float32Array[], gain: number) {
  return channels.map((channel) => {
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      output[index] = sanitizeSample((channel[index] ?? 0) * gain);
    }
    return output;
  });
}

function measurePeak(channels: Float32Array[]) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      peak = Math.max(peak, Math.abs(sanitizeSample(channel[index] ?? 0)));
    }
  }
  return peak;
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function formatMemoryMb(bytes: number) {
  return (Math.max(0, bytes) / (1024 * 1024)).toFixed(1);
}

function isRetryableExportError(error: unknown) {
  if (error instanceof RangeError || error instanceof DOMException) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /offlineaudiocontext|startRendering|allocation|out of memory|memory|buffer/i.test(message);
}
