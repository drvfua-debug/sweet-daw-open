import type { Project } from "@/daw/model/Project";
import type { SweetExportStabilityReport } from "@/daw/export/ExportStabilityPlanner";
import type { ExportHealthReport } from "@/audio/export/ExportHealth";
import { createPluginQualityReport } from "@/audio/plugins/pluginQualityReport";
import type { PluginInstance } from "@/daw/model/Plugin";
import { analyzeFloat32ChannelsLoudness } from "@/audio/analysis/LoudnessAnalyzer";
import { createChunkPlan } from "./chunkPlan";
import { SweetProcessingQueue, createAbortError, runChunked } from "./processingJobs";
import type { SweetChunk, SweetProcessingJobProgress } from "./processingTypes";
import {
  createEmptySweetExportProcessingReport,
  type SweetExportAppliedOperation,
  type SweetExportOperationStatus,
  type SweetExportPluginQualitySummary,
  type SweetExportProcessingReport,
} from "./exportProcessingTypes";

export interface SweetExportQueueWiring {
  repairRegions: boolean;
  aimixUnmask: boolean;
  masterPolish2: boolean;
  finalRepairModules: boolean;
}

export interface SweetQueuedPcmExportArgs {
  jobId?: string;
  label?: string;
  channels: Float32Array[];
  sampleRate: number;
  project?: Project;
  queue?: SweetProcessingQueue;
  signal?: AbortSignal;
  preferredChunkSeconds?: number;
  wiring?: Partial<SweetExportQueueWiring>;
  outputMode?: "buffer" | "stream";
  processChunk?: (chunk: SweetChunk, channels: Float32Array[], sampleRate: number) => Float32Array[] | Promise<Float32Array[]>;
  onChunkOutput?: (chunk: SweetChunk, channels: Float32Array[], sampleRate: number) => void | Promise<void>;
  onProgress?: (progress: SweetProcessingJobProgress) => void;
}

export interface SweetQueuedPcmExportResult {
  channels: Float32Array[];
  streamed?: boolean;
  report: SweetExportProcessingReport;
  jobId: string;
}

const DEFAULT_WIRING: SweetExportQueueWiring = {
  repairRegions: true,
  aimixUnmask: true,
  masterPolish2: false,
  finalRepairModules: false,
};

