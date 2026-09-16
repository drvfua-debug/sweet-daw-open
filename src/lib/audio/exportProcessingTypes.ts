import type { SweetExportStabilityReport } from "@/daw/export/ExportStabilityPlanner";
import type { ExportHealthReport } from "@/audio/export/ExportHealth";
import type { RenderBudgetReport } from "@/audio/export/RenderBudget";

export type SweetExportOperationStatus = "applied" | "bypassed" | "not-wired" | "failed";

export interface SweetExportAppliedOperation {
  id: string;
  kind: string;
  label: string;
  fixed: boolean;
  exportStatus: SweetExportOperationStatus;
  warning?: string;
}

export interface SweetExportPluginQualitySummary {
  totalPluginCount: number;
  cpuScore: number;
  highCpuCount: number;
  masterRiskCount: number;
  warningCount: number;
  warnings: string[];
}

export interface SweetExportProcessingReport {
  createdAt: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  appliedOperations: SweetExportAppliedOperation[];
  loudnessApprox?: {
    before?: number;
    after?: number;
  };
  truePeakEstimate?: {
    before?: number;
    after?: number;
  };
  budget?: RenderBudgetReport;
  health?: ExportHealthReport;
  stability?: SweetExportStabilityReport;
  pluginQuality?: SweetExportPluginQualitySummary;
  warnings: string[];
}

export interface SweetPersistedAnalysisCacheSummary {
  analysisVersion: string;
  createdAt: number;
  sourceRefs: Array<{
    fileId?: string;
    trackId?: string;
    clipId?: string;
    hash?: string;
    version?: string;
  }>;
  summaryMetrics?: Record<string, number>;
  markerCount: number;
  repairOperationCount: number;
  targetProfileId?: string;
  referenceDeltaSummary?: {
    source?: string;
    confidence?: number;
    bandCount?: number;
    warningCount?: number;
  };
  userAcceptedProposalCount: number;
  warnings: string[];
}

export interface SweetProjectMigrationResult {
  migrated: boolean;
  fromVersion?: string;
  toVersion: string;
  warnings: string[];
}

export function createEmptySweetExportProcessingReport(patch: Partial<SweetExportProcessingReport> = {}): SweetExportProcessingReport {
  return sanitizeSweetExportProcessingReport({
    createdAt: Date.now(),
    durationSec: 0,
    sampleRate: 48000,
    channels: 2,
    appliedOperations: [],
    warnings: [],
    ...patch,
  });
}

export function sanitizeSweetExportProcessingReport(value: unknown): SweetExportProcessingReport {
  const record = isRecord(value) ? value : {};
  return {
    createdAt: numberOr(record.createdAt, Date.now()),
    durationSec: clampNumber(numberOr(record.durationSec, 0), 0, 60 * 60 * 12),
    sampleRate: Math.round(clampNumber(numberOr(record.sampleRate, 48000), 1, 384000)),
    channels: Math.round(clampNumber(numberOr(record.channels, 2), 1, 32)),
    appliedOperations: Array.isArray(record.appliedOperations)
      ? record.appliedOperations.map(sanitizeAppliedOperation).filter((operation): operation is SweetExportAppliedOperation => !!operation).slice(0, 256)
      : [],
    loudnessApprox: sanitizeMetricPair(record.loudnessApprox),
    truePeakEstimate: sanitizeMetricPair(record.truePeakEstimate),
    budget: sanitizeRenderBudgetReport(record.budget),
    health: sanitizeExportHealthReport(record.health),
    stability: sanitizeExportStabilityReport(record.stability),
    pluginQuality: sanitizePluginQualitySummary(record.pluginQuality),
    warnings: sanitizeStringArray(record.warnings).slice(0, 64),
  };
}

export function sanitizeSweetExportProcessingReports(value: unknown, maxReports = 12): SweetExportProcessingReport[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitizeSweetExportProcessingReport)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, maxReports));
}

