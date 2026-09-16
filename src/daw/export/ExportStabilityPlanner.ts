import { hasSoloTrack, isReferenceTrack, isTrackAudible } from "@/audio/engine/TrackGraph";
import { getPluginRenderWeight, isHeavyRenderPlugin } from "@/audio/plugins/pluginCost";
import { resolveStableExportSampleRate, type StableExportSampleRate } from "@/daw/export/ExportConsistency";
import type { Project } from "@/daw/model/Project";

export type SweetExportStrategy =
  | "exact-full-render"
  | "chunked-project-render"
  | "track-batched-chunked-render"
  | "clip-by-clip-safe-export"
  | "split-stem-package"
  | "individual-stem-download";

export type SweetExportRiskLevel = "low" | "medium" | "high" | "critical";

export type SweetExportStabilityPlan = {
  strategy: SweetExportStrategy;
  risk: SweetExportRiskLevel;
  reason: string[];
  sampleRate: StableExportSampleRate;
  durationSec: number;
  trackCount: number;
  clipCount: number;
  activeStemCount: number;
  repairRegionCount: number;
  unmaskOperationCount: number;
  heavyPluginCount: number;
  estimatedFullRenderMb: number;
  estimatedPeakMemoryMb: number;
  memoryBudgetMb: number;
  chunkSec: number;
  renderPaddingSec: number;
  trackBatchSize: number;
  maxZipPartMb: number;
  allowSingleZip: boolean;
  allowFullOfflineRender: boolean;
  retryPlan: Array<{
    chunkSec: number;
    trackBatchSize: number;
    sampleRate?: StableExportSampleRate;
  }>;
  warnings: string[];
};

export type SweetExportStabilityReport = {
  strategy: SweetExportStrategy;
  risk: SweetExportRiskLevel;
  estimatedPeakMemoryMb: number;
  memoryBudgetMb: number;
  chunkSec: number;
  trackBatchSize: number;
  retryCount: number;
  fallbackUsed: boolean;
  renderedChunks: number;
  renderedTrackBatches: number;
  boundarySmoothing?: boolean;
  failedChunks: Array<{
    index: number;
    reason: string;
  }>;
  warnings: string[];
};

export type ExportStabilityPlannerOptions = {
  purpose?: "master-wav" | "processed-stem-package" | "track-render";
  sampleRate?: StableExportSampleRate;
  userAgent?: string;
  deviceMemoryGb?: number;
  forceStable?: boolean;
};

const MOBILE_MEMORY_BUDGET_MB = 96;
const TABLET_MEMORY_BUDGET_MB = 160;
const DESKTOP_MEMORY_BUDGET_MB = 384;
const FALLBACK_DESKTOP_MEMORY_BUDGET_MB = 256;
const BYTES_PER_MB = 1024 * 1024;