export async function runSweetQueuedPcmExport(args: SweetQueuedPcmExportArgs): Promise<SweetQueuedPcmExportResult> {
  const sampleRate = Math.max(1, Math.round(args.sampleRate || 48000));
  const frameCount = Math.max(0, Math.min(...args.channels.map((channel) => channel.length)));
  const queue = args.queue ?? new SweetProcessingQueue();
  const jobId = args.jobId ?? `export-${Date.now().toString(36)}`;
  const controller = new AbortController();
  const abortFromInputSignal = () => controller.abort();
  if (args.signal?.aborted) controller.abort();
  args.signal?.addEventListener("abort", abortFromInputSignal, { once: true });
  const plan = createChunkPlan({
    sampleRate,
    totalFrames: frameCount,
    preferredChunkSeconds: args.preferredChunkSeconds ?? 2,
    overlapSeconds: 0,
  });
  const wiring = { ...DEFAULT_WIRING, ...(args.wiring ?? {}) };
  const streamOutput = args.outputMode === "stream";
  if (streamOutput && !args.onChunkOutput) {
    throw new Error("Stream export requires onChunkOutput; otherwise rendered audio would be discarded.");
  }
  const before = analyzeExportLoudness(args.channels, sampleRate);
  const output: Float32Array[] = streamOutput ? [] : args.channels.map(() => new Float32Array(frameCount));
  const afterAccumulator = streamOutput ? createExportLoudnessAccumulator() : null;

  queue.enqueue({
    id: jobId,
    kind: "export-render",
    priority: 100,
    params: {
      label: args.label ?? "WAV export",
      sampleRate,
      durationSec: frameCount / sampleRate,
      chunks: plan.chunks.length,
    },
  });
  queue.attachAbortController(jobId, controller);

  try {
    queue.updateStatus(jobId, "running");
    await runChunked({
      plan,
      signal: controller.signal,
      onProgress: (progress) => {
        queue.updateStatus(jobId, "running", { progress });
        args.onProgress?.(progress);
      },
      processChunk: async (chunk) => {
        const inputSlice = sliceChunkChannels(args.channels, chunk.startFrame, chunk.endFrame);
        const processed = args.processChunk ? await args.processChunk(chunk, inputSlice, sampleRate) : inputSlice;
        if (streamOutput) {
          accumulateExportLoudness(afterAccumulator, processed);
          await args.onChunkOutput?.(chunk, processed, sampleRate);
        } else {
          copyChunkIntoOutput(output, processed, chunk.startFrame, chunk.endFrame);
        }
        return chunk.index;
      },
    });
    const after = streamOutput
      ? finalizeExportLoudnessAccumulator(afterAccumulator, sampleRate)
      : analyzeExportLoudness(output, sampleRate);
    const report = createSweetExportProcessingReportFromProject(args.project, {
      durationSec: frameCount / sampleRate,
      sampleRate,
      channels: args.channels.length,
      loudnessBefore: before.integratedLufs ?? undefined,
      loudnessAfter: after.integratedLufs ?? undefined,
      truePeakBefore: before.truePeakDbtp,
      truePeakAfter: after.truePeakDbtp,
      wiring,
    });
    queue.updateStatus(jobId, "done", { result: report });
    return { channels: output, streamed: streamOutput ? true : undefined, report, jobId };
  } catch (error) {
    const aborted = controller.signal.aborted || args.signal?.aborted || (error instanceof Error && error.name === "AbortError");
    const message = aborted ? "Export job cancelled." : error instanceof Error ? error.message : String(error);
    queue.updateStatus(jobId, aborted ? "cancelled" : "failed", { error: message });
    throw aborted ? createAbortError(message) : error;
  } finally {
    args.signal?.removeEventListener("abort", abortFromInputSignal);
  }
}

export function createSweetExportProcessingReportFromProject(
  project: Project | null | undefined,
  input: {
    durationSec: number;
    sampleRate: number;
    channels: number;
    loudnessBefore?: number;
    loudnessAfter?: number;
  truePeakBefore?: number;
  truePeakAfter?: number;
  wiring?: Partial<SweetExportQueueWiring>;
  stability?: SweetExportStabilityReport;
  health?: ExportHealthReport;
  warnings?: string[];
  },
): SweetExportProcessingReport {
  const wiring = { ...DEFAULT_WIRING, ...(input.wiring ?? {}) };
  const operations = project ? collectSweetExportAppliedOperations(project, wiring) : [];
  const pluginQuality = project ? buildExportPluginQualitySummary(project) : undefined;
  const warnings = [
    ...(input.warnings ?? []),
    ...buildOperationWarnings(operations),
    ...(pluginQuality?.warnings.map((warning) => `Plugin Quality: ${warning}`) ?? []),
  ];
  return createEmptySweetExportProcessingReport({
    createdAt: Date.now(),
    durationSec: input.durationSec,
    sampleRate: input.sampleRate,
    channels: input.channels,
    appliedOperations: operations,
    loudnessApprox: input.loudnessBefore === undefined && input.loudnessAfter === undefined
      ? undefined
      : { before: round2(input.loudnessBefore), after: round2(input.loudnessAfter) },
    truePeakEstimate: input.truePeakBefore === undefined && input.truePeakAfter === undefined
      ? undefined
      : { before: round2(input.truePeakBefore), after: round2(input.truePeakAfter) },
    stability: input.stability,
    health: input.health,
    pluginQuality,
    warnings,
  });
}

