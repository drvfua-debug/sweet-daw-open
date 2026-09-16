"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Check, Crosshair, Disc, Info, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { createPluginInstance } from "@/audio/plugins/pluginRegistry";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { useDawStore } from "@/daw/store/dawStore";
import { AimixUnmaskMatrixPanel } from "@/ui/daw/AimixUnmaskMatrixPanel";
import type { EQBandType, ParametricEQState, Project, StemRole, Track } from "@/daw/model/Project";
import type { BuiltinPluginId, PluginInstance } from "@/daw/model/Plugin";
import { computeAiMix, type MagicPolishAnalysis } from "@/daw/mix/aiMixAssistant";
import { applyPeakingToSlot, applyShelfGainToSlot } from "@/daw/mix/eqSlotUtils";
import { averageDbAsPower, estimateIntegratedLufsApproxFromRms } from "@/daw/mix/loudnessApprox";
import { validateReferenceMatchProgress } from "@/daw/mix/reference/referenceValidation";
import { analyzeMixDoctor } from "@/daw/mix/mixDoctorEngine";
import {
  applyClipIntelligenceToProject,
  buildClipIntelligenceReport,
  summarizeClipIntelligence,
  type ClipIntelligenceReport,
  type ClipPanDesignMode,
} from "@/daw/mix/clipIntelligence";
import type { ReferenceDelta, ReferenceProfile, ReferenceRepairDiagnosis, StemFeatureReport } from "@/daw/mix/mixDoctorTypes";
import {
  MAGIC_POLISH_TARGETS,
  type MagicPolishGenre,
  type MagicPolishMode,
  type MagicPolishTargetPreset,
  type MixStrength,
} from "@/daw/mix/aiMixPresets";
import { applyReferenceAmbienceFollowToProject } from "@/daw/mix/reference/referenceAmbience";
import { buildReferenceRepairMarkdown } from "@/daw/mix/reference/referenceRepair";
import { applyCleanStemRebuild } from "@/daw/mix/cleanStem/cleanStemRebuild";
import type { StemAirLayerStatus, VocalClarityGateItem, VocalClarityGateReport, VocalClarityGateStatus } from "@/daw/auto/autoReferenceMixTypes";
import { buildOneTapReferenceFinishState } from "@/daw/auto/oneTapReferenceFinish";
import {
  AIMIX_GLOW_PRESET_ORDER,
  AIMIX_GLOW_PRESETS,
  DEFAULT_AIMIX_GLOW_SETTINGS,
  processAimixGlow,
  settingsFromAimixGlowPreset,
  type AimixGlowAnalysis,
  type AimixGlowPresetId,
  type AimixGlowSettings,
} from "@/daw/aimixGlow";
import {
  SINGLE_FILE_MASTERING_MODE_PRESETS,
  analyzeSingleFileMastering,
  processSingleFileMastering,
  resolveSingleFileMasteringSettings,
  type SingleFileAudioChannel,
  type SingleFileMasteringMetrics,
  type SingleFileMasteringMode,
  type SingleFileMasteringResult,
  type SingleFileMasteringSettings,
  type SingleFileStageToggles,
} from "@/daw/mastering/singleFileMastering";
import {
  createDirectWavMasteringSource,
  hasDirectWavMasteringSource,
} from "@/daw/mastering/directWavMasteringSource";
import {
  buildSingleFileExportPlan,
  type SingleFileExportPlan as SingleFileRenderPlan,
} from "@/daw/mastering/singleFileExportPlan";
import {
  canRunSingleFileMasteringExport,
  getSingleFileExportButtonLabel,
  getSingleFileExportDisabledReason,
} from "@/daw/mastering/singleFileMasteringUi";
import { reserveMasterExportFilename } from "@/daw/export/MasterExportFilename";
import {
  buildSweetReferenceDeltaReportFromFeatures,
  toAimixReferenceDeltaHints,
  toMasterPolishTargetHints,
  type SweetReferenceDeltaReport,
} from "@/lib/audio/referenceDelta";
import {
  DEFAULT_SWEET_MASTER_TARGET_PROFILE_ID,
  SWEET_MASTER_TARGET_PROFILES,
  getSweetMasterTargetProfile,
  type SweetMasterTargetProfile,
  type SweetMasterTargetProfileId,
} from "@/lib/audio/targetProfiles";
type AiMixMode = "safe" | "balanced" | "dense" | "referenceMatch" | "cleanRebuild" | "suggestOnly";
type AimixWorkflowPreset = "standard" | "reference" | "custom";
type ReferenceGainMode = "match" | "manual";
type ReferenceRuntimeStatus = "none" | "loaded" | "analyzing" | "ready" | "error";
type ReferenceRuntimeState = {
  status: ReferenceRuntimeStatus;
  trackId?: string;
  trackName?: string;
  profile?: ReferenceProfile | null;
  delta?: ReferenceDelta | null;
  repair?: ReferenceRepairDiagnosis | null;
  error?: string | null;
  updatedAt?: string;
};

type AiMixMetrics = {
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  low: number;
  lowMid: number;
  presence: number;
  air: number;
  width: number;
  sub2060: number;
  low120250: number;
  body250500: number;
  mid5002000: number;
  presence20005000: number;
  air500010000: number;
  ultraAir1000020000: number;
};

type AiMixProposal = {
  before: Project;
  after: Project;
  beforeMetrics: AiMixMetrics;
  afterMetrics: AiMixMetrics;
  decisions: string[];
  vocalClarityGate?: VocalClarityGateReport | null;
  createdAt: string;
  mode: AiMixMode;
};

type AiMixReferenceContext = {
  delta: ReferenceDelta | null;
  crestFactorDb: number | null;
  profile: ReferenceProfile | null;
  repair: ReferenceRepairDiagnosis | null;
  stemFeatureReports: StemFeatureReport[];
};

type ManualAdjustments = {
  bassTrimDb: number;
  bodyDb: number;
  presenceDb: number;
  width: number;
};

type AimixSpectralRestoreMode = "off" | "safe" | "balanced" | "strong";

type AimixSpectralRestoreSettings = {
  enabled: boolean;
  mode: AimixSpectralRestoreMode;
  useReference: boolean;
  amount: number;
  restorePresence: boolean;
  restoreAir: boolean;
  restoreLowMid: boolean;
  maxPresenceBoostDb: number;
  maxAirBoostDb: number;
  maxLowMidBoostDb: number;
  deEssGuard: boolean;
  artifactGuard: boolean;
  correlationGuard: boolean;
};

type AimixSpectralRestoreReport = {
  project: Project;
  decisions: string[];
};

type AimixBandProfile = {
  lowMid120250: number;
  presence5000_10000: number;
  air10000_16000: number;
  ultra16000_20000: number;
  lrCorrelation: number;
  sideMidRatioDb: number;
  spectralFlatness: number;
};

type MagicPolishMeter = {
  integratedLufs: number;
  truePeakDb: number;
  rmsDb: number;
  crestDb: number;
  lowMidDb: number;
  presenceDb: number;
  airDb: number;
  widthDb: number;
  low120250Db: number;
  body250500Db: number;
  mid5002000Db: number;
  presence20005000Db: number;
  air500010000Db: number;
  ultraAir1000020000Db: number;
};

type MagicPolishResolvedTarget = {
  preset: MagicPolishTargetPreset;
  label: string;
  targetIntegratedLufs: number;
  truePeakCeilingDb: number;
  tonalMatchStrength: number;
  spatialMatchStrength: number;
  densityMatchStrength: number;
  notes: string;
  warning?: string | null;
  exactReferenceGain?: boolean;
  hardLimitEnabled?: boolean;
  referenceGainDb?: number;
  referenceRepairStatus?: ReferenceRepairDiagnosis["status"] | null;
  referenceRepairSeverity?: ReferenceRepairDiagnosis["severity"] | null;
};

type MagicPolishReport = {
  before: MagicPolishMeter;
  target: MagicPolishResolvedTarget;
  after: MagicPolishMeter;
  actions: string[];
  warning?: string | null;
};

type SingleFileAudioSnapshot = {
  sampleRate: number;
  channels: SingleFileAudioChannel[];
  lowMemoryMode?: boolean;
  estimatedPcmBytes?: number;
  estimatedWorkingBytes?: number;
  previewOnly?: boolean;
};

type SingleFileChunkedTargetScan = {
  estimatedLufs: number;
  peakDb: number;
  fixedTargetGainDb: number;
  chunks: number;
  warnings: string[];
};

type SingleFileMasteringUiReport = Omit<SingleFileMasteringResult, "channels">;

type SingleFileWorkProgress = {
  title: string;
  label: string;
  detail?: string;
  percent: number;
};

type SingleFileMasteringPrefs = {
  mode: SingleFileMasteringMode;
  targetLufs: number;
  truePeakCeilingDb: number;
  safetyHpfHz: number;
  harshnessAmount: number;
  artifactGuardAmount: number;
  stages: SingleFileStageToggles;
  manualTargetDirty: boolean;
  manualCeilingDirty: boolean;
  manualHpfDirty: boolean;
  manualHarshnessDirty: boolean;
  manualArtifactGuardDirty: boolean;
};

type AimixGlowUiReport = {
  before: AimixGlowAnalysis;
  after: AimixGlowAnalysis;
  outputMatchGainDb: number;
  actions: string[];
  warnings: string[];
  vocalSource: "vocal" | "fallback" | "off";
};

type MasteringConflictGuard = {
  active: boolean;
  glowActive: boolean;
  clarityShortage: boolean;
  toneCleanupAmount: number;
  harshnessScale: number;
  reasons: string[];
};

type PeakCulpritReportItem = {
  trackId: string;
  trackName: string;
  role: StemRole;
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  peakRiskDb: number;
  suggestedAction: string;
};

const SINGLE_FILE_STAGE_LABELS: Array<{ key: keyof SingleFileStageToggles; label: string }> = [
  { key: "safetyHpf", label: "Safety HPF" },
  { key: "tiltBalance", label: "Tilt Balance" },
  { key: "toneCleanup", label: "Tone Cleanup" },
  { key: "harshnessGuard", label: "Harsh Guard" },
  { key: "glueCompression", label: "Glue" },
  { key: "preLimiterClipper", label: "Clipper" },
  { key: "targetLoudness", label: "Target LUFS" },
  { key: "truePeakLimiter", label: "TP Limiter" },
];

const SINGLE_FILE_MODE_OPTIONS: Array<{ id: SingleFileMasteringMode; label: string; description: string }> = [
  { id: "existing", label: "Existing", description: "Project Magic Polish. Existing reference and project settings are kept." },
  ...Object.entries(SINGLE_FILE_MASTERING_MODE_PRESETS).map(([id, preset]) => ({
    id: id as SingleFileMasteringMode,
    label: preset.label,
    description: preset.description,
  })),
];

const SINGLE_FILE_TARGET_LUFS_OPTIONS = [-16, -14, -12, -10, -9];
const SINGLE_FILE_TRUE_PEAK_OPTIONS = [-2, -1.5, -1.2, -1];
const DEFAULT_SINGLE_FILE_TRUE_PEAK_CEILING_DBTP = -1.2;
const SINGLE_FILE_HPF_OPTIONS = [0, 28, 40, 60, 80, 100, 120];
const SINGLE_FILE_AUDITION_PREVIEW_SEC = 45;
const SINGLE_FILE_FULL_PROCESSED_STORE_LIMIT_BYTES = 180 * 1024 * 1024;

const REFERENCE_GAIN_MODE_OPTIONS: Array<{ id: ReferenceGainMode; label: string; description: string }> = [
  { id: "match", label: "Reference一致", description: "ReferenceのLUFSをそのまま目標にします。" },
  { id: "manual", label: "手動Trim", description: "Reference LUFSに手動Trimを足して決めます。" },
];

const PAN_DESIGN_OPTIONS: Array<{ id: ClipPanDesignMode; label: string; description: string }> = [
  { id: "referencePlus", label: "Reference+", description: "Referenceを土台に、中央保護しながら伴奏/FXを時間軸で整理します。" },
  { id: "role", label: "Role基準", description: "Role別の安全なPanアンカーを作ります。" },
  { id: "off", label: "OFF", description: "clipのPanアンカーを作りません。" },
];

const DEFAULT_ADJUSTMENTS: ManualAdjustments = {
  bassTrimDb: -0.4,
  bodyDb: -0.35,
  presenceDb: 0.2,
  width: 0.12,
};

const ORTHODOX_AIMIX_MODE: AiMixMode = "balanced";
const DEFAULT_AIMIX_WORKFLOW: AimixWorkflowPreset = "standard";

const DEFAULT_AIMIX_SPECTRAL_RESTORE: AimixSpectralRestoreSettings = {
  enabled: true,
  mode: "balanced",
  useReference: true,
  amount: 65,
  restorePresence: true,
  restoreAir: true,
  restoreLowMid: true,
  maxPresenceBoostDb: 1.5,
  maxAirBoostDb: 1.5,
  maxLowMidBoostDb: 1.2,
  deEssGuard: true,
  artifactGuard: true,
  correlationGuard: true,
};

const AIMIX_REFERENCE_PRESET: {
  mode: AiMixMode;
  spectralRestore: AimixSpectralRestoreSettings;
  target: {
    lufsToleranceDb: number;
    crestToleranceDb: number;
    tonalToleranceDb: number;
    airToleranceDb: number;
  };
} = {
  mode: "referenceMatch",
  spectralRestore: {
    ...DEFAULT_AIMIX_SPECTRAL_RESTORE,
    enabled: true,
    mode: "balanced",
    useReference: true,
    amount: 75,
    restorePresence: true,
    restoreAir: true,
    restoreLowMid: true,
    maxPresenceBoostDb: 1.5,
    maxAirBoostDb: 1.2,
    maxLowMidBoostDb: 1.0,
    deEssGuard: true,
    artifactGuard: true,
    correlationGuard: true,
  },
  target: {
    lufsToleranceDb: 0.5,
    crestToleranceDb: 1.5,
    tonalToleranceDb: 1.2,
    airToleranceDb: 2,
  },
};

const AIMIX_MODE_OPTIONS: Array<{ id: AiMixMode; label: string; description: string }> = [
  {
    id: "balanced",
    label: "Balanced",
    description: "通常推奨。Role、Volume、Pan、EQを安全に整え、Vocalと低域を守ります。",
  },
  {
    id: "referenceMatch",
    label: "Reference Match",
    description: "Reference WAVの音量感、こもり、空気感、横幅へできる限り近づけます。Reference自体は解析・比較専用で、通常再生とWAV書き出しには混ぜません。",
  },
  {
    id: "cleanRebuild",
    label: "Clean Rebuild",
    description: "Suno clean stems向け。Spatialなしでrole/masking/placement/安全widthを整理します。",
  },
  {
    id: "safe",
    label: "Safe",
    description: "元stemの質感を優先。加工量を最小限にして、失敗しにくい補正だけ行います。",
  },
  {
    id: "dense",
    label: "Dense",
    description: "少し密度と音圧を足します。強めなのでA/B確認してからFIXしてください。",
  },
  {
    id: "suggestOnly",
    label: "Suggest",
    description: "提案と判断ログだけ表示します。プロジェクトへは反映しません。",
  },
];

const FINAL_MODE_LABELS: Record<MagicPolishMode, string> = {
  safe: "Safe",
  balanced: "Balanced",
  loud: "Dense",
};

const MAGIC_POLISH_TARGET_ORDER: MagicPolishTargetPreset[] = [
  "apple_music",
  "spotify",
  "soundcloud",
  "reference",
  "custom",
];

const MAGIC_POLISH_PREFS_KEY = "sweet-daw.magic-polish.v2";
const SINGLE_FILE_MASTERING_PREFS_KEY = "sweet-daw.single-file-mastering.v1";
const AIMIX_SPECTRAL_RESTORE_PREFS_KEY = "sweet-daw.aimix-spectral-restore.v1";
const AIMIX_GLOW_PREFS_KEY = "sweet-daw.aimix-glow.v1";

const SPECTRAL_RESTORE_MODE_LABELS: Record<AimixSpectralRestoreMode, string> = {
  off: "Off",
  safe: "Safe",
  balanced: "Balanced",
  strong: "Strong",
};

const ROLE_SPECTRAL_RESTORE_WEIGHT: Record<StemRole, { presence: number; air: number; lowMid: number }> = {
  vocal: { presence: 0.55, air: 0.35, lowMid: 0.3 },
  backingVocal: { presence: 0.45, air: 0.35, lowMid: 0.2 },
  drums: { presence: 0.85, air: 0.75, lowMid: 0.2 },
  bass: { presence: 0.05, air: 0, lowMid: 0.45 },
  guitar: { presence: 0.7, air: 0.45, lowMid: 0.35 },
  synth: { presence: 0.6, air: 0.55, lowMid: 0.15 },
  keys: { presence: 0.5, air: 0.45, lowMid: 0.2 },
  fx: { presence: 0.5, air: 0.6, lowMid: 0 },
  music: { presence: 0.5, air: 0.4, lowMid: 0.25 },
  loop: { presence: 0.45, air: 0.35, lowMid: 0.2 },
  other: { presence: 0.45, air: 0.35, lowMid: 0.2 },
  reference: { presence: 0, air: 0, lowMid: 0 },
};