export function buildExportStabilityPlan(project: Project, options: ExportStabilityPlannerOptions = {}): SweetExportStabilityPlan {
  const sampleRate = options.sampleRate ?? resolveStableExportSampleRate(project);
  const purpose = options.purpose ?? "master-wav";
  const exportTracks = project.tracks.filter((track) => !isReferenceTrack(track));
  const soloActive = hasSoloTrack(exportTracks);
  const audibleTrackIds = new Set(exportTracks.filter((track) => isTrackAudible(track, soloActive)).map((track) => track.id));
  const exportClips = project.clips.filter((clip) => audibleTrackIds.has(clip.trackId));
  const durationSec = Math.max(0.1, getClipDurationSec(exportClips));
  const activeStemCount = audibleTrackIds.size;
  const repairRegionCount = project.repairRegions.filter((region) => region.enabled && region.fixed).length;
  const unmaskOperationCount = project.aimixUnmaskState.operations.filter((operation) => operation.enabled && operation.fixed).length;
  const heavyPluginCount = countHeavyPlugins(project);
  const pluginWeight = estimatePluginWeight(project);
  const memoryBudgetMb = resolveMemoryBudgetMb(options);
  const stereoPcmMb = (durationSec * sampleRate * 2 * 4) / BYTES_PER_MB;
  const estimatedFullRenderMb = stereoPcmMb * 3.5;
  const wavEncodeEstimateMb = stereoPcmMb * 1.5;
  const projectGraphFactor = 1 + activeStemCount * 0.08 + pluginWeight * 0.035 + heavyPluginCount * 0.08 + repairRegionCount * 0.01 + unmaskOperationCount * 0.02;
  const estimatedPeakMemoryMb = (estimatedFullRenderMb + wavEncodeEstimateMb) * projectGraphFactor;
  const packageEstimateMb = stereoPcmMb * (activeStemCount + 2) * 2.8;
  const mobile = isLikelyMobileRuntime(options.userAgent);
  const reason: string[] = [];
  const warnings: string[] = [];

  let strategy: SweetExportStrategy = "exact-full-render";
  const smallStandardProject =
    activeStemCount <= 4 &&
    durationSec <= 180 &&
    heavyPluginCount === 0 &&
    repairRegionCount === 0 &&
    unmaskOperationCount === 0 &&
    estimatedPeakMemoryMb < memoryBudgetMb * 1.4;

  if (options.forceStable) {
    strategy = purpose === "master-wav" ? "chunked-project-render" : activeStemCount > 32 ? "split-stem-package" : "chunked-project-render";
    reason.push("Stable export was requested.");
    if (purpose === "master-wav" && activeStemCount > 32) {
      reason.push("Master WAV export will still be attempted with smaller time chunks instead of stopping at the stem-count guard.");
      warnings.push("Large master WAV detected. Sweet DAW will try stable chunked rendering first; if the browser still runs out of memory, export a processed stem package next.");
    } else if (strategy === "split-stem-package") {
      reason.push("Track-batched master WAV rendering is not enabled yet; split stem package is safer for this project.");
      warnings.push("Track-batched master WAV rendering is not enabled. Sweet DAW will not silently run a heavier project chunk render.");
    }
  } else if (smallStandardProject || (estimatedPeakMemoryMb < memoryBudgetMb * 0.65 && activeStemCount <= 12 && repairRegionCount + unmaskOperationCount < 64)) {
    strategy = "exact-full-render";
    reason.push("Project estimate fits comfortably inside the memory budget.");
  } else if (activeStemCount <= 32) {
    strategy = "chunked-project-render";
    reason.push("Full render may be heavy; use time-sliced rendering.");
  } else if (purpose === "master-wav") {
    strategy = "chunked-project-render";
    reason.push("Large master WAV will be attempted with stable time-sliced rendering instead of being stopped by the stem-count guard.");
    warnings.push("Large master WAV detected. Sweet DAW will try stable chunked rendering first; if the browser still runs out of memory, export a processed stem package next.");
  } else if (activeStemCount <= 64) {
    strategy = "split-stem-package";
    reason.push("Many active stems exceed the safe master WAV renderer; split stem package is safer than unimplemented track-batched rendering.");
    warnings.push("Track-batched master WAV rendering is not enabled. Sweet DAW will not silently run a heavier project chunk render.");
  } else {
    strategy = "individual-stem-download";
    reason.push("Very large stem count is safer as individual downloads.");
  }

  const allowSingleZip = packageEstimateMb <= memoryBudgetMb * 2;
  if (purpose === "processed-stem-package" && !allowSingleZip) {
    strategy = activeStemCount > 64 ? "individual-stem-download" : "split-stem-package";
    reason.push("Processed stem package is too large for one in-memory ZIP.");
    warnings.push("Large project detected. Sweet DAW will export stems in stable parts instead of one huge ZIP.");
  }

  const risk = resolveRisk(strategy, estimatedPeakMemoryMb, memoryBudgetMb);
  const chunkSec = resolveInitialChunkSec(risk, mobile);
  const trackBatchSize = resolveInitialTrackBatchSize(strategy, mobile);
  const renderPaddingSec = mobile ? 0.75 : heavyPluginCount > 0 ? 2.5 : 1.5;
  const maxZipPartMb = mobile ? 256 : 768;
  const allowFullOfflineRender = strategy === "exact-full-render";

  if (estimatedPeakMemoryMb > memoryBudgetMb) {
    warnings.push(`Estimated peak memory ${round1(estimatedPeakMemoryMb)}MB exceeds budget ${round1(memoryBudgetMb)}MB.`);
  }
  if (project.tracks.some(isReferenceTrack)) {
    warnings.push("Reference tracks are analysis-only and will be excluded from audio export.");
  }

  return {
    strategy,
    risk,
    reason,
    sampleRate,
    durationSec,
    trackCount: exportTracks.length,
    clipCount: exportClips.length,
    activeStemCount,
    repairRegionCount,
    unmaskOperationCount,
    heavyPluginCount,
    estimatedFullRenderMb: round1(estimatedFullRenderMb),
    estimatedPeakMemoryMb: round1(estimatedPeakMemoryMb),
    memoryBudgetMb: round1(memoryBudgetMb),
    chunkSec,
    renderPaddingSec,
    trackBatchSize,
    maxZipPartMb,
    allowSingleZip,
    allowFullOfflineRender,
    retryPlan: buildRetryPlan(chunkSec, trackBatchSize, sampleRate, mobile),
    warnings,
  };
}