export function collectSweetExportAppliedOperations(project: Project, wiring: SweetExportQueueWiring): SweetExportAppliedOperation[] {
  const repairOps: SweetExportAppliedOperation[] = project.repairRegions.map((region) => ({
    id: region.id,
    kind: `repair:${region.operation}`,
    label: `Repair ${region.operation}`,
    fixed: region.fixed,
    exportStatus: !region.enabled ? "bypassed" : region.fixed ? statusForWiring(wiring.repairRegions) : "bypassed",
    warning: !region.enabled
      ? "Repair region is disabled."
      : region.fixed
        ? (wiring.repairRegions ? undefined : "Fixed repair region is not connected to this export path.")
        : "Repair region is preview-only until FIX is applied.",
  }));

  const unmaskOps: SweetExportAppliedOperation[] = project.aimixUnmaskState.operations.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    label: `AIMIX Unmask ${operation.bandId}`,
    fixed: operation.fixed,
    exportStatus: !operation.enabled ? "bypassed" : operation.fixed ? statusForWiring(wiring.aimixUnmask) : "bypassed",
    warning: !operation.enabled
      ? "AIMIX Unmask operation is disabled."
      : operation.fixed
        ? (wiring.aimixUnmask ? undefined : "Fixed AIMIX Unmask operation is not connected to this export path.")
        : "AIMIX Unmask operation is preview-only until FIX is applied.",
  }));

  const masterPolish: SweetExportAppliedOperation[] = project.master.masterPolish2?.enabled
    ? [{
        id: "master-polish-2",
        kind: "master-polish-2",
        label: "Master Polish 2",
        fixed: true,
        exportStatus: statusForWiring(wiring.masterPolish2),
        warning: wiring.masterPolish2 ? undefined : "Master Polish 2 settings are saved but not connected to this export path.",
      }]
    : [];

  const finalRepairModules: SweetExportAppliedOperation[] = project.master.masterPolish2?.enabled
    ? [{
        id: "final-repair-modules",
        kind: "final-repair-modules",
        label: "Final Repair Modules",
        fixed: true,
        exportStatus: statusForWiring(wiring.finalRepairModules),
        warning: wiring.finalRepairModules ? undefined : "Final Repair Modules are available for Master Polish 2 analysis but not connected to this export path.",
      }]
    : [];

  return [...repairOps, ...unmaskOps, ...masterPolish, ...finalRepairModules];
}

export function createSweetProjectAnalysisCacheSummary(project: Project) {
  const referenceDelta = project.aimixUnmaskState.referenceDelta;
  const acceptedProposals = [
    ...project.repairRegions.filter((region) => region.fixed),
    ...project.aimixUnmaskState.operations.filter((operation) => operation.fixed),
  ].length;
  return {
    analysisVersion: "sweet-analysis-summary-v0.9",
    createdAt: Date.now(),
    sourceRefs: project.files.map((file) => ({
      fileId: file.id,
      hash: file.hash,
      version: file.peakCacheKey,
    })).slice(0, 128),
    summaryMetrics: {
      trackCount: project.tracks.length,
      clipCount: project.clips.length,
      fileCount: project.files.length,
      markerCount: project.markers.length + project.sections.length,
      repairOperationCount: project.repairRegions.length,
    },
    markerCount: project.markers.length + project.sections.length,
    repairOperationCount: project.repairRegions.length,
    targetProfileId: project.master.masterPolish2?.profileId ?? project.master.target.profileId,
    referenceDeltaSummary: referenceDelta
      ? {
          source: referenceDelta.source,
          confidence: referenceDelta.confidence,
          bandCount: Object.values(referenceDelta).filter((value) => typeof value === "number").length,
          warningCount: referenceDelta.warnings.length,
        }
      : undefined,
    userAcceptedProposalCount: acceptedProposals,
    warnings: [
      "Heavy analysis buffers are intentionally excluded from .swtd; only lightweight summaries are persisted.",
    ],
  };
}

function statusForWiring(connected: boolean): SweetExportOperationStatus {
  return connected ? "applied" : "not-wired";
}

function buildOperationWarnings(operations: SweetExportAppliedOperation[]) {
  const warnings = operations
    .filter((operation) => operation.warning || operation.exportStatus === "not-wired" || operation.exportStatus === "failed")
    .map((operation) => operation.warning ?? `${operation.label} export status: ${operation.exportStatus}.`);
  return [...new Set(warnings)];
}

