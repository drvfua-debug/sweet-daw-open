import type { MobileAudioQuality } from "@/audio/analysis/MobileProcessingBudget";
import type { PeakMaximizerOversample } from "@/audio/dsp/PeakMaximizer";

export type EngineQualityMode =
  | "mobile-preview"
  | "mobile-export"
  | "desktop-preview"
  | "desktop-export"
  | "analysis-only";

export type EngineQualityModeContext = {
  userAgent?: string;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  preferExport?: boolean;
  forceMobile?: boolean;
};

export type EngineProcessingBudget = {
  mode: EngineQualityMode;
  loudnessQuality: MobileAudioQuality;
  truePeakOversample: 1 | 2 | 4;
  analysisHopSize: number;
  maxAnalysisSeconds?: number;
  peakMaxOversampleCap: PeakMaximizerOversample;
  peakMaxMemoryBudgetBytes: number;
  offlineRenderMemoryBudgetBytes: number;
  allowHeavySpectral: boolean;
  allowCandidateRender: boolean;
  allowPostRenderSecondPass: boolean;
  chunkSeconds: number;
  reportLabel: string;
};

const MB = 1024 * 1024;

export function resolveEngineQualityMode(
  requested?: EngineQualityMode,
  context: EngineQualityModeContext = {},
): EngineQualityMode {
  if (requested) return requested;
  const isMobileLike = context.forceMobile
    || isMobileUserAgent(context.userAgent)
    || (Number.isFinite(context.deviceMemoryGb) && Number(context.deviceMemoryGb) <= 4)
    || (Number.isFinite(context.hardwareConcurrency) && Number(context.hardwareConcurrency) <= 4);
  if (context.preferExport) return isMobileLike ? "mobile-export" : "desktop-export";
  return isMobileLike ? "mobile-preview" : "desktop-preview";
}

export function detectBrowserEngineQualityMode(preferExport = true): EngineQualityMode {
  if (typeof navigator === "undefined") {
    return preferExport ? "desktop-export" : "desktop-preview";
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return resolveEngineQualityMode(undefined, {
    userAgent: nav.userAgent,
    deviceMemoryGb: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
    preferExport,
  });
}

export function resolveEngineProcessingBudget(
  mode: EngineQualityMode,
  overrides: { memoryBudgetBytes?: number } = {},
): EngineProcessingBudget {
  const memoryBudgetBytes = overrides.memoryBudgetBytes;
  if (mode === "analysis-only") {
    return withMemoryOverride({
      mode,
      loudnessQuality: "fast",
      truePeakOversample: 1,
      analysisHopSize: 1024,
      maxAnalysisSeconds: 90,
      peakMaxOversampleCap: "off",
      peakMaxMemoryBudgetBytes: 48 * MB,
      offlineRenderMemoryBudgetBytes: 96 * MB,
      allowHeavySpectral: false,
      allowCandidateRender: false,
      allowPostRenderSecondPass: false,
      chunkSeconds: 12,
      reportLabel: "Analysis only / no audio rewrite",
    }, memoryBudgetBytes);
  }
  if (mode === "mobile-preview") {
    return withMemoryOverride({
      mode,
      loudnessQuality: "fast",
      truePeakOversample: 1,
      analysisHopSize: 1024,
      maxAnalysisSeconds: 45,
      peakMaxOversampleCap: "off",
      peakMaxMemoryBudgetBytes: 64 * MB,
      offlineRenderMemoryBudgetBytes: 128 * MB,
      allowHeavySpectral: false,
      allowCandidateRender: false,
      allowPostRenderSecondPass: false,
      chunkSeconds: 8,
      reportLabel: "Mobile preview / lightweight",
    }, memoryBudgetBytes);
  }
  if (mode === "mobile-export") {
    return withMemoryOverride({
      mode,
      loudnessQuality: "mobile-hq",
      truePeakOversample: 2,
      analysisHopSize: 512,
      maxAnalysisSeconds: undefined,
      peakMaxOversampleCap: "2x",
      peakMaxMemoryBudgetBytes: 112 * MB,
      offlineRenderMemoryBudgetBytes: 384 * MB,
      allowHeavySpectral: false,
      allowCandidateRender: false,
      allowPostRenderSecondPass: true,
      chunkSeconds: 10,
      reportLabel: "Mobile export / high precision within memory guard",
    }, memoryBudgetBytes);
  }
  if (mode === "desktop-preview") {
    return withMemoryOverride({
      mode,
      loudnessQuality: "mobile-hq",
      truePeakOversample: 2,
      analysisHopSize: 512,
      maxAnalysisSeconds: 90,
      peakMaxOversampleCap: "2x",
      peakMaxMemoryBudgetBytes: 160 * MB,
      offlineRenderMemoryBudgetBytes: 512 * MB,
      allowHeavySpectral: false,
      allowCandidateRender: true,
      allowPostRenderSecondPass: true,
      chunkSeconds: 16,
      reportLabel: "Desktop preview / balanced",
    }, memoryBudgetBytes);
  }
  return withMemoryOverride({
    mode: "desktop-export",
    loudnessQuality: "offline-best",
    truePeakOversample: 4,
    analysisHopSize: 256,
    maxAnalysisSeconds: undefined,
    peakMaxOversampleCap: "4x",
    peakMaxMemoryBudgetBytes: 256 * MB,
    offlineRenderMemoryBudgetBytes: 768 * MB,
    allowHeavySpectral: true,
    allowCandidateRender: true,
    allowPostRenderSecondPass: true,
    chunkSeconds: 24,
    reportLabel: "Desktop export / highest browser-safe precision",
  }, memoryBudgetBytes);
}

export function engineModeToMobileAudioQuality(mode: EngineQualityMode): MobileAudioQuality {
  return resolveEngineProcessingBudget(mode).loudnessQuality;
}

export function capPeakMaximizerOversample(
  requested: PeakMaximizerOversample,
  cap: PeakMaximizerOversample,
): PeakMaximizerOversample {
  return oversampleRank(requested) > oversampleRank(cap) ? cap : requested;
}

export function formatEngineQualityModeReport(budget: EngineProcessingBudget) {
  return `EngineQualityMode ${budget.mode}: ${budget.reportLabel}; TP ${budget.truePeakOversample}x, PeakMax cap ${budget.peakMaxOversampleCap}, render budget ${formatMb(budget.offlineRenderMemoryBudgetBytes)}MB.`;
}

function withMemoryOverride<T extends EngineProcessingBudget>(budget: T, memoryBudgetBytes?: number): T {
  if (!Number.isFinite(memoryBudgetBytes) || Number(memoryBudgetBytes) <= 0) return budget;
  const safeBudget = Math.max(16 * MB, Math.round(Number(memoryBudgetBytes)));
  return {
    ...budget,
    peakMaxMemoryBudgetBytes: Math.min(budget.peakMaxMemoryBudgetBytes, safeBudget),
    offlineRenderMemoryBudgetBytes: Math.min(budget.offlineRenderMemoryBudgetBytes, safeBudget),
  };
}

function isMobileUserAgent(userAgent?: string) {
  return /\b(iPhone|iPad|iPod|Android|Mobile)\b/i.test(userAgent ?? "");
}

function oversampleRank(value: PeakMaximizerOversample) {
  if (value === "4x") return 4;
  if (value === "2x") return 2;
  return 1;
}

function formatMb(bytes: number) {
  return Math.round(bytes / MB);
}