function readMagicPolishPrefs() {
  if (typeof window === "undefined") {
    return {
      targetPreset: "spotify" as MagicPolishTargetPreset,
      finalMode: "balanced" as MagicPolishMode,
      customTargetIntegratedLufs: -13.5,
      customTruePeakCeilingDb: -1,
      customTonalMatchStrength: 0.35,
      customSpatialMatchStrength: 0.25,
      customDensityMatchStrength: 0.35,
      referenceGainMode: "match" as ReferenceGainMode,
      referenceGainTrimDb: 0,
      referenceHardLimit: false,
      panDesignMode: "role" as ClipPanDesignMode,
      panDesignAmount: 70,
    };
  }

  try {
    const raw = window.localStorage.getItem(MAGIC_POLISH_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const targetPreset = MAGIC_POLISH_TARGET_ORDER.includes(parsed.targetPreset as MagicPolishTargetPreset)
      ? parsed.targetPreset as MagicPolishTargetPreset
      : "spotify";
    const finalMode: MagicPolishMode = parsed.finalMode === "safe" || parsed.finalMode === "balanced" || parsed.finalMode === "loud"
      ? parsed.finalMode as MagicPolishMode
      : "balanced";
    const referenceGainMode: ReferenceGainMode = parsed.referenceGainMode === "manual"
      ? parsed.referenceGainMode as ReferenceGainMode
      : "match";
    const panDesignMode: ClipPanDesignMode = parsed.panDesignMode === "off" || parsed.panDesignMode === "role" || parsed.panDesignMode === "referencePlus"
      ? parsed.panDesignMode as ClipPanDesignMode
      : "role";
    return {
      targetPreset,
      finalMode,
      customTargetIntegratedLufs: clampNumber(parsed.customTargetIntegratedLufs, -20, -8, -13.5),
      customTruePeakCeilingDb: clampNumber(parsed.customTruePeakCeilingDb, -3, -0.3, -1),
      customTonalMatchStrength: clampNumber(parsed.customTonalMatchStrength, 0, 1, 0.35),
      customSpatialMatchStrength: clampNumber(parsed.customSpatialMatchStrength, 0, 1, 0.25),
      customDensityMatchStrength: clampNumber(parsed.customDensityMatchStrength, 0, 1, 0.35),
      referenceGainMode,
      referenceGainTrimDb: clampNumber(parsed.referenceGainTrimDb, -6, 6, 0),
      referenceHardLimit: typeof parsed.referenceHardLimit === "boolean" ? parsed.referenceHardLimit : false,
      panDesignMode,
      panDesignAmount: clampNumber(parsed.panDesignAmount, 0, 100, 70),
    };
  } catch {
    return {
      targetPreset: "spotify" as MagicPolishTargetPreset,
      finalMode: "balanced" as MagicPolishMode,
      customTargetIntegratedLufs: -13.5,
      customTruePeakCeilingDb: -1,
      customTonalMatchStrength: 0.35,
      customSpatialMatchStrength: 0.25,
      customDensityMatchStrength: 0.35,
      referenceGainMode: "match" as ReferenceGainMode,
      referenceGainTrimDb: 0,
      referenceHardLimit: false,
      panDesignMode: "role" as ClipPanDesignMode,
      panDesignAmount: 70,
    };
  }
}

function isSingleFileMasteringModeId(value: unknown): value is SingleFileMasteringMode {
  return value === "existing" || value === "directWavPolish" || value === "lightMaster" || value === "referenceCatchUp" || value === "loudnessOnly" || value === "loudRelease";
}

function sanitizeSingleFileStages(value: unknown, fallback: SingleFileStageToggles): SingleFileStageToggles {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Partial<Record<keyof SingleFileStageToggles, unknown>>;
  return {
    safetyHpf: typeof record.safetyHpf === "boolean" ? record.safetyHpf : fallback.safetyHpf,
    tiltBalance: typeof record.tiltBalance === "boolean" ? record.tiltBalance : fallback.tiltBalance,
    toneCleanup: typeof record.toneCleanup === "boolean" ? record.toneCleanup : fallback.toneCleanup,
    harshnessGuard: typeof record.harshnessGuard === "boolean" ? record.harshnessGuard : fallback.harshnessGuard,
    glueCompression: typeof record.glueCompression === "boolean" ? record.glueCompression : fallback.glueCompression,
    preLimiterClipper: typeof record.preLimiterClipper === "boolean" ? record.preLimiterClipper : fallback.preLimiterClipper,
    targetLoudness: typeof record.targetLoudness === "boolean" ? record.targetLoudness : fallback.targetLoudness,
    truePeakLimiter: typeof record.truePeakLimiter === "boolean" ? record.truePeakLimiter : fallback.truePeakLimiter,
  };
}

function readSingleFileMasteringPrefs(fallback: SingleFileMasteringSettings): SingleFileMasteringPrefs {
  const defaults: SingleFileMasteringPrefs = {
    mode: "lightMaster",
    targetLufs: fallback.targetLufs,
    truePeakCeilingDb: fallback.truePeakCeilingDb,
    safetyHpfHz: fallback.safetyHpfHz,
    harshnessAmount: fallback.harshnessAmount,
    artifactGuardAmount: fallback.artifactGuardAmount,
    stages: fallback.stages,
    manualTargetDirty: false,
    manualCeilingDirty: false,
    manualHpfDirty: false,
    manualHarshnessDirty: false,
    manualArtifactGuardDirty: false,
  };
  if (typeof window === "undefined") return defaults;

  try {
    const raw = window.localStorage.getItem(SINGLE_FILE_MASTERING_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const mode = isSingleFileMasteringModeId(parsed.mode) ? parsed.mode : defaults.mode;
    return {
      mode,
      targetLufs: clampNumber(parsed.targetLufs, -24, -6, defaults.targetLufs),
      truePeakCeilingDb: clampNumber(parsed.truePeakCeilingDb, -6, -1, defaults.truePeakCeilingDb),
      safetyHpfHz: clampNumber(parsed.safetyHpfHz, 0, 180, defaults.safetyHpfHz),
      harshnessAmount: clampNumber(parsed.harshnessAmount, 0, 1, defaults.harshnessAmount),
      artifactGuardAmount: clampNumber(parsed.artifactGuardAmount, 0, 1, defaults.artifactGuardAmount),
      stages: sanitizeSingleFileStages(parsed.stages, defaults.stages),
      manualTargetDirty: typeof parsed.manualTargetDirty === "boolean" ? parsed.manualTargetDirty : false,
      manualCeilingDirty: typeof parsed.manualCeilingDirty === "boolean" ? parsed.manualCeilingDirty : false,
      manualHpfDirty: typeof parsed.manualHpfDirty === "boolean" ? parsed.manualHpfDirty : false,
      manualHarshnessDirty: typeof parsed.manualHarshnessDirty === "boolean" ? parsed.manualHarshnessDirty : false,
      manualArtifactGuardDirty: typeof parsed.manualArtifactGuardDirty === "boolean" ? parsed.manualArtifactGuardDirty : false,
    };
  } catch {
    return defaults;
  }
}

function readAimixGlowPrefs(): AimixGlowSettings {
  if (typeof window === "undefined") return DEFAULT_AIMIX_GLOW_SETTINGS;
  try {
    const raw = window.localStorage.getItem(AIMIX_GLOW_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const preset = AIMIX_GLOW_PRESET_ORDER.includes(parsed.preset as Exclude<AimixGlowPresetId, "custom">)
      ? parsed.preset as AimixGlowPresetId
      : parsed.preset === "custom" ? "custom" : DEFAULT_AIMIX_GLOW_SETTINGS.preset;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_AIMIX_GLOW_SETTINGS.enabled,
      preset,
      amount: clampNumber(parsed.amount, 0, 100, DEFAULT_AIMIX_GLOW_SETTINGS.amount),
      vocalKey: clampNumber(parsed.vocalKey, 0, 100, DEFAULT_AIMIX_GLOW_SETTINGS.vocalKey),
      recover: clampNumber(parsed.recover, 0, 100, DEFAULT_AIMIX_GLOW_SETTINGS.recover),
      gloss: clampNumber(parsed.gloss, 0, 100, DEFAULT_AIMIX_GLOW_SETTINGS.gloss),
      air: clampNumber(parsed.air, 0, 100, DEFAULT_AIMIX_GLOW_SETTINGS.air),
      tame: clampNumber(parsed.tame, 0, 100, DEFAULT_AIMIX_GLOW_SETTINGS.tame),
      outputMatch: typeof parsed.outputMatch === "boolean" ? parsed.outputMatch : DEFAULT_AIMIX_GLOW_SETTINGS.outputMatch,
      quality: parsed.quality === "preview" ? "preview" : "offlineHighQuality",
    };
  } catch {
    return DEFAULT_AIMIX_GLOW_SETTINGS;
  }
}

function readAimixSpectralRestorePrefs(): AimixSpectralRestoreSettings {
  if (typeof window === "undefined") return DEFAULT_AIMIX_SPECTRAL_RESTORE;
  try {
    const raw = window.localStorage.getItem(AIMIX_SPECTRAL_RESTORE_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const mode = parsed.mode === "off" || parsed.mode === "safe" || parsed.mode === "balanced" || parsed.mode === "strong"
      ? parsed.mode as AimixSpectralRestoreMode
      : DEFAULT_AIMIX_SPECTRAL_RESTORE.mode;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_AIMIX_SPECTRAL_RESTORE.enabled,
      mode,
      useReference: typeof parsed.useReference === "boolean" ? parsed.useReference : DEFAULT_AIMIX_SPECTRAL_RESTORE.useReference,
      amount: clampNumber(parsed.amount, 0, 100, DEFAULT_AIMIX_SPECTRAL_RESTORE.amount),
      restorePresence: typeof parsed.restorePresence === "boolean" ? parsed.restorePresence : DEFAULT_AIMIX_SPECTRAL_RESTORE.restorePresence,
      restoreAir: typeof parsed.restoreAir === "boolean" ? parsed.restoreAir : DEFAULT_AIMIX_SPECTRAL_RESTORE.restoreAir,
      restoreLowMid: typeof parsed.restoreLowMid === "boolean" ? parsed.restoreLowMid : DEFAULT_AIMIX_SPECTRAL_RESTORE.restoreLowMid,
      maxPresenceBoostDb: clampNumber(parsed.maxPresenceBoostDb, 0, 2.5, DEFAULT_AIMIX_SPECTRAL_RESTORE.maxPresenceBoostDb),
      maxAirBoostDb: clampNumber(parsed.maxAirBoostDb, 0, 2.5, DEFAULT_AIMIX_SPECTRAL_RESTORE.maxAirBoostDb),
      maxLowMidBoostDb: clampNumber(parsed.maxLowMidBoostDb, 0, 1.8, DEFAULT_AIMIX_SPECTRAL_RESTORE.maxLowMidBoostDb),
      deEssGuard: typeof parsed.deEssGuard === "boolean" ? parsed.deEssGuard : DEFAULT_AIMIX_SPECTRAL_RESTORE.deEssGuard,
      artifactGuard: typeof parsed.artifactGuard === "boolean" ? parsed.artifactGuard : DEFAULT_AIMIX_SPECTRAL_RESTORE.artifactGuard,
      correlationGuard: typeof parsed.correlationGuard === "boolean" ? parsed.correlationGuard : DEFAULT_AIMIX_SPECTRAL_RESTORE.correlationGuard,
    };
  } catch {
    return DEFAULT_AIMIX_SPECTRAL_RESTORE;
  }
}

type AiMixAssistantPanelSection = "aimix" | "mastering";

export function AiMixAssistantPanel({
  section = "aimix",
  onRequestSection,
}: {
  section?: AiMixAssistantPanelSection;
  onRequestSection?: (section: AiMixAssistantPanelSection) => void;
}) {
  const {
    project,
    waveformPeaks,
    loadProject,
    mixDoctorReport,
    setMixDoctorReport,
    mixDoctorAudition,
    autoReferenceMix,
    autoReferenceMixSettings,
    runOneTapReferenceFinish,
  } = useDawStore();
  const magicPrefs = readMagicPolishPrefs();
  const spectralPrefs = readAimixSpectralRestorePrefs();
  const glowPrefs = readAimixGlowPrefs();
  const [aimixMode, setAimixMode] = useState<AiMixMode>(ORTHODOX_AIMIX_MODE);
  const [aimixWorkflowPreset, setAimixWorkflowPreset] = useState<AimixWorkflowPreset>(DEFAULT_AIMIX_WORKFLOW);
  const [referenceOptionsOpen, setReferenceOptionsOpen] = useState(false);
  const [advancedAimixOpen, setAdvancedAimixOpen] = useState(autoReferenceMixSettings.showAdvancedByDefault);
  const [targetProfileId, setTargetProfileId] = useState<SweetMasterTargetProfileId>(DEFAULT_SWEET_MASTER_TARGET_PROFILE_ID);
  const [finalMode, setFinalMode] = useState<MagicPolishMode>(magicPrefs.finalMode);
  const [targetPreset, setTargetPreset] = useState<MagicPolishTargetPreset>(magicPrefs.targetPreset);
  const [customTargetIntegratedLufs, setCustomTargetIntegratedLufs] = useState(magicPrefs.customTargetIntegratedLufs);
  const [customTruePeakCeilingDb, setCustomTruePeakCeilingDb] = useState(magicPrefs.customTruePeakCeilingDb);
  const [customTonalMatchStrength, setCustomTonalMatchStrength] = useState(magicPrefs.customTonalMatchStrength);
  const [customSpatialMatchStrength, setCustomSpatialMatchStrength] = useState(magicPrefs.customSpatialMatchStrength);
  const [customDensityMatchStrength, setCustomDensityMatchStrength] = useState(magicPrefs.customDensityMatchStrength);
  const [referenceGainMode, setReferenceGainMode] = useState<ReferenceGainMode>(magicPrefs.referenceGainMode);
  const [referenceGainTrimDb, setReferenceGainTrimDb] = useState(magicPrefs.referenceGainTrimDb);
  const [referenceHardLimit, setReferenceHardLimit] = useState(magicPrefs.referenceHardLimit);
  const [panDesignMode, setPanDesignMode] = useState<ClipPanDesignMode>(magicPrefs.panDesignMode);
  const [panDesignAmount, setPanDesignAmount] = useState(magicPrefs.panDesignAmount);
  const [spectralRestore, setSpectralRestore] = useState<AimixSpectralRestoreSettings>(spectralPrefs);
  const [aimixGlowSettings, setAimixGlowSettings] = useState<AimixGlowSettings>(glowPrefs);
  const [aimixGlowReport, setAimixGlowReport] = useState<AimixGlowUiReport | null>(null);
  const [magicPolishReport, setMagicPolishReport] = useState<MagicPolishReport | null>(null);
  const defaultSingleFileSettings = resolveSingleFileMasteringSettings("lightMaster");
  const initialSingleFilePrefs = useMemo(() => readSingleFileMasteringPrefs(defaultSingleFileSettings), []);
  const [singleFileMode, setSingleFileMode] = useState<SingleFileMasteringMode>(initialSingleFilePrefs.mode);
  const [singleFileTargetLufs, setSingleFileTargetLufs] = useState(initialSingleFilePrefs.targetLufs);
  const [singleFileTruePeakCeilingDb, setSingleFileTruePeakCeilingDb] = useState(initialSingleFilePrefs.truePeakCeilingDb);
  const [singleFileHpfHz, setSingleFileHpfHz] = useState(initialSingleFilePrefs.safetyHpfHz);
  const [singleFileHarshnessAmount, setSingleFileHarshnessAmount] = useState(initialSingleFilePrefs.harshnessAmount);
  const [singleFileArtifactGuardAmount, setSingleFileArtifactGuardAmount] = useState(initialSingleFilePrefs.artifactGuardAmount);
  const [singleFileStages, setSingleFileStages] = useState<SingleFileStageToggles>(initialSingleFilePrefs.stages);
  const [singleFileManualTargetDirty, setSingleFileManualTargetDirty] = useState(initialSingleFilePrefs.manualTargetDirty);
  const [singleFileManualCeilingDirty, setSingleFileManualCeilingDirty] = useState(initialSingleFilePrefs.manualCeilingDirty);
  const [singleFileManualHpfDirty, setSingleFileManualHpfDirty] = useState(initialSingleFilePrefs.manualHpfDirty);
  const [singleFileManualHarshnessDirty, setSingleFileManualHarshnessDirty] = useState(initialSingleFilePrefs.manualHarshnessDirty);
  const [singleFileManualArtifactGuardDirty, setSingleFileManualArtifactGuardDirty] = useState(initialSingleFilePrefs.manualArtifactGuardDirty);
  const [singleFileReport, setSingleFileReport] = useState<SingleFileMasteringUiReport | null>(null);
  const [singleFileIsWorking, setSingleFileIsWorking] = useState(false);
  const [singleFileProgress, setSingleFileProgress] = useState<SingleFileWorkProgress | null>(null);
  const [singleFileAudition, setSingleFileAudition] = useState<"original" | "processed" | null>(null);
  const singleFileOriginalRef = useRef<SingleFileAudioSnapshot | null>(null);
  const singleFileProcessedRef = useRef<SingleFileAudioSnapshot | null>(null);
  const singleFileAudioContextRef = useRef<AudioContext | null>(null);
  const singleFileSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [adjustments, setAdjustments] = useState<ManualAdjustments>(DEFAULT_ADJUSTMENTS);
  const [proposal, setProposal] = useState<AiMixProposal | null>(null);
  const [activeAB, setActiveAB] = useState<"before" | "after" | null>(null);
  const [fixed, setFixed] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [referenceDelta, setReferenceDelta] = useState<ReferenceDelta | null>(mixDoctorReport?.referenceDelta ?? null);
  const [referenceCrestFactorDb, setReferenceCrestFactorDb] = useState<number | null>(mixDoctorReport?.referenceProfile?.crestFactorDb ?? null);
  const [referenceRuntime, setReferenceRuntime] = useState<ReferenceRuntimeState>(() => ({
    status: mixDoctorReport?.referenceProfile ? "ready" : "none",
    trackName: mixDoctorReport?.referenceProfile?.trackName,
    profile: mixDoctorReport?.referenceProfile ?? null,
    delta: mixDoctorReport?.referenceDelta ?? null,
    repair: mixDoctorReport?.referenceRepair ?? null,
    updatedAt: new Date().toISOString(),
  }));

  const [referenceProfile, setReferenceProfile] = useState<ReferenceProfile | null>(mixDoctorReport?.referenceProfile ?? null);

  const referenceTracks = project.tracks.filter((track) => track.role === "reference");
  const activeReferenceDelta = referenceTracks.length > 0 ? referenceDelta ?? mixDoctorReport?.referenceDelta ?? null : null;
  const activeReferenceProfile = referenceTracks.length > 0 ? referenceProfile ?? mixDoctorReport?.referenceProfile ?? null : null;
  const activeReferenceLufs = activeReferenceProfile?.integratedLufsApprox;
  const activeReferenceRepair = referenceTracks.length > 0 ? mixDoctorReport?.referenceRepair ?? null : null;
  const referenceAnalysisReady = referenceTracks.length > 0 && Boolean(activeReferenceProfile);
  const effectiveReferenceRuntime: ReferenceRuntimeState = {
    ...referenceRuntime,
    status: activeReferenceProfile ? "ready" : referenceTracks.length > 0 ? "loaded" : referenceRuntime.status,
    trackId: referenceTracks[0]?.id ?? referenceRuntime.trackId,
    trackName: activeReferenceProfile?.trackName ?? referenceTracks[0]?.name ?? referenceRuntime.trackName,
    profile: activeReferenceProfile ?? referenceRuntime.profile ?? null,
    delta: activeReferenceDelta ?? referenceRuntime.delta ?? null,
    repair: activeReferenceRepair ?? referenceRuntime.repair ?? null,
  };
  const referenceStatus = formatReferenceRuntimeState(effectiveReferenceRuntime);
  const targetProfile = useMemo(() => getSweetMasterTargetProfile(targetProfileId), [targetProfileId]);
  const sweetReferenceDeltaReport = useMemo(() => buildSweetReferenceDeltaReportFromFeatures({
    source: "mix-doctor",
    reference: activeReferenceProfile,
    features: mixDoctorReport?.stemFeatureReports ?? [],
    profile: targetProfile,
    role: "master",
  }), [activeReferenceProfile, mixDoctorReport?.stemFeatureReports, targetProfile]);
  const sweetAimixDeltaHints = useMemo(() => toAimixReferenceDeltaHints(sweetReferenceDeltaReport, targetProfile), [sweetReferenceDeltaReport, targetProfile]);
  const sweetMasterPolishHints = useMemo(() => toMasterPolishTargetHints(sweetReferenceDeltaReport, targetProfile), [sweetReferenceDeltaReport, targetProfile]);
  const setReferenceStatus = (message: string) => {
    setReferenceRuntime((current) => runtimeFromLegacyReferenceMessage(message, current));
  };

  useEffect(() => {
    if (referenceAnalysisReady && referenceOptionsOpen) return;
    if (!referenceAnalysisReady) setReferenceOptionsOpen(false);
    setAimixWorkflowPreset((current) => current === "reference" ? "standard" : current);
    setTargetPreset((current) => current === "reference" || current === "custom" ? "spotify" : current);
    setPanDesignMode((current) => current === "referencePlus" ? "role" : current);
    setSingleFileMode((current) => current === "referenceCatchUp" ? "lightMaster" : current);
  }, [referenceAnalysisReady, referenceOptionsOpen]);

  useEffect(() => {
    window.localStorage.setItem(
      MAGIC_POLISH_PREFS_KEY,
      JSON.stringify({
        targetPreset,
        finalMode,
        customTargetIntegratedLufs,
        customTruePeakCeilingDb,
        customTonalMatchStrength,
        customSpatialMatchStrength,
        customDensityMatchStrength,
        referenceGainMode,
        referenceGainTrimDb,
        referenceHardLimit,
        panDesignMode,
        panDesignAmount,
      }),
    );
  }, [
    customDensityMatchStrength,
    customSpatialMatchStrength,
    customTargetIntegratedLufs,
    customTonalMatchStrength,
    customTruePeakCeilingDb,
    finalMode,
    panDesignAmount,
    panDesignMode,
    referenceGainMode,
    referenceGainTrimDb,
    referenceHardLimit,
    targetPreset,
  ]);

  useEffect(() => {
    window.localStorage.setItem(AIMIX_SPECTRAL_RESTORE_PREFS_KEY, JSON.stringify(spectralRestore));
  }, [spectralRestore]);

  useEffect(() => {
    window.localStorage.setItem(AIMIX_GLOW_PREFS_KEY, JSON.stringify(aimixGlowSettings));
  }, [aimixGlowSettings]);

  useEffect(() => {
    window.localStorage.setItem(
      SINGLE_FILE_MASTERING_PREFS_KEY,
      JSON.stringify({
        mode: singleFileMode,
        targetLufs: singleFileTargetLufs,
        truePeakCeilingDb: singleFileTruePeakCeilingDb,
        safetyHpfHz: singleFileHpfHz,
        harshnessAmount: singleFileHarshnessAmount,
        artifactGuardAmount: singleFileArtifactGuardAmount,
        stages: singleFileStages,
        manualTargetDirty: singleFileManualTargetDirty,
        manualCeilingDirty: singleFileManualCeilingDirty,
        manualHpfDirty: singleFileManualHpfDirty,
        manualHarshnessDirty: singleFileManualHarshnessDirty,
        manualArtifactGuardDirty: singleFileManualArtifactGuardDirty,
      }),
    );
  }, [
    singleFileArtifactGuardAmount,
    singleFileHarshnessAmount,
    singleFileHpfHz,
    singleFileManualArtifactGuardDirty,
    singleFileManualCeilingDirty,
    singleFileManualHarshnessDirty,
    singleFileManualHpfDirty,
    singleFileManualTargetDirty,
    singleFileMode,
    singleFileStages,
    singleFileTargetLufs,
    singleFileTruePeakCeilingDb,
  ]);

  const singleFilePresetSettings = useMemo(() => {
    if (singleFileMode === "existing") return null;
    return resolveSingleFileMasteringSettings(singleFileMode, singleFileMode === "referenceCatchUp" && activeReferenceLufs !== undefined
      ? {
          targetLufs: singleFileTargetLufs,
          referenceTargetLufs: activeReferenceLufs,
          targetLufsSource: "ui" as const,
          truePeakCeilingDb: referenceHardLimit ? Math.min(getReferenceCatchUpCeilingDb(activeReferenceProfile), -1) : DEFAULT_SINGLE_FILE_TRUE_PEAK_CEILING_DBTP,
          ...buildSingleFileReferenceClarityOverrides(proposal?.vocalClarityGate ?? null, activeReferenceProfile, proposal?.afterMetrics ?? null),
        }
      : {});
  }, [
    activeReferenceLufs,
    activeReferenceProfile,
    proposal?.afterMetrics,
    proposal?.vocalClarityGate,
    referenceHardLimit,
    singleFileMode,
    singleFileTargetLufs,
  ]);

  useEffect(() => {
    if (!singleFilePresetSettings || singleFileMode === "existing") return;
    setSingleFileTargetLufs((current) => singleFileManualTargetDirty ? current : singleFilePresetSettings.targetLufs);
    setSingleFileTruePeakCeilingDb((current) => singleFileManualCeilingDirty ? current : singleFilePresetSettings.truePeakCeilingDb);
    setSingleFileHpfHz((current) => singleFileManualHpfDirty ? current : singleFilePresetSettings.safetyHpfHz);
    setSingleFileHarshnessAmount((current) => singleFileManualHarshnessDirty ? current : singleFilePresetSettings.harshnessAmount);
    setSingleFileArtifactGuardAmount((current) => singleFileManualArtifactGuardDirty ? current : singleFilePresetSettings.artifactGuardAmount);
    setSingleFileStages(singleFilePresetSettings.stages);
    setSingleFileReport(null);
    singleFileOriginalRef.current = null;
    singleFileProcessedRef.current = null;
    setSingleFileAudition(null);
  }, [singleFileMode, singleFilePresetSettings]);

  const clearSingleFilePreparedAudio = () => {
    setSingleFileReport(null);
    singleFileProcessedRef.current = null;
    setSingleFileAudition(null);
  };

  const selectSingleFileMode = (mode: SingleFileMasteringMode) => {
    setSingleFileMode(mode);
    setSingleFileManualTargetDirty(false);
    setSingleFileManualCeilingDirty(false);
    setSingleFileManualHpfDirty(false);
    setSingleFileManualHarshnessDirty(false);
    setSingleFileManualArtifactGuardDirty(false);
    clearSingleFilePreparedAudio();
  };

  const resetSingleFileSettingsToPreset = () => {
    if (!singleFilePresetSettings) return;
    setSingleFileManualTargetDirty(false);
    setSingleFileManualCeilingDirty(false);
    setSingleFileManualHpfDirty(false);
    setSingleFileManualHarshnessDirty(false);
    setSingleFileManualArtifactGuardDirty(false);
    setSingleFileTargetLufs(singleFilePresetSettings.targetLufs);
    setSingleFileTruePeakCeilingDb(singleFilePresetSettings.truePeakCeilingDb);
    setSingleFileHpfHz(singleFilePresetSettings.safetyHpfHz);
    setSingleFileHarshnessAmount(singleFilePresetSettings.harshnessAmount);
    setSingleFileArtifactGuardAmount(singleFilePresetSettings.artifactGuardAmount);
    setSingleFileStages(singleFilePresetSettings.stages);
    clearSingleFilePreparedAudio();
  };

  const updateSingleFileTargetLufs = (value: number) => {
    setSingleFileManualTargetDirty(true);
    setSingleFileTargetLufs(clampNumber(value, -24, -6, defaultSingleFileSettings.targetLufs));
    clearSingleFilePreparedAudio();
  };

  const updateSingleFileTruePeakCeilingDb = (value: number) => {
    setSingleFileManualCeilingDirty(true);
    setSingleFileTruePeakCeilingDb(clampNumber(value, -6, -1, defaultSingleFileSettings.truePeakCeilingDb));
    clearSingleFilePreparedAudio();
  };

  const updateSingleFileHpfHz = (value: number) => {
    setSingleFileManualHpfDirty(true);
    setSingleFileHpfHz(clampNumber(value, 0, 180, defaultSingleFileSettings.safetyHpfHz));
    clearSingleFilePreparedAudio();
  };

  const updateSingleFileHarshnessAmount = (value: number) => {
    setSingleFileManualHarshnessDirty(true);
    setSingleFileHarshnessAmount(clampNumber(value, 0, 1, defaultSingleFileSettings.harshnessAmount));
    clearSingleFilePreparedAudio();
  };

  const updateSingleFileArtifactGuardAmount = (value: number) => {
    setSingleFileManualArtifactGuardDirty(true);
    setSingleFileArtifactGuardAmount(clampNumber(value, 0, 1, defaultSingleFileSettings.artifactGuardAmount));
    clearSingleFilePreparedAudio();
  };

  const updateSingleFileStages = (updater: (current: SingleFileStageToggles) => SingleFileStageToggles) => {
    setSingleFileStages((current) => updater(current));
    clearSingleFilePreparedAudio();
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3000);
  };

  const applyTargetProfileToAimixProposal = () => {
    if (!sweetReferenceDeltaReport) {
      showToast("Reference Deltaがまだありません。Referenceを読み込んでAIMIX解析を実行してください。");
      return;
    }
    setReferenceOptionsOpen(true);
    setAimixWorkflowPreset("reference");
    setAimixMode(targetProfile.id === "vocal-forward" ? "referenceMatch" : "balanced");
    showToast(`Target Profile ${targetProfile.label} をAIMIX Reference提案の上限として選択しました。`);
  };

  const applyTargetProfileToMasterPolish = () => {
    setReferenceOptionsOpen(true);
    setSingleFileMode("existing");
    setTargetPreset("custom");
    setCustomTargetIntegratedLufs(sweetMasterPolishHints.targetLufsApprox);
    setCustomTruePeakCeilingDb(sweetMasterPolishHints.ceilingDbTpEstimate);
    setCustomTonalMatchStrength(clampNumber(sweetMasterPolishHints.maxReferenceDeltaDb / 3, 0, 1, 0.5));
    setCustomSpatialMatchStrength(clampNumber(sweetMasterPolishHints.maxStereoWiden, 0, 1, 0.2));
    setCustomDensityMatchStrength(targetProfile.id === "loud-modern" || targetProfile.id === "club-low-end" ? 0.42 : 0.28);
    showToast(`Target Profile ${targetProfile.label} をMagic Polish Customへ反映しました。`);
  };
  const downloadReferenceRepairReport = (repair: ReferenceRepairDiagnosis) => {
    const markdown = buildReferenceRepairMarkdown(repair);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sweet-daw-reference-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    showToast("Reference Repairレポートを書き出しました。");
  };

  const resolveReferenceDeltaForAimix = (targetProject: Project): AiMixReferenceContext => {
    const referenceTracksInProject = targetProject.tracks.filter((track) => track.role === "reference");
    if (referenceTracksInProject.length === 0) {
      setReferenceDelta(null);
      setReferenceCrestFactorDb(null);
      setReferenceStatus("Referenceなし: RoleをReferenceにしたWAVを追加すると、Suno直出しMIXの傾向をstemへ追従できます。");
      return { delta: null, crestFactorDb: null, profile: null, repair: null, stemFeatureReports: [] };
    }

    try {
      const report = analyzeMixDoctor(targetProject, waveformPeaks, { mode: "balanced", target: "reference_polish" });
      setMixDoctorReport(report);
      setReferenceDelta(report.referenceDelta ?? null);
      setReferenceCrestFactorDb(report.referenceProfile?.crestFactorDb ?? null);
      if (report.referenceDelta) {
        const name = report.referenceProfile?.trackName ?? referenceTracksInProject[0]?.name ?? "Reference";
        setReferenceStatus(`Reference解析OK: ${name} の音像、低域、空気感、クレスト傾向をAIMIXへ安全に反映します。`);
      } else {
        setReferenceStatus("Referenceはありますが、比較に必要な波形解析が不足しています。読み込み直し後に再実行してください。");
      }
      return {
        delta: report.referenceDelta ?? null,
        crestFactorDb: report.referenceProfile?.crestFactorDb ?? null,
        profile: report.referenceProfile ?? null,
        repair: report.referenceRepair ?? null,
        stemFeatureReports: report.stemFeatureReports ?? [],
      };
    } catch (error) {
      setReferenceDelta(null);
      setReferenceCrestFactorDb(null);
      setReferenceStatus(`Reference解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      return { delta: null, crestFactorDb: null, profile: null, repair: null, stemFeatureReports: [] };
    }
  };

  const resolveReferenceContextForAimix = (targetProject: Project): AiMixReferenceContext => {
    const referenceTracksInProject = targetProject.tracks.filter((track) => track.role === "reference");
    if (referenceTracksInProject.length === 0) {
      setReferenceDelta(null);
      setReferenceCrestFactorDb(null);
      setReferenceProfile(null);
      setReferenceStatus("Referenceがありません。FilesのImport Reference Mixから読み込むと、Suno直出しWAVの音量・帯域・横幅・空間感をstemへ安全に反映できます。");
      return { delta: null, crestFactorDb: null, profile: null, repair: null, stemFeatureReports: [] };
    }

    try {
      const report = analyzeMixDoctor(targetProject, waveformPeaks, { mode: "balanced", target: "reference_polish" });
      const profile = report.referenceProfile ?? null;
      setMixDoctorReport(report);
      setReferenceDelta(report.referenceDelta ?? null);
      setReferenceCrestFactorDb(profile?.crestFactorDb ?? null);
      setReferenceProfile(profile);

      if (report.referenceDelta && profile) {
        const name = profile.trackName ?? referenceTracksInProject[0]?.name ?? "Reference";
        setReferenceStatus(`Reference解析OK: ${name} の音量、低域、空気感、クレスト、横幅をAIMIXへ安全に反映します。`);
      } else {
        setReferenceStatus("Referenceは読み込み済みですが、解析に必要な波形情報が足りません。読み込み直後またはAIMIX提案を再実行してください。");
      }

      return {
        delta: report.referenceDelta ?? null,
        crestFactorDb: profile?.crestFactorDb ?? null,
        profile,
        repair: report.referenceRepair ?? null,
        stemFeatureReports: report.stemFeatureReports ?? [],
      };
    } catch (error) {
      setReferenceDelta(null);
      setReferenceCrestFactorDb(null);
      setReferenceProfile(null);
      setReferenceStatus(`Reference解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
      return { delta: null, crestFactorDb: null, profile: null, repair: null, stemFeatureReports: [] };
    }
  };

  const createProposal = async (workflow: AimixWorkflowPreset = aimixWorkflowPreset) => {
    setAimixWorkflowPreset(workflow);
    const isReferencePreset = workflow === "reference";
    const isStandardPreset = workflow === "standard";
    if (project.tracks.filter((track) => track.role !== "reference" && track.type !== "reference").length === 0) {
      if (referenceTracks.length > 0 && hasDirectWavMasteringSource(project)) {
        setReferenceOptionsOpen(true);
        setSingleFileMode("directWavPolish");
        setSingleFileReport(null);
        singleFileProcessedRef.current = null;
        setSingleFileAudition(null);
        onRequestSection?.("mastering");
        showToast("直WAV 1本を検出しました。Direct WAV PolishのAIMIX/Spatial経路へ移動します。");
        return;
      }
      showToast("先にstemまたはWAVを読み込んでください。");
      return;
    }
    if (isReferencePreset && referenceTracks.length === 0) {
      showToast("AIMIX Reference PresetにはReference Mixが必要です。FilesでReferenceを読み込んでください。");
      return;
    }

    setIsWorking(true);
    try {
      const before = cloneProject(project);
      const genre = detectMagicGenre(before);
      const beforeMetrics = measureProject(before, waveformPeaks);
      const analysis = buildAnalysisFromMetrics(beforeMetrics);
      const reference = resolveReferenceContextForAimix(before);
      if (isReferencePreset && (!reference.delta || !reference.profile)) {
        showToast("Reference解析が不足しています。Reference読み込み直後にもう一度AIMIX Reference Presetを実行してください。");
        return;
      }

      const effectiveAimixMode = isReferencePreset ? AIMIX_REFERENCE_PRESET.mode : isStandardPreset ? ORTHODOX_AIMIX_MODE : aimixMode;
      const effectiveSpectralRestore = isReferencePreset ? AIMIX_REFERENCE_PRESET.spectralRestore : isStandardPreset ? DEFAULT_AIMIX_SPECTRAL_RESTORE : spectralRestore;
      if (effectiveAimixMode === "referenceMatch" && !reference.delta) {
        showToast("Reference MatchにはReferenceトラックが必要です。今回はBalanced相当で提案します。");
      }
      if (effectiveAimixMode === "cleanRebuild") {
        const rebuild = applyCleanStemRebuild(before, {
          stemFeatureReports: reference.stemFeatureReports,
        });
        const after = rebuild.project;
        const afterMetrics = measureProject(after, waveformPeaks);
        const vocalClarityGate = buildUiVocalClarityGate(afterMetrics, reference.profile, "bypassed");
        setProposal({
          before,
          after,
          beforeMetrics,
          afterMetrics,
          decisions: [
            "Mode: Clean Rebuild",
            `RMS: ${beforeMetrics.rmsDb.toFixed(1)}dB -> ${afterMetrics.rmsDb.toFixed(1)}dB / Crest: ${beforeMetrics.crestDb.toFixed(1)}dB -> ${afterMetrics.crestDb.toFixed(1)}dB`,
            `LowMid: ${beforeMetrics.lowMid.toFixed(1)}dB -> ${afterMetrics.lowMid.toFixed(1)}dB / Width: ${beforeMetrics.width.toFixed(1)}dB -> ${afterMetrics.width.toFixed(1)}dB`,
            ...rebuild.decisions,
            ...(vocalClarityGate ? buildVocalClarityGateDecisionLines(vocalClarityGate) : []),
          ],
          vocalClarityGate,
          createdAt: new Date().toISOString(),
          mode: effectiveAimixMode,
        });
        setActiveAB(null);
        setFixed(false);
        showToast("Clean Rebuild proposalを作成しました。A/B確認後にFIXしてください。");
        return;
      }
      const strength = getStrengthForAimixMode(effectiveAimixMode);
      const polishMode = getFinalModeForAimixMode(effectiveAimixMode, finalMode);
      const computed = computeAiMix(
        before,
        "magic-pro-polish",
        strength,
        "none",
        genre,
        polishMode,
        analysis,
        {
          workflow: "doctor-touchup",
          referenceDelta: reference.delta,
          referenceCrestFactorDb: reference.crestFactorDb,
          referenceCrestFollow: Boolean(reference.delta),
          allowReferenceProcessing: false,
        },
      );

      const computedProject: Project = {
        ...before,
        tracks: computed.tracks,
        master: computed.master,
        updatedAt: new Date().toISOString(),
      };
      const withManual = isReferencePreset
        ? computedProject
        : applyManualAdjustments(computedProject, adjustments, effectiveAimixMode);
      const spectral = applyAimixSpectralRestore(
        withManual,
        effectiveSpectralRestore,
        beforeMetrics,
        reference.profile,
        waveformPeaks,
        effectiveAimixMode,
      );
      const withDensity = isReferencePreset
        ? applyAimixReferenceDensity(spectral.project, beforeMetrics, reference.profile)
        : effectiveAimixMode === "dense"
          ? applyAimixParallelDensity(spectral.project)
          : spectral.project;
      const withDuck = effectiveAimixMode === "suggestOnly" ? before : applyAimixDynamicVocalDuck(withDensity, effectiveAimixMode);
      const ambience = isReferencePreset
        ? { project: withDuck, decisions: ["AIMIX Reference Preset: Pan / Width / Spatialは後段Spatialで調整します。"] }
        : applyReferenceAmbienceFollowToProject(withDuck, reference.profile, reference.delta, effectiveAimixMode);
      const intelligence = buildClipIntelligenceReport(before, waveformPeaks, {
        mode: effectiveAimixMode,
        referenceDelta: reference.delta,
        referenceProfile: reference.profile,
        stemFeatureReports: reference.stemFeatureReports,
        panDesignMode: "off",
        panDesignAmount: 0,
        enableClipPan: false,
      });
      let after = applyClipIntelligenceToProject(ambience.project, intelligence, waveformPeaks, {
        mode: effectiveAimixMode,
        referenceDelta: reference.delta,
        referenceProfile: reference.profile,
        stemFeatureReports: reference.stemFeatureReports,
        panDesignMode: "off",
        panDesignAmount: 0,
        enableClipPan: false,
      });
      if (isReferencePreset) {
        after = preservePanAndClipAutomation(after, before);
      }
      const afterMetrics = measureProject(after, waveformPeaks);
      const referenceValidationDecisions = isReferencePreset
        ? buildAimixReferenceValidationDecisions(beforeMetrics, afterMetrics, reference.profile)
        : [];
      const vocalClarityGate = buildUiVocalClarityGate(afterMetrics, reference.profile, "bypassed");
      const decisions = [
        ...(isReferencePreset
          ? ["AIMIX Reference Preset: Reference WAVの音量・密度・帯域感へ寄せます。Pan/Spatial/Widthは変更しません。"]
          : []),
        ...buildAimixDecisions(beforeMetrics, afterMetrics, effectiveAimixMode, reference.delta, intelligence),
        ...spectral.decisions,
        ...ambience.decisions,
        ...referenceValidationDecisions,
        ...(vocalClarityGate ? buildVocalClarityGateDecisionLines(vocalClarityGate) : []),
      ];

      setProposal({
        before,
        after,
        beforeMetrics,
        afterMetrics,
        decisions,
        vocalClarityGate,
        createdAt: new Date().toISOString(),
        mode: effectiveAimixMode,
      });
      setActiveAB(null);
      setFixed(false);
      showToast(
        isReferencePreset
          ? "AIMIX Reference Presetを作成しました。A/B確認後にFIXしてください。"
          : isStandardPreset
            ? "AIMIX Standardを作成しました。まずはこの設定でA/B確認してからFIXしてください。"
            : "AIMIX Customを作成しました。Before/Afterで確認してからFIXしてください。",
      );
    } finally {
      setIsWorking(false);
    }
  };

  const previewBefore = () => {
    if (!proposal) return;
    loadProject(proposal.before, waveformPeaks);
    setActiveAB("before");
    showToast("Beforeを読み込みました。");
  };

  const previewAfter = () => {
    if (!proposal) return;
    loadProject(proposal.after, waveformPeaks);
    setActiveAB("after");
    showToast("Afterを読み込みました。");
  };

  const fixProposal = () => {
    if (!proposal) return;
    loadProject(proposal.after, waveformPeaks);
    setFixed(true);
    setActiveAB("after");
    showToast("AIMIXをFIXしました。WAV書き出しにも反映されます。");
  };

  const restoreBefore = () => {
    if (!proposal) return;
    loadProject(proposal.before, waveformPeaks);
    setFixed(false);
    setActiveAB("before");
    showToast("AIMIX前へ戻しました。");
  };

  const resolveMagicTargetForCurrentProject = (source: Project) => {
    const reference = targetPreset === "reference" ? resolveReferenceContextForAimix(source) : {
      delta: activeReferenceDelta,
      crestFactorDb: referenceCrestFactorDb,
      profile: activeReferenceProfile,
      repair: activeReferenceRepair,
      stemFeatureReports: mixDoctorReport?.stemFeatureReports ?? [],
    };
    const target = resolveMagicPolishTarget(
      targetPreset,
      customTargetIntegratedLufs,
      customTruePeakCeilingDb,
      customTonalMatchStrength,
      customSpatialMatchStrength,
      customDensityMatchStrength,
      reference.profile,
      reference.repair,
      finalMode,
      referenceGainMode,
      referenceGainTrimDb,
      referenceHardLimit,
    );
    if (!target) {
      showToast(referenceTracks.length > 0 ? "Reference解析を更新できませんでした。AIMIX提案またはReferenceの再読み込みを試してください。" : "Reference音源が必要です。FilesのImport Reference Mixから読み込んでください。");
      return null;
    }
    return { target, reference };
  };

  const analyzeMagicPolish = () => {
    const source = fixed ? project : proposal?.after ?? project;
    const resolved = resolveMagicTargetForCurrentProject(source);
    if (!resolved) return;
    const before = meterFromMetrics(measureProject(source, waveformPeaks));
    const preview = applyFinalPolish(source, finalMode, resolved.target, before, resolved.reference.profile, resolved.reference.delta, resolved.reference.repair);
    const after = meterFromMetrics(measureProject(preview, waveformPeaks));
    const validation = validateReferenceMatchProgress(before, after, resolved.reference.profile);
    if (resolved.target.preset === "reference") {
      if (!validation.passed) showToast(`Reference Match確認: ${[...validation.failures, ...validation.warnings].join(" / ")}`);
    }
    setMagicPolishReport({
      before,
      target: resolved.target,
      after,
      actions: [
        ...buildMagicPolishActions(before, after, resolved.target),
        ...(resolved.target.preset === "reference" ? [`Reference距離: ${validation.beforeDistance.toFixed(2)} -> ${validation.afterDistance.toFixed(2)}`] : []),
      ],
      warning: resolved.target.warning ?? validation.warnings[0] ?? null,
    });
  };

  const applyAimixFinalPolish = () => {
    const source = fixed ? project : proposal?.after ?? project;
    const resolved = resolveMagicTargetForCurrentProject(source);
    if (!resolved) return;
    const before = meterFromMetrics(measureProject(source, waveformPeaks));
    const polished = applyFinalPolish(source, finalMode, resolved.target, before, resolved.reference.profile, resolved.reference.delta, resolved.reference.repair);
    const after = meterFromMetrics(measureProject(polished, waveformPeaks));
    const validation = validateReferenceMatchProgress(before, after, resolved.reference.profile);
    if (resolved.target.preset === "reference") {
      if (!validation.passed) showToast(`Reference Match確認: ${[...validation.failures, ...validation.warnings].join(" / ")}`);
    }
    loadProject(polished, waveformPeaks);
    setMagicPolishReport({
      before,
      target: resolved.target,
      after,
      actions: [
        ...buildMagicPolishActions(before, after, resolved.target),
        ...(resolved.target.preset === "reference" ? [`Reference距離: ${validation.beforeDistance.toFixed(2)} -> ${validation.afterDistance.toFixed(2)}`] : []),
      ],
      warning: resolved.target.warning ?? validation.warnings[0] ?? null,
    });
    setFixed(true);
    showToast(`Magic Polish ${resolved.target.label} / ${FINAL_MODE_LABELS[finalMode]}を反映しました。`);
  };

  const resolveSingleFileSettingsForUi = () => {
    const masteringSource = fixed ? project : proposal?.after ?? project;
    const masterTarget = masteringSource.master.target;
    const referenceCatchUpOverrides = singleFileMode === "referenceCatchUp" && activeReferenceLufs !== undefined
      ? {
          referenceTargetLufs: activeReferenceLufs,
          targetLufsSource: "ui" as const,
          truePeakCeilingDb: referenceHardLimit ? Math.min(getReferenceCatchUpCeilingDb(activeReferenceProfile), -1) : DEFAULT_SINGLE_FILE_TRUE_PEAK_CEILING_DBTP,
          ...buildSingleFileReferenceClarityOverrides(proposal?.vocalClarityGate ?? null, activeReferenceProfile, proposal?.afterMetrics ?? null),
        }
      : {};
    const resolved = resolveSingleFileMasteringSettings(singleFileMode, {
      targetLufs: singleFileTargetLufs,
      targetLufsSource: "ui",
      truePeakCeilingDb: singleFileTruePeakCeilingDb,
      safetyHpfHz: singleFileHpfHz,
      harshnessAmount: singleFileHarshnessAmount,
      artifactGuardAmount: singleFileArtifactGuardAmount,
      headroomMode: singleFileMode === "directWavPolish"
        ? "analysis"
        : masterTarget.headroomMode === "auto-trim" ? "apply" : masterTarget.headroomMode,
      preMasterPeakCeilingDbfs: masterTarget.preMasterPeakCeilingDbfs,
      preMasterLoudnessHintLufs: masterTarget.preMasterLoudnessHintLufs,
      stages: singleFileStages,
      ...referenceCatchUpOverrides,
    });
    return applyMasteringConflictGuard(resolved, masteringConflictGuard);
  };

  const getCurrentMasteringSourceProject = () => {
    const source = fixed ? project : proposal?.after ?? project;
    if (singleFileMode !== "directWavPolish") return source;
    return createDirectWavMasteringSource(source) ?? source;
  };

  const createSingleFileRenderPlan = async (source = getCurrentMasteringSourceProject()): Promise<SingleFileRenderPlan> => {
    const [{ resolveStableExportSampleRate }, { getProjectDurationSec }, { audioBufferRegistry }] = await Promise.all([
      import("@/daw/export/ExportConsistency"),
      import("@/audio/engine/TrackGraph"),
      import("@/audio/engine/AudioBufferRegistry"),
    ]);
    const sampleRate = resolveStableExportSampleRate(source);
    return buildSingleFileExportPlan({
      project: source,
      sampleRate,
      durationSec: Math.max(0.1, getProjectDurationSec(source) + 0.05),
      isMobile: isLikelyMobileBrowser(),
      registryPcmBytes: audioBufferRegistry.getStats().estimatedPcmBytes,
    });
  };

  const suspendStreamableRenderBuffers = async (source: Project) => {
    const [{ audioBufferRegistry }, { releaseStreamableProjectBuffers }, { audioEngine }] = await Promise.all([
      import("@/audio/engine/AudioBufferRegistry"),
      import("@/audio/engine/StreamingWavSource"),
      import("@/audio/engine/AudioEngine"),
    ]);
    await audioEngine.suspendForOfflineExport();
    return releaseStreamableProjectBuffers(source, audioBufferRegistry);
  };

  const renderCurrentMixForSingleFile = async (
    source = getCurrentMasteringSourceProject(),
    options: { previewOnly?: boolean; plan?: SingleFileRenderPlan } = {},
  ): Promise<SingleFileAudioSnapshot> => {
    const [{ renderProjectOffline, renderProjectSliceOffline }] = await Promise.all([
      import("@/audio/engine/OfflineRenderer"),
    ]);
    const plan = options.plan ?? await createSingleFileRenderPlan(source);
    if (plan.lowMemoryMode) {
      showToast(`Large mix detected: iPhone-safe mastering is enabled (${plan.activeTrackCount} active tracks / ${formatBytes(plan.estimatedResidentPcmBytes)} decoded audio). Export will continue.`);
      await suspendStreamableRenderBuffers(source);
    }
    if (options.previewOnly) {
      const previewDurationSec = Math.min(plan.durationSec, plan.previewDurationSec);
      const channels = await renderProjectSliceOffline(source, undefined, {
        startSec: 0,
        endSec: previewDurationSec,
        preRollSec: 0,
        postRollSec: 0.1,
      }, { sampleRate: plan.sampleRate });
      return {
        sampleRate: plan.sampleRate,
        channels,
        lowMemoryMode: plan.lowMemoryMode,
        estimatedPcmBytes: plan.estimatedPcmBytes,
        estimatedWorkingBytes: plan.estimatedWorkingBytes,
        previewOnly: true,
      };
    }
    const buffer = await renderProjectOffline(source, undefined, { sampleRate: plan.sampleRate });
    return audioBufferToSingleFileSnapshot(buffer, {
      lowMemoryMode: plan.lowMemoryMode,
      estimatedPcmBytes: plan.estimatedPcmBytes,
      estimatedWorkingBytes: plan.estimatedWorkingBytes,
    });
  };

  const audioBufferToSingleFileSnapshot = (buffer: AudioBuffer, metadata: Partial<SingleFileAudioSnapshot> = {}): SingleFileAudioSnapshot => ({
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)),
    lowMemoryMode: metadata.lowMemoryMode,
    estimatedPcmBytes: metadata.estimatedPcmBytes,
    estimatedWorkingBytes: metadata.estimatedWorkingBytes,
  });

  const estimateSnapshotBytes = (snapshot: SingleFileAudioSnapshot) =>
    snapshot.channels.reduce((total, channel) => total + channel.byteLength, 0);

  const estimateSingleFileWorkingBytes = (pcmBytes: number) => {
    const multiplier = isLikelyMobileBrowser() ? 3.4 : 2.6;
    return Math.ceil(pcmBytes * multiplier + 64 * 1024 * 1024);
  };

  const getSingleFileMemoryLimitBytes = () => (isLikelyMobileBrowser() ? 300 * 1024 * 1024 : 1024 * 1024 * 1024);

  const createVocalGlowProject = (source: Project): Project | null => {
    const vocalTrackIds = new Set(source.tracks.filter(isAimixGlowVocalTrack).map((track) => track.id));
    if (vocalTrackIds.size === 0) return null;
    return {
      ...cloneProject(source),
      tracks: source.tracks.map((track) => ({
        ...track,
        solo: false,
        mute: track.role === "reference" || !vocalTrackIds.has(track.id),
      })),
      master: {
        ...source.master,
        gainDb: 0,
        compressor: { ...source.master.compressor, enabled: false },
        limiterEnabled: false,
      },
    };
  };

  const renderVocalSidechainForGlow = async (
    source: Project,
    sampleRate: number,
    maxDurationSec?: number,
  ): Promise<SingleFileAudioSnapshot | null> => {
    const vocalProject = createVocalGlowProject(source);
    if (!vocalProject) return null;
    const { renderProjectOffline, renderProjectSliceOffline } = await import("@/audio/engine/OfflineRenderer");
    const offlineSampleRate: 44100 | 48000 = sampleRate === 44100 ? 44100 : 48000;
    if (maxDurationSec && maxDurationSec > 0) {
      const channels = await renderProjectSliceOffline(vocalProject, undefined, {
        startSec: 0,
        endSec: maxDurationSec,
        preRollSec: 0,
        postRollSec: 0.05,
      }, { sampleRate: offlineSampleRate });
      return {
        sampleRate: offlineSampleRate,
        channels,
        previewOnly: true,
      };
    }
    const buffer = await renderProjectOffline(vocalProject, undefined, { sampleRate: offlineSampleRate });
    return audioBufferToSingleFileSnapshot(buffer);
  };

  const scanSingleFileChunkedTarget = async (
    source: Project,
    plan: SingleFileRenderPlan,
    settings: SingleFileMasteringSettings,
  ): Promise<SingleFileChunkedTargetScan> => {
    const [{ renderProjectSliceOfflinePadded }, { cropStreamingMasterChunk, STREAMING_MASTER_PRE_ROLL_SEC, STREAMING_MASTER_POST_ROLL_SEC }] = await Promise.all([
      import("@/audio/engine/OfflineRenderer"),
      import("@/daw/mastering/StreamingMasterProcessor"),
    ]);
    const chunkSec = plan.chunkDurationSec;
    const totalChunks = Math.max(1, Math.ceil(plan.durationSec / chunkSec));
    let weightedPowerSeconds = 0;
    let measuredSeconds = 0;
    let peakDb = -Infinity;
    const scanGlowSettings = aimixGlowSettings;
    const vocalProject = aimixGlowSettings.enabled ? createVocalGlowProject(source) : null;
    const analysisSettings: SingleFileMasteringSettings = {
      ...settings,
      stages: {
        ...settings.stages,
        targetLoudness: false,
        truePeakLimiter: false,
      },
    };

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const startSec = chunkIndex * chunkSec;
      const endSec = Math.min(plan.durationSec, startSec + chunkSec);
      await updateSingleFileProgress({
        title: "Exporting WAV",
        label: `Scanning full song target ${chunkIndex + 1}/${totalChunks}...`,
        detail: "Sweet DAW is measuring the full song in safe chunks so loudness does not change chunk by chunk.",
        percent: 12 + (chunkIndex / totalChunks) * 16,
      });
      const renderedChunk = await renderProjectSliceOfflinePadded(source, undefined, {
        startSec,
        endSec,
        preRollSec: chunkIndex === 0 ? 0 : STREAMING_MASTER_PRE_ROLL_SEC,
        postRollSec: chunkIndex >= totalChunks - 1 ? 0.05 : STREAMING_MASTER_POST_ROLL_SEC,
      }, { sampleRate: plan.sampleRate });
      let chunkChannels = renderedChunk.channels;
      if (aimixGlowSettings.enabled) {
        const vocalChunk = vocalProject
          ? await renderProjectSliceOfflinePadded(vocalProject, undefined, {
              startSec,
              endSec,
              preRollSec: chunkIndex === 0 ? 0 : STREAMING_MASTER_PRE_ROLL_SEC,
              postRollSec: chunkIndex >= totalChunks - 1 ? 0.05 : STREAMING_MASTER_POST_ROLL_SEC,
            }, { sampleRate: plan.sampleRate })
          : null;
        chunkChannels = processAimixGlow(chunkChannels, plan.sampleRate, scanGlowSettings, {
          copyInput: false,
          vocalSidechain: vocalChunk?.channels ?? null,
        }).channels;
        vocalChunk?.channels.splice(0);
      }
      const analyzedChunk = processSingleFileMastering(chunkChannels, plan.sampleRate, analysisSettings, {
        copyInput: false,
        quality: "mobile-hq",
      });
      const stableChunk = cropStreamingMasterChunk(analyzedChunk.channels, renderedChunk);
      const metrics = analyzeSingleFileMastering(stableChunk, plan.sampleRate, { quality: "mobile-hq" });
      const seconds = Math.max(0, endSec - startSec);
      weightedPowerSeconds += 10 ** ((metrics.estimatedLufs + 0.691) / 10) * seconds;
      measuredSeconds += seconds;
      peakDb = Math.max(peakDb, metrics.estimatedTruePeakDb);
      stableChunk.splice(0);
      analyzedChunk.channels.splice(0);
      chunkChannels.splice(0);
      renderedChunk.channels.splice(0);
      await waitForUiFrame();
    }

    const estimatedLufs = -0.691 + 10 * Math.log10(Math.max(1e-12, weightedPowerSeconds / Math.max(1e-8, measuredSeconds)));
    const requestedTargetGainDb = clamp(settings.targetLufs - estimatedLufs, -18, 18);
    const limiterBudgetDb = settings.mode === "loudRelease" ? 2.5 : settings.mode === "referenceCatchUp" ? 2 : 1.5;
    const peakSafeGainDb = settings.stages.truePeakLimiter
      ? settings.truePeakCeilingDb + limiterBudgetDb - peakDb
      : 18;
    const fixedTargetGainDb = clamp(Math.min(requestedTargetGainDb, peakSafeGainDb), -18, 18);
    const warnings: string[] = [];
    if (fixedTargetGainDb < requestedTargetGainDb - 0.05) {
      warnings.push(`Full-song target gain was reduced by ${(requestedTargetGainDb - fixedTargetGainDb).toFixed(1)}dB to keep limiter work inside the transparent budget.`);
    }
    return {
      estimatedLufs: round2(estimatedLufs),
      peakDb: round2(peakDb),
      fixedTargetGainDb: round2(fixedTargetGainDb),
      chunks: totalChunks,
      warnings,
    };
  };

  const processAimixGlowForSingleFile = async (original: SingleFileAudioSnapshot, source: Project): Promise<SingleFileAudioSnapshot> => {
    if (!aimixGlowSettings.enabled) {
      setAimixGlowReport(null);
      return original;
    }
    const originalBytes = estimateSnapshotBytes(original);
    const sidechainMemoryWouldExceedLimit = Boolean(original.lowMemoryMode) || estimateSingleFileWorkingBytes(originalBytes * 2) > getSingleFileMemoryLimitBytes();
    const previewDurationSec = original.previewOnly
      ? Math.min(...original.channels.map((channel) => channel.length)) / original.sampleRate
      : undefined;
    const vocalSidechain = await renderVocalSidechainForGlow(
      source,
      original.sampleRate,
      sidechainMemoryWouldExceedLimit ? previewDurationSec : undefined,
    );
    const effectiveGlowSettings: AimixGlowSettings = aimixGlowSettings;
    const result = processAimixGlow(original.channels, original.sampleRate, effectiveGlowSettings, {
      copyInput: false,
      vocalSidechain: vocalSidechain?.channels ?? null,
    });
    const memoryWarnings = sidechainMemoryWouldExceedLimit
      ? [vocalSidechain
          ? "Low-memory preview rendered only the matching vocal range; AIMIX Glow parameters remain identical to chunked export."
          : "No vocal sidechain was available; AIMIX Glow parameters were kept unchanged for Preview/Export parity."]
      : [];
    setAimixGlowReport({
      before: result.before,
      after: result.after,
      outputMatchGainDb: result.outputMatchGainDb,
      actions: result.actions,
      warnings: [...memoryWarnings, ...result.warnings],
      vocalSource: vocalSidechain ? "vocal" : "fallback",
    });
    return {
      sampleRate: original.sampleRate,
      channels: result.channels,
      lowMemoryMode: original.lowMemoryMode,
      estimatedPcmBytes: original.estimatedPcmBytes,
      estimatedWorkingBytes: original.estimatedWorkingBytes,
    };
  };

  const createSingleFilePreviewSnapshot = (snapshot: SingleFileAudioSnapshot): SingleFileAudioSnapshot => {
    if (snapshot.lowMemoryMode) {
      return createRepresentativeSingleFilePreviewSnapshot(snapshot);
    }
    const frameCount = Math.min(
      Math.ceil(snapshot.sampleRate * SINGLE_FILE_AUDITION_PREVIEW_SEC),
      ...snapshot.channels.map((channel) => channel.length),
    );
    return copySingleFilePreviewSegments(snapshot, [{ start: 0, length: frameCount }]);
  };

  const shouldStoreFullSingleFileProcessedAudio = (snapshot: SingleFileAudioSnapshot) => {
    if (snapshot.lowMemoryMode) return false;
    const limit = isLikelyMobileBrowser()
      ? Math.min(SINGLE_FILE_FULL_PROCESSED_STORE_LIMIT_BYTES, getSingleFileMemoryLimitBytes() * 0.34)
      : Math.min(420 * 1024 * 1024, getSingleFileMemoryLimitBytes() * 0.5);
    return estimateSnapshotBytes(snapshot) <= limit;
  };

  const createSingleFileProcessedStorageSnapshot = (snapshot: SingleFileAudioSnapshot): SingleFileAudioSnapshot => {
    if (shouldStoreFullSingleFileProcessedAudio(snapshot)) {
      return { ...snapshot, previewOnly: false };
    }
    return {
      ...createSingleFilePreviewSnapshot(snapshot),
      previewOnly: true,
    };
  };

  const createRepresentativeSingleFilePreviewSnapshot = (snapshot: SingleFileAudioSnapshot): SingleFileAudioSnapshot => {
    const commonLength = Math.min(...snapshot.channels.map((channel) => channel.length));
    const firstLength = Math.min(Math.ceil(snapshot.sampleRate * 4), commonLength);
    const loudLength = Math.min(Math.ceil(snapshot.sampleRate * 6), commonLength);
    const finalLength = Math.min(Math.ceil(snapshot.sampleRate * 2), Math.max(0, commonLength - firstLength));
    const loudStart = findLoudestSingleFilePreviewStart(snapshot, loudLength);
    const finalStart = Math.max(0, commonLength - finalLength);
    return copySingleFilePreviewSegments(snapshot, [
      { start: 0, length: firstLength },
      { start: loudStart, length: loudLength },
      { start: finalStart, length: finalLength },
    ].filter((segment) => segment.length > 0));
  };

  const findLoudestSingleFilePreviewStart = (snapshot: SingleFileAudioSnapshot, segmentFrames: number) => {
    const commonLength = Math.min(...snapshot.channels.map((channel) => channel.length));
    if (segmentFrames <= 0 || commonLength <= segmentFrames) return 0;
    const windowFrames = Math.min(Math.ceil(snapshot.sampleRate), segmentFrames);
    const hopFrames = Math.max(1, Math.floor(snapshot.sampleRate * 0.5));
    let bestStart = 0;
    let bestScore = -Infinity;
    for (let start = 0; start <= commonLength - windowFrames; start += hopFrames) {
      let sumSquares = 0;
      let count = 0;
      for (const channel of snapshot.channels) {
        for (let index = start; index < start + windowFrames; index += 1) {
          const sample = channel[index] ?? 0;
          sumSquares += sample * sample;
          count += 1;
        }
      }
      const score = count > 0 ? sumSquares / count : 0;
      if (score > bestScore) {
        bestScore = score;
        bestStart = Math.max(0, Math.min(start - Math.floor((segmentFrames - windowFrames) / 2), commonLength - segmentFrames));
      }
    }
    return bestStart;
  };

  const copySingleFilePreviewSegments = (snapshot: SingleFileAudioSnapshot, segments: Array<{ start: number; length: number }>): SingleFileAudioSnapshot => {
    const totalFrames = segments.reduce((total, segment) => total + segment.length, 0);
    return {
      sampleRate: snapshot.sampleRate,
      channels: snapshot.channels.map((channel) => {
        const preview = new Float32Array(totalFrames);
        let writeOffset = 0;
        for (const segment of segments) {
          const start = Math.max(0, Math.min(segment.start, channel.length));
          const end = Math.max(start, Math.min(start + segment.length, channel.length));
          preview.set(channel.subarray(start, end), writeOffset);
          writeOffset += segment.length;
        }
        return preview;
      }),
      lowMemoryMode: snapshot.lowMemoryMode,
      estimatedPcmBytes: snapshot.estimatedPcmBytes,
      estimatedWorkingBytes: snapshot.estimatedWorkingBytes,
      previewOnly: snapshot.previewOnly,
    };
  };

  const releaseSingleFileAudioRefs = () => {
    stopSingleFileAudition();
    singleFileOriginalRef.current = null;
    singleFileProcessedRef.current = null;
    setSingleFileAudition(null);
  };

  const waitForUiFrame = () =>
    new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));

  const closeSingleFileAuditionContext = async () => {
    const context = singleFileAudioContextRef.current;
    singleFileAudioContextRef.current = null;
    if (!context || context.state === "closed") return;
    try {
      await context.close();
    } catch {
      // Safari can close an interrupted context before this cleanup runs.
    }
  };

  const requestSingleFileExportWakeLock = async () => {
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    }).wakeLock;
    if (!wakeLock) return null;
    try {
      return await wakeLock.request("screen");
    } catch {
      return null;
    }
  };

  const updateSingleFileProgress = async (progress: SingleFileWorkProgress) => {
    setSingleFileProgress(progress);
    await waitForUiFrame();
  };

  const toSingleFileUiReport = (result: SingleFileMasteringResult, snapshot?: SingleFileAudioSnapshot): SingleFileMasteringUiReport => ({
    before: result.before,
    after: result.after,
    limiterGainReductionDb: result.limiterGainReductionDb,
    glueGainReductionDb: result.glueGainReductionDb,
    exportSafetyReport: result.exportSafetyReport,
    referenceCatchUpGuardReport: result.referenceCatchUpGuardReport,
    targetReport: result.targetReport,
    warnings: [
      ...(snapshot?.lowMemoryMode
        ? [`Large mix low-memory mode: A/B preview is shortened; full export keeps AIMIX Glow and its matching vocal sidechain in safe chunks (${formatBytes(snapshot.estimatedWorkingBytes ?? 0)} estimated).`]
        : []),
      ...result.warnings,
    ],
    actions: result.actions,
  });

  const analyzeSingleFileMagicPolish = async () => {
    if (singleFileMode === "existing") {
      analyzeMagicPolish();
      return;
    }
    if (!canRunSingleFileMastering) {
      showToast(singleFileExportDisabledReason ?? "Import at least one non-reference stem or WAV before mastering.");
      return;
    }
    setSingleFileIsWorking(true);
    try {
      releaseSingleFileAudioRefs();
      if (isLikelyMobileBrowser()) await closeSingleFileAuditionContext();
      setSingleFileReport(null);
      await updateSingleFileProgress({
        title: "Analyzing Mix",
        label: "Rendering current mix for mastering analysis...",
        detail: "Sweet DAW is preparing a local offline render.",
        percent: 8,
      });
      const source = getCurrentMasteringSourceProject();
      const renderPlan = await createSingleFileRenderPlan(source);
      const original = await renderCurrentMixForSingleFile(source, { plan: renderPlan, previewOnly: renderPlan.lowMemoryMode });
      await updateSingleFileProgress({
        title: "Analyzing Mix",
        label: "Preparing safe A/B preview...",
        detail: original.lowMemoryMode ? "Large mix mode: only a representative preview is analyzed; full export will use chunk-safe rendering." : "Creating local preview audio.",
        percent: 38,
      });
      const originalPreview = createSingleFilePreviewSnapshot(original);
      await updateSingleFileProgress({
        title: "Analyzing Mix",
        label: "Applying AIMIX Glow analysis path...",
        detail: "This stage stays local in the browser.",
        percent: 55,
      });
      const glowSource = await processAimixGlowForSingleFile(original, source);
      await updateSingleFileProgress({
        title: "Analyzing Mix",
        label: "Measuring mastering target and safety guards...",
        percent: 78,
      });
      const result = processSingleFileMastering(glowSource.channels, glowSource.sampleRate, resolveSingleFileSettingsForUi(), { copyInput: false });
      singleFileOriginalRef.current = originalPreview;
      singleFileProcessedRef.current = null;
      setSingleFileReport(toSingleFileUiReport(result, original));
      setMagicPolishReport(null);
      await updateSingleFileProgress({
        title: "Analysis Ready",
        label: "Mastering analysis is ready.",
        detail: "Press Render Processed Master when you want to prepare processed preview/export audio.",
        percent: 100,
      });
      showToast(original.lowMemoryMode
        ? "Preview analysis is ready. Full Processed WAV export will use chunk-safe rendering."
        : "Single File Mastering analysis is ready. Press Render Processed Master to prepare export audio.");
    } catch (error) {
      showToast(`Single File Mastering analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSingleFileProgress(null);
      setSingleFileIsWorking(false);
    }
  };

  const applySingleFileMagicPolish = async () => {
    if (singleFileMode === "existing") {
      applyAimixFinalPolish();
      return;
    }
    if (!canRunSingleFileMastering) {
      showToast(singleFileExportDisabledReason ?? "Import at least one non-reference stem or WAV before mastering.");
      return;
    }
    setSingleFileIsWorking(true);
    try {
      releaseSingleFileAudioRefs();
      if (isLikelyMobileBrowser()) await closeSingleFileAuditionContext();
      setSingleFileReport(null);
      await updateSingleFileProgress({
        title: "Polishing Rendered Mix",
        label: "Rendering current mix...",
        detail: "Please keep this page open. Long songs can take a moment on mobile.",
        percent: 6,
      });
      const source = getCurrentMasteringSourceProject();
      const renderPlan = await createSingleFileRenderPlan(source);
      const original = await renderCurrentMixForSingleFile(source, { plan: renderPlan, previewOnly: renderPlan.lowMemoryMode });
      await updateSingleFileProgress({
        title: "Polishing Rendered Mix",
        label: "Preparing original A/B preview...",
        detail: original.lowMemoryMode ? "Large mix mode: only preview audio is processed here; full export will use chunk-safe rendering." : undefined,
        percent: 32,
      });
      const originalPreview = createSingleFilePreviewSnapshot(original);
      await updateSingleFileProgress({
        title: "Polishing Rendered Mix",
        label: "Applying AIMIX Glow...",
        percent: 48,
      });
      const glowSource = await processAimixGlowForSingleFile(original, source);
      await updateSingleFileProgress({
        title: "Polishing Rendered Mix",
        label: "Applying mastering polish and true-peak safety...",
        percent: 68,
      });
      const result = processSingleFileMastering(glowSource.channels, glowSource.sampleRate, resolveSingleFileSettingsForUi(), { copyInput: false });
      const processedSnapshot: SingleFileAudioSnapshot = {
        sampleRate: glowSource.sampleRate,
        channels: result.channels,
        lowMemoryMode: glowSource.lowMemoryMode,
        estimatedPcmBytes: glowSource.estimatedPcmBytes,
        estimatedWorkingBytes: glowSource.estimatedWorkingBytes,
      };
      const storedProcessed = createSingleFileProcessedStorageSnapshot(processedSnapshot);
      singleFileOriginalRef.current = originalPreview;
      singleFileProcessedRef.current = storedProcessed;
      setSingleFileReport(toSingleFileUiReport(result, original));
      setMagicPolishReport(null);
      setSingleFileAudition(null);
      await updateSingleFileProgress({
        title: "Polish Ready",
        label: storedProcessed.previewOnly ? "Processed preview is ready. Full WAV export will render again safely." : "Processed audio is ready.",
        detail: storedProcessed.previewOnly ? "Full processed audio was not kept in memory to reduce browser crashes." : "Use A/B or Export Processed WAV.",
        percent: 100,
      });
      showToast(storedProcessed.previewOnly
        ? "Processed preview is ready. Full WAV export will render again safely."
        : "Single File Mastering processed audio is ready. Use A/B or Export Processed WAV.");
    } catch (error) {
      showToast(`Single File Mastering failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSingleFileProgress(null);
      setSingleFileIsWorking(false);
    }
  };

  const stopSingleFileAudition = () => {
    const source = singleFileSourceRef.current;
    try {
      source?.stop();
    } catch {
      // Already stopped.
    }
    try {
      source?.disconnect();
      if (source) source.buffer = null;
    } catch {
      // The source may already be detached by Safari.
    }
    singleFileSourceRef.current = null;
    setSingleFileAudition(null);
  };

  const playSingleFileAudition = async (kind: "original" | "processed") => {
    const snapshot = kind === "original" ? singleFileOriginalRef.current : singleFileProcessedRef.current;
    if (!snapshot) {
      showToast(kind === "original" ? "Analyze first to prepare the original mix." : "Polish first to prepare processed audio.");
      return;
    }
    stopSingleFileAudition();
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor) {
      showToast("This browser does not support AudioContext.");
      return;
    }
    const context = singleFileAudioContextRef.current ?? new AudioContextCtor();
    singleFileAudioContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    const frameCount = Math.min(
      Math.ceil(snapshot.sampleRate * SINGLE_FILE_AUDITION_PREVIEW_SEC),
      ...snapshot.channels.map((channel) => channel.length),
    );
    const buffer = context.createBuffer(snapshot.channels.length, frameCount, snapshot.sampleRate);
    snapshot.channels.forEach((channel, index) => {
      const previewChannel = new Float32Array(frameCount);
      previewChannel.set(channel.subarray(0, frameCount));
      buffer.copyToChannel(previewChannel, index);
    });
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => {
      if (singleFileSourceRef.current === source) {
        source.disconnect();
        source.buffer = null;
        singleFileSourceRef.current = null;
        setSingleFileAudition(null);
      }
    };
    singleFileSourceRef.current = source;
    setSingleFileAudition(kind);
    source.start();
  };

  const exportSingleFileProcessedWavChunked = async (
    source: Project,
    downloadBlob: (blob: Blob, filename: string) => void,
  ) => {
    const [{ renderProjectSliceOfflinePadded }, { createWavExportWriter }, { createExportHealthAccumulator, formatExportHealthWarnings }, { createStreamingMasterChunkJoiner, STREAMING_MASTER_PRE_ROLL_SEC, STREAMING_MASTER_POST_ROLL_SEC }] = await Promise.all([
      import("@/audio/engine/OfflineRenderer"),
      import("@/audio/export/WavStreamingEncoder"),
      import("@/audio/export/ExportHealth"),
      import("@/daw/mastering/StreamingMasterProcessor"),
    ]);
    const plan = await createSingleFileRenderPlan(source);
    const exportBitDepth = source.master.exportBitDepth ?? "pcm16";
    const totalFrames = Math.ceil(plan.durationSec * plan.sampleRate);
    const chunkJoiner = createStreamingMasterChunkJoiner({ sampleRate: plan.sampleRate });
    const health = createExportHealthAccumulator();
    const baseSettings = resolveSingleFileSettingsForUi();
    const chunkSec = plan.chunkDurationSec;
    const totalChunks = Math.max(1, Math.ceil(plan.durationSec / chunkSec));
    const suspendedSources = await suspendStreamableRenderBuffers(source);
    if (suspendedSources.releasedBytes > 0) {
      await updateSingleFileProgress({
        title: "Exporting WAV",
        label: "Switching STEM sources to streamed WAV ranges...",
        detail: `${formatBytes(suspendedSources.releasedBytes)} of full-song decoded PCM was released. Each render chunk now reads only the source range it needs.`,
        percent: 9,
      });
    }
    const targetScan = await scanSingleFileChunkedTarget(source, plan, baseSettings);
    const settings: SingleFileMasteringSettings = {
      ...baseSettings,
      chunkedFixedTargetGainDb: targetScan.fixedTargetGainDb,
      chunkedGlobalLufs: targetScan.estimatedLufs,
    };
    const writer = await createWavExportWriter({
      sampleRate: plan.sampleRate,
      channels: 2,
      normalizePeak: false,
      bitDepth: exportBitDepth,
      dither: exportBitDepth === "pcm16" ? source.master.exportDither : false,
      totalFrames,
      maxBlobBytes: Number.POSITIVE_INFINITY,
    });
    let firstReport: SingleFileMasteringResult | null = null;
    let firstGlow: ReturnType<typeof processAimixGlow> | null = null;
    const vocalProject = aimixGlowSettings.enabled ? createVocalGlowProject(source) : null;
    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        const startSec = chunkIndex * chunkSec;
        const endSec = Math.min(plan.durationSec, startSec + chunkSec);
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: `Rendering safe chunk ${chunkIndex + 1}/${totalChunks}...`,
          detail: `iPhone safe mode: ${plan.activeTrackCount} tracks / ${chunkSec}s chunks / ${writer.storageMode === "opfs" ? "disk-backed WAV" : "memory WAV fallback"}.`,
          percent: 30 + (chunkIndex / totalChunks) * 62,
        });
        const renderedChunk = await renderProjectSliceOfflinePadded(source, undefined, {
          startSec,
          endSec,
          preRollSec: chunkIndex === 0 ? 0 : STREAMING_MASTER_PRE_ROLL_SEC,
          postRollSec: chunkIndex >= totalChunks - 1 ? 0.05 : STREAMING_MASTER_POST_ROLL_SEC,
        }, { sampleRate: plan.sampleRate });
        let chunkChannels = renderedChunk.channels;
        if (aimixGlowSettings.enabled) {
          const vocalChunk = vocalProject
            ? await renderProjectSliceOfflinePadded(vocalProject, undefined, {
                startSec,
                endSec,
                preRollSec: chunkIndex === 0 ? 0 : STREAMING_MASTER_PRE_ROLL_SEC,
                postRollSec: chunkIndex >= totalChunks - 1 ? 0.05 : STREAMING_MASTER_POST_ROLL_SEC,
              }, { sampleRate: plan.sampleRate })
            : null;
          const glow = processAimixGlow(chunkChannels, plan.sampleRate, aimixGlowSettings, {
            copyInput: false,
            vocalSidechain: vocalChunk?.channels ?? null,
          });
          chunkChannels = glow.channels;
          if (!firstGlow) firstGlow = { ...glow, channels: [] };
          vocalChunk?.channels.splice(0);
        }
        const result = processSingleFileMastering(chunkChannels, plan.sampleRate, settings, {
          copyInput: false,
          quality: "mobile-hq",
        });
        if (!firstReport) firstReport = { ...result, channels: [] };
        const stableChunk = chunkJoiner.add(result.channels, renderedChunk);
        if ((stableChunk[0]?.length ?? 0) > 0) {
          health.add(stableChunk);
          await writer.writeChunk(stableChunk);
        }
        stableChunk.splice(0);
        result.channels.splice(0);
        chunkChannels.splice(0);
        renderedChunk.channels.splice(0);
        await waitForUiFrame();
      }

      const finalTail = chunkJoiner.flush();
      if ((finalTail[0]?.length ?? 0) > 0) {
        health.add(finalTail);
        await writer.writeChunk(finalTail);
        finalTail.splice(0);
      }
      const report = health.finish();
      const warnings = formatExportHealthWarnings(report);
      if (firstGlow) {
        setAimixGlowReport({
          before: firstGlow.before,
          after: firstGlow.after,
          outputMatchGainDb: firstGlow.outputMatchGainDb,
          actions: firstGlow.actions,
          warnings: [vocalProject ? "Low-memory chunk export rendered the vocal sidechain per chunk." : "Low-memory chunk export kept the current AIMIX Glow settings without a vocal track.", ...firstGlow.warnings],
          vocalSource: vocalProject ? "vocal" : "fallback",
        });
      } else {
        setAimixGlowReport(null);
      }
      if (firstReport) {
        setSingleFileReport(toSingleFileUiReport(firstReport, {
          sampleRate: plan.sampleRate,
          channels: [],
          lowMemoryMode: true,
          estimatedPcmBytes: plan.estimatedPcmBytes,
          estimatedWorkingBytes: plan.estimatedWorkingBytes,
          previewOnly: true,
        }));
      }
      await updateSingleFileProgress({
        title: "Exporting WAV",
        label: "Finalizing chunk-safe WAV...",
        detail: writer.storageMode === "opfs"
          ? "The WAV was written to temporary browser storage instead of being accumulated in RAM."
          : writer.fallbackReason,
        percent: 96,
      });
      const allWarnings = [...targetScan.warnings, ...warnings];
      const blob = await writer.finish();
      const exportFilename = reserveMasterExportFilename(project);
      downloadBlob(blob, exportFilename);
      window.setTimeout(() => void writer.cleanup(), 120_000);
      showToast(allWarnings.length > 0
        ? `${exportFilename} exported with ${allWarnings.length} health warning${allWarnings.length === 1 ? "" : "s"}.`
        : `${exportFilename} exported with iPhone safe chunk rendering.`);
    } catch (error) {
      await writer.abort();
      throw error;
    } finally {
      // Full-song PCM stays released after export. Playback restores only the
      // audible source files when the user presses Play again.
    }
  };

  const exportSingleFileProcessedWav = async () => {
    let prepared = singleFileProcessedRef.current;
    if (!canRunSingleFileMastering) {
      showToast(singleFileExportDisabledReason ?? "Import at least one non-reference stem or WAV before exporting.");
      return;
    }
    setSingleFileIsWorking(true);
    const wakeLock = await requestSingleFileExportWakeLock();
    let exportSnapshot: SingleFileAudioSnapshot | null = null;
    try {
      stopSingleFileAudition();
      if (isLikelyMobileBrowser()) await closeSingleFileAuditionContext();
      singleFileOriginalRef.current = null;
      await updateSingleFileProgress({
        title: "Exporting WAV",
        label: !prepared ? "Polishing and exporting processed master..." : prepared.previewOnly ? "Re-rendering full processed mix..." : "Preparing processed WAV export...",
        detail: !prepared
          ? "No processed buffer exists yet, so Sweet DAW will render, master, and export in one step."
          : prepared.previewOnly
          ? "The preview was kept small for memory safety; the full WAV is rebuilt now."
          : "Sweet DAW is preparing local WAV encoding.",
        percent: 5,
      });
      const [{ createWavStreamingEncoder }, { downloadBlob }] = await Promise.all([
        import("@/audio/export/WavStreamingEncoder"),
        import("@/daw/project/ProjectSerializer"),
      ]);
      const source = getCurrentMasteringSourceProject();
      const renderPlan = await createSingleFileRenderPlan(source);
      if (renderPlan.lowMemoryMode || prepared?.previewOnly) {
        prepared = null;
        singleFileProcessedRef.current = null;
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: "Switching to iPhone safe chunk export...",
          detail: renderPlan.lowMemoryMode
            ? `Estimated working memory is ${formatBytes(renderPlan.estimatedWorkingBytes)}. Full-buffer mastering will be skipped.`
            : "The prepared preview is memory-safe only, so the full WAV will be rebuilt in chunks.",
          percent: 10,
        });
        await exportSingleFileProcessedWavChunked(source, downloadBlob);
        return;
      }
      if (!prepared) {
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: "Rendering current mix for processed WAV...",
          percent: 15,
        });
        const original = await renderCurrentMixForSingleFile(source);
        const originalPreview = createSingleFilePreviewSnapshot(original);
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: "Applying AIMIX Glow for export...",
          percent: 38,
        });
        const glowSource = await processAimixGlowForSingleFile(original, source);
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: "Applying mastering polish for export...",
          percent: 56,
        });
        const result = processSingleFileMastering(glowSource.channels, glowSource.sampleRate, resolveSingleFileSettingsForUi(), { copyInput: false });
        exportSnapshot = {
          sampleRate: glowSource.sampleRate,
          channels: result.channels,
          lowMemoryMode: glowSource.lowMemoryMode,
          estimatedPcmBytes: glowSource.estimatedPcmBytes,
          estimatedWorkingBytes: glowSource.estimatedWorkingBytes,
        };
        prepared = createSingleFileProcessedStorageSnapshot(exportSnapshot);
        singleFileOriginalRef.current = originalPreview;
        singleFileProcessedRef.current = prepared;
        setSingleFileReport(toSingleFileUiReport(result, original));
        setMagicPolishReport(null);
      } else if (prepared.previewOnly) {
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: "Rendering current mix for full WAV...",
          percent: 15,
        });
        const original = await renderCurrentMixForSingleFile(source);
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: "Applying AIMIX Glow for export...",
          percent: 38,
        });
        const glowSource = await processAimixGlowForSingleFile(original, source);
        await updateSingleFileProgress({
          title: "Exporting WAV",
          label: "Applying mastering polish for export...",
          percent: 56,
        });
        const result = processSingleFileMastering(glowSource.channels, glowSource.sampleRate, resolveSingleFileSettingsForUi(), { copyInput: false });
        exportSnapshot = {
          sampleRate: glowSource.sampleRate,
          channels: result.channels,
          lowMemoryMode: glowSource.lowMemoryMode,
          estimatedPcmBytes: glowSource.estimatedPcmBytes,
          estimatedWorkingBytes: glowSource.estimatedWorkingBytes,
        };
        setSingleFileReport(toSingleFileUiReport(result, original));
      } else {
        exportSnapshot = prepared;
      }

      await updateSingleFileProgress({
        title: "Exporting WAV",
        label: "Encoding WAV in chunks...",
        detail: "Chunked encoding reduces memory pressure while the download is prepared.",
        percent: 70,
      });
      const totalFrames = Math.max(0, Math.min(...exportSnapshot.channels.map((channel) => channel.length)));
      const exportBitDepth = source.master.exportBitDepth ?? "pcm16";
      const encoder = createWavStreamingEncoder({
        sampleRate: exportSnapshot.sampleRate,
        channels: exportSnapshot.channels.length,
        normalizePeak: false,
        bitDepth: exportBitDepth,
        dither: exportBitDepth === "pcm16" ? source.master.exportDither : false,
        totalFrames,
      });
      const chunkFrames = Math.max(4096, Math.floor(exportSnapshot.sampleRate * 1.5));
      for (let offset = 0, chunkIndex = 0; offset < totalFrames; offset += chunkFrames, chunkIndex += 1) {
        const end = Math.min(totalFrames, offset + chunkFrames);
        encoder.writeChunk(exportSnapshot.channels.map((channel) => channel.subarray(offset, end)));
        if (chunkIndex % 4 === 3 || end >= totalFrames) {
          await updateSingleFileProgress({
            title: "Exporting WAV",
            label: "Encoding WAV in chunks...",
            detail: `${Math.round((end / Math.max(1, totalFrames)) * 100)}% encoded`,
            percent: 70 + (end / Math.max(1, totalFrames)) * 25,
          });
        }
      }
      await updateSingleFileProgress({
        title: "Exporting WAV",
        label: "Finalizing download...",
        percent: 98,
      });
      const blob = encoder.finish();
      const exportFilename = reserveMasterExportFilename(project);
      downloadBlob(blob, exportFilename);
      showToast(`${exportFilename} exported. Mastering audio buffer was released.`);
    } catch (error) {
      showToast(`Processed WAV export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try {
        await wakeLock?.release();
      } catch {
        // The browser releases the lock automatically when the page loses visibility.
      }
      exportSnapshot = null;
      singleFileProcessedRef.current = null;
      setSingleFileAudition(null);
      setSingleFileProgress(null);
      setSingleFileIsWorking(false);
    }
  };

  const currentMagicTarget = resolveMagicPolishTarget(
    targetPreset,
    customTargetIntegratedLufs,
    customTruePeakCeilingDb,
    customTonalMatchStrength,
    customSpatialMatchStrength,
    customDensityMatchStrength,
    activeReferenceProfile,
    activeReferenceRepair,
    finalMode,
    referenceGainMode,
    referenceGainTrimDb,
    referenceHardLimit,
  );
  const referenceProfileForMagic = activeReferenceProfile;
  const magicPolishReferenceMissing = targetPreset === "reference" && referenceTracks.length === 0;
  const magicReferenceStatusText =
    targetPreset !== "reference"
      ? null
      : referenceProfileForMagic && currentMagicTarget
        ? `Reference ready: ${referenceProfileForMagic.trackName} / ${referenceProfileForMagic.integratedLufsApprox.toFixed(1)} LUFS / ${referenceProfileForMagic.truePeakApproxDb.toFixed(1)} dBTP`
        : "Reference音源が必要です。FilesでReference Mixを読み込み、AIMIX提案または解析を実行してください。";

  const magicReferenceStatusTextReadable =
    targetPreset !== "reference"
      ? null
      : referenceProfileForMagic && currentMagicTarget
        ? `Reference ready: ${referenceProfileForMagic.trackName} / ${referenceProfileForMagic.integratedLufsApprox.toFixed(1)} LUFS / ${referenceProfileForMagic.truePeakApproxDb.toFixed(1)} dBTP`
        : referenceTracks.length > 0
          ? "Reference is loaded. Run analysis or Magic Polish to refresh the target."
          : "Reference mix is required. Import a Reference Mix from Files first.";

  const advancedReferenceToolsEnabled = referenceOptionsOpen && referenceAnalysisReady;
  const singleFileModeOptionsForUi = advancedReferenceToolsEnabled
    ? SINGLE_FILE_MODE_OPTIONS
    : SINGLE_FILE_MODE_OPTIONS.filter((option) => option.id === "directWavPolish" || option.id === "lightMaster" || option.id === "loudnessOnly" || option.id === "loudRelease");
  const magicPolishTargetOrderForUi = advancedReferenceToolsEnabled
    ? MAGIC_POLISH_TARGET_ORDER
    : MAGIC_POLISH_TARGET_ORDER.filter((preset) => preset === "spotify");
  const isSingleFileMasteringMode = singleFileMode !== "existing";
  const hasSingleFileWorkClips = useMemo(() => {
    const tracksById = new Map(project.tracks.map((track) => [track.id, track]));
    return project.clips.some((clip) => {
      const track = tracksById.get(clip.trackId);
      return Boolean(track && track.role !== "reference" && track.type !== "reference");
    });
  }, [project.clips, project.tracks]);
  const hasSingleFileDirectWavClip = useMemo(() => hasDirectWavMasteringSource(project), [project]);
  const singleFileExportAvailability = {
    isSingleFileMasteringMode,
    mode: singleFileMode,
    hasWorkClips: hasSingleFileWorkClips,
    hasDirectWavClip: hasSingleFileDirectWavClip,
    referenceAnalysisReady,
    isWorking: singleFileIsWorking,
  };
  const canRunSingleFileMastering = canRunSingleFileMasteringExport(singleFileExportAvailability);
  const singleFileReferenceMissing = singleFileMode === "referenceCatchUp" && !referenceAnalysisReady;
  const singleFileExportDisabledReason = getSingleFileExportDisabledReason(singleFileExportAvailability);
  const singleFileExportButtonLabel = getSingleFileExportButtonLabel({
    isWorking: singleFileIsWorking,
    hasProcessedBuffer: Boolean(singleFileProcessedRef.current),
  });
  const activeVocalClarityGate = proposal?.vocalClarityGate ?? null;
  const masteringConflictGuard = buildMasteringConflictGuard(aimixGlowSettings.enabled, aimixGlowReport, activeVocalClarityGate);
  const currentSingleFileSettings = resolveSingleFileSettingsForUi();
  const peakCulpritReport = useMemo(() => buildPeakCulpritReport(project, waveformPeaks), [project, waveformPeaks]);
  const isMasteringSection = section === "mastering";
  const oneTapFinish = useMemo(
    () => buildOneTapReferenceFinishState(project, autoReferenceMix, autoReferenceMixSettings),
    [autoReferenceMix, autoReferenceMixSettings, project],
  );
  const oneTapMetrics = useMemo(() => {
    if (!mixDoctorAudition) return null;
    return {
      before: measureProject(mixDoctorAudition.before, waveformPeaks),
      after: measureProject(mixDoctorAudition.after, waveformPeaks),
    };
  }, [mixDoctorAudition, waveformPeaks]);
  const aimixGlowVocalTrackCount = project.tracks.filter(isAimixGlowVocalTrack).length;
  const currentAimixGlowPresetLabel = aimixGlowSettings.preset === "custom"
    ? "Custom"
    : AIMIX_GLOW_PRESETS[aimixGlowSettings.preset as Exclude<AimixGlowPresetId, "custom">]?.label ?? "Custom";
  const selectAimixGlowPreset = (preset: Exclude<AimixGlowPresetId, "custom">) => {
    setAimixGlowSettings({
      ...settingsFromAimixGlowPreset(preset),
      enabled: true,
      outputMatch: aimixGlowSettings.outputMatch,
    });
    setAimixGlowReport(null);
  };
  const updateAimixGlowCustom = (patch: Partial<AimixGlowSettings>) => {
    setAimixGlowSettings((current) => ({ ...current, ...patch, preset: "custom" }));
    setAimixGlowReport(null);
  };
  const openReferenceSingleFileCheck = () => {
    if (referenceTracks.length === 0) {
      showToast("Reference Mix is required. Import one from Files first.");
      return;
    }
    if (hasSingleFileWorkClips && !referenceAnalysisReady) {
      showToast("Reference is loaded. Run AIMIX analysis first to refresh the Reference target.");
      return;
    }
    setReferenceOptionsOpen(true);
    setSingleFileMode(hasSingleFileWorkClips ? "referenceCatchUp" : "directWavPolish");
    setSingleFileReport(null);
    singleFileProcessedRef.current = null;
    setSingleFileAudition(null);
    onRequestSection?.("mastering");
    showToast(hasSingleFileWorkClips
      ? "Masteringへ移動しました。Reference Catch-UpでAIMIX/Spatial後のミックスを確認できます。"
      : "Masteringへ移動しました。Direct WAV PolishでReference 1本を非破壊処理できます。");
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-cyan-300/20 bg-slate-950/80 p-3 pb-20 text-slate-100 shadow-2xl shadow-cyan-950/30 sm:p-4 lg:pb-4">
      {!isMasteringSection ? (
        <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-cyan-200/70">
            <Sparkles size={15} />
            AIMIX
          </div>
          <h3 className="mt-1 text-xl font-semibold">AIMIX提案からFIXまで</h3>
          <p className="mt-1 text-sm text-slate-300">
            バランスを提案し、Before / Afterで確認してFIXします。最終仕上げはMasteringタブのMagic Polishで行います。
          </p>
        </div>
        <div className="rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
          {fixed ? "FIX済み" : proposal ? "確認待ち" : "未提案"}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-emerald-300/25 bg-emerald-300/[0.08] p-3 shadow-[0_0_30px_rgba(16,185,129,0.08)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-200/80">
              <Sparkles size={15} />
              {oneTapFinish.title}
            </div>
            <h4 className="mt-1 text-lg font-black text-emerald-50">Referenceで1発仕上げ</h4>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-300">{oneTapFinish.message}</p>
          </div>
          <div className={`rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-wider ${
            oneTapFinish.status === "done"
              ? "border-emerald-300/40 bg-emerald-300/15 text-emerald-100"
              : oneTapFinish.status === "warning"
                ? "border-amber-300/40 bg-amber-300/15 text-amber-100"
                : oneTapFinish.status === "error"
                  ? "border-rose-300/40 bg-rose-300/15 text-rose-100"
                  : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
          }`}>
            {oneTapFinish.status}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <MetricLine label="Reference" value={`${oneTapFinish.referenceTrackCount}`} />
          <MetricLine label="Tracks" value={`${oneTapFinish.workTrackCount}`} />
          <MetricLine label="Clips" value={`${oneTapFinish.workClipCount}`} />
        </div>

        {oneTapMetrics ? (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <MetricLine label="LUFS" value={`${oneTapMetrics.before.rmsDb.toFixed(1)} -> ${oneTapMetrics.after.rmsDb.toFixed(1)}`} />
            <MetricLine label="Crest" value={`${oneTapMetrics.before.crestDb.toFixed(1)} -> ${oneTapMetrics.after.crestDb.toFixed(1)}`} />
            <MetricLine label="Presence" value={`${oneTapMetrics.before.presence.toFixed(1)} -> ${oneTapMetrics.after.presence.toFixed(1)}`} />
            <MetricLine label="Air" value={`${oneTapMetrics.before.air.toFixed(1)} -> ${oneTapMetrics.after.air.toFixed(1)}`} />
            <MetricLine label="Width" value={`${oneTapMetrics.before.width.toFixed(1)} -> ${oneTapMetrics.after.width.toFixed(1)}`} />
          </div>
        ) : null}

        {autoReferenceMix.vocalClarityGate ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-2 text-xs text-slate-200">
            <span className="font-black text-emerald-100">Vocal Clarity Gate:</span> {autoReferenceMix.vocalClarityGate.summary}
          </div>
        ) : null}

        {oneTapFinish.warnings.length > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-2 text-xs text-amber-100">
            {oneTapFinish.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        ) : null}

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <button
            type="button"
            disabled={oneTapFinish.disabled}
            onClick={runOneTapReferenceFinish}
            className="min-h-12 rounded-xl border border-emerald-200/60 bg-emerald-300/20 px-4 py-3 text-sm font-black text-emerald-50 transition hover:bg-emerald-300/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/[0.04] disabled:text-slate-500"
          >
            {oneTapFinish.primaryLabel}
          </button>
          <button
            type="button"
            onClick={() => setAdvancedAimixOpen((open) => !open)}
            className={`min-h-12 rounded-xl border px-4 py-3 text-sm font-black transition ${
              advancedAimixOpen
                ? "border-cyan-300/60 bg-cyan-300/15 text-cyan-50"
                : "border-white/10 bg-slate-900/80 text-slate-200"
            }`}
          >
            Advanced AIMIX {advancedAimixOpen ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {referenceOptionsOpen ? (
          <>
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Crosshair size={16} />
            Reference解析
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-300">{referenceStatus}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <MetricLine label="Reference" value={`${referenceTracks.length}本`} />
            <MetricLine label="Crest" value={referenceCrestFactorDb == null ? "-" : `${referenceCrestFactorDb.toFixed(1)}dB`} />
            <MetricLine label="追従" value={activeReferenceDelta ? "ON" : "OFF"} />
          </div>
          <div className="mt-3 rounded-xl border border-fuchsia-300/25 bg-fuchsia-300/10 p-3">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-100">
              1 File WAV Check
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              STEMがある場合はAIMIX/Spatial後のミックスをReference Catch-Upで確認します。Reference 1本だけの場合はDirect WAV Polishが、原音を上書きせずArtifact Guard・薄い中域Spatial・True Peak保護を行います。
            </p>
            <button
              type="button"
              onClick={openReferenceSingleFileCheck}
              disabled={referenceTracks.length === 0 || (hasSingleFileWorkClips && !referenceAnalysisReady)}
              className="mt-2 min-h-10 w-full rounded-xl border border-fuchsia-300/50 bg-fuchsia-400/15 px-3 py-2 text-xs font-black text-fuchsia-50 transition disabled:cursor-not-allowed disabled:opacity-45"
            >
              {hasSingleFileWorkClips ? "AIMIX/Spatial後をReferenceと比較" : "直WAV 1本をAIMIX/Spatial処理"}
            </button>
          </div>
          <TargetProfileDeltaCard
            profiles={SWEET_MASTER_TARGET_PROFILES}
            profileId={targetProfileId}
            targetProfile={targetProfile}
            report={sweetReferenceDeltaReport}
            aimixHints={sweetAimixDeltaHints}
            onProfileChange={setTargetProfileId}
            onApplyAimix={applyTargetProfileToAimixProposal}
            onApplyMaster={applyTargetProfileToMasterPolish}
          />
          {activeReferenceRepair ? (
            <div className={`mt-3 rounded-xl border p-3 text-xs ${
              activeReferenceRepair.severity === "critical"
                ? "border-rose-300/30 bg-rose-400/10 text-rose-100"
                : activeReferenceRepair.severity === "warning"
                  ? "border-amber-300/30 bg-amber-400/10 text-amber-100"
                  : "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-black uppercase tracking-wider">Direct WAV Repair</div>
                  <p className="mt-1 leading-relaxed text-slate-200">
                    {activeReferenceRepair.messages[0]}
                  </p>
                </div>
                <span className="rounded-lg bg-black/25 px-2 py-1 font-black">
                  {activeReferenceRepair.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <MetricLine label="RMS差" value={`${activeReferenceRepair.rmsDiffDb > 0 ? "+" : ""}${activeReferenceRepair.rmsDiffDb.toFixed(1)}dB`} />
                <MetricLine label="Peak差" value={`${activeReferenceRepair.peakDiffDb > 0 ? "+" : ""}${activeReferenceRepair.peakDiffDb.toFixed(1)}dB`} />
                <MetricLine label="Crest差" value={`${activeReferenceRepair.crestDiffDb > 0 ? "+" : ""}${activeReferenceRepair.crestDiffDb.toFixed(1)}dB`} />
                <MetricLine label="Side/Mid差" value={`${activeReferenceRepair.sideMidDiffDb > 0 ? "+" : ""}${activeReferenceRepair.sideMidDiffDb.toFixed(1)}dB`} />
              </div>
              <div className="mt-2 rounded-lg bg-black/20 px-2 py-1.5 text-slate-200">
                推奨: {activeReferenceRepair.recommendedChain.slice(0, 4).join(" → ")}
              </div>
              <button
                type="button"
                onClick={() => downloadReferenceRepairReport(activeReferenceRepair)}
                className="mt-2 min-h-9 w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-slate-100"
              >
                Reference Repairレポートを書き出し
              </button>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <SlidersHorizontal size={16} />
            AIMIXモード
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {AIMIX_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setAimixMode(option.id);
                  setAimixWorkflowPreset("custom");
                }}
                className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                  aimixMode === option.id
                    ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-50"
                    : "border-white/10 bg-slate-900/70 text-slate-300"
                }`}
              >
                <span className="block font-semibold">{option.label}</span>
                <span className="mt-1 block leading-relaxed text-slate-400">{option.description}</span>
              </button>
            ))}
          </div>
        </div>
          </>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-cyan-300/15 bg-white/[0.04] p-3 text-xs leading-relaxed text-slate-400">
        Pan / Width / Clip Pan AutomationはAIMIX Spatialへ移動しました。AIMIXは音量、EQ、Artifact Light Fix、Role / Artifact診断だけを行います。
      </div>

      <div className="mt-4 grid gap-3">
        <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] p-3 text-xs leading-relaxed text-slate-300">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="font-black text-cyan-100">Default route:</span> AIMIX Standard → Spatial Auto → Light Master.
              Reference / Custom tools stay optional so the normal path is always the first choice.
            </div>
            <button
              type="button"
              disabled={!referenceAnalysisReady}
              onClick={() => setReferenceOptionsOpen((open) => !open)}
              className={`min-h-10 rounded-xl border px-3 py-2 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${
                referenceOptionsOpen
                  ? "border-emerald-300/70 bg-emerald-300/15 text-emerald-50"
                  : "border-white/10 bg-slate-900/80 text-slate-200"
              }`}
            >
              Reference / Custom {referenceOptionsOpen ? "ON" : "OFF"}
            </button>
          </div>
          {!referenceAnalysisReady ? (
            <div className="mt-2 text-[11px] text-slate-400">
              Reference options unlock after a Reference mix is loaded and analyzed. Use AIMIX Standard first when unsure.
            </div>
          ) : null}
        </div>
        <div className={`grid gap-2 ${referenceOptionsOpen ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
          <button
            type="button"
            onClick={() => createProposal("standard")}
            disabled={isWorking}
            className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition disabled:opacity-60 ${
              aimixWorkflowPreset === "standard"
                ? "border-cyan-200/70 bg-cyan-300/22 text-cyan-50 shadow-[0_0_24px_rgba(103,232,249,0.16)]"
                : "border-cyan-200/30 bg-cyan-300/10 text-cyan-50"
            }`}
          >
            <Wand2 size={18} />
            <span>
              <span className="block">{isWorking && aimixWorkflowPreset === "standard" ? "AIMIX analyzing..." : "AIMIX Standard"}</span>
              <span className="block text-[11px] font-normal text-cyan-100/75">通常はこちら。Balancedで安全に整えます</span>
            </span>
          </button>
          {referenceOptionsOpen ? (
            <>
          <button
            type="button"
            onClick={() => createProposal("reference")}
            disabled={isWorking || !referenceAnalysisReady}
            className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition disabled:opacity-45 ${
              aimixWorkflowPreset === "reference"
                ? "border-emerald-200/70 bg-emerald-300/22 text-emerald-50 shadow-[0_0_24px_rgba(110,231,183,0.16)]"
                : "border-emerald-200/35 bg-emerald-300/12 text-emerald-50"
            }`}
          >
            <Crosshair size={18} />
            <span>
              <span className="block">AIMIX Reference</span>
              <span className="block text-[11px] font-normal text-emerald-100/75">Reference WAVがある時の基本設定</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => createProposal("custom")}
            disabled={isWorking}
            className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition disabled:opacity-60 ${
              aimixWorkflowPreset === "custom"
                ? "border-sky-200/70 bg-sky-300/20 text-sky-50 shadow-[0_0_24px_rgba(125,211,252,0.14)]"
                : "border-white/10 bg-white/[0.04] text-slate-200"
            }`}
          >
            <SlidersHorizontal size={18} />
            <span>
              <span className="block">AIMIX Custom</span>
              <span className="block text-[11px] font-normal text-slate-300">手動モードを選んでから実行</span>
            </span>
          </button>
            </>
          ) : null}
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-relaxed text-slate-300">
          AIMIXはReference品質・音圧・帯域合わせを行います。Pan / Clip Pan / Spatial / Widthは後段のSpatialで調整します。
        </div>

        <AimixUnmaskMatrixPanel />

        {proposal ? (
          <div className="rounded-xl border border-white/10 bg-slate-900/80 p-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={previewBefore}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
                  activeAB === "before" ? "border-amber-300/70 bg-amber-300/15 text-amber-50" : "border-white/10 bg-white/[0.04] text-slate-200"
                }`}
              >
                Before
              </button>
              <button
                type="button"
                onClick={previewAfter}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold ${
                  activeAB === "after" ? "border-emerald-300/70 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-white/[0.04] text-slate-200"
                }`}
              >
                After
              </button>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <MetricCard title="Before" metrics={proposal.beforeMetrics} />
              <MetricCard title="After" metrics={proposal.afterMetrics} />
            </div>

            <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] p-3 text-xs text-cyan-50">
              <div className="font-black uppercase tracking-[0.14em] text-cyan-200/80">Final Output Trim</div>
              <div className="mt-1 text-sm font-semibold">
                {(proposal.after.master.finalOutputTrimDb ?? 0).toFixed(2)} dB
                {proposal.after.master.finalOutputTrimOwner ? ` / ${proposal.after.master.finalOutputTrimOwner}` : ""}
              </div>
              <p className="mt-1 leading-relaxed text-cyan-100/75">
                Referenceの音量合わせはMaster gainではなく、master処理後の最終段で行います。コンプやリミッターの入力バランスを不用意に変えないための安全設定です。
              </p>
            </div>

            {proposal.vocalClarityGate ? <VocalClarityGateCard report={proposal.vocalClarityGate} /> : null}

            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Info size={15} />
                AIMIX判断ログ
              </div>
              <ul className="space-y-1 text-xs leading-relaxed text-slate-300">
                {proposal.decisions.slice(0, 12).map((decision, index) => (
                  <li key={`${decision}-${index}`}>・{decision}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Activity size={16} />
          手動微調整
        </div>
        <SliderRow
          label="Bass整理"
          value={adjustments.bassTrimDb}
          min={-2}
          max={1}
          step={0.1}
          unit="dB"
          onChange={(value) => setAdjustments((current) => ({ ...current, bassTrimDb: value }))}
        />
        <SliderRow
          label="こもり整理"
          value={adjustments.bodyDb}
          min={-2}
          max={1}
          step={0.1}
          unit="dB"
          onChange={(value) => setAdjustments((current) => ({ ...current, bodyDb: value }))}
        />
        <SliderRow
          label="輪郭"
          value={adjustments.presenceDb}
          min={-1}
          max={1.2}
          step={0.1}
          unit="dB"
          onChange={(value) => setAdjustments((current) => ({ ...current, presenceDb: value }))}
        />
        <SliderRow
          label="横幅"
          value={adjustments.width}
          min={-0.2}
          max={0.35}
          step={0.01}
          unit=""
          onChange={(value) => setAdjustments((current) => ({ ...current, width: value }))}
        />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={fixProposal}
          disabled={!proposal}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-300/50 bg-emerald-400/15 px-3 py-2 text-sm font-semibold text-emerald-50 disabled:opacity-50"
        >
          <Check size={17} />
          FIXする
        </button>
        <button
          type="button"
          onClick={restoreBefore}
          disabled={!proposal}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 disabled:opacity-50"
        >
          <RotateCcw size={17} />
          Beforeへ戻す
        </button>
      </div>

      </>
      ) : null}

      {isMasteringSection ? (
        <>
          <div className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/[0.07] p-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-fuchsia-200/75">
              <ShieldCheck size={15} />
              Mastering
            </div>
            <h3 className="mt-1 text-xl font-semibold">Mastering</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">
              最終ミックスの音圧・質感・ピークを整えます。AIMIXでバランスを整え、Spatialで定位を作った後の仕上げ工程です。
            </p>
          </div>

      <div className="mt-3 rounded-xl border border-fuchsia-300/20 bg-black/25 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <ShieldCheck size={16} />
              Magic Polish
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              現在のミックスに、最終的な音圧、質感、ピーク管理を適用します。Referenceは目標として使い、Reference音声自体をミックスへ混ぜません。
            </p>
          </div>
          <div className="rounded-lg border border-fuchsia-300/20 bg-fuchsia-400/10 px-2 py-1 text-[11px] font-semibold text-fuchsia-100">
            {currentMagicTarget ? formatTargetLufs(currentMagicTarget) : targetPreset === "reference" && referenceTracks.length > 0 ? "Reference解析" : "Reference待ち"}
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-fuchsia-300/15 bg-fuchsia-300/[0.06] p-3 text-xs leading-relaxed text-slate-300">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="font-black text-fuchsia-100">Default mastering:</span> Light Master with the standard streaming target.
              Reference Catch-Up and custom targets are optional after Reference analysis.
            </div>
            <button
              type="button"
              disabled={!referenceAnalysisReady}
              onClick={() => setReferenceOptionsOpen((open) => !open)}
              className={`min-h-10 rounded-xl border px-3 py-2 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${
                referenceOptionsOpen
                  ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50"
                  : "border-white/10 bg-slate-900/80 text-slate-200"
              }`}
            >
              Reference / Advanced {referenceOptionsOpen ? "ON" : "OFF"}
            </button>
          </div>
          {!referenceAnalysisReady ? (
            <div className="mt-2 text-[11px] text-slate-400">
              Advanced mastering choices unlock after a Reference mix has been analyzed.
            </div>
          ) : null}
        </div>

        <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.05] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
                <Sparkles size={16} />
                AIMIX Glow
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                A vocal-keyed enhancer after AIMIX and before Mastering. Vocal tracks drive the sidechain when available; otherwise it uses a gentle mix-only fallback.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAimixGlowSettings((current) => ({ ...current, enabled: !current.enabled }));
                setAimixGlowReport(null);
              }}
              className={"min-h-10 rounded-xl border px-3 py-2 text-xs font-black " + (aimixGlowSettings.enabled ? "border-cyan-300/70 bg-cyan-300/20 text-cyan-50" : "border-white/10 bg-slate-900 text-slate-300")}
            >
              {aimixGlowSettings.enabled ? "ON" : "OFF"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {AIMIX_GLOW_PRESET_ORDER.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => selectAimixGlowPreset(preset)}
                className={"min-h-12 rounded-xl border px-2 py-2 text-left text-xs font-semibold transition " + (aimixGlowSettings.preset === preset ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-slate-900 text-slate-300")}
              >
                <span className="block">{AIMIX_GLOW_PRESETS[preset].label}</span>
                <span className="mt-1 block text-[10px] font-normal leading-relaxed text-slate-400">{AIMIX_GLOW_PRESETS[preset].description}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SliderRow label="Amount" value={aimixGlowSettings.amount} min={0} max={100} step={1} unit="" onChange={(value) => updateAimixGlowCustom({ amount: value })} />
            <SliderRow label="Vocal Key" value={aimixGlowSettings.vocalKey} min={0} max={100} step={1} unit="" onChange={(value) => updateAimixGlowCustom({ vocalKey: value })} />
            <SliderRow label="Recover" value={aimixGlowSettings.recover} min={0} max={100} step={1} unit="" onChange={(value) => updateAimixGlowCustom({ recover: value })} />
            <SliderRow label="Gloss" value={aimixGlowSettings.gloss} min={0} max={100} step={1} unit="" onChange={(value) => updateAimixGlowCustom({ gloss: value })} />
            <SliderRow label="Air" value={aimixGlowSettings.air} min={0} max={100} step={1} unit="" onChange={(value) => updateAimixGlowCustom({ air: value })} />
            <SliderRow label="Tame" value={aimixGlowSettings.tame} min={0} max={100} step={1} unit="" onChange={(value) => updateAimixGlowCustom({ tame: value })} />
          </div>
          <button
            type="button"
            onClick={() => setAimixGlowSettings((current) => ({ ...current, outputMatch: !current.outputMatch }))}
            className={"mt-3 min-h-10 w-full rounded-xl border px-3 py-2 text-left text-xs font-semibold " + (aimixGlowSettings.outputMatch ? "border-emerald-300/50 bg-emerald-300/12 text-emerald-50" : "border-white/10 bg-slate-900 text-slate-300")}
          >
            Output Match {aimixGlowSettings.outputMatch ? "ON" : "OFF"} / Preset: {currentAimixGlowPresetLabel} / Vocal Key: {aimixGlowVocalTrackCount > 0 ? aimixGlowVocalTrackCount + " vocal track" : "mix-only fallback"}
          </button>
          {aimixGlowReport ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
              <div className="mb-2 text-xs font-black uppercase tracking-wider text-cyan-100">AIMIX Glow A/B</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricLine label="LUFS" value={aimixGlowReport.before.inputLufsApprox.toFixed(1) + " -> " + aimixGlowReport.after.inputLufsApprox.toFixed(1)} />
                <MetricLine label="True Peak" value={aimixGlowReport.before.inputTruePeakDb.toFixed(1) + " -> " + aimixGlowReport.after.inputTruePeakDb.toFixed(1)} />
                <MetricLine label="Output Match" value={formatDb(aimixGlowReport.outputMatchGainDb)} />
                <MetricLine label="Vocal" value={aimixGlowReport.vocalSource === "vocal" ? "sidechain" : "fallback"} />
                <MetricLine label="Presence" value={formatPercentChange(aimixGlowReport.before.presenceDeficit, aimixGlowReport.after.presenceDeficit)} />
                <MetricLine label="Air" value={formatPercentChange(aimixGlowReport.before.airDeficit, aimixGlowReport.after.airDeficit)} />
                <MetricLine label="Fake Air" value={formatPercentChange(aimixGlowReport.before.fakeAirRisk, aimixGlowReport.after.fakeAirRisk)} />
                <MetricLine label="Harsh Risk" value={formatPercentChange(aimixGlowReport.before.harshnessRisk, aimixGlowReport.after.harshnessRisk)} />
              </div>
              <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-300">
                {aimixGlowReport.actions.slice(0, 5).map((action, index) => <div key={action + "-" + index}>- {action}</div>)}
                {aimixGlowReport.warnings.slice(0, 2).map((warning, index) => <div key={warning + "-" + index} className="text-amber-100">- {warning}</div>)}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {singleFileModeOptionsForUi.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => selectSingleFileMode(option.id)}
              className={`min-h-14 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                singleFileMode === option.id ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900 text-slate-300"
              }`}
            >
              <span className="block">{option.label}</span>
              <span className="mt-1 block text-[10px] font-normal leading-relaxed text-slate-400">{option.description}</span>
            </button>
          ))}
        </div>

        {isSingleFileMasteringMode ? (
          <div className="mt-3 rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/[0.04] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-fuchsia-100">Single File Mastering</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Render the current mix, process it as one stereo file, then A/B or export the processed WAV.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  Referenceは任意です。Light Master / Loudness Only / Loud Release は通常stemだけで使えます。Reference Catch-Upだけは解析済みReferenceが必要です。
                </p>
              </div>
              <div className="grid gap-2 text-right">
                <div className="rounded-lg border border-fuchsia-300/20 bg-fuchsia-400/10 px-2 py-1 text-[11px] font-semibold text-fuchsia-100">
                  {currentSingleFileSettings.targetLufs.toFixed(1)} LUFS / {currentSingleFileSettings.truePeakCeilingDb.toFixed(1)} dBTP
                </div>
                <button
                  type="button"
                  onClick={resetSingleFileSettingsToPreset}
                  className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-200"
                >
                  Reset to Preset
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SINGLE_FILE_STAGE_LABELS.map((stage) => {
                const forcedOff = singleFileMode === "loudnessOnly" && !["targetLoudness", "truePeakLimiter"].includes(stage.key);
                const active = currentSingleFileSettings.stages[stage.key];
                return (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => {
                      if (singleFileMode === "loudnessOnly") return;
                      updateSingleFileStages((current) => ({ ...current, [stage.key]: !current[stage.key] }));
                    }}
                    disabled={singleFileMode === "loudnessOnly"}
                    className={`min-h-11 rounded-xl border px-2 py-2 text-xs font-semibold disabled:opacity-60 ${
                      active && !forcedOff ? "border-emerald-300/60 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-slate-900 text-slate-400"
                    }`}
                  >
                    {stage.label} {active && !forcedOff ? "ON" : "OFF"}
                  </button>
                );
              })}
            </div>

            <MasteringConflictGuardCard guard={masteringConflictGuard} settings={currentSingleFileSettings} />

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-200">Target Loudness</div>
                <div className="grid grid-cols-5 gap-1">
                  {SINGLE_FILE_TARGET_LUFS_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateSingleFileTargetLufs(value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                        singleFileTargetLufs === value ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900 text-slate-300"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <SliderRow label="Custom LUFS" value={singleFileTargetLufs} min={-20} max={-6} step={0.1} unit=" LUFS" onChange={updateSingleFileTargetLufs} />
                <label className="mt-2 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Target LUFS number
                  <input
                    type="number"
                    min={-24}
                    max={-6}
                    step={0.1}
                    value={singleFileTargetLufs}
                    onChange={(event) => updateSingleFileTargetLufs(Number(event.currentTarget.value))}
                    className="mt-1 min-h-10 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-fuchsia-300/60"
                  />
                </label>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  Target Loudness is used by Analyze Only, Render Processed Master, and Polish & Export.
                  {singleFileManualTargetDirty ? " Manual target active." : ""}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-200">True Peak Ceiling</div>
                <div className="grid grid-cols-3 gap-1">
                  {SINGLE_FILE_TRUE_PEAK_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateSingleFileTruePeakCeilingDb(value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                        singleFileTruePeakCeilingDb === value ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900 text-slate-300"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <SliderRow label="Custom Ceiling" value={singleFileTruePeakCeilingDb} min={-6} max={-1} step={0.1} unit=" dBTP" onChange={updateSingleFileTruePeakCeilingDb} />
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-200">Safety HPF</div>
                <div className="grid grid-cols-3 gap-1">
                  {SINGLE_FILE_HPF_OPTIONS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateSingleFileHpfHz(value)}
                      disabled={singleFileMode === "loudnessOnly"}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold disabled:opacity-50 ${
                        singleFileHpfHz === value ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900 text-slate-300"
                      }`}
                    >
                      {value === 0 ? "OFF" : `${value}Hz`}
                    </button>
                  ))}
                </div>
                <SliderRow label="Custom HPF" value={singleFileHpfHz} min={0} max={180} step={1} unit=" Hz" onChange={updateSingleFileHpfHz} />
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <SliderRow
                  label="Harshness Amount"
                  value={singleFileHarshnessAmount}
                  min={0}
                  max={1}
                  step={0.01}
                  unit=""
                  onChange={updateSingleFileHarshnessAmount}
                />
                <SliderRow
                  label="Artifact Guard"
                  value={singleFileArtifactGuardAmount}
                  min={0}
                  max={1}
                  step={0.01}
                  unit=""
                  onChange={updateSingleFileArtifactGuardAmount}
                />
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Hiss / metallic / AI high grainを検出した時だけ、Mastering前段で軽く抑えます。既存De-Esserで足りる刺さりはHarshness側に任せます。
                </p>
                {singleFileMode === "loudRelease" ? (
                  <p className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">
                    Loud Release can reduce dynamics. Check limiter GR before export.
                  </p>
                ) : null}
                {singleFileMode === "loudnessOnly" ? (
                  <p className="rounded-lg border border-sky-300/25 bg-sky-300/10 px-2 py-1 text-xs text-sky-100">
                    Loudness Only ignores HPF, tone cleanup, harshness guard, artifact guard, and glue compression.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {isSingleFileMasteringMode ? <PeakCulpritReportCard items={peakCulpritReport} /> : null}

        {!isSingleFileMasteringMode ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {magicPolishTargetOrderForUi.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setTargetPreset(preset)}
              className={`min-h-11 rounded-xl border px-2 py-2 text-xs font-semibold transition ${
                targetPreset === preset ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900 text-slate-300"
              }`}
            >
              {MAGIC_POLISH_TARGETS[preset].label}
            </button>
          ))}
        </div>
        ) : null}

        {!isSingleFileMasteringMode ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["safe", "balanced", "loud"] as MagicPolishMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFinalMode(mode)}
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                finalMode === mode ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900 text-slate-300"
              }`}
            >
              {FINAL_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        ) : null}

        {!isSingleFileMasteringMode && targetPreset === "reference" ? (
          <div className="mt-3 rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/[0.04] p-3">
            <div className="mb-2 text-xs font-black uppercase tracking-wider text-fuchsia-100">Reference Gain</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {REFERENCE_GAIN_MODE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setReferenceGainMode(option.id)}
                  className={`min-h-12 rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                    referenceGainMode === option.id ? "border-fuchsia-300/70 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900 text-slate-300"
                  }`}
                >
                  <span className="block">{option.label}</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">{option.description}</span>
                </button>
              ))}
            </div>
            {referenceGainMode === "manual" ? (
              <div className="mt-2">
                <SliderRow
                  label="Reference Trim"
                  value={referenceGainTrimDb}
                  min={-6}
                  max={6}
                  step={0.1}
                  unit=" dB"
                  onChange={setReferenceGainTrimDb}
                />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setReferenceHardLimit((value) => !value)}
              className={`mt-3 flex min-h-12 w-full items-start gap-3 rounded-xl border px-3 py-2 text-left text-xs transition ${
                referenceHardLimit ? "border-amber-300/60 bg-amber-300/15 text-amber-50" : "border-white/10 bg-slate-900 text-slate-300"
              }`}
            >
              <span className="mt-0.5 rounded-full border border-current p-1">
                {referenceHardLimit ? <Check size={13} /> : <ShieldCheck size={13} />}
              </span>
              <span>
                <span className="block font-black">Safety Limiter {referenceHardLimit ? "ON" : "OFF"}</span>
                <span className="mt-1 block leading-relaxed text-slate-400">
                  OFFではReferenceのLUFS・帯域・空間・密度へ追従し、Peak Normalizeは強制しません。ONでは-1.0dBTP目標の安全リミッターだけを有効にします。
                </span>
              </span>
            </button>
          </div>
        ) : null}

        {!isSingleFileMasteringMode && targetPreset === "custom" ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <SliderRow
                label="Target LUFS"
                value={customTargetIntegratedLufs}
                min={-20}
                max={-8}
                step={0.1}
                unit=" LUFS"
                onChange={setCustomTargetIntegratedLufs}
              />
              <SliderRow
                label="True Peak Ceiling"
                value={customTruePeakCeilingDb}
                min={-3}
                max={-0.3}
                step={0.1}
                unit=" dBTP"
                onChange={setCustomTruePeakCeilingDb}
              />
              <SliderRow
                label="Tonal Match"
                value={customTonalMatchStrength}
                min={0}
                max={1}
                step={0.01}
                unit=""
                onChange={setCustomTonalMatchStrength}
              />
              <SliderRow
                label="Spatial Amount"
                value={customSpatialMatchStrength}
                min={0}
                max={1}
                step={0.01}
                unit=""
                onChange={setCustomSpatialMatchStrength}
              />
              <SliderRow
                label="Density Amount"
                value={customDensityMatchStrength}
                min={0}
                max={1}
                step={0.01}
                unit=""
                onChange={setCustomDensityMatchStrength}
              />
            </div>
          </div>
        ) : null}
        {!isSingleFileMasteringMode ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
          <p className="text-xs leading-relaxed text-slate-400">
            {currentMagicTarget
              ? `${currentMagicTarget.label}: ${currentMagicTarget.notes} / Safety Limiter ${currentMagicTarget.hardLimitEnabled ? `${currentMagicTarget.truePeakCeilingDb.toFixed(currentMagicTarget.exactReferenceGain ? 2 : 1)} dBTP` : "OFF"}`
              : "Reference目標を使うには、FilesでReference Mixを読み込んでからAIMIX提案または解析を実行してください。"}
          </p>
          {currentMagicTarget?.exactReferenceGain ? (
            <p className="mt-2 rounded-lg border border-fuchsia-300/25 bg-fuchsia-300/10 px-2 py-1 text-xs text-fuchsia-100">
              Reference追従中: LUFS・帯域・空間・密度を安全範囲で反映します。Safety Limiter OFFではPeak Normalizeを強制しません。
            </p>
          ) : null}
          {currentMagicTarget?.warning ? (
            <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">{currentMagicTarget.warning}</p>
          ) : null}
          {magicReferenceStatusTextReadable ? (
            <p className={`mt-2 rounded-lg border px-2 py-1 text-xs ${
              currentMagicTarget ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" : "border-amber-300/25 bg-amber-300/10 text-amber-100"
            }`}>
              {magicReferenceStatusTextReadable}
            </p>
          ) : null}
        </div>
        ) : null}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={analyzeSingleFileMagicPolish}
            disabled={singleFileIsWorking || (isSingleFileMasteringMode && !canRunSingleFileMastering) || (!isSingleFileMasteringMode && magicPolishReferenceMissing)}
            className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 disabled:opacity-50"
          >
            {singleFileIsWorking ? "Processing..." : isSingleFileMasteringMode ? "Analyze Only" : "Before / Target / After"}
          </button>
          <button
            type="button"
            onClick={applySingleFileMagicPolish}
            disabled={singleFileIsWorking || (isSingleFileMasteringMode && !canRunSingleFileMastering) || (!isSingleFileMasteringMode && magicPolishReferenceMissing)}
            className="min-h-11 rounded-xl border border-fuchsia-300/50 bg-fuchsia-400/15 px-3 py-2 text-sm font-semibold text-fuchsia-50 disabled:opacity-50"
          >
            {isSingleFileMasteringMode ? "Render Processed Master" : "Apply Magic Polish"}
          </button>
        </div>

        {isSingleFileMasteringMode ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => playSingleFileAudition("original")}
              disabled={!singleFileOriginalRef.current}
              className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                singleFileAudition === "original" ? "border-amber-300/70 bg-amber-300/15 text-amber-50" : "border-white/10 bg-slate-900 text-slate-200"
              }`}
            >
              A: Original Preview
            </button>
            <button
              type="button"
              onClick={() => playSingleFileAudition("processed")}
              disabled={!singleFileProcessedRef.current}
              className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                singleFileAudition === "processed" ? "border-emerald-300/70 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-slate-900 text-slate-200"
              }`}
            >
              B: Processed Preview
            </button>
            <button
              type="button"
              onClick={exportSingleFileProcessedWav}
              disabled={!canRunSingleFileMastering}
              className="min-h-11 rounded-xl border border-cyan-300/50 bg-cyan-400/15 px-3 py-2 text-sm font-semibold text-cyan-50 disabled:opacity-50"
            >
              {singleFileExportButtonLabel}
            </button>
            {singleFileExportDisabledReason ? (
              <p className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs leading-relaxed text-amber-100 sm:col-span-3">
                {singleFileExportDisabledReason}
              </p>
            ) : !singleFileProcessedRef.current ? (
              <p className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs leading-relaxed text-cyan-100 sm:col-span-3">
                No processed buffer yet. Press Polish & Export Processed WAV to render, master, and export in one step.
              </p>
            ) : null}
            {singleFileAudition ? (
              <button
                type="button"
                onClick={stopSingleFileAudition}
                className="min-h-11 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 sm:col-span-3"
              >
                Stop A/B Playback
              </button>
            ) : null}
          </div>
        ) : null}

        {isSingleFileMasteringMode && singleFileReport ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <SingleFileMasteringMetricCard title="Before" metrics={singleFileReport.before} />
              <div className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/10 p-3 text-xs text-fuchsia-50">
                <div className="font-black uppercase tracking-wider">
                  {SINGLE_FILE_MASTERING_MODE_PRESETS[singleFileMode as Exclude<SingleFileMasteringMode, "existing">]?.label}
                </div>
                <div className="mt-2 space-y-1 text-slate-200">
                  <div>Limiter GR: {singleFileReport.limiterGainReductionDb.toFixed(1)} dB</div>
                  <div>Glue GR: {singleFileReport.glueGainReductionDb.toFixed(1)} dB</div>
                  <div>Channels: {singleFileReport.after.channels}</div>
                  <div>Duration: {singleFileReport.after.durationSec.toFixed(2)} sec</div>
                </div>
              </div>
              <SingleFileMasteringMetricCard title="After" metrics={singleFileReport.after} />
            </div>
            <div className="mt-3 grid gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 text-xs text-slate-200 sm:grid-cols-4">
              <MetricLine label="Requested TP" value={`${singleFileReport.exportSafetyReport.requestedTruePeakCeilingDbtp.toFixed(2)} dBTP`} />
              <MetricLine label="Measured TP" value={`${singleFileReport.exportSafetyReport.measuredFinalTruePeakDbtp.toFixed(2)} dBTP`} />
              <MetricLine label="TP Safety Trim" value={`${singleFileReport.exportSafetyReport.truePeakSafetyTrimDb.toFixed(2)} dB`} />
              <MetricLine label="TP Ceiling" value={singleFileReport.exportSafetyReport.truePeakCeilingReached ? "OK" : "NG"} />
              <MetricLine label="Headroom Mode" value={singleFileReport.exportSafetyReport.headroomMode} />
              <MetricLine label="Headroom Trim" value={`${singleFileReport.exportSafetyReport.appliedHeadroomTrimDb.toFixed(2)} dB`} />
              <MetricLine label="Pre Peak" value={singleFileReport.exportSafetyReport.measuredPreMasterPeakBeforeDbfs == null ? "-" : `${singleFileReport.exportSafetyReport.measuredPreMasterPeakBeforeDbfs.toFixed(2)} dBFS`} />
              <MetricLine label="After Headroom" value={singleFileReport.exportSafetyReport.measuredPreMasterPeakAfterDbfs == null ? "-" : `${singleFileReport.exportSafetyReport.measuredPreMasterPeakAfterDbfs.toFixed(2)} dBFS`} />
            </div>
            {singleFileReport.targetReport ? (
              <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.06] p-3 text-xs text-slate-200">
                <div className="mb-2 font-black uppercase tracking-wider text-emerald-100">Target Authority</div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <MetricLine label="Requested LUFS" value={`${singleFileReport.targetReport.requestedTargetLufs.toFixed(1)} LUFS`} />
                  <MetricLine label="Effective LUFS" value={`${singleFileReport.targetReport.effectiveTargetLufs.toFixed(1)} LUFS`} />
                  <MetricLine label="Source" value={singleFileReport.targetReport.targetLufsSource.toUpperCase()} />
                  <MetricLine label="Reference LUFS" value={singleFileReport.targetReport.referenceTargetLufs == null ? "-" : `${singleFileReport.targetReport.referenceTargetLufs.toFixed(1)} LUFS`} />
                  <MetricLine label="Final LUFS" value={`${singleFileReport.targetReport.afterLufs.toFixed(1)} LUFS`} />
                  <MetricLine label="Overshoot" value={`${singleFileReport.targetReport.overshootLu.toFixed(2)} LU`} />
                  <MetricLine label="Final Trim" value={`${singleFileReport.targetReport.finalTrimDb.toFixed(2)} dB`} />
                  <MetricLine label="PLR" value={`${singleFileReport.targetReport.plrDb.toFixed(1)} / ${singleFileReport.targetReport.minPlrDb.toFixed(1)} dB`} />
                </div>
              </div>
            ) : null}
            {singleFileReport.referenceCatchUpGuardReport ? (
              <div className="mt-3 rounded-xl border border-fuchsia-300/20 bg-fuchsia-400/[0.08] p-3 text-xs text-slate-200">
                <div className="mb-2 font-black uppercase tracking-wider text-fuchsia-100">Reference Catch-Up Guard</div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <MetricLine label="Requested" value={`${singleFileReport.referenceCatchUpGuardReport.requestedPushDb.toFixed(2)} dB`} />
                  <MetricLine label="Applied" value={`${singleFileReport.referenceCatchUpGuardReport.appliedPushDb.toFixed(2)} dB`} />
                  <MetricLine label="Held Back" value={`${singleFileReport.referenceCatchUpGuardReport.heldBackDb.toFixed(2)} dB`} />
                  <MetricLine label="Limiter GR" value={`${singleFileReport.referenceCatchUpGuardReport.limiterGainReductionDb.toFixed(2)} / ${singleFileReport.referenceCatchUpGuardReport.targetLimiterBudgetDb.toFixed(2)} dB`} />
                  <MetricLine label="Presence" value={`${singleFileReport.referenceCatchUpGuardReport.presenceLiftDb.toFixed(2)} dB`} />
                  <MetricLine label="Clarity" value={`${singleFileReport.referenceCatchUpGuardReport.clarityDb.toFixed(2)} dB`} />
                  <MetricLine label="Air" value={`${singleFileReport.referenceCatchUpGuardReport.airDb.toFixed(2)} dB`} />
                  <MetricLine label="Sheen" value={`${singleFileReport.referenceCatchUpGuardReport.sheenDb.toFixed(2)} dB`} />
                  <MetricLine label="Density" value={`${Math.round(singleFileReport.referenceCatchUpGuardReport.densityAmount * 100)}%`} />
                </div>
                {singleFileReport.referenceCatchUpGuardReport.warnings.length > 0 ? (
                  <div className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-amber-100">
                    {singleFileReport.referenceCatchUpGuardReport.warnings.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-emerald-100">
                    Catch-Up guard stayed within the transparent budget.
                  </p>
                )}
              </div>
            ) : null}
            {singleFileReport.exportSafetyReport.targetLufsLimitedByTruePeak ? (
              <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">
                Target loudness was held back by TRUE PEAK CEILING.
              </p>
            ) : null}
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-300">
              {singleFileReport.actions.map((action) => (
                <li key={action}>- {action}</li>
              ))}
            </ul>
            {singleFileReport.warnings.length > 0 ? (
              <div className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">
                {singleFileReport.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-xs text-emerald-100">
                Safety check passed. Estimated TP is under the selected ceiling.
              </p>
            )}
          </div>
        ) : null}

        {!isSingleFileMasteringMode && magicPolishReport ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/70 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <MagicPolishMeterCard title="Before" meter={magicPolishReport.before} />
              <MagicPolishTargetCard target={magicPolishReport.target} />
              <MagicPolishMeterCard title="After" meter={magicPolishReport.after} />
            </div>
            <ul className="mt-3 space-y-1 text-xs leading-relaxed text-slate-300">
              {magicPolishReport.actions.map((action) => (
                <li key={action}>・{action}</li>
              ))}
            </ul>
            {magicPolishReport.warning ? (
              <p className="mt-2 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">{magicPolishReport.warning}</p>
            ) : null}
          </div>
        ) : null}
      </div>
        </>
      ) : null}

      {singleFileIsWorking && singleFileProgress ? (
        <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-2xl border border-cyan-300/30 bg-slate-950/95 p-4 shadow-2xl shadow-cyan-950/40">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                  Sweet DAW
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">{singleFileProgress.title}</h3>
              </div>
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 text-sm font-semibold text-cyan-50">
                {Math.round(Math.min(100, Math.max(0, singleFileProgress.percent)))}%
              </div>
            </div>
            <p className="mt-3 text-sm font-medium text-slate-100">{singleFileProgress.label}</p>
            {singleFileProgress.detail ? (
              <p className="mt-1 text-xs leading-relaxed text-slate-300">{singleFileProgress.detail}</p>
            ) : null}
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-300 to-emerald-300 transition-[width] duration-300"
                style={{ width: `${Math.min(100, Math.max(3, singleFileProgress.percent))}%` }}
              />
            </div>
            <p className="mt-3 text-[0.68rem] leading-relaxed text-slate-400">
              Keep this tab open while Sweet DAW renders audio. Long songs may take a little time on mobile Safari.
            </p>
          </div>
        </div>
      ) : null}

      {toastMsg ? (
        <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-50">
          {toastMsg}
        </div>
      ) : null}
    </section>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span className="font-mono text-slate-100">
          {value.toFixed(step < 0.1 ? 2 : 1)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="w-full accent-cyan-300"
      />
    </label>
  );
}

function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-slate-200">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-5 w-5 accent-cyan-300"
      />
    </label>
  );
}

function TargetProfileDeltaCard({
  profiles,
  profileId,
  targetProfile,
  report,
  aimixHints,
  onProfileChange,
  onApplyAimix,
  onApplyMaster,
}: {
  profiles: SweetMasterTargetProfile[];
  profileId: SweetMasterTargetProfileId;
  targetProfile: SweetMasterTargetProfile;
  report: SweetReferenceDeltaReport | null;
  aimixHints: ReturnType<typeof toAimixReferenceDeltaHints>;
  onProfileChange: (id: SweetMasterTargetProfileId) => void;
  onApplyAimix: () => void;
  onApplyMaster: () => void;
}) {
  const visibleBands = (report?.bands ?? [])
    .filter((band) => Math.abs(band.boundedDeltaDb) >= 0.05)
    .sort((a, b) => Math.abs(b.boundedDeltaDb) - Math.abs(a.boundedDeltaDb))
    .slice(0, 6);
  const confidence = report ? Math.round(averageNumber(report.bands.map((band) => band.confidence)) * 100) : 0;

  return (
    <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-black uppercase tracking-wider text-cyan-100">Target Profile / Bounded Delta</div>
          <p className="mt-1 leading-relaxed text-slate-300">
            Referenceを100%一致ではなく、安全上限付きの提案としてAIMIXとMagic Polishへ渡します。
          </p>
        </div>
        <span className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-2 py-1 font-black text-cyan-50">
          {report ? `${confidence}%` : "待機"}
        </span>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-300">Target Profile</span>
        <select
          value={profileId}
          onChange={(event) => onProfileChange(event.currentTarget.value as SweetMasterTargetProfileId)}
          className="min-h-10 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none"
        >
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.label}</option>
          ))}
        </select>
      </label>

      <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-2 text-slate-300">
        <div className="font-semibold text-slate-100">{targetProfile.label}</div>
        <p className="mt-1 leading-relaxed">{targetProfile.description}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MetricLine label="LUFS目安" value={`${targetProfile.targetLufsApprox.toFixed(1)}`} />
          <MetricLine label="Ceiling" value={`${targetProfile.ceilingDbTpEstimate.toFixed(1)}dBTP`} />
          <MetricLine label="Max Delta" value={`${targetProfile.maxReferenceDeltaDb.toFixed(1)}dB`} />
          <MetricLine label="High Boost上限" value={`${targetProfile.maxHighBoostDb.toFixed(1)}dB`} />
        </div>
      </div>

      {report ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MetricLine label="Bass Delta" value={formatDb(aimixHints.bassWeightDeltaDb)} />
            <MetricLine label="Presence Delta" value={formatDb(aimixHints.vocalPresenceDeltaDb)} />
            <MetricLine label="Air Delta" value={formatDb(aimixHints.airDeltaDb)} />
            <MetricLine label="Reduction上限" value={formatDb(-aimixHints.maxProposalReductionDb)} />
          </div>
          <div className="mt-3 space-y-1">
            {visibleBands.length > 0 ? visibleBands.map((band) => (
              <div key={band.bandId} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/70 px-2 py-1.5">
                <span className="text-slate-300">{band.bandId} / {band.centerHz}Hz</span>
                <span className="font-mono text-cyan-50">{formatDb(band.boundedDeltaDb)} bounded</span>
              </div>
            )) : (
              <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2 py-1.5 text-emerald-100">
                大きなReference差分はありません。提案は控えめで十分です。
              </div>
            )}
          </div>
          {report.warnings.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-amber-100">
              {report.warnings.slice(0, 3).map((warning, index) => <li key={index}>- {warning}</li>)}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-3 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1.5 text-amber-100">
          Reference Deltaは未生成です。Referenceを読み込み、AIMIX解析を実行すると表示されます。
        </p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onApplyAimix}
          disabled={!report}
          className="min-h-10 rounded-xl border border-cyan-300/40 bg-cyan-300/12 px-3 py-2 text-xs font-semibold text-cyan-50 disabled:opacity-45"
        >
          Apply to AIMIX Proposal
        </button>
        <button
          type="button"
          onClick={onApplyMaster}
          className="min-h-10 rounded-xl border border-fuchsia-300/40 bg-fuchsia-300/12 px-3 py-2 text-xs font-semibold text-fuchsia-50"
        >
          Apply to Master Polish
        </button>
      </div>
    </div>
  );
}
function MetricCard({ title, metrics }: { title: string; metrics: AiMixMetrics }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
      <div className="mb-2 font-semibold text-slate-100">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <MetricLine label="Peak" value={`${metrics.peakDb.toFixed(1)}dB`} />
        <MetricLine label="RMS" value={`${metrics.rmsDb.toFixed(1)}dB`} />
        <MetricLine label="Crest" value={`${metrics.crestDb.toFixed(1)}dB`} />
        <MetricLine label="Width" value={`${metrics.width.toFixed(1)}dB`} />
      </div>
    </div>
  );
}

function VocalClarityGateCard({ report }: { report: VocalClarityGateReport }) {
  return (
    <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-cyan-50">Vocal Clarity Gate</span>
        <span className={"rounded-full border px-2 py-1 font-semibold " + gatePassedClass(report.passed)}>
          {report.passed ? "PASS" : "HOLD"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {report.items.map((item) => (
          <span
            key={item.id}
            className={"rounded-full border px-2 py-1 font-semibold " + gateStatusClass(item.status)}
            title={item.detail}
          >
            {item.label}: {item.status.toUpperCase()} {formatGateDelta(item.deltaDb)}
          </span>
        ))}
        <span className={"rounded-full border px-2 py-1 font-semibold " + stemAirLayerClass(report.stemAirLayer)}>
          Stem Air Layer: {report.stemAirLayer.toUpperCase()}
        </span>
      </div>
      {report.warnings.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed text-amber-100">
          {report.warnings.slice(0, 3).map((warning, index) => <li key={index}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function MagicPolishMeterCard({ title, meter }: { title: string; meter: MagicPolishMeter }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
      <div className="mb-2 font-semibold text-slate-100">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <MetricLine label="LUFS" value={formatLufs(meter.integratedLufs)} />
        <MetricLine label="TP" value={formatDb(meter.truePeakDb)} />
        <MetricLine label="RMS" value={formatDb(meter.rmsDb)} />
        <MetricLine label="Crest" value={formatDb(meter.crestDb)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <MetricLine label="LowMid" value={formatDb(meter.lowMidDb)} />
        <MetricLine label="Presence" value={formatDb(meter.presenceDb)} />
        <MetricLine label="Air" value={formatDb(meter.airDb)} />
        <MetricLine label="Width" value={formatDb(meter.widthDb)} />
      </div>
    </div>
  );
}

function MagicPolishTargetCard({ target }: { target: MagicPolishResolvedTarget }) {
  return (
    <div className="rounded-xl border border-fuchsia-300/20 bg-fuchsia-300/[0.06] p-3 text-xs">
      <div className="mb-2 font-semibold text-fuchsia-50">Target</div>
      <div className="grid grid-cols-2 gap-2">
        <MetricLine label="Preset" value={target.label} />
        <MetricLine label="LUFS" value={formatTargetLufs(target)} />
        <MetricLine label="Ceiling" value={target.hardLimitEnabled === false ? "OFF" : formatTargetDb(target.truePeakCeilingDb, target.exactReferenceGain)} />
        <MetricLine label="Safety Limiter" value={target.hardLimitEnabled === false ? "OFF" : "ON"} />
        <MetricLine label="Tonal" value={`${Math.round(target.tonalMatchStrength * 100)}%`} />
        <MetricLine label="Spatial" value={`${Math.round(target.spatialMatchStrength * 100)}%`} />
        <MetricLine label="Density" value={`${Math.round(target.densityMatchStrength * 100)}%`} />
      </div>
    </div>
  );
}

function SingleFileMasteringMetricCard({ title, metrics }: { title: string; metrics: SingleFileMasteringMetrics }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
      <div className="mb-2 font-semibold text-slate-100">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <MetricLine label="Peak" value={`${metrics.peakDb.toFixed(1)}dB`} />
        <MetricLine label="True Peak" value={`${metrics.estimatedTruePeakDb.toFixed(1)}dBTP`} />
        <MetricLine label="LUFS" value={`${metrics.estimatedLufs.toFixed(1)}`} />
        <MetricLine label="RMS" value={`${metrics.rmsDb.toFixed(1)}dB`} />
        <MetricLine label="Length" value={`${metrics.durationSec.toFixed(2)}s`} />
        <MetricLine label="Ch" value={`${metrics.channels}`} />
      </div>
    </div>
  );
}

function MasteringConflictGuardCard({ guard, settings }: { guard: MasteringConflictGuard; settings: SingleFileMasteringSettings }) {
  if (!guard.active) return null;
  return (
    <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-300/[0.08] p-3 text-xs text-cyan-50">
      <div className="mb-2 font-black uppercase tracking-wider">Glow / Mastering Conflict Guard</div>
      <p className="leading-relaxed text-slate-200">
        AIMIX GlowやVocal Clarity Gateで作った2〜10kHzの芯をMasteringで削り返さないよう、Tone CleanupとHarsh Guardを控えめにしています。
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricLine label="Tone Cleanup" value={`${Math.round(settings.toneCleanupAmount * 100)}%`} />
        <MetricLine label="Harsh Guard" value={`${Math.round(settings.harshnessAmount * 100)}%`} />
        <MetricLine label="Glow" value={guard.glowActive ? "active" : "off"} />
        <MetricLine label="2-10kHz" value={guard.clarityShortage ? "shortage" : "ok"} />
      </div>
      <ul className="mt-2 space-y-1 leading-relaxed text-slate-300">
        {guard.reasons.map((reason) => <li key={reason}>- {reason}</li>)}
      </ul>
    </div>
  );
}

function PeakCulpritReportCard({ items }: { items: PeakCulpritReportItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-black uppercase tracking-wider text-amber-100">Peak Culprit Report</span>
        <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-semibold text-amber-100">report only</span>
      </div>
      <p className="mb-2 leading-relaxed text-slate-300">
        LUFSを上げにくくしているピーク候補です。v1では自動処理せず、原因の見える化だけを行います。
      </p>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item.trackId} className="rounded-xl border border-white/10 bg-slate-950/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-100">{index + 1}. {item.trackName}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{item.role}</div>
              </div>
              <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-2 py-1 font-mono text-amber-100">
                +{item.peakRiskDb.toFixed(1)} risk
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <MetricLine label="Peak" value={formatDb(item.peakDb)} />
              <MetricLine label="RMS" value={formatDb(item.rmsDb)} />
              <MetricLine label="Crest" value={formatDb(item.crestDb)} />
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-slate-300">{item.suggestedAction}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/20 px-2 py-1">
      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="font-mono text-slate-100">{value}</div>
    </div>
  );
}

function measureProject(project: Project, waveformPeaks: Record<string, PeakSummary>): AiMixMetrics {
  const activeClips = project.clips.filter((clip) => {
    const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
    return track && !track.mute && track.role !== "reference";
  });
  if (activeClips.length === 0) {
    return emptyAiMixMetrics();
  }

  let peak = -60;
  const rmsValues: number[] = [];
  const lowValues: number[] = [];
  const lowMidValues: number[] = [];
  const presenceValues: number[] = [];
  const airValues: number[] = [];
  const widthValues: number[] = [];
  const sub2060Values: number[] = [];
  const low120250Values: number[] = [];
  const body250500Values: number[] = [];
  const mid5002000Values: number[] = [];
  const presence20005000Values: number[] = [];
  const air500010000Values: number[] = [];
  const ultraAir1000020000Values: number[] = [];

  for (const clip of activeClips) {
    const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
    const summary = waveformPeaks[clip.fileId];
    if (!track || !summary) continue;
    const gain = (track.gainDb ?? 0) + (clip.gainDb ?? 0) + (project.master.gainDb ?? 0);
    const clipPeak = Math.max(...summary.max.map((value) => Math.abs(value)), ...summary.min.map((value) => Math.abs(value)));
    peak = Math.max(peak, ampToDb(Math.max(clipPeak, 0.000001)) + gain);
    rmsValues.push(estimateSummaryRms(summary) + gain);
    lowValues.push(avgBands(summary, ["35-60", "60-120"]) + gain);
    lowMidValues.push(avgBands(summary, ["250-500", "500-900"]) + gain);
    presenceValues.push(avgBands(summary, ["1500-3000", "3000-5000"]) + gain);
    airValues.push(avgBands(summary, ["9000-12000", "12000-16000"]) + gain);
    widthValues.push(summary.sideMidRatioDb ?? -24);
    sub2060Values.push(avgBands(summary, ["20-35", "35-60"]) + gain);
    low120250Values.push(avgBands(summary, ["120-250"]) + gain);
    body250500Values.push(avgBands(summary, ["250-500"]) + gain);
    mid5002000Values.push(avgBands(summary, ["500-900", "900-1500", "1500-3000"]) + gain);
    presence20005000Values.push(avgBands(summary, ["1500-3000", "3000-5000"]) + gain);
    air500010000Values.push(avgBands(summary, ["5000-9000", "9000-12000"]) + gain);
    ultraAir1000020000Values.push(avgBands(summary, ["9000-12000", "12000-16000", "16000-20000"]) + gain);
  }

  if (rmsValues.length === 0) return emptyAiMixMetrics();

  const rms = averageDbAsPower(rmsValues);
  return {
    peakDb: round1(peak),
    rmsDb: round1(rms),
    crestDb: round1(Math.max(0, peak - rms)),
    low: round1(averageDbAsPower(lowValues)),
    lowMid: round1(averageDbAsPower(lowMidValues)),
    presence: round1(averageDbAsPower(presenceValues)),
    air: round1(averageDbAsPower(airValues)),
    width: round1(averageDb(widthValues)),
    sub2060: round1(averageDbAsPower(sub2060Values)),
    low120250: round1(averageDbAsPower(low120250Values)),
    body250500: round1(averageDbAsPower(body250500Values)),
    mid5002000: round1(averageDbAsPower(mid5002000Values)),
    presence20005000: round1(averageDbAsPower(presence20005000Values)),
    air500010000: round1(averageDbAsPower(air500010000Values)),
    ultraAir1000020000: round1(averageDbAsPower(ultraAir1000020000Values)),
  };
}

function emptyAiMixMetrics(): AiMixMetrics {
  return {
    peakDb: -60,
    rmsDb: -60,
    crestDb: 0,
    low: -60,
    lowMid: -60,
    presence: -60,
    air: -60,
    width: -24,
    sub2060: -60,
    low120250: -60,
    body250500: -60,
    mid5002000: -60,
    presence20005000: -60,
    air500010000: -60,
    ultraAir1000020000: -60,
  };
}

function measureAimixBandProfile(project: Project, waveformPeaks: Record<string, PeakSummary>): AimixBandProfile {
  const activeTracks = project.tracks.filter((track) => track.role !== "reference" && !track.mute);
  const profiles = activeTracks
    .map((track) => measureTrackBandProfile(project, track, waveformPeaks))
    .filter((profile): profile is AimixBandProfile => Boolean(profile));
  return averageAimixBandProfiles(profiles);
}

function measureTrackBandProfile(project: Project, track: Track, waveformPeaks: Record<string, PeakSummary>): AimixBandProfile | null {
  const clips = project.clips.filter((clip) => clip.trackId === track.id);
  const profiles: AimixBandProfile[] = [];
  for (const clip of clips) {
    const summary = waveformPeaks[clip.fileId];
    if (!summary) continue;
    const gain = (track.gainDb ?? 0) + (clip.gainDb ?? 0);
    profiles.push({
      lowMid120250: avgBands(summary, ["120-250"]) + gain,
      presence5000_10000: avgBands(summary, ["5000-9000", "9000-12000"]) + gain,
      air10000_16000: avgBands(summary, ["9000-12000", "12000-16000"]) + gain,
      ultra16000_20000: avgBands(summary, ["16000-20000"]) + gain,
      lrCorrelation: summary.lrCorrelation ?? 1,
      sideMidRatioDb: summary.sideMidRatioDb ?? -24,
      spectralFlatness: summary.spectralFlatness ?? 0,
    });
  }
  return profiles.length > 0 ? averageAimixBandProfiles(profiles) : null;
}

function averageAimixBandProfiles(profiles: AimixBandProfile[]): AimixBandProfile {
  if (profiles.length === 0) {
    return {
      lowMid120250: -60,
      presence5000_10000: -60,
      air10000_16000: -60,
      ultra16000_20000: -60,
      lrCorrelation: 1,
      sideMidRatioDb: -24,
      spectralFlatness: 0,
    };
  }

  return {
    lowMid120250: round1(averageDbAsPower(profiles.map((profile) => profile.lowMid120250))),
    presence5000_10000: round1(averageDbAsPower(profiles.map((profile) => profile.presence5000_10000))),
    air10000_16000: round1(averageDbAsPower(profiles.map((profile) => profile.air10000_16000))),
    ultra16000_20000: round1(averageDbAsPower(profiles.map((profile) => profile.ultra16000_20000))),
    lrCorrelation: round2(profiles.reduce((sum, profile) => sum + profile.lrCorrelation, 0) / profiles.length),
    sideMidRatioDb: round1(averageDbAsPower(profiles.map((profile) => profile.sideMidRatioDb))),
    spectralFlatness: round2(profiles.reduce((sum, profile) => sum + profile.spectralFlatness, 0) / profiles.length),
  };
}

function estimateArtifactScore(profile: AimixBandProfile, metrics: AiMixMetrics) {
  const highBandNoiseRatio = clamp01((profile.air10000_16000 - profile.presence5000_10000 + 10) / 24);
  const unstableStereoScore = profile.lrCorrelation < 0.45 ? clamp01((0.65 - profile.lrCorrelation) / 0.65) : 0;
  const transientSmear = metrics.crestDb < 6 ? clamp01((6 - metrics.crestDb) / 6) : 0;
  return clamp01(
    profile.spectralFlatness * 0.35 +
      highBandNoiseRatio * 0.3 +
      unstableStereoScore * 0.2 +
      transientSmear * 0.15,
  );
}

function buildAnalysisFromMetrics(metrics: AiMixMetrics): MagicPolishAnalysis {
  return {
    lowEnergy: normalizeBand(metrics.low),
    lowMidEnergy: normalizeBand(metrics.lowMid),
    presenceEnergy: normalizeBand(metrics.presence),
    airEnergy: normalizeBand(metrics.air),
    ultraAirEnergy: normalizeBand(metrics.air - 2),
    topAirEnergy: normalizeBand(metrics.air - 4),
    crestFactorDb: metrics.crestDb,
    stereoWidth: clamp01((metrics.width + 28) / 24),
  };
}

function applyManualAdjustments(project: Project, adjustments: ManualAdjustments, mode: AiMixMode): Project {
  if (mode === "suggestOnly") return project;
  const tracks = project.tracks.map((track, index) => applyTrackAdjustments(track, index, adjustments, mode));
  return { ...project, tracks, updatedAt: new Date().toISOString() };
}

function applyTrackAdjustments(track: Track, index: number, adjustments: ManualAdjustments, mode: AiMixMode): Track {
  if (track.role === "reference") return track;
  const scale = mode === "dense" ? 1 : mode === "referenceMatch" ? 0.86 : mode === "safe" ? 0.45 : 0.72;
  const eq: ParametricEQState = JSON.parse(JSON.stringify(track.eq));
  eq.enabled = true;

  if (track.role !== "bass" && track.role !== "drums") {
    applyPeaking(eq, 320, adjustments.bodyDb * scale, 1.05);
    applyPeaking(eq, 720, adjustments.bodyDb * 0.65 * scale, 1.1);
  }
  if (track.role === "bass" || track.role === "drums") {
    applyPeaking(eq, 70, adjustments.bassTrimDb * 0.35 * scale, 0.9);
    applyPeaking(eq, 220, adjustments.bodyDb * 0.5 * scale, 1);
  }
  if (track.role === "vocal" || track.role === "backingVocal") {
    applyPeaking(eq, 3300, adjustments.presenceDb * 0.6 * scale, 1);
  } else if (track.role !== "bass") {
    applyPeaking(eq, 2500, -Math.abs(adjustments.presenceDb) * 0.35 * scale, 1);
  }

  return {
    ...track,
    pan: track.pan,
    eq,
  };
}

function applyAimixSpectralRestore(
  project: Project,
  settings: AimixSpectralRestoreSettings,
  beforeMetrics: AiMixMetrics,
  referenceProfile: ReferenceProfile | null,
  waveformPeaks: Record<string, PeakSummary>,
  mode: AiMixMode,
): AimixSpectralRestoreReport {
  if (!settings.enabled || settings.mode === "off" || mode === "suggestOnly") {
    return { project, decisions: ["Artifact Light Fix: OFF"] };
  }

  const mixProfile = measureAimixBandProfile(project, waveformPeaks);
  const boosts = computeSpectralRestoreBoosts(settings, mixProfile, referenceProfile);
  const modeScale = settings.mode === "safe" ? 0.55 : settings.mode === "strong" ? 1.15 : 1;
  let affected = 0;
  let guarded = 0;
  let deEssed = 0;
  let correlationGuarded = 0;

  const tracks = project.tracks.map((track, index) => {
    if (track.role === "reference") return track;
    const weight = ROLE_SPECTRAL_RESTORE_WEIGHT[track.role] ?? ROLE_SPECTRAL_RESTORE_WEIGHT.other;
    const profile = measureTrackBandProfile(project, track, waveformPeaks);
    if (!profile) return track;

    const artifactScore = estimateArtifactScore(profile, beforeMetrics);
    const artifactScale = settings.artifactGuard && artifactScore > 0.65 ? 0.35 : 1;
    const highGuardScale = settings.artifactGuard && artifactScore > 0.65 ? 0.22 : 1;
    const correlationScale = settings.correlationGuard && profile.lrCorrelation < 0.65 && !CENTER_ROLES.has(track.role) ? 0.55 : 1;
    if (artifactScale < 1) guarded += 1;
    if (correlationScale < 1) correlationGuarded += 1;

    const presenceGain = settings.restorePresence
      ? boosts.presence * weight.presence * modeScale * artifactScale * correlationScale
      : 0;
    const airGain = settings.restoreAir
      ? boosts.air * weight.air * modeScale * highGuardScale * correlationScale
      : 0;
    const lowMidGain = settings.restoreLowMid
      ? boosts.lowMid * weight.lowMid * modeScale * (profile.lowMid120250 > -11 ? 0.55 : 1)
      : 0;

    if (Math.abs(presenceGain) < 0.03 && Math.abs(airGain) < 0.03 && Math.abs(lowMidGain) < 0.03) return track;

    const eq: ParametricEQState = JSON.parse(JSON.stringify(track.eq));
    eq.enabled = true;
    applyPeaking(eq, 185, clamp(lowMidGain, -1.0, settings.maxLowMidBoostDb), 0.9, "spectral_restore", "low_mid_restore_185");
    applyPeaking(eq, 7200, clamp(presenceGain, -0.8, settings.maxPresenceBoostDb), 0.75, "spectral_restore", "presence_restore_7200");
    applyShelfGain(eq, "highshelf", 11800, clamp(airGain * 0.55, -0.6, Math.min(0.9, settings.maxAirBoostDb)), 0.7, "spectral_restore", "air_shelf_11800");
    applyPeaking(eq, 210, lowMidGain > 0 ? -0.18 * Math.min(1, lowMidGain) : clamp(lowMidGain * 0.45, -0.8, 0), 1.1, "spectral_restore", "mud_guard_210");

    let insertChain = track.insertChain;

    if (settings.deEssGuard && (track.role === "vocal" || track.role === "backingVocal" || presenceGain + airGain > 0.65)) {
      insertChain = upsertPlugin(insertChain, "sweet-de-esser", "track", {
        frequency: track.role === "vocal" || track.role === "backingVocal" ? 7600 : 8200,
        amount: round2(clamp(0.2 + (presenceGain + airGain) * 0.11, 0.2, 0.5)),
        sharpness: 0.58,
        mix: track.role === "vocal" || track.role === "backingVocal" ? 0.7 : 0.45,
      });
      deEssed += 1;
    }

    affected += 1;

    return {
      ...track,
      eq,
      insertChain,
      pan: track.pan,
    };
  });

  return {
    project: {
      ...project,
      tracks,
      updatedAt: new Date().toISOString(),
    },
    decisions: [
      `Artifact Light Fix (MVP): ${SPECTRAL_RESTORE_MODE_LABELS[settings.mode]} / Amount ${Math.round(settings.amount)}% / 対象 ${affected} tracks`,
      `Artifact Light Fix量: Presence +${boosts.presence.toFixed(1)}dB / Air +${boosts.air.toFixed(1)}dB / Low-mid +${boosts.lowMid.toFixed(1)}dB`,
      referenceProfile && settings.useReference ? "Artifact Light Fix: Referenceとの差分を安全係数で使用しました。現段階では安全なEQ / De-Esser系補正として適用します。" : "Artifact Light Fix: Referenceなしの安全固定補填を使用しました。現段階では安全なEQ / De-Esser系補正として適用します。",
      settings.deEssGuard ? `De-ess Guard: ${deEssed} tracksに高域保護を設定` : "De-ess Guard: OFF",
      settings.artifactGuard ? `Artifact Guard: ${guarded} tracksで高域補填を抑制` : "Artifact Guard: OFF",
      settings.correlationGuard ? `Correlation Guard: ${correlationGuarded} tracksでSide高域/広がりを抑制` : "Correlation Guard: OFF",
    ],
  };
}

function computeSpectralRestoreBoosts(
  settings: AimixSpectralRestoreSettings,
  current: AimixBandProfile,
  referenceProfile: ReferenceProfile | null,
) {
  const amountScale = clamp(settings.amount / 100, 0, 1);
  const referencePresence = referenceProfile ? avgReferenceProfileBands(referenceProfile, ["5000-9000", "9000-12000"]) : null;
  const referenceAir = referenceProfile ? avgReferenceProfileBands(referenceProfile, ["9000-12000", "12000-16000"]) : null;
  const referenceLowMid = referenceProfile ? avgReferenceProfileBands(referenceProfile, ["120-250"]) : null;
  const referenceScale = settings.useReference && referenceProfile ? 1 : 0;

  const presence = referenceScale
    ? computeReferenceBandGain(referencePresence, current.presence5000_10000, 0.35 * amountScale, settings.maxPresenceBoostDb, 0.8)
    : clamp(0.8 * amountScale, 0, settings.maxPresenceBoostDb);
  const airGuard = current.air10000_16000 > -18 ? 0.45 : current.ultra16000_20000 > -20 ? 0.65 : 1;
  const referenceUltraAir = referenceProfile ? avgReferenceProfileBands(referenceProfile, ["12000-16000", "16000-20000"]) : null;
  const ultraAirDelta = referenceUltraAir == null ? 0 : referenceUltraAir - current.ultra16000_20000;
  const ultraAirGain = referenceScale && settings.restoreAir
    ? clamp(ultraAirDelta * 0.18 * amountScale * airGuard, 0, 0.6)
    : 0;
  const air = referenceScale
    ? clamp(
        computeReferenceBandGain(referenceAir, current.air10000_16000, 0.25 * amountScale * airGuard, settings.maxAirBoostDb, 0.6) + ultraAirGain,
        -0.6,
        Math.min(settings.maxAirBoostDb, 1.2),
      )
    : clamp(0.6 * amountScale * airGuard, 0, settings.maxAirBoostDb);
  const lowMid = referenceScale
    ? computeReferenceBandGain(referenceLowMid, current.lowMid120250, 0.3 * amountScale, settings.maxLowMidBoostDb, 1.0)
    : clamp(0.6 * amountScale, 0, settings.maxLowMidBoostDb);

  return {
    presence: round1(presence),
    air: round1(air),
    lowMid: round1(lowMid),
  };
}

function computeReferenceBandGain(referenceDb: number | null, currentDb: number, scale: number, maxBoostDb: number, maxCutDb: number) {
  if (referenceDb == null) return 0;
  return clamp((referenceDb - currentDb) * scale, -maxCutDb, maxBoostDb);
}

function applyAimixReferenceDensity(
  project: Project,
  beforeMetrics: AiMixMetrics,
  referenceProfile: ReferenceProfile | null,
): Project {
  if (!referenceProfile) return project;
  const beforeMeter = meterFromMetrics(beforeMetrics);
  const referenceCrest = Number.isFinite(referenceProfile.crestFactorDb) ? Number(referenceProfile.crestFactorDb) : beforeMeter.crestDb;
  const referenceLufs = Number.isFinite(referenceProfile.integratedLufsApprox) ? Number(referenceProfile.integratedLufsApprox) : beforeMeter.integratedLufs;
  const crestExcess = Math.max(0, beforeMeter.crestDb - referenceCrest);
  const lufsGap = referenceLufs - beforeMeter.integratedLufs;
  if (lufsGap <= 0.6 && crestExcess <= 1.5) {
    return {
      ...project,
      master: {
        ...project.master,
        exportNormalizePeak: false,
      },
    };
  }

  const threshold = round1(clamp(-15 - crestExcess * 0.6, -24, -12));
  const ratio = round2(clamp(1.2 + crestExcess * 0.05, 1.2, 1.55));

  return {
    ...project,
    master: {
      ...project.master,
      compressor: {
        ...project.master.compressor,
        enabled: true,
        threshold,
        ratio,
        attack: 0.028,
        release: 0.18,
        knee: 18,
        makeupGainDb: 0,
      },
      insertChain: project.master.insertChain,
      limiterEnabled: false,
      exportNormalizePeak: false,
      exportPeakTargetDb: -1.2,
    },
    updatedAt: new Date().toISOString(),
  };
}

function applyAimixParallelDensity(project: Project): Project {
  const tracks = project.tracks.map((track) => {
    if (track.role === "reference" || track.role === "vocal" || track.role === "bass") return track;
    const alreadyHas = track.insertChain.some((plugin) => plugin.pluginId === "sweet-saturator");
    return {
      ...track,
      gainDb: round1(track.gainDb - 0.15),
      insertChain: alreadyHas
        ? track.insertChain
        : [
            ...track.insertChain,
            {
              ...createPluginInstance("sweet-saturator", "track"),
              params: { drive: 0.14, color: 0.45, lowCutHz: 120, mix: 0.12, outputDb: -0.2 },
            },
          ],
    };
  });
  return { ...project, tracks, updatedAt: new Date().toISOString() };
}

function applyAimixDynamicVocalDuck(project: Project, mode: AiMixMode): Project {
  const vocalExists = project.tracks.some((track) => (track.role === "vocal" || track.role === "backingVocal") && !track.mute);
  if (!vocalExists || mode === "suggestOnly") return project;
  const amount = mode === "dense" ? -0.8 : mode === "referenceMatch" ? -0.55 : mode === "safe" ? -0.25 : -0.45;
  const tracks = project.tracks.map((track) => {
    if (!["music", "synth", "keys", "guitar", "loop", "other"].includes(track.role)) return track;
    const eq: ParametricEQState = JSON.parse(JSON.stringify(track.eq));
    eq.enabled = true;
    applyPeaking(eq, 2500, amount, 1.1);
    return { ...track, eq };
  });
  return { ...project, tracks, updatedAt: new Date().toISOString() };
}

function resolveMagicPolishTarget(
  preset: MagicPolishTargetPreset,
  customTargetIntegratedLufs: number,
  customTruePeakCeilingDb: number,
  customTonalMatchStrength: number,
  customSpatialMatchStrength: number,
  customDensityMatchStrength: number,
  referenceProfile: ReferenceProfile | null,
  referenceRepair: ReferenceRepairDiagnosis | null,
  mode: MagicPolishMode,
  referenceGainMode: ReferenceGainMode,
  referenceGainTrimDb: number,
  referenceHardLimit: boolean,
): MagicPolishResolvedTarget | null {
  const settings = MAGIC_POLISH_TARGETS[preset];
  let targetIntegratedLufs = settings.targetIntegratedLufs ?? -14;
  let truePeakCeilingDb = settings.truePeakCeilingDb ?? settings.maxAllowedTruePeakDb;
  let warning: string | null = null;

  if (preset === "reference") {
    if (!referenceProfile) return null;
    const referenceLufs = Number.isFinite(referenceProfile.integratedLufsApprox) ? referenceProfile.integratedLufsApprox : -14;
    targetIntegratedLufs = referenceGainMode === "manual" ? referenceLufs + referenceGainTrimDb : referenceLufs;
    truePeakCeilingDb = referenceHardLimit ? -1 : 0;
    if (referenceGainMode === "manual") {
      warning = `Reference LUFSに${referenceGainTrimDb >= 0 ? "+" : ""}${referenceGainTrimDb.toFixed(1)}dBの手動Trimを加えます。`;
    }
    if (referenceHardLimit) {
      warning = warning
        ? `${warning} Safety Limiter ON: 書き出し時に-1.0dBTP目標の安全リミッターを使います。`
        : "Safety Limiter ON: 書き出し時に-1.0dBTP目標の安全リミッターを使います。";
    }
    if (referenceRepair?.status === "low_rms_high_peak") {
      warning = referenceHardLimit
        ? "Direct WAV Repair警告: Stem Sumはピークが高めです。Safety Limiter ONで安全側に保護します。"
        : "Direct WAV Repair警告: Stem Sumはピークが高めです。Safety Limiter OFFでは音色追従とゲイン追従のみを行います。";
    }
  }

  if (preset === "custom") {
    targetIntegratedLufs = clampNumber(customTargetIntegratedLufs, -20, -8, -13.5);
    truePeakCeilingDb = clampNumber(customTruePeakCeilingDb, -3, -0.3, -1);
  }

  if (preset === "soundcloud" && (mode === "loud" || targetIntegratedLufs > (settings.loudMasterThresholdLufs ?? -14))) {
    truePeakCeilingDb = settings.loudMasterTruePeakCeilingDb ?? -2;
  }

  const allowExactReferenceGain = preset === "reference";
  if (!allowExactReferenceGain) {
    truePeakCeilingDb = mode === "safe" ? Math.min(truePeakCeilingDb, -1.2) : Math.min(truePeakCeilingDb, -1);
  }

  if (mode === "loud" && preset !== "reference") {
    warning = warning ?? "Loudは音圧優先です。ダイナミクスが平たくなる場合があります。";
  }

  const referenceScale = mode === "safe" ? 0.65 : mode === "loud" ? 1 : 0.85;
  return {
    preset,
    label: settings.label,
    targetIntegratedLufs: allowExactReferenceGain ? round2(targetIntegratedLufs) : round1(targetIntegratedLufs),
    truePeakCeilingDb: allowExactReferenceGain ? round2(truePeakCeilingDb) : round1(clamp(truePeakCeilingDb, -3, -0.3)),
    tonalMatchStrength: preset === "reference" ? round2(settings.tonalMatchStrength * referenceScale) : preset === "custom" ? round2(clamp(customTonalMatchStrength, 0, 1)) : settings.tonalMatchStrength,
    spatialMatchStrength: preset === "reference" ? round2(settings.spatialMatchStrength * referenceScale) : preset === "custom" ? round2(clamp(customSpatialMatchStrength, 0, 1)) : settings.spatialMatchStrength,
    densityMatchStrength: preset === "reference" ? round2(settings.densityMatchStrength * referenceScale) : preset === "custom" ? round2(clamp(customDensityMatchStrength, 0, 1)) : settings.densityMatchStrength,
    notes: preset === "reference" ? "ReferenceのLUFS、帯域、空間、密度へ安全範囲で追従します。Referenceトラック自体は解析・比較専用で、通常再生とWAV書き出しには混ぜません。" : settings.notes,
    warning,
    exactReferenceGain: allowExactReferenceGain,
    hardLimitEnabled: preset === "reference" ? referenceHardLimit : true,
    referenceGainDb: allowExactReferenceGain ? round2(targetIntegratedLufs - (referenceProfile?.integratedLufsApprox ?? targetIntegratedLufs)) : undefined,
    referenceRepairStatus: referenceRepair?.status ?? null,
    referenceRepairSeverity: referenceRepair?.severity ?? null,
  };
}

function meterFromMetrics(metrics: AiMixMetrics): MagicPolishMeter {
  return {
    integratedLufs: round1(estimateIntegratedLufsApproxFromRms(metrics.rmsDb)),
    truePeakDb: round1(metrics.peakDb + 0.2),
    rmsDb: metrics.rmsDb,
    crestDb: metrics.crestDb,
    lowMidDb: metrics.lowMid,
    presenceDb: metrics.presence,
    airDb: metrics.air,
    widthDb: metrics.width,
    low120250Db: metrics.low120250,
    body250500Db: metrics.body250500,
    mid5002000Db: metrics.mid5002000,
    presence20005000Db: metrics.presence20005000,
    air500010000Db: metrics.air500010000,
    ultraAir1000020000Db: metrics.ultraAir1000020000,
  };
}

function applyFinalPolish(
  project: Project,
  mode: MagicPolishMode,
  target: MagicPolishResolvedTarget,
  before: MagicPolishMeter,
  referenceProfile: ReferenceProfile | null,
  referenceDelta: ReferenceDelta | null,
  referenceRepair: ReferenceRepairDiagnosis | null,
): Project {
  const next = cloneProject(project);
  const isReferenceTarget = target.preset === "reference";
  const modeScale = isReferenceTarget ? 1 : mode === "safe" ? 0.55 : mode === "loud" ? 1.15 : 1;
  const lufsGap = target.targetIntegratedLufs - before.integratedLufs;
  const referenceDensity = isReferenceTarget ? computeReferenceDensitySettings(before, referenceProfile, target) : null;
  const desiredGainDb = isReferenceTarget ? clamp(lufsGap, -9, 9) : clamp(lufsGap * 0.62 * modeScale, -3, mode === "loud" ? 2.4 : 1.8);
  const gainLimitedByPeakDb = target.truePeakCeilingDb - before.truePeakDb;
  const referencePostTrimDb = isReferenceTarget ? computeReferencePostTrimDb(before, target, desiredGainDb) : 0;
  const finalGainDb = isReferenceTarget
    ? round2(desiredGainDb + referencePostTrimDb)
    : round1(clamp(Math.min(desiredGainDb, gainLimitedByPeakDb), -3, mode === "loud" ? 2.4 : 1.8));

  const tonalScale = target.tonalMatchStrength * modeScale;
  const spatialScale = target.spatialMatchStrength * (mode === "safe" && !isReferenceTarget ? 0.55 : 1);
  const densityScale = isReferenceTarget ? referenceDensity?.densityAmount ?? 0 : target.densityMatchStrength * modeScale;
  const masterEq: ParametricEQState = JSON.parse(JSON.stringify(next.master.eq));
  masterEq.enabled = true;
  applyFilterFrequency(masterEq, "highpass", 28, 0.72);
  applyMasterPolishEq(masterEq, before, target, referenceProfile, tonalScale);

  const compressorRatio = referenceDensity
    ? referenceDensity.compressorRatio
    : mode === "loud" ? 2.0 : mode === "safe" ? 1.35 : 1.55;
  const compressorThreshold = referenceDensity
    ? referenceDensity.compressorThreshold
    : mode === "loud" ? -20 : mode === "safe" ? -14 : -16;
  let masterChain = next.master.insertChain;
  const useDensityStage = isReferenceTarget ? false : true;
  if (useDensityStage) {
    masterChain = upsertPlugin(masterChain, "sweet-saturator", "master", {
      drive: round2(referenceDensity?.saturatorDrive ?? clamp(0.06 + densityScale * 0.22, 0.05, 0.28)),
      color: 0.52,
      lowCutHz: 120,
      mix: round2(referenceDensity?.saturatorMix ?? clamp(0.08 + densityScale * 0.14, 0.06, 0.22)),
      outputDb: -0.2,
    });
  }
  masterChain = upsertPlugin(masterChain, "sweet-de-esser", "master", {
    frequency: 8200,
    amount: round2(clamp(0.12 + tonalScale * 0.16 + (before.airDb > -18 ? 0.06 : 0), 0.08, isReferenceTarget ? 0.3 : 0.38)),
    sharpness: 0.58,
    mix: round2(isReferenceTarget ? clamp(0.35 + tonalScale * 0.08, 0.35, 0.45) : mode === "safe" ? 0.45 : 0.56),
  });

  let polishedProject: Project = {
    ...next,
    tracks: next.tracks.map((track, index) => applyFinalPolishTrack(track, index, spatialScale, mode)),
    master: {
      ...next.master,
      gainDb: isReferenceTarget ? round2(clamp(next.master.gainDb + finalGainDb, -12, 12)) : round1(clamp(next.master.gainDb + finalGainDb, -6, 3)),
      eq: masterEq,
      limiterEnabled: isReferenceTarget ? Boolean(target.hardLimitEnabled) : true,
      compressor: {
        ...next.master.compressor,
        enabled: isReferenceTarget ? Boolean(referenceDensity?.needsDensity) : densityScale > 0.08,
        threshold: compressorThreshold,
        ratio: round2(compressorRatio),
        attack: referenceDensity ? 0.028 : mode === "loud" ? 0.022 : 0.028,
        release: referenceDensity ? 0.18 : mode === "safe" ? 0.22 : 0.16,
        knee: referenceDensity ? 18 : 14,
        makeupGainDb: 0,
      },
      insertChain: masterChain,
      exportNormalizePeak: isReferenceTarget ? false : true,
      exportPeakTargetDb: isReferenceTarget ? Math.min(target.truePeakCeilingDb, -1) : target.truePeakCeilingDb,
    },
    updatedAt: new Date().toISOString(),
  };


  return polishedProject;
}

function computeReferencePostTrimDb(
  before: MagicPolishMeter,
  target: MagicPolishResolvedTarget,
  desiredGainDb: number,
) {
  const estimatedAfterLufs = before.integratedLufs + desiredGainDb;
  const loudnessOvershootDb = estimatedAfterLufs - target.targetIntegratedLufs;
  const truePeakCeilingDb = Math.min(target.truePeakCeilingDb, -1);
  const truePeakOvershootDb = (before.truePeakDb + desiredGainDb) - truePeakCeilingDb;
  let trimDb = 0;
  if (loudnessOvershootDb > 0.5) {
    trimDb -= loudnessOvershootDb - 0.3;
  }
  if (truePeakOvershootDb > 0) {
    trimDb -= truePeakOvershootDb;
  }
  return round2(clamp(trimDb, -9, 0));
}

function computeReferenceDensitySettings(
  before: MagicPolishMeter,
  referenceProfile: ReferenceProfile | null,
  target: MagicPolishResolvedTarget,
) {
  const referenceCrest = Number.isFinite(referenceProfile?.crestFactorDb) ? Number(referenceProfile?.crestFactorDb) : 12.5;
  const crestExcessDb = Math.max(0, before.crestDb - referenceCrest);
  const lufsGap = target.targetIntegratedLufs - before.integratedLufs;
  const densityAmount = clamp((Math.max(0, lufsGap) * 0.13) + (crestExcessDb * 0.09), 0.04, 0.32);

  return {
    needsDensity: target.preset === "reference" && (lufsGap > 0.6 || crestExcessDb > 1.5),
    referenceCrestDb: referenceCrest,
    crestExcessDb,
    densityAmount,
    compressorThreshold: clamp(-15 - crestExcessDb * 0.6, -24, -12),
    compressorRatio: clamp(1.2 + crestExcessDb * 0.05, 1.2, 1.55),
    saturatorDrive: clamp(0.06 + crestExcessDb * 0.012 + Math.max(0, lufsGap) * 0.01, 0.06, 0.18),
    saturatorMix: clamp(0.07 + crestExcessDb * 0.008, 0.07, 0.16),
  };
}

function applyMasterPolishEq(
  eq: ParametricEQState,
  before: MagicPolishMeter,
  target: MagicPolishResolvedTarget,
  referenceProfile: ReferenceProfile | null,
  tonalScale: number,
) {
  const referenceLowMid = referenceProfile ? avgReferenceProfileBands(referenceProfile, ["250-500", "500-900"]) : null;
  const referencePresence = referenceProfile ? avgReferenceProfileBands(referenceProfile, ["1500-3000", "3000-5000"]) : null;
  const referenceAir = referenceProfile ? avgReferenceProfileBands(referenceProfile, ["9000-12000", "12000-16000"]) : null;
  const lowMidCut = referenceLowMid == null
    ? (before.lowMidDb > -15 ? -0.35 : -0.15)
    : clamp((referenceLowMid - before.lowMidDb) * 0.12, -0.9, 0.25);
  const presenceLift = referencePresence == null
    ? 0.25
    : clamp((referencePresence - before.presenceDb) * 0.08, -0.35, target.preset === "reference" ? 0.75 : 1.0);
  const airGuard = before.airDb > -18 ? 0.35 : before.airDb > -22 ? 0.65 : 1;
  const referenceAirGap = referenceAir == null ? null : referenceAir - before.airDb;
  const needsReferenceGloss = target.preset === "reference" && referenceAirGap != null && referenceAirGap > 0.8;
  const airLift = referenceAir == null
    ? 0.3 * airGuard
    : clamp((referenceAirGap ?? 0) * 0.1, needsReferenceGloss ? 0 : -0.25, target.preset === "reference" ? 0.65 : 0.9) * airGuard;
  const harshPresenceCut = target.preset === "reference" && referencePresence != null && referencePresence < before.presenceDb ? 0 : -0.12 * tonalScale;

  applyPeaking(eq, 285, clamp(lowMidCut * tonalScale, -1.0, 0.2), 1.05, "final_polish", "low_mid_285");
  applyPeaking(eq, 720, clamp(Math.min(0, lowMidCut * 0.65) * tonalScale, -0.55, 0), 1.12, "final_polish", "nasal_guard_720");
  applyPeaking(eq, 3300, clamp(presenceLift * tonalScale, -0.35, 1.1), 1, "final_polish", "presence_3300");
  applyPeaking(eq, 7800, clamp(harshPresenceCut, -0.35, 0.1), 2.2, "final_polish", "harsh_guard_7800");
  applyPeaking(eq, 10500, clamp(airLift * tonalScale * 0.75, 0, 0.9), 1.05, "final_polish", "air_peak_10500");
  applyShelfGain(eq, "highshelf", 12000, clamp(airLift * tonalScale, needsReferenceGloss ? 0 : -0.15, 0.8), 0.72, "final_polish", "air_shelf_12000");

  if (target.preset === "soundcloud") {
    applyPeaking(eq, 120, -0.15 * tonalScale, 0.9, "final_polish", "soundcloud_low_guard_120");
  }
}

function applyFinalPolishTrack(track: Track, index: number, spatialScale: number, mode: MagicPolishMode): Track {
  if (track.role === "reference") return track;

  const isGeneratedSpatial = track.aimixSpatial?.isAimixSpatialGenerated;
  const nextEq: ParametricEQState = JSON.parse(JSON.stringify(track.eq));
  nextEq.enabled = track.eq.enabled || Boolean(isGeneratedSpatial);

  if (isGeneratedSpatial) {
    applyFilterFrequency(nextEq, "highpass", 205, 0.75);
    applyPeaking(nextEq, 285, -0.45, 1.1, "final_polish", "spatial_low_mid_285");
    applyPeaking(nextEq, 7200, 0.25 + spatialScale * 0.35, 1.2, "final_polish", "spatial_air_7200");
  }

  return {
    ...track,
    eq: nextEq,
    pan: track.pan,
    insertChain: track.insertChain,
  };
}

function buildMagicPolishActions(
  before: MagicPolishMeter,
  after: MagicPolishMeter,
  target: MagicPolishResolvedTarget,
) {
  const actions = [
    `目標: ${target.label} / ${formatTargetLufs(target)} / ${target.hardLimitEnabled === false ? "Safety Limiter OFF" : `${formatTargetDb(target.truePeakCeilingDb, target.exactReferenceGain)}TP`}`,
    `音量: ${formatLufs(before.integratedLufs)} -> ${formatLufs(after.integratedLufs)} / True Peak ${formatDb(after.truePeakDb)}`,
    target.preset === "reference"
      ? `ReferenceのLUFS、帯域、空間、密度へ安全範囲で追従します。Safety Limiterは${target.hardLimitEnabled ? "ON" : "OFF"}です。`
      : "帯域、密度、空間をターゲットに合わせて整えます。",
    "Low-midは自動ブーストせず、こもりが出る帯域だけを軽く整理します。",
    target.preset === "reference"
      ? "Referenceトラック自体は解析・比較専用です。必要なEQ、Saturator、De-Esser、空間処理はstem/master側へ安全に反映し、Referenceは通常再生とWAV書き出しには混ぜません。"
      : "Master SaturatorとDe-Esserを控えめに追加し、export時のLimiter ceilingへ反映します。",
  ];
  if (target.hardLimitEnabled !== false && after.truePeakDb > target.truePeakCeilingDb + 0.2) {
    actions.push("Safety Limiter ONのため、WAV書き出し時はceilingへ収めます。");
  }
  if (target.preset === "reference") {
    actions.push("Referenceは目標として参照します。Referenceトラック自体は自動加工、通常再生、WAV書き出しの対象から除外します。");
  }
  if (target.referenceRepairStatus === "low_rms_high_peak") {
    actions.push("Direct WAV Repair警告は表示のみです。Safety LimiterがONの時だけリミッターで保護します。");
  }
  return actions;
}

function buildAimixDecisions(
  before: AiMixMetrics,
  after: AiMixMetrics,
  mode: AiMixMode,
  referenceDelta: ReferenceDelta | null,
  intelligence: ClipIntelligenceReport,
) {
  const decisions: string[] = [];
  const modeLabel =
    mode === "balanced"
      ? "Balanced 推奨"
      : mode === "safe"
        ? "Safe 低加工"
        : mode === "cleanRebuild"
          ? "Clean Rebuild"
          : mode === "dense"
          ? "Dense 強め"
          : mode === "referenceMatch"
            ? "Reference Match"
            : "Suggest Only";
  decisions.push(`Mode: ${modeLabel}`);
  decisions.push(`RMS: ${before.rmsDb.toFixed(1)}dB -> ${after.rmsDb.toFixed(1)}dB / Crest: ${before.crestDb.toFixed(1)}dB -> ${after.crestDb.toFixed(1)}dB`);
  decisions.push(`LowMid: ${before.lowMid.toFixed(1)}dB -> ${after.lowMid.toFixed(1)}dB / Presence: ${before.presence.toFixed(1)}dB -> ${after.presence.toFixed(1)}dB`);
  if (referenceDelta) {
    decisions.push(
      mode === "referenceMatch"
        ? "Reference Match: Reference WAVの低域、こもり、空気感、クレスト、横幅へ近づけました。Referenceトラック自体は解析・比較専用で、通常再生とWAV書き出しには混ぜません。"
        : "Reference Follow: Reference WAVの低域、空気感、クレスト、横幅の差分を安全範囲で反映しました。",
    );
  }
  decisions.push(...summarizeClipIntelligence(intelligence));
  decisions.push(...intelligence.decisions.slice(0, 8).map((decision) => decision.message));
  if (mode === "dense") {
    decisions.push("Dense: 強めの密度処理です。音が詰まる場合はBalancedへ戻してください。");
  }
  if (mode === "referenceMatch" && !referenceDelta) {
    decisions.push("Reference Match: Referenceがないため、Reference追従は行わずBalanced相当で安全に提案しました。");
  }
  return decisions;
}

function preservePanAndClipAutomation(project: Project, source: Project): Project {
  const trackPanById = new Map(source.tracks.map((track) => [track.id, track.pan]));
  const clipPanById = new Map(source.clips.map((clip) => [clip.id, clip.panAutomation]));
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      trackPanById.has(track.id)
        ? {
            ...track,
            pan: trackPanById.get(track.id) ?? track.pan,
          }
        : track,
    ),
    clips: project.clips.map((clip) =>
      clipPanById.has(clip.id)
        ? {
            ...clip,
            panAutomation: clipPanById.get(clip.id),
          }
        : clip,
    ),
  };
}


function buildUiVocalClarityGate(
  metrics: AiMixMetrics,
  referenceProfile: ReferenceProfile | null,
  stemAirLayer: StemAirLayerStatus,
): VocalClarityGateReport | null {
  if (!referenceProfile) return null;
  const referenceSub = avgReferenceProfileBands(referenceProfile, ["20-35", "35-60"]);
  const referenceMid = avgReferenceProfileBands(referenceProfile, ["500-900", "900-1500", "1500-3000"]);
  const referencePresence = avgReferenceProfileBands(referenceProfile, ["1500-3000", "3000-5000"]);
  const referenceAir = avgReferenceProfileBands(referenceProfile, ["5000-9000", "9000-12000"]);
  const referenceUltra = avgReferenceProfileBands(referenceProfile, ["9000-12000", "12000-16000", "16000-20000"]);
  const subExcessDb = round1(metrics.sub2060 - referenceSub);
  const midShortageDb = round1(referenceMid - metrics.mid5002000);
  const presenceShortageDb = round1(referencePresence - metrics.presence20005000);
  const airShortageDb = round1(referenceAir - metrics.air500010000);
  const ultraAirExcessDb = round1(metrics.ultraAir1000020000 - referenceUltra);
  const ultraAirShortageDb = round1(referenceUltra - metrics.ultraAir1000020000);
  const sideShortfallDb = round1(referenceProfile.sideMidRatioDb - metrics.width);
  const falseAirSuccess = ultraAirExcessDb > 0.5 && (midShortageDb > 1.2 || presenceShortageDb > 1.0 || airShortageDb > 1.0);
  const items: VocalClarityGateItem[] = [
    uiGateItem("sub_20_60", "20-60Hz", excessGateStatus(subExcessDb, 1.0, 2.0), subExcessDb, "Candidate vs Reference: " + formatGateDelta(subExcessDb)),
    uiGateItem("mid_500_2000", "500Hz-2kHz", shortageGateStatus(midShortageDb, 0.8, 1.2), midShortageDb, "Shortage vs Reference: " + formatGateDelta(midShortageDb)),
    uiGateItem("presence_2000_5000", "2kHz-5kHz", shortageGateStatus(presenceShortageDb, 0.6, 1.0), presenceShortageDb, "Shortage vs Reference: " + formatGateDelta(presenceShortageDb)),
    uiGateItem("air_5000_10000", "5kHz-10kHz", shortageGateStatus(airShortageDb, 0.8, 1.0), airShortageDb, "Shortage vs Reference: " + formatGateDelta(airShortageDb)),
    uiGateItem("ultra_air_10000_20000", "10kHz-20kHz", shortageGateStatus(ultraAirShortageDb, 1.2, 99), ultraAirShortageDb, "Sheen shortage vs Reference: " + formatGateDelta(ultraAirShortageDb)),
    uiGateItem("side_mid", "Side/Mid", shortageGateStatus(sideShortfallDb, 0.8, 1.5), sideShortfallDb, "Shortfall vs Reference: " + formatGateDelta(sideShortfallDb)),
  ];
  if (falseAirSuccess) {
    const airItem = items.find((item) => item.id === "air_5000_10000");
    if (airItem && airItem.status === "pass") {
      airItem.status = "warn";
      airItem.detail += "; 10-20kHz is not enough when 500Hz-10kHz is weak";
    }
  }
  const passed = !items.some((item) => item.status === "fail") && !falseAirSuccess;
  const warnings = items
    .filter((item) => item.status !== "pass")
    .map((item) => item.label + ": " + item.status.toUpperCase() + " (" + item.detail + ")");
  if (falseAirSuccess) warnings.push("10-20kHz is present, but 500Hz-10kHz is still short. Do not judge this as clear.");
  return {
    passed,
    stemAirLayer,
    items,
    summary: (passed ? "PASS" : "HOLD")
      + " / 20-60 " + items[0].status
      + " / 500-2k " + items[1].status
      + " / 2-5k " + items[2].status
      + " / 5-10k " + items[3].status
      + " / 10-20k " + items[4].status
      + " / Side " + items[5].status,
    warnings,
  };
}

function buildVocalClarityGateDecisionLines(report: VocalClarityGateReport) {
  return [
    "Vocal Clarity Gate: " + report.summary,
    "Stem Air Layer: " + report.stemAirLayer,
    ...report.warnings.slice(0, 3).map((warning) => "Vocal Clarity Gate warning: " + warning),
  ];
}

function uiGateItem(id: VocalClarityGateItem["id"], label: string, status: VocalClarityGateStatus, deltaDb: number, detail: string): VocalClarityGateItem {
  return { id, label, status, deltaDb: round1(deltaDb), detail };
}

function excessGateStatus(value: number, warnAt: number, failAt: number): VocalClarityGateStatus {
  if (value > failAt) return "fail";
  if (value > warnAt) return "warn";
  return "pass";
}

function shortageGateStatus(value: number, warnAt: number, failAt: number): VocalClarityGateStatus {
  if (value > failAt) return "fail";
  if (value > warnAt) return "warn";
  return "pass";
}

function gateStatusClass(status: VocalClarityGateStatus) {
  if (status === "pass") return "border-emerald-300/40 bg-emerald-300/10 text-emerald-100";
  if (status === "warn") return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  return "border-rose-300/45 bg-rose-300/12 text-rose-100";
}

function gatePassedClass(passed: boolean) {
  return passed ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-100" : "border-amber-300/40 bg-amber-300/10 text-amber-100";
}

function stemAirLayerClass(status: StemAirLayerStatus) {
  if (status === "enabled") return "border-cyan-300/45 bg-cyan-300/10 text-cyan-100";
  if (status === "reduced") return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  return "border-slate-400/30 bg-white/[0.04] text-slate-200";
}

function formatGateDelta(value: number) {
  return (value > 0 ? "+" : "") + value.toFixed(1) + "dB";
}

function buildSingleFileReferenceClarityOverrides(
  report: VocalClarityGateReport | null,
  referenceProfile?: ReferenceProfile | null,
  sourceMetrics?: AiMixMetrics | null,
): Partial<Pick<SingleFileMasteringSettings, "referenceClarityMode" | "presenceCatchUpDb" | "clarityCatchUpDb" | "airCatchUpDb" | "sheenCatchUpDb" | "referenceSideMidDb" | "referenceCorrelation" | "referenceUltraAirSideMidDb" | "referenceGlossSideMidDb" | "referenceAirNoiseSideMidDb" | "referencePresenceDb" | "referenceAirDb" | "referenceGlossDb" | "referenceUltraAirDb" | "referenceSheenDb" | "referencePlrDb" | "imageCatchUpAmount" | "sideHighClampAmount" | "falseAirRisk" | "referenceDensityGateAmount" | "referenceSubTrimDb" | "referenceMidGlossShiftDb" | "referenceMidSideRecoveryDb" | "referenceTransparentCheck">> {
  const imageTargets = referenceProfile
    ? {
        referenceSideMidDb: referenceProfile.sideMidRatioDb,
        referenceCorrelation: referenceProfile.lrCorrelation,
        referenceUltraAirSideMidDb: referenceProfile.bandSideMidDb?.ultraAir_10000_20000,
        referenceGlossSideMidDb: referenceProfile.bandSideMidDb?.gloss_9000_14000,
        referenceAirNoiseSideMidDb: referenceProfile.bandSideMidDb?.sheen_14000_20000,
        referencePresenceDb: avgReferenceProfileBands(referenceProfile, ["1500-3000", "3000-5000"]),
        referenceAirDb: avgReferenceProfileBands(referenceProfile, ["5000-9000", "9000-12000"]),
        referenceGlossDb: avgReferenceProfileBands(referenceProfile, ["9000-12000", "12000-16000"]),
        referenceUltraAirDb: avgReferenceProfileBands(referenceProfile, ["9000-12000", "12000-16000", "16000-20000"]),
        referenceSheenDb: avgReferenceProfileBands(referenceProfile, ["12000-16000", "16000-20000"]),
        referencePlrDb: round2(referenceProfile.truePeakApproxDb - referenceProfile.integratedLufsApprox),
        imageCatchUpAmount: 0.85,
        sideHighClampAmount: 0.9,
      }
    : {};
  const transparentTargets = {
    ...imageTargets,
    referenceClarityMode: "off" as const,
    presenceCatchUpDb: 0,
    clarityCatchUpDb: 0,
    airCatchUpDb: 0,
    sheenCatchUpDb: 0,
    referenceDensityGateAmount: 0,
    referenceSubTrimDb: 0,
    referenceMidGlossShiftDb: 0,
    referenceMidSideRecoveryDb: 0,
    referenceTransparentCheck: true,
  };
  if (!report) return transparentTargets;
  const delta = (id: VocalClarityGateItem["id"]) => report.items.find((item) => item.id === id)?.deltaDb ?? 0;
  const shortage = (id: VocalClarityGateItem["id"]) => Math.max(0, delta(id));
  let midShortageDb = shortage("mid_500_2000");
  let presenceShortageDb = shortage("presence_2000_5000");
  let airShortageDb = shortage("air_5000_10000");
  let sheenShortageDb = shortage("ultra_air_10000_20000");
  let subExcessDb = shortage("sub_20_60");
  let sideShortageDb = shortage("side_mid");
  const estimatedSourceLufs = sourceMetrics ? sourceMetrics.rmsDb - 1.2 : undefined;
  if (referenceProfile && sourceMetrics && estimatedSourceLufs !== undefined) {
    const levelMatchDb = referenceProfile.integratedLufsApprox - estimatedSourceLufs;
    const referenceSub = avgReferenceProfileBands(referenceProfile, ["20-35", "35-60"]);
    const referenceMid = avgReferenceProfileBands(referenceProfile, ["500-900", "900-1500", "1500-3000"]);
    const referencePresence = avgReferenceProfileBands(referenceProfile, ["1500-3000", "3000-5000"]);
    const referenceAir = avgReferenceProfileBands(referenceProfile, ["5000-9000", "9000-12000"]);
    const referenceUltra = avgReferenceProfileBands(referenceProfile, ["9000-12000", "12000-16000", "16000-20000"]);
    const matched = {
      sub: sourceMetrics.sub2060 + levelMatchDb,
      mid: sourceMetrics.mid5002000 + levelMatchDb,
      presence: sourceMetrics.presence20005000 + levelMatchDb,
      air: sourceMetrics.air500010000 + levelMatchDb,
      ultra: sourceMetrics.ultraAir1000020000 + levelMatchDb,
    };
    subExcessDb = round1(matched.sub - referenceSub);
    midShortageDb = round1(referenceMid - matched.mid);
    presenceShortageDb = round1(referencePresence - matched.presence);
    airShortageDb = round1(referenceAir - matched.air);
    sheenShortageDb = round1(referenceUltra - matched.ultra);
    sideShortageDb = round1(referenceProfile.sideMidRatioDb - sourceMetrics.width);
  }
  const glossShortageDb = round1(Math.max(0, airShortageDb * 0.35 + sheenShortageDb * 0.65));
  const presenceOverDb = Math.max(0, -presenceShortageDb);
  const clarityOverDb = Math.max(0, -airShortageDb);
  const upperMidOverGuard = presenceOverDb > 1.2 || clarityOverDb > 1.2;
  const falseAirRisk = report.warnings.some((warning) => warning.toLowerCase().includes("10-20khz")) ||
    (sheenShortageDb <= 0.5 && (midShortageDb > 1.2 || presenceShortageDb > 1.0 || airShortageDb > 1.0));
  const highSideClampPriority = Boolean(referenceProfile?.bandSideMidDb?.sheen_14000_20000 != null) && falseAirRisk;
  const topOnlyHighSideRisk = highSideClampPriority && airShortageDb <= 0.8 && presenceShortageDb <= 1.0 && glossShortageDb <= 0.8;
  const presenceAllowed = presenceShortageDb > 1.2 || midShortageDb > 1.6;
  const clarityAllowed = airShortageDb > 1.0;
  const sheenAllowed = !falseAirRisk && !upperMidOverGuard && sheenShortageDb > 0.8;
  const midOnlySheenAllowed = falseAirRisk && !upperMidOverGuard && sheenShortageDb > 2.0;
  const referenceSubTrimDb = subExcessDb > 1.5 ? round2(clamp((subExcessDb - 1.0) * 0.5, 0.25, 1.6)) : 0;
  const midGlossFromGloss = glossShortageDb > 1.0 && !upperMidOverGuard
    ? round2(clamp((glossShortageDb - 0.8) * 0.26, 0.15, falseAirRisk ? 1.25 : 0.9))
    : 0;
  const midGlossFromSheenScale = topOnlyHighSideRisk ? 0.12 : falseAirRisk ? 0.24 : 0.18;
  const midGlossFromSheenCeiling = topOnlyHighSideRisk ? 0.65 : falseAirRisk ? 1.45 : 1.1;
  const midGlossFromSheen = sheenShortageDb > 1.4 && !upperMidOverGuard
    ? round2(clamp((sheenShortageDb - 1.05) * midGlossFromSheenScale, 0.12, midGlossFromSheenCeiling))
    : 0;
  const midGlossFromUltra = !falseAirRisk && sheenShortageDb > 2.5 && !upperMidOverGuard
    ? round2(clamp((sheenShortageDb - 2.2) * 0.08, 0.12, 0.28))
    : 0;
  const referenceMidGlossShiftDb = Math.max(midGlossFromGloss, midGlossFromSheen, midGlossFromUltra);
  const referenceMidSideRecoveryDb = sideShortageDb > 1.2
    ? round2(clamp((sideShortageDb - 0.8) * (highSideClampPriority ? 0.32 : 0.18), 0.15, highSideClampPriority ? 0.85 : 0.45))
    : 0;
  const loudnessShortfallDb = referenceProfile && estimatedSourceLufs !== undefined
    ? Math.max(0, referenceProfile.integratedLufsApprox - estimatedSourceLufs)
    : 0;
  const crestExcessDb = referenceProfile && sourceMetrics
    ? Math.max(0, sourceMetrics.crestDb - referenceProfile.crestFactorDb)
    : 0;
  const densityNeedDb = crestExcessDb - 1.75;
  const transparentDensityAmount = densityNeedDb > 0.35
    ? clamp(0.22 + densityNeedDb * 0.22 + Math.max(0, loudnessShortfallDb - 1) * 0.035, 0.22, 0.78)
    : 0;
  const referenceDensityGateAmount = loudnessShortfallDb > 2.5 && densityNeedDb > 0.4
    ? round2(clamp(0.3 + densityNeedDb * 0.28 + Math.max(0, loudnessShortfallDb - 3) * 0.06, 0.3, 0.92))
    : round2(transparentDensityAmount);
  const hasMeasuredCorrection = referenceSubTrimDb > 0 || referenceMidGlossShiftDb > 0 || referenceMidSideRecoveryDb > 0 || referenceDensityGateAmount > 0;
  if (!presenceAllowed && !clarityAllowed && !sheenAllowed && !midOnlySheenAllowed && !hasMeasuredCorrection) return transparentTargets;
  const presenceCeilingDb = falseAirRisk ? 1.5 : 1.35;
  const clarityCeilingDb = falseAirRisk ? 0.55 : 0.5;
  const presenceCatchUpDb = presenceAllowed
    ? round2(clamp(Math.max(0, presenceShortageDb - 0.75) * 0.72 + Math.max(0, midShortageDb - 0.5) * 0.12, 0, presenceCeilingDb))
    : 0;
  const clarityCatchUpDb = clarityAllowed
    ? round2(clamp((airShortageDb - 0.9) * 0.075 - Math.max(0, presenceShortageDb - airShortageDb) * 0.012, 0, clarityCeilingDb))
    : 0;
  const midOnlySheenScale = topOnlyHighSideRisk ? 1.0 : falseAirRisk && presenceShortageDb > 1.2 ? 0.72 : 0.42;
  const midOnlySheenCeiling = topOnlyHighSideRisk ? 4.1 : falseAirRisk && presenceShortageDb > 1.2 ? 2.8 : 2.2;
  const midOnlySheenCatchUpDb = midOnlySheenAllowed
    ? round2(clamp((sheenShortageDb - 1.0) * midOnlySheenScale, 0.55, midOnlySheenCeiling))
    : 0;

  return {
    referenceClarityMode: "catchUp",
    presenceCatchUpDb,
    clarityCatchUpDb,
    airCatchUpDb: clarityAllowed ? round2(clamp(0.02 + (airShortageDb - 1.0) * 0.012, 0.02, 0.12)) : 0,
    sheenCatchUpDb: sheenAllowed
      ? round2(clamp(0.2 + sheenShortageDb * 0.65, 0.4, 4.8))
      : midOnlySheenCatchUpDb,
    ...imageTargets,
    referenceDensityGateAmount,
    referenceSubTrimDb,
    referenceMidGlossShiftDb,
    referenceMidSideRecoveryDb,
    falseAirRisk,
  };
}

function getReferenceCatchUpCeilingDb(profile: ReferenceProfile | null | undefined) {
  if (!profile || !Number.isFinite(profile.truePeakApproxDb)) return -1;
  return round2(Math.max(-2, Math.min(-1, profile.truePeakApproxDb + 0.8)));
}

function buildAimixReferenceValidationDecisions(
  before: AiMixMetrics,
  after: AiMixMetrics,
  referenceProfile: ReferenceProfile | null,
) {
  const validation = validateReferenceMatchProgress(meterFromMetrics(before), meterFromMetrics(after), referenceProfile);
  if (!referenceProfile) return ["Reference Match: Reference解析がないため品質チェックをスキップしました。"];
  const rows = new Map(validation.rows.map((row) => [row.metric, row]));
  const lufs = rows.get("LUFS");
  const crest = rows.get("Crest");
  const tonalRows = ["Body250500", "Mid5002000", "Presence20005000", "Air500010000"]
    .map((metric) => rows.get(metric))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const tonalBefore = tonalRows.length > 0
    ? tonalRows.reduce((sum, row) => sum + row.beforeDistance, 0) / tonalRows.length
    : 0;
  const tonalAfter = tonalRows.length > 0
    ? tonalRows.reduce((sum, row) => sum + row.afterDistance, 0) / tonalRows.length
    : 0;
  const ultraAir = rows.get("UltraAir1000020000");
  const decisions = [
    lufs ? `Reference Match: LUFS ${lufs.before.toFixed(1)} -> ${lufs.after.toFixed(1)} / target ${lufs.reference.toFixed(1)}` : "Reference Match: LUFS check skipped",
    crest ? `Reference Match: Crest ${crest.before.toFixed(1)} -> ${crest.after.toFixed(1)} / target ${crest.reference.toFixed(1)}` : "Reference Match: Crest check skipped",
    `Reference Match: Tonal 250Hz-10kHz distance ${tonalBefore.toFixed(1)} -> ${tonalAfter.toFixed(1)}`,
    ultraAir ? `Reference Match: Air 10-20kHz ${ultraAir.before.toFixed(1)} -> ${ultraAir.after.toFixed(1)} / target ${ultraAir.reference.toFixed(1)}` : "Reference Match: Air 10-20kHz check skipped",
    `Reference Match: distance score ${validation.beforeDistance.toFixed(2)} -> ${validation.afterDistance.toFixed(2)}`,
  ];
  if (validation.failures.length > 0) {
    decisions.push(...validation.failures.map((failure) => `Reference Match fail: ${failure}`));
  }
  if (validation.warnings.length > 0) {
    decisions.push(...validation.warnings.map((warning) => `Reference Match warning: ${warning}`));
  }
  return decisions;
}

function detectMagicGenre(project: Project): MagicPolishGenre {
  const roles = new Set(project.tracks.map((track) => track.role));
  if (roles.has("drums") && roles.has("bass") && roles.has("synth")) return "club";
  if (roles.has("guitar") && roles.has("drums")) return "rock";
  if (roles.has("keys") && !roles.has("drums")) return "acoustic";
  return "pop";
}

function getStrengthForAimixMode(mode: AiMixMode): MixStrength {
  if (mode === "safe" || mode === "suggestOnly") return "light";
  if (mode === "cleanRebuild") return "medium";
  if (mode === "dense" || mode === "referenceMatch") return "strong";
  return "medium";
}

function getFinalModeForAimixMode(mode: AiMixMode, selected: MagicPolishMode): MagicPolishMode {
  if (mode === "safe" || mode === "suggestOnly") return "safe";
  if (mode === "cleanRebuild") return "balanced";
  if (mode === "dense") return selected === "safe" ? "balanced" : selected;
  if (mode === "referenceMatch") return selected === "loud" ? "balanced" : selected;
  return selected === "loud" ? "balanced" : selected;
}

function applyPeaking(
  eq: ParametricEQState,
  freqHz: number,
  gainDb: number,
  q: number,
  owner: "role_enhancement" | "shared_magic_policy" | "manual_adjustment" | "spectral_restore" | "dynamic_vocal_duck" | "reference_match" | "final_polish" | "safety" | "legacy" = "final_polish",
  slotId = `peaking_${Math.round(freqHz)}`,
) {
  applyPeakingToSlot(eq, owner, slotId, freqHz, gainDb, q);
}

function applyFilterFrequency(eq: ParametricEQState, type: EQBandType, freqHz: number, q: number) {
  const band = eq.bands.find((candidate) => candidate.type === type);
  if (!band) return;
  band.enabled = true;
  band.frequency = round1(clamp(freqHz, 20, 20000));
  band.q = round2(clamp(q, 0.2, 5));
  if (type === "highpass" || type === "lowpass") {
    band.gainDb = 0;
  }
}

function applyShelfGain(
  eq: ParametricEQState,
  type: "lowshelf" | "highshelf",
  freqHz: number,
  gainDb: number,
  q: number,
  owner: "role_enhancement" | "shared_magic_policy" | "manual_adjustment" | "spectral_restore" | "dynamic_vocal_duck" | "reference_match" | "final_polish" | "safety" | "legacy" = "final_polish",
  slotId = `${type}_${Math.round(freqHz)}`,
) {
  applyShelfGainToSlot(eq, type, owner, slotId, freqHz, gainDb, q);
}

function upsertPlugin(
  chain: PluginInstance[],
  pluginId: BuiltinPluginId,
  target: PluginInstance["target"],
  params: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  const existingIndex = chain.findIndex((plugin) => plugin.pluginId === pluginId);
  if (existingIndex >= 0) {
    return chain.map((plugin, index) =>
      index === existingIndex
        ? {
            ...plugin,
            enabled: true,
            params: {
              ...plugin.params,
              ...params,
            },
            updatedAt: now,
          }
        : plugin,
    );
  }
  const instance = createPluginInstance(pluginId, target);
  return [
    ...chain,
    {
      ...instance,
      params: {
        ...instance.params,
        ...params,
      },
      updatedAt: now,
    },
  ];
}

function avgReferenceProfileBands(profile: ReferenceProfile, ids: Array<keyof ReferenceProfile["bandEnergyDb"]>) {
  const values = ids.map((id) => profile.bandEnergyDb[id]).filter((value): value is number => Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : -60;
}

function estimateSummaryRms(summary: PeakSummary) {
  const bins = Math.max(1, Math.min(summary.min.length, summary.max.length));
  let sum = 0;
  for (let index = 0; index < bins; index += 1) {
    const value = Math.max(Math.abs(summary.min[index] ?? 0), Math.abs(summary.max[index] ?? 0));
    sum += value * value * 0.5;
  }
  return ampToDb(Math.sqrt(sum / bins));
}

function avgBands(summary: PeakSummary, ids: string[]) {
  const values = ids.map((id) => summary.bandEnergyDb?.[id]).filter((value): value is number => Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : -60;
}

function buildMasteringConflictGuard(
  glowEnabled: boolean,
  glowReport: AimixGlowUiReport | null,
  clarityGate: VocalClarityGateReport | null,
): MasteringConflictGuard {
  const clarityShortage = hasTwoToTenKhzShortage(clarityGate);
  const glowActive = glowEnabled;
  const fakeAirRisk = glowReport?.after.fakeAirRisk ?? glowReport?.before.fakeAirRisk ?? 0;
  const sibilanceRisk = glowReport?.after.sibilanceRisk ?? glowReport?.before.sibilanceRisk ?? 0;
  const active = glowActive || clarityShortage;
  const reasons: string[] = [];

  if (glowActive) reasons.push("AIMIX Glow is active, so Mastering should preserve its clarity / gloss work.");
  if (clarityShortage) reasons.push("Vocal Clarity Gate reports a 2-10kHz shortage, so presence and harshness cuts are softened.");
  if (fakeAirRisk > 0.55) reasons.push("Fake Air risk is still elevated; Harsh Guard remains partially active.");
  if (sibilanceRisk > 0.62) reasons.push("Sibilance risk is elevated; De-ess / Harsh Guard is reduced but not bypassed.");

  const toneCleanupAmount = !active ? 1 : clarityShortage ? 0.35 : 0.55;
  const harshnessScale = !active
    ? 1
    : sibilanceRisk > 0.62 || fakeAirRisk > 0.65
      ? 0.72
      : clarityShortage
        ? 0.42
        : 0.55;

  return {
    active,
    glowActive,
    clarityShortage,
    toneCleanupAmount,
    harshnessScale,
    reasons,
  };
}

function applyMasteringConflictGuard(settings: SingleFileMasteringSettings, guard: MasteringConflictGuard): SingleFileMasteringSettings {
  if (!guard.active || settings.mode === "existing" || settings.mode === "loudnessOnly") return settings;
  return {
    ...settings,
    toneCleanupAmount: round2(clamp(settings.toneCleanupAmount * guard.toneCleanupAmount, 0, 1)),
    harshnessAmount: round2(clamp(settings.harshnessAmount * guard.harshnessScale, 0, 1)),
  };
}

function hasTwoToTenKhzShortage(report: VocalClarityGateReport | null) {
  if (!report) return false;
  return report.items.some((item) =>
    (item.id === "mid_500_2000" || item.id === "presence_2000_5000" || item.id === "air_5000_10000") &&
    item.status !== "pass",
  );
}

function buildPeakCulpritReport(project: Project, waveformPeaks: Record<string, PeakSummary>): PeakCulpritReportItem[] {
  const items = project.tracks
    .filter((track) => track.role !== "reference" && !track.mute)
    .map((track) => buildPeakCulpritForTrack(project, track, waveformPeaks))
    .filter((item): item is PeakCulpritReportItem => Boolean(item))
    .filter((item) => item.peakRiskDb >= 0.5 || item.crestDb >= 10.5 || item.peakDb >= -3)
    .sort((a, b) => b.peakRiskDb - a.peakRiskDb);
  return items.slice(0, 4);
}

function buildPeakCulpritForTrack(
  project: Project,
  track: Track,
  waveformPeaks: Record<string, PeakSummary>,
): PeakCulpritReportItem | null {
  const clips = project.clips.filter((clip) => clip.trackId === track.id);
  const peakValues: number[] = [];
  const rmsValues: number[] = [];

  for (const clip of clips) {
    const summary = waveformPeaks[clip.fileId];
    if (!summary) continue;
    const gain = (track.gainDb ?? 0) + (clip.gainDb ?? 0);
    const peakAmp = Math.max(
      ...summary.max.map((value) => Math.abs(value)),
      ...summary.min.map((value) => Math.abs(value)),
      0.000001,
    );
    peakValues.push(ampToDb(peakAmp) + gain);
    rmsValues.push(estimateSummaryRms(summary) + gain);
  }

  if (peakValues.length === 0 || rmsValues.length === 0) return null;
  const peakDb = Math.max(...peakValues);
  const rmsDb = averageDbAsPower(rmsValues);
  const crestDb = Math.max(0, peakDb - rmsDb);
  const peakRiskDb = round1(
    Math.max(0, peakDb + 3) +
    Math.max(0, crestDb - 10) * 0.25 +
    Math.max(0, -18 - rmsDb) * 0.08,
  );

  return {
    trackId: track.id,
    trackName: track.name,
    role: track.role,
    peakDb: round1(peakDb),
    rmsDb: round1(rmsDb),
    crestDb: round1(crestDb),
    peakRiskDb,
    suggestedAction: suggestPeakCulpritAction(track.role, peakDb, rmsDb, crestDb),
  };
}

function suggestPeakCulpritAction(role: StemRole, peakDb: number, rmsDb: number, crestDb: number) {
  if (role === "drums") return "瞬間ピーク候補です。まず軽いdensity / transient smoothingを検討し、強いmaster limiterで押し込まないでください。";
  if (role === "vocal" || role === "backingVocal") return crestDb > 11 ? "子音スパイク候補です。De-esserを強くしすぎず、必要なら軽いピーク整理を検討します。" : "Vocalは前に残す対象です。音量を下げる前にsupport maskingを確認してください。";
  if (role === "bass") return "Bassの芯は中央に保護します。ピークが高い場合は低域を削りすぎず、軽いdensityで整えます。";
  if (rmsDb < -22 && peakDb > -4) return "低RMS・高ピーク候補です。不要なスパイクやclip単位の飛び出しを確認してください。";
  return "Supportのピーク候補です。Vocalの邪魔をしている帯域があれば、軽いmasking cleanupを優先します。";
}

function averageDb(values: number[]) {
  const amps = values.filter(Number.isFinite).map((value) => 10 ** (value / 20));
  if (amps.length === 0) return -60;
  return ampToDb(amps.reduce((sum, value) => sum + value, 0) / amps.length);
}

function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(0.000001, value));
}

function normalizeBand(value: number) {
  return clamp01((value + 48) / 42);
}

function isAimixGlowVocalTrack(track: Track) {
  if (track.role === "vocal" || track.role === "backingVocal") return true;
  const name = track.name.toLowerCase();
  return /lead[\s_-]*vocal|\bvocals?\b|backing[\s_-]*vocals?|\bbv\b/.test(name);
}

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatDb(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}dB`;
}