export function sanitizeSweetPersistedAnalysisCacheSummary(value: unknown): SweetPersistedAnalysisCacheSummary | null {
  if (!isRecord(value)) return null;
  return {
    analysisVersion: stringOr(value.analysisVersion, "analysis-v1"),
    createdAt: numberOr(value.createdAt, Date.now()),
    sourceRefs: Array.isArray(value.sourceRefs)
      ? value.sourceRefs.filter(isRecord).map((entry) => ({
          fileId: typeof entry.fileId === "string" ? entry.fileId : undefined,
          trackId: typeof entry.trackId === "string" ? entry.trackId : undefined,
          clipId: typeof entry.clipId === "string" ? entry.clipId : undefined,
          hash: typeof entry.hash === "string" ? entry.hash : undefined,
          version: typeof entry.version === "string" ? entry.version : undefined,
        })).slice(0, 128)
      : [],
    summaryMetrics: sanitizeMetricRecord(value.summaryMetrics),
    markerCount: Math.round(clampNumber(numberOr(value.markerCount, 0), 0, 10000)),
    repairOperationCount: Math.round(clampNumber(numberOr(value.repairOperationCount, 0), 0, 10000)),
    targetProfileId: typeof value.targetProfileId === "string" ? value.targetProfileId : undefined,
    referenceDeltaSummary: sanitizeReferenceDeltaSummary(value.referenceDeltaSummary),
    userAcceptedProposalCount: Math.round(clampNumber(numberOr(value.userAcceptedProposalCount, 0), 0, 10000)),
    warnings: sanitizeStringArray(value.warnings).slice(0, 64),
  };
}

function sanitizeAppliedOperation(value: unknown): SweetExportAppliedOperation | null {
  if (!isRecord(value)) return null;
  return {
    id: stringOr(value.id, "operation"),
    kind: stringOr(value.kind, "unknown"),
    label: stringOr(value.label, stringOr(value.kind, "Operation")),
    fixed: Boolean(value.fixed),
    exportStatus: isExportStatus(value.exportStatus) ? value.exportStatus : "not-wired",
    warning: typeof value.warning === "string" ? value.warning : undefined,
  };
}

function sanitizeRenderBudgetReport(value: unknown): RenderBudgetReport | undefined {
  if (!isRecord(value)) return undefined;
  const risk = value.risk === "danger" || value.risk === "warn" || value.risk === "ok" ? value.risk : "ok";
  const bitDepth = value.bitDepth === "pcm24" || value.bitDepth === "float32" || value.bitDepth === "pcm16" ? value.bitDepth : "pcm16";
  return {
    risk,
    estimatedBytes: Math.round(clampNumber(numberOr(value.estimatedBytes, 0), 0, Number.MAX_SAFE_INTEGER)),
    estimatedMb: clampNumber(numberOr(value.estimatedMb, 0), 0, 1024 * 1024),
    sourceDecodedBytes: Math.round(clampNumber(numberOr(value.sourceDecodedBytes, 0), 0, Number.MAX_SAFE_INTEGER)),
    offlineOutputBytes: Math.round(clampNumber(numberOr(value.offlineOutputBytes, 0), 0, Number.MAX_SAFE_INTEGER)),
    wavBodyBytes: Math.round(clampNumber(numberOr(value.wavBodyBytes, 0), 0, Number.MAX_SAFE_INTEGER)),
    pluginWeight: clampNumber(numberOr(value.pluginWeight, 0), 0, 10000),
    stemCount: Math.round(clampNumber(numberOr(value.stemCount, 0), 0, 10000)),
    durationSec: clampNumber(numberOr(value.durationSec, 0), 0, 60 * 60 * 12),
    sampleRate: Math.round(clampNumber(numberOr(value.sampleRate, 48000), 1, 384000)),
    bitDepth,
    reasons: sanitizeStringArray(value.reasons).slice(0, 32),
  };
}

function sanitizeExportHealthReport(value: unknown): ExportHealthReport | undefined {
  if (!isRecord(value)) return undefined;
  return {
    peakDb: clampNumber(numberOr(value.peakDb, -120), -120, 24),
    rmsDb: clampNumber(numberOr(value.rmsDb, -120), -120, 24),
    clippedSamples: Math.round(clampNumber(numberOr(value.clippedSamples, 0), 0, Number.MAX_SAFE_INTEGER)),
    nearClipSamples: Math.round(clampNumber(numberOr(value.nearClipSamples, 0), 0, Number.MAX_SAFE_INTEGER)),
    nanSamples: Math.round(clampNumber(numberOr(value.nanSamples, 0), 0, Number.MAX_SAFE_INTEGER)),
    infSamples: Math.round(clampNumber(numberOr(value.infSamples, 0), 0, Number.MAX_SAFE_INTEGER)),
    silent: Boolean(value.silent),
    silentChunks: Math.round(clampNumber(numberOr(value.silentChunks, 0), 0, Number.MAX_SAFE_INTEGER)),
    maxConsecutiveSilentChunks: Math.round(clampNumber(numberOr(value.maxConsecutiveSilentChunks, 0), 0, Number.MAX_SAFE_INTEGER)),
  };
}