export function createExportStabilityReport(
  plan: SweetExportStabilityPlan,
  patch: Partial<Omit<SweetExportStabilityReport, "strategy" | "risk" | "estimatedPeakMemoryMb" | "memoryBudgetMb" | "chunkSec" | "trackBatchSize" | "warnings">> & {
    warnings?: string[];
  } = {},
): SweetExportStabilityReport {
  return {
    strategy: plan.strategy,
    risk: plan.risk,
    estimatedPeakMemoryMb: plan.estimatedPeakMemoryMb,
    memoryBudgetMb: plan.memoryBudgetMb,
    chunkSec: plan.chunkSec,
    trackBatchSize: plan.trackBatchSize,
    retryCount: patch.retryCount ?? 0,
    fallbackUsed: patch.fallbackUsed ?? !plan.allowFullOfflineRender,
    renderedChunks: patch.renderedChunks ?? 0,
    renderedTrackBatches: patch.renderedTrackBatches ?? 0,
    boundarySmoothing: patch.boundarySmoothing,
    failedChunks: patch.failedChunks ?? [],
    warnings: [...plan.warnings, ...(patch.warnings ?? [])].slice(0, 24),
  };
}

function countHeavyPlugins(project: Project) {
  const allPlugins = [
    ...project.master.insertChain,
    ...project.tracks.flatMap((track) => track.insertChain),
    ...project.clips.flatMap((clip) => clip.insertChain),
  ];
  return allPlugins.filter((plugin) => plugin.enabled && isHeavyRenderPlugin(plugin.pluginId)).length;
}

function estimatePluginWeight(project: Project) {
  const allPlugins = [
    ...project.master.insertChain,
    ...project.tracks.flatMap((track) => track.insertChain),
    ...project.clips.flatMap((clip) => clip.insertChain),
  ];
  return allPlugins
    .filter((plugin) => plugin.enabled)
    .reduce((sum, plugin) => sum + getPluginRenderWeight(plugin.pluginId), 0);
}

function resolveMemoryBudgetMb(options: ExportStabilityPlannerOptions) {
  const deviceMemoryGb = options.deviceMemoryGb ?? getNavigatorDeviceMemoryGb();
  if (typeof deviceMemoryGb === "number" && Number.isFinite(deviceMemoryGb)) {
    if (deviceMemoryGb <= 2) return MOBILE_MEMORY_BUDGET_MB;
    if (deviceMemoryGb <= 4) return TABLET_MEMORY_BUDGET_MB;
    return DESKTOP_MEMORY_BUDGET_MB;
  }
  return isLikelyMobileRuntime(options.userAgent) ? MOBILE_MEMORY_BUDGET_MB : FALLBACK_DESKTOP_MEMORY_BUDGET_MB;
}

function getNavigatorDeviceMemoryGb() {
  const navigatorLike = typeof navigator !== "undefined" ? navigator as Navigator & { deviceMemory?: number } : undefined;
  return navigatorLike?.deviceMemory;
}

function isLikelyMobileRuntime(userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "") {
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
}

function resolveRisk(strategy: SweetExportStrategy, estimatedPeakMemoryMb: number, memoryBudgetMb: number): SweetExportRiskLevel {
  if (strategy === "exact-full-render") return "low";
  if (strategy === "individual-stem-download" || estimatedPeakMemoryMb > memoryBudgetMb * 2.25) return "critical";
  if (strategy === "track-batched-chunked-render" || strategy === "split-stem-package" || estimatedPeakMemoryMb > memoryBudgetMb * 1.2) return "high";
  if (strategy === "chunked-project-render" || estimatedPeakMemoryMb > memoryBudgetMb * 0.65) return "medium";
  return "low";
}

function resolveInitialChunkSec(risk: SweetExportRiskLevel, mobile: boolean) {
  if (mobile) return risk === "critical" || risk === "high" ? 1 : 2;
  if (risk === "critical") return 2;
  if (risk === "high") return 4;
  return 8;
}

function resolveInitialTrackBatchSize(strategy: SweetExportStrategy, mobile: boolean) {
  if (strategy === "track-batched-chunked-render") return mobile ? 2 : 8;
  if (strategy === "individual-stem-download") return 1;
  return mobile ? 4 : 12;
}

function buildRetryPlan(chunkSec: number, trackBatchSize: number, sampleRate: StableExportSampleRate, mobile: boolean) {
  const minChunk = mobile ? 0.5 : 1;
  const candidates = [
    { chunkSec, trackBatchSize, sampleRate },
    { chunkSec: Math.max(minChunk, chunkSec / 2), trackBatchSize: Math.max(1, Math.floor(trackBatchSize / 2)), sampleRate },
    { chunkSec: Math.max(minChunk, chunkSec / 4), trackBatchSize: Math.max(1, Math.floor(trackBatchSize / 4)), sampleRate },
    { chunkSec: minChunk, trackBatchSize: 1, sampleRate: sampleRate === 48000 ? 44100 : sampleRate },
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.chunkSec}:${candidate.trackBatchSize}:${candidate.sampleRate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getClipDurationSec(clips: Project["clips"]) {
  return clips.reduce((duration, clip) => Math.max(duration, clip.timelineStartSec + clip.durationSec), 0);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