function buildExportPluginQualitySummary(project: Project): SweetExportPluginQualitySummary | undefined {
  const chain = collectProjectPluginChain(project).filter((plugin) => plugin.enabled);
  if (chain.length === 0) return undefined;
  const report = createPluginQualityReport(chain);
  return {
    totalPluginCount: report.itemCount,
    cpuScore: report.cpuScore,
    highCpuCount: report.highCpuCount,
    masterRiskCount: report.masterRiskCount,
    warningCount: report.warnings.length,
    warnings: report.warnings.slice(0, 32),
  };
}

function collectProjectPluginChain(project: Project): PluginInstance[] {
  return [
    ...project.master.insertChain,
    ...project.tracks.flatMap((track) => track.insertChain),
    ...project.clips.flatMap((clip) => clip.insertChain),
  ];
}

function sliceChunkChannels(channels: Float32Array[], startFrame: number, endFrame: number) {
  return channels.map((channel) => channel.slice(startFrame, Math.min(endFrame, channel.length)));
}

function copyChunkIntoOutput(output: Float32Array[], processed: Float32Array[], startFrame: number, endFrame: number) {
  const length = Math.max(0, endFrame - startFrame);
  for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
    const target = output[channelIndex];
    const source = processed[channelIndex] ?? processed[0];
    if (!target || !source) continue;
    target.set(source.slice(0, length), startFrame);
  }
}

function analyzeExportLoudness(channels: Float32Array[], sampleRate: number) {
  return analyzeFloat32ChannelsLoudness(channels, sampleRate, { quality: "fast" });
}

type ExportLoudnessAccumulator = {
  peak: number;
  squares: number;
  sum: number;
  clipped: number;
  samples: number;
  channelCount: number;
};

function createExportLoudnessAccumulator(): ExportLoudnessAccumulator {
  return {
    peak: 0,
    squares: 0,
    sum: 0,
    clipped: 0,
    samples: 0,
    channelCount: 1,
  };
}

function accumulateExportLoudness(accumulator: ExportLoudnessAccumulator | null, channels: Float32Array[]) {
  if (!accumulator) return;
  accumulator.channelCount = Math.max(accumulator.channelCount, channels.length || 1);
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = sanitizeSample(channel[index] ?? 0);
      accumulator.peak = Math.max(accumulator.peak, Math.abs(sample));
      accumulator.squares += sample * sample;
      accumulator.sum += sample;
      if (Math.abs(sample) >= 0.999) accumulator.clipped += 1;
      accumulator.samples += 1;
    }
  }
}

function finalizeExportLoudnessAccumulator(accumulator: ExportLoudnessAccumulator | null, _sampleRate: number): ReturnType<typeof analyzeFloat32ChannelsLoudness> {
  const safe = accumulator ?? createExportLoudnessAccumulator();
  const rms = safe.samples > 0 && safe.squares > 0 ? Math.sqrt(safe.squares / safe.samples) : 0;
  const rmsDb = gainToDb(rms);
  const samplePeakDbfs = gainToDb(safe.peak);
  const durationSec = safe.samples / Math.max(1, _sampleRate * safe.channelCount);
  return {
    durationSec,
    integratedLufs: Number.isFinite(rmsDb) ? rmsDb - 1.2 : null,
    shortTermMaxLufs: Number.isFinite(rmsDb) ? rmsDb - 1.2 : null,
    momentaryMaxLufs: Number.isFinite(rmsDb) ? rmsDb - 1.2 : null,
    loudnessRangeLu: null,
    samplePeakDbfs,
    truePeakDbtp: samplePeakDbfs,
    clippedSampleRatio: safe.samples > 0 ? safe.clipped / safe.samples : 0,
    dcOffset: safe.samples > 0 ? safe.sum / safe.samples : 0,
  };
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function gainToDb(gain: number) {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

function round2(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
}