function sanitizeMetricPair(value: unknown): SweetExportProcessingReport["loudnessApprox"] {
  if (!isRecord(value)) return undefined;
  const before = finiteOrUndefined(value.before);
  const after = finiteOrUndefined(value.after);
  return before === undefined && after === undefined ? undefined : { before, after };
}

function sanitizeExportStabilityReport(value: unknown): SweetExportStabilityReport | undefined {
  if (!isRecord(value)) return undefined;
  return {
    strategy: isExportStrategy(value.strategy) ? value.strategy : "exact-full-render",
    risk: isExportRisk(value.risk) ? value.risk : "low",
    estimatedPeakMemoryMb: round2(clampNumber(numberOr(value.estimatedPeakMemoryMb, 0), 0, 100000)),
    memoryBudgetMb: round2(clampNumber(numberOr(value.memoryBudgetMb, 0), 0, 100000)),
    chunkSec: round2(clampNumber(numberOr(value.chunkSec, 0), 0, 3600)),
    trackBatchSize: Math.round(clampNumber(numberOr(value.trackBatchSize, 1), 1, 1000)),
    retryCount: Math.round(clampNumber(numberOr(value.retryCount, 0), 0, 100)),
    fallbackUsed: Boolean(value.fallbackUsed),
    renderedChunks: Math.round(clampNumber(numberOr(value.renderedChunks, 0), 0, 100000)),
    renderedTrackBatches: Math.round(clampNumber(numberOr(value.renderedTrackBatches, 0), 0, 100000)),
    boundarySmoothing: typeof value.boundarySmoothing === "boolean" ? value.boundarySmoothing : undefined,
    failedChunks: Array.isArray(value.failedChunks)
      ? value.failedChunks.filter(isRecord).map((chunk) => ({
          index: Math.round(clampNumber(numberOr(chunk.index, 0), 0, 100000)),
          reason: stringOr(chunk.reason, "Unknown error"),
        })).slice(0, 32)
      : [],
    warnings: sanitizeStringArray(value.warnings).slice(0, 24),
  };
}

function sanitizePluginQualitySummary(value: unknown): SweetExportPluginQualitySummary | undefined {
  if (!isRecord(value)) return undefined;
  return {
    totalPluginCount: Math.round(clampNumber(numberOr(value.totalPluginCount, 0), 0, 10000)),
    cpuScore: round2(clampNumber(numberOr(value.cpuScore, 0), 0, 100000)),
    highCpuCount: Math.round(clampNumber(numberOr(value.highCpuCount, 0), 0, 10000)),
    masterRiskCount: Math.round(clampNumber(numberOr(value.masterRiskCount, 0), 0, 10000)),
    warningCount: Math.round(clampNumber(numberOr(value.warningCount, 0), 0, 10000)),
    warnings: sanitizeStringArray(value.warnings).slice(0, 32),
  };
}

function sanitizeMetricRecord(value: unknown): Record<string, number> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .slice(0, 64);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeReferenceDeltaSummary(value: unknown): SweetPersistedAnalysisCacheSummary["referenceDeltaSummary"] {
  if (!isRecord(value)) return undefined;
  return {
    source: typeof value.source === "string" ? value.source : undefined,
    confidence: finiteOrUndefined(value.confidence),
    bandCount: finiteOrUndefined(value.bandCount),
    warningCount: finiteOrUndefined(value.warningCount),
  };
}

function isExportStatus(value: unknown): value is SweetExportOperationStatus {
  return value === "applied" || value === "bypassed" || value === "not-wired" || value === "failed";
}

function isExportStrategy(value: unknown): value is SweetExportStabilityReport["strategy"] {
  return (
    value === "exact-full-render" ||
    value === "chunked-project-render" ||
    value === "track-batched-chunked-render" ||
    value === "clip-by-clip-safe-export" ||
    value === "split-stem-package" ||
    value === "individual-stem-download"
  );
}

function isExportRisk(value: unknown): value is SweetExportStabilityReport["risk"] {
  return value === "low" || value === "medium" || value === "high" || value === "critical";
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