function formatLufs(value: number) {
  return `${value.toFixed(1)} LUFS`;
}

function formatPercentChange(before: number, after: number) {
  return `${Math.round(before * 100)}% -> ${Math.round(after * 100)}%`;
}

function formatTargetDb(value: number, exact = false) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(exact ? 2 : 1)}dB`;
}

function formatTargetLufs(target: MagicPolishResolvedTarget) {
  return `${target.targetIntegratedLufs.toFixed(target.exactReferenceGain ? 2 : 1)} LUFS`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function isLikelyMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? clamp(numberValue, min, max) : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const CENTER_ROLES = new Set<StemRole>(["vocal", "backingVocal", "drums", "bass", "reference"]);


function formatReferenceRuntimeState(state: ReferenceRuntimeState): string {
  const name = state.trackName ? `「${state.trackName}」` : "Reference";
  if (state.status === "ready") {
    return `${name} 解析OK: LUFS、帯域、空間、密度をAIMIX / Magic Polishの目標に使えます。Referenceトラックは解析・比較専用で、通常再生とWAV書き出しには混ぜません。`;
  }
  if (state.status === "analyzing") return `${name} を解析中です。`;
  if (state.status === "loaded") return `${name} は読み込み済みです。AIMIX実行時に解析して目標へ反映します。`;
  if (state.status === "error") return `Reference解析に失敗しました: ${state.error ?? "unknown error"}`;
  return "Referenceは未解析です。FilesのImport Reference Mixから読み込んだ音源をAIMIXの目標に使います。Referenceトラックは解析・比較専用で、通常再生とWAV書き出しには混ぜません。";
}

function runtimeFromLegacyReferenceMessage(message: string, current: ReferenceRuntimeState): ReferenceRuntimeState {
  const failed = message.includes("失敗") || message.toLowerCase().includes("error");
  const ready = message.includes("OK") || message.includes("解析OK");
  const none = message.includes("ありません") || message.includes("未解析") || message.includes("なし");
  return {
    ...current,
    status: failed ? "error" : ready ? "ready" : none ? "none" : current.status === "none" ? "loaded" : current.status,
    error: failed ? message : null,
    updatedAt: new Date().toISOString(),
  };
}

function averageNumber(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}
