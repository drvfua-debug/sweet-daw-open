import { processSoftClipperBuffer } from "../../audio/dsp/softClipper.ts";
import {
  analyzeFloat32ChannelsLoudness,
  estimateTruePeakDbtpFromChannels,
} from "../../audio/analysis/LoudnessAnalyzer.ts";
import type { MobileAudioQuality } from "../../audio/analysis/MobileProcessingBudget.ts";
import { analyzeMasterArtifacts, applyMasterArtifactGuard } from "./masterArtifactGuard.ts";
import {
  buildReferenceMasterPlan,
  capReferenceMasterPlan,
  type ReferenceMasterPlan,
} from "./referenceMasterPlan.ts";

export type SingleFileMasteringMode = "existing" | "directWavPolish" | "lightMaster" | "referenceCatchUp" | "loudnessOnly" | "loudRelease";
export type SingleFileTargetLufsSource = "ui" | "reference" | "preset";
export type SingleFileReferenceClarityMode = "off" | "softenCuts" | "catchUp";
export type SingleFileAudioChannel = Float32Array<ArrayBufferLike>;
export type SingleFileHeadroomMode = "off" | "analysis" | "apply";

export type SingleFileStageToggles = {
  safetyHpf: boolean;
  tiltBalance: boolean;
  toneCleanup: boolean;
  harshnessGuard: boolean;
  glueCompression: boolean;
  preLimiterClipper: boolean;
  targetLoudness: boolean;
  truePeakLimiter: boolean;
};

export type SingleFileMasteringSettings = {
  mode: SingleFileMasteringMode;
  targetLufs: number;
  referenceTargetLufs?: number;
  targetLufsSource?: SingleFileTargetLufsSource;
  truePeakCeilingDb: number;
  safetyHpfHz: number;
  tiltDb: number;
  tiltPivotHz: number;
  toneCleanupAmount: number;
  harshnessAmount: number;
  artifactGuardAmount: number;
  clipperDriveDb: number;
  clipperCeilingDb: number;
  clipperMix: number;
  referenceClarityMode?: SingleFileReferenceClarityMode;
  presenceCatchUpDb?: number;
  clarityCatchUpDb?: number;
  airCatchUpDb?: number;
  sheenCatchUpDb?: number;
  referenceSideMidDb?: number;
  referenceCorrelation?: number;
  referenceUltraAirSideMidDb?: number;
  referenceGlossSideMidDb?: number;
  referenceAirNoiseSideMidDb?: number;
  referencePresenceDb?: number;
  referenceAirDb?: number;
  referenceGlossDb?: number;
  referenceUltraAirDb?: number;
  referenceSheenDb?: number;
  referencePlrDb?: number;
  imageCatchUpAmount?: number;
  sideHighClampAmount?: number;
  falseAirRisk?: boolean;
  referenceDensityGateAmount?: number;
  referenceSubTrimDb?: number;
  referenceMidGlossShiftDb?: number;
  referenceMidSideRecoveryDb?: number;
  referenceTransparentCheck?: boolean;
  chunkedFixedTargetGainDb?: number | null;
  chunkedGlobalLufs?: number | null;
  headroomMode: SingleFileHeadroomMode;
  preMasterPeakCeilingDbfs: number | null;
  preMasterLoudnessHintLufs: number | null;
  stages: SingleFileStageToggles;
};

export type SingleFileMasteringMetrics = {
  peakDb: number;
  estimatedTruePeakDb: number;
  estimatedLufs: number;
  rmsDb: number;
  durationSec: number;
  sampleRate: number;
  channels: number;
  loudnessQuality: MobileAudioQuality;
  monoFoldDownRmsLossDb: number | null;
};

export type SingleFileTargetReport = {
  requestedTargetLufs: number;
  effectiveTargetLufs: number;
  targetLufsSource: SingleFileTargetLufsSource;
  referenceTargetLufs?: number;
  beforeLufs: number;
  afterLufs: number;
  overshootLu: number;
  underTargetLu: number;
  finalTrimDb: number;
  plrDb: number;
  minPlrDb: number;
  passed: boolean;
};

export type SingleFileMasteringResult = {
  channels: SingleFileAudioChannel[];
  before: SingleFileMasteringMetrics;
  after: SingleFileMasteringMetrics;
  limiterGainReductionDb: number;
  glueGainReductionDb: number;
  exportSafetyReport: SingleFileExportSafetyReport;
  referenceCatchUpGuardReport?: ReferenceCatchUpGuardReport;
  targetReport: SingleFileTargetReport;
  warnings: string[];
  actions: string[];
};

export type ReferenceCatchUpGuardReport = {
  requestedPushDb: number;
  appliedPushDb: number;
  heldBackDb: number;
  limiterGainReductionDb: number;
  targetLimiterBudgetDb: number;
  presenceLiftDb: number;
  clarityDb: number;
  airDb: number;
  sheenDb: number;
  densityAmount: number;
  warnings: string[];
};

export type SingleFileExportSafetyReport = {
  requestedTruePeakCeilingDbtp: number;
  measuredFinalTruePeakDbtp: number;
  truePeakCeilingReached: boolean;
  requestedReferenceTrimDb: number;
  appliedFinalOutputTrimDb: number;
  truePeakSafetyTrimDb: number;
  heldBackByTruePeakDb: number;
  headroomMode: SingleFileHeadroomMode;
  requestedPreMasterPeakCeilingDbfs: number | null;
  requestedPreMasterLoudnessHintLufs: number | null;
  measuredPreMasterPeakBeforeDbfs: number | null;
  measuredPreMasterLufsBefore: number | null;
  appliedHeadroomTrimDb: number;
  measuredPreMasterPeakAfterDbfs: number | null;
  measuredPreMasterLufsAfter: number | null;
  targetLufs: number;
  measuredFinalLufs: number;
  targetLufsReached: boolean;
  targetLufsLimitedByTruePeak: boolean;
};

export type SingleFileMasteringProcessOptions = {
  copyInput?: boolean;
  quality?: MobileAudioQuality;
};

export type SingleFileMasteringAnalysisOptions = {
  quality?: MobileAudioQuality;
};

type SingleFileModePreset = {
  label: string;
  description: string;
  targetLufs: number;
  referenceTargetLufs?: number;
  targetLufsSource?: SingleFileTargetLufsSource;
  truePeakCeilingDb: number;
  safetyHpfHz: number;
  tiltDb: number;
  tiltPivotHz: number;
  toneCleanupAmount: number;
  harshnessAmount: number;
  artifactGuardAmount: number;
  clipperDriveDb: number;
  clipperCeilingDb: number;
  clipperMix: number;
  referenceClarityMode?: SingleFileReferenceClarityMode;
  presenceCatchUpDb?: number;
  clarityCatchUpDb?: number;
  airCatchUpDb?: number;
  sheenCatchUpDb?: number;
  referenceSideMidDb?: number;
  referenceCorrelation?: number;
  referenceUltraAirSideMidDb?: number;
  referenceGlossSideMidDb?: number;
  referenceAirNoiseSideMidDb?: number;
  referencePresenceDb?: number;
  referenceAirDb?: number;
  referenceGlossDb?: number;
  referenceUltraAirDb?: number;
  referenceSheenDb?: number;
  referencePlrDb?: number;
  imageCatchUpAmount?: number;
  sideHighClampAmount?: number;
  falseAirRisk?: boolean;
  referenceDensityGateAmount?: number;
  referenceSubTrimDb?: number;
  referenceMidGlossShiftDb?: number;
  referenceMidSideRecoveryDb?: number;
  referenceTransparentCheck?: boolean;
  chunkedFixedTargetGainDb?: number | null;
  chunkedGlobalLufs?: number | null;
  headroomMode?: SingleFileHeadroomMode;
  preMasterPeakCeilingDbfs?: number | null;
  preMasterLoudnessHintLufs?: number | null;
  stages: SingleFileStageToggles;
  warning?: string;
};

const DEFAULT_STAGES: SingleFileStageToggles = {
  safetyHpf: true,
  tiltBalance: true,
  toneCleanup: true,
  harshnessGuard: true,
  glueCompression: true,
  preLimiterClipper: true,
  targetLoudness: true,
  truePeakLimiter: true,
};
const LUFS_FROM_RMS_OFFSET_DB = -1.2;

export const SINGLE_FILE_MASTERING_MODE_PRESETS: Record<Exclude<SingleFileMasteringMode, "existing">, SingleFileModePreset> = {
  directWavPolish: {
    label: "Direct WAV Polish",
    description: "直WAV 1本用。原音の音圧と音色を大きく変えず、Artifact Guard・中域だけの薄いSpatial・True Peak保護を行います。",
    targetLufs: -12,
    truePeakCeilingDb: -1.2,
    safetyHpfHz: 0,
    tiltDb: 0,
    tiltPivotHz: 1000,
    toneCleanupAmount: 0,
    harshnessAmount: 0,
    artifactGuardAmount: 0.22,
    clipperDriveDb: 0,
    clipperCeilingDb: -1.2,
    clipperMix: 0,
    stages: {
      safetyHpf: false,
      tiltBalance: false,
      toneCleanup: false,
      harshnessGuard: false,
      glueCompression: false,
      preLimiterClipper: false,
      targetLoudness: false,
      truePeakLimiter: true,
    },
  },
  lightMaster: {
    label: "Light Master",
    description: "Safe final polish around -14 LUFS with gentle cleanup and peak protection.",
    targetLufs: -14,
    truePeakCeilingDb: -1,
    safetyHpfHz: 60,
    tiltDb: 0.35,
    tiltPivotHz: 1000,
    toneCleanupAmount: 1,
    harshnessAmount: 0.35,
    artifactGuardAmount: 0.18,
    clipperDriveDb: 1.3,
    clipperCeilingDb: -1,
    clipperMix: 0.45,
    stages: { ...DEFAULT_STAGES },
  },
  referenceCatchUp: {
    label: "Reference Catch-Up",
    description: "Reference LUFS target with safe peak-first catch-up. It keeps clarity forward instead of making the mix dull.",
    targetLufs: -14,
    truePeakCeilingDb: -1,
    safetyHpfHz: 45,
    tiltDb: 0.15,
    tiltPivotHz: 1000,
    toneCleanupAmount: 0.35,
    harshnessAmount: 0.22,
    artifactGuardAmount: 0.22,
    clipperDriveDb: 2.15,
    clipperCeilingDb: -1,
    clipperMix: 0.58,
    referenceClarityMode: "catchUp",
    presenceCatchUpDb: 0.7,
    clarityCatchUpDb: 0.52,
    airCatchUpDb: 0.16,
    sheenCatchUpDb: 0.65,
    imageCatchUpAmount: 0.65,
    sideHighClampAmount: 0.85,
    stages: { ...DEFAULT_STAGES },
  },
  loudnessOnly: {
    label: "Loudness Only",
    description: "Gain and true-peak limiting only. EQ, HPF, harshness guard, and glue are bypassed.",
    targetLufs: -14,
    truePeakCeilingDb: -1,
    safetyHpfHz: 0,
    tiltDb: 0,
    tiltPivotHz: 1000,
    toneCleanupAmount: 0,
    harshnessAmount: 0,
    artifactGuardAmount: 0,
    clipperDriveDb: 0,
    clipperCeilingDb: -1,
    clipperMix: 0,
    stages: {
      safetyHpf: false,
      tiltBalance: false,
      toneCleanup: false,
      harshnessGuard: false,
      glueCompression: false,
      preLimiterClipper: false,
      targetLoudness: true,
      truePeakLimiter: true,
    },
  },
  loudRelease: {
    label: "Loud Release",
    description: "Stronger release-style level around -9 LUFS with safety warnings when limiting becomes heavy.",
    targetLufs: -9,
    truePeakCeilingDb: -1,
    safetyHpfHz: 60,
    tiltDb: 0.55,
    tiltPivotHz: 1000,
    toneCleanupAmount: 1,
    harshnessAmount: 0.45,
    artifactGuardAmount: 0.2,
    clipperDriveDb: 2.4,
    clipperCeilingDb: -1,
    clipperMix: 0.65,
    stages: { ...DEFAULT_STAGES },
    warning: "Loud Release may flatten dynamics when the limiter gain reduction becomes high.",
  },
};

export function resolveSingleFileMasteringSettings(
  mode: SingleFileMasteringMode,
  overrides: Partial<Omit<SingleFileMasteringSettings, "mode">> = {},
): SingleFileMasteringSettings {
  if (mode === "existing") {
    return {
      mode,
      targetLufs: -14,
      referenceTargetLufs: undefined,
      targetLufsSource: "preset",
      truePeakCeilingDb: -1,
      safetyHpfHz: 0,
      tiltDb: 0,
      tiltPivotHz: 1000,
      toneCleanupAmount: 1,
      harshnessAmount: 0.35,
      artifactGuardAmount: 0.18,
      clipperDriveDb: 1.2,
      clipperCeilingDb: -1,
      clipperMix: 0.45,
      referenceClarityMode: "off",
      presenceCatchUpDb: 0,
      clarityCatchUpDb: 0,
      airCatchUpDb: 0,
      sheenCatchUpDb: 0,
      referenceSideMidDb: undefined,
      referenceCorrelation: undefined,
      referenceUltraAirSideMidDb: undefined,
      referenceGlossSideMidDb: undefined,
      referenceAirNoiseSideMidDb: undefined,
      referencePresenceDb: undefined,
      referenceAirDb: undefined,
      referenceGlossDb: undefined,
      referenceUltraAirDb: undefined,
      referenceSheenDb: undefined,
      referencePlrDb: undefined,
      imageCatchUpAmount: 0,
      sideHighClampAmount: 0,
      falseAirRisk: false,
      referenceDensityGateAmount: 0,
      referenceSubTrimDb: 0,
      referenceMidGlossShiftDb: 0,
      referenceMidSideRecoveryDb: 0,
      referenceTransparentCheck: false,
      chunkedFixedTargetGainDb: null,
      chunkedGlobalLufs: null,
      headroomMode: "analysis",
      preMasterPeakCeilingDbfs: -6,
      preMasterLoudnessHintLufs: -18,
      stages: { ...DEFAULT_STAGES },
    };
  }

  const preset = SINGLE_FILE_MASTERING_MODE_PRESETS[mode];
  const stages = {
    ...preset.stages,
    ...(overrides.stages ?? {}),
  };
  const resolved: SingleFileMasteringSettings = {
    mode,
    targetLufs: clampNumber(overrides.targetLufs ?? preset.targetLufs, -24, -6),
    referenceTargetLufs: Number.isFinite(overrides.referenceTargetLufs) ? clampNumber(Number(overrides.referenceTargetLufs), -30, -3) : preset.referenceTargetLufs,
    targetLufsSource: overrides.targetLufsSource ?? preset.targetLufsSource ?? (overrides.targetLufs !== undefined ? "ui" : "preset"),
    truePeakCeilingDb: clampNumber(overrides.truePeakCeilingDb ?? preset.truePeakCeilingDb, -6, -1),
    safetyHpfHz: clampNumber(overrides.safetyHpfHz ?? preset.safetyHpfHz, 0, 180),
    tiltDb: clampNumber(overrides.tiltDb ?? preset.tiltDb, -1.5, 1.5),
    tiltPivotHz: clampNumber(overrides.tiltPivotHz ?? preset.tiltPivotHz, 500, 2500),
    toneCleanupAmount: clampNumber(overrides.toneCleanupAmount ?? preset.toneCleanupAmount, 0, 1),
    harshnessAmount: clampNumber(overrides.harshnessAmount ?? preset.harshnessAmount, 0, 1),
    artifactGuardAmount: clampNumber(overrides.artifactGuardAmount ?? preset.artifactGuardAmount, 0, 1),
    clipperDriveDb: clampNumber(overrides.clipperDriveDb ?? preset.clipperDriveDb, 0, 12),
    clipperCeilingDb: clampNumber(overrides.clipperCeilingDb ?? preset.clipperCeilingDb, -6, -0.1),
    clipperMix: clampNumber(overrides.clipperMix ?? preset.clipperMix, 0, 1),
    referenceClarityMode: overrides.referenceClarityMode ?? preset.referenceClarityMode ?? "off",
    presenceCatchUpDb: clampNumber(overrides.presenceCatchUpDb ?? preset.presenceCatchUpDb ?? 0, 0, 1.5),
    clarityCatchUpDb: clampNumber(overrides.clarityCatchUpDb ?? preset.clarityCatchUpDb ?? 0, 0, 1.1),
    airCatchUpDb: clampNumber(overrides.airCatchUpDb ?? preset.airCatchUpDb ?? 0, 0, 0.8),
    sheenCatchUpDb: clampNumber(overrides.sheenCatchUpDb ?? preset.sheenCatchUpDb ?? 0, 0, 4.8),
    referenceSideMidDb: Number.isFinite(overrides.referenceSideMidDb) ? clampNumber(Number(overrides.referenceSideMidDb), -36, 6) : preset.referenceSideMidDb,
    referenceCorrelation: Number.isFinite(overrides.referenceCorrelation) ? clampNumber(Number(overrides.referenceCorrelation), -1, 1) : preset.referenceCorrelation,
    referenceUltraAirSideMidDb: Number.isFinite(overrides.referenceUltraAirSideMidDb) ? clampNumber(Number(overrides.referenceUltraAirSideMidDb), -48, 12) : preset.referenceUltraAirSideMidDb,
    referenceGlossSideMidDb: Number.isFinite(overrides.referenceGlossSideMidDb) ? clampNumber(Number(overrides.referenceGlossSideMidDb), -48, 12) : preset.referenceGlossSideMidDb,
    referenceAirNoiseSideMidDb: Number.isFinite(overrides.referenceAirNoiseSideMidDb) ? clampNumber(Number(overrides.referenceAirNoiseSideMidDb), -48, 12) : preset.referenceAirNoiseSideMidDb,
    referencePresenceDb: Number.isFinite(overrides.referencePresenceDb) ? clampNumber(Number(overrides.referencePresenceDb), -96, 12) : preset.referencePresenceDb,
    referenceAirDb: Number.isFinite(overrides.referenceAirDb) ? clampNumber(Number(overrides.referenceAirDb), -96, 12) : preset.referenceAirDb,
    referenceGlossDb: Number.isFinite(overrides.referenceGlossDb) ? clampNumber(Number(overrides.referenceGlossDb), -96, 12) : preset.referenceGlossDb,
    referenceUltraAirDb: Number.isFinite(overrides.referenceUltraAirDb) ? clampNumber(Number(overrides.referenceUltraAirDb), -96, 12) : preset.referenceUltraAirDb,
    referenceSheenDb: Number.isFinite(overrides.referenceSheenDb) ? clampNumber(Number(overrides.referenceSheenDb), -96, 12) : preset.referenceSheenDb,
    referencePlrDb: Number.isFinite(overrides.referencePlrDb) ? clampNumber(Number(overrides.referencePlrDb), 4, 28) : preset.referencePlrDb,
    imageCatchUpAmount: clampNumber(overrides.imageCatchUpAmount ?? preset.imageCatchUpAmount ?? 0, 0, 1),
    sideHighClampAmount: clampNumber(overrides.sideHighClampAmount ?? preset.sideHighClampAmount ?? 0, 0, 1),
    falseAirRisk: Boolean(overrides.falseAirRisk ?? preset.falseAirRisk ?? false),
    referenceDensityGateAmount: clampNumber(overrides.referenceDensityGateAmount ?? preset.referenceDensityGateAmount ?? 0, 0, 1),
    referenceSubTrimDb: clampNumber(overrides.referenceSubTrimDb ?? preset.referenceSubTrimDb ?? 0, 0, 3),
    referenceMidGlossShiftDb: clampNumber(overrides.referenceMidGlossShiftDb ?? preset.referenceMidGlossShiftDb ?? 0, 0, 4),
    referenceMidSideRecoveryDb: clampNumber(overrides.referenceMidSideRecoveryDb ?? preset.referenceMidSideRecoveryDb ?? 0, 0, 2),
    referenceTransparentCheck: Boolean(overrides.referenceTransparentCheck ?? preset.referenceTransparentCheck ?? false),
    chunkedFixedTargetGainDb: Number.isFinite(overrides.chunkedFixedTargetGainDb)
      ? clampNumber(Number(overrides.chunkedFixedTargetGainDb), -18, 18)
      : preset.chunkedFixedTargetGainDb ?? null,
    chunkedGlobalLufs: Number.isFinite(overrides.chunkedGlobalLufs)
      ? clampNumber(Number(overrides.chunkedGlobalLufs), -36, 0)
      : preset.chunkedGlobalLufs ?? null,
    headroomMode: isSingleFileHeadroomMode(overrides.headroomMode ?? preset.headroomMode) ? (overrides.headroomMode ?? preset.headroomMode)! : "analysis",
    preMasterPeakCeilingDbfs: Number.isFinite(overrides.preMasterPeakCeilingDbfs)
      ? clampNumber(Number(overrides.preMasterPeakCeilingDbfs), -24, -0.1)
      : preset.preMasterPeakCeilingDbfs ?? -6,
    preMasterLoudnessHintLufs: Number.isFinite(overrides.preMasterLoudnessHintLufs)
      ? clampNumber(Number(overrides.preMasterLoudnessHintLufs), -36, -6)
      : preset.preMasterLoudnessHintLufs ?? -18,
    stages,
  };

  if (mode === "loudnessOnly") {
    return {
      ...resolved,
      safetyHpfHz: 0,
      tiltDb: 0,
      tiltPivotHz: 1000,
      toneCleanupAmount: 0,
      harshnessAmount: 0,
      artifactGuardAmount: 0,
      clipperDriveDb: 0,
      clipperMix: 0,
      referenceClarityMode: "off",
      presenceCatchUpDb: 0,
      clarityCatchUpDb: 0,
      airCatchUpDb: 0,
      sheenCatchUpDb: 0,
      referenceSideMidDb: undefined,
      referenceCorrelation: undefined,
      referenceUltraAirSideMidDb: undefined,
      referenceGlossSideMidDb: undefined,
      referenceAirNoiseSideMidDb: undefined,
      referencePresenceDb: undefined,
      referenceAirDb: undefined,
      referenceGlossDb: undefined,
      referenceUltraAirDb: undefined,
      referenceSheenDb: undefined,
      referencePlrDb: undefined,
      imageCatchUpAmount: 0,
      sideHighClampAmount: 0,
      falseAirRisk: false,
      referenceDensityGateAmount: 0,
      referenceSubTrimDb: 0,
      referenceMidGlossShiftDb: 0,
      referenceMidSideRecoveryDb: 0,
      referenceTransparentCheck: false,
      chunkedFixedTargetGainDb: resolved.chunkedFixedTargetGainDb,
      chunkedGlobalLufs: resolved.chunkedGlobalLufs,
      headroomMode: resolved.headroomMode,
      preMasterPeakCeilingDbfs: resolved.preMasterPeakCeilingDbfs,
      preMasterLoudnessHintLufs: resolved.preMasterLoudnessHintLufs,
      stages: {
        safetyHpf: false,
        tiltBalance: false,
        toneCleanup: false,
        harshnessGuard: false,
        glueCompression: false,
        preLimiterClipper: false,
        targetLoudness: true,
        truePeakLimiter: true,
      },
    };
  }

  return resolved;
}

function shouldUseTransparentReferenceCheck(
  settings: SingleFileMasteringSettings,
  before: SingleFileMasteringMetrics,
) {
  if (settings.mode !== "referenceCatchUp") return false;
  if (settings.referenceTransparentCheck) {
    const targetDeltaLu = Math.abs(settings.targetLufs - before.estimatedLufs);
    if (targetDeltaLu > 0.75) return false;
    const referencePlrDb = Number.isFinite(settings.referencePlrDb) ? Number(settings.referencePlrDb) : null;
    if (referencePlrDb != null) {
      const currentPlrDb = before.estimatedTruePeakDb - before.estimatedLufs;
      if (Math.abs(currentPlrDb - referencePlrDb) > 1.4) return false;
    }
    return true;
  }
  const requestedCorrectionDb = Math.max(
    settings.presenceCatchUpDb ?? 0,
    settings.clarityCatchUpDb ?? 0,
    settings.airCatchUpDb ?? 0,
    settings.sheenCatchUpDb ?? 0,
    settings.referenceDensityGateAmount ?? 0,
    settings.referenceSubTrimDb ?? 0,
    settings.referenceMidGlossShiftDb ?? 0,
    settings.referenceMidSideRecoveryDb ?? 0,
  );
  if (requestedCorrectionDb > 0.08) return false;

  const targetDeltaLu = Math.abs(settings.targetLufs - before.estimatedLufs);
  if (targetDeltaLu > 0.75) return false;

  const referencePlrDb = Number.isFinite(settings.referencePlrDb) ? Number(settings.referencePlrDb) : null;
  if (referencePlrDb != null) {
    const currentPlrDb = before.estimatedTruePeakDb - before.estimatedLufs;
    if (Math.abs(currentPlrDb - referencePlrDb) > 1.4) return false;
  }

  return true;
}

export function analyzeSingleFileMastering(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  options: SingleFileMasteringAnalysisOptions = {},
): SingleFileMasteringMetrics {
  assertValidAudio(channels, sampleRate);
  const quality = options.quality ?? "fast";
  const sampleCount = getCommonLength(channels);
  let peak = 0;
  let sumSquares = 0;
  let count = 0;

  for (const channel of channels) {
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = sanitizeSample(channel[index] ?? 0);
      const abs = Math.abs(sample);
      peak = Math.max(peak, abs);
      sumSquares += sample * sample;
      count += 1;
    }
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  const peakDb = gainToDb(peak);
  const rmsDb = gainToDb(rms);
  const hqAnalysis = quality === "fast"
    ? null
    : analyzeFloat32ChannelsLoudness(channels, sampleRate, { quality });
  const estimatedTruePeakDb = hqAnalysis?.truePeakDbtp ?? round2(peakDb + estimateInterSamplePeakMarginDb(channels, sampleCount));
  const estimatedLufs = hqAnalysis?.integratedLufs ?? round2(rmsDb + LUFS_FROM_RMS_OFFSET_DB);
  return {
    peakDb: round2(peakDb),
    estimatedTruePeakDb: round2(estimatedTruePeakDb),
    estimatedLufs: round2(estimatedLufs),
    rmsDb: round2(rmsDb),
    durationSec: round2(sampleCount / sampleRate),
    sampleRate,
    channels: channels.length,
    loudnessQuality: quality,
    monoFoldDownRmsLossDb: calculateMonoFoldDownRmsLossDb(channels, sampleCount),
  };
}

function isSingleFileHeadroomMode(value: unknown): value is SingleFileHeadroomMode {
  return value === "off" || value === "analysis" || value === "apply";
}

export function processSingleFileMastering(
  inputChannels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
  options: SingleFileMasteringProcessOptions = {},
): SingleFileMasteringResult {
  assertValidAudio(inputChannels, sampleRate);
  const resolved = resolveSingleFileMasteringSettings(settings.mode, settings);
  const finalQuality = options.quality ?? "mobile-hq";
  const before = analyzeSingleFileMastering(inputChannels, sampleRate);
  const warnings: string[] = [];
  const actions: string[] = [];
  const channels = options.copyInput === false ? sanitizeChannelsInPlace(inputChannels, warnings) : cloneAndSanitizeChannels(inputChannels, warnings);
  const chunkedFixedTargetGainDb = Number.isFinite(resolved.chunkedFixedTargetGainDb) ? Number(resolved.chunkedFixedTargetGainDb) : null;
  const useChunkedFixedTarget = chunkedFixedTargetGainDb != null;
  let glueGainReductionDb = 0;
  let limiterGainReductionDb = 0;
  let finalSafety: FinalTruePeakSafetyResult | null = null;
  let targetAuthorityTrimDb = 0;
  let frozenReferenceMasterPlan: ReferenceMasterPlan | null = null;
  const headroomReport = applyHeadroomPrep(channels, sampleRate, resolved);
  actions.push(headroomReport.action);
  const clarityGuardActive = (resolved.referenceClarityMode === "softenCuts" || resolved.referenceClarityMode === "catchUp") &&
    ((resolved.presenceCatchUpDb ?? 0) > 0.05 ||
      (resolved.clarityCatchUpDb ?? 0) > 0.05 ||
      (resolved.airCatchUpDb ?? 0) > 0.05 ||
      (resolved.sheenCatchUpDb ?? 0) > 0.05);
  const hasMeasuredReferenceTonalTargets = [
    resolved.referencePresenceDb,
    resolved.referenceAirDb,
    resolved.referenceGlossDb,
    resolved.referenceUltraAirDb,
    resolved.referenceSheenDb,
  ].some((value) => Number.isFinite(value));
  const transparentReferenceCheck = shouldUseTransparentReferenceCheck(resolved, before);
  if (transparentReferenceCheck) {
    actions.push("Reference Transparent Check: source is already close to the Reference target, so tone/glue/clipper/spatial catch-up stays bypassed.");
  }

  if (!transparentReferenceCheck && resolved.stages.safetyHpf && resolved.safetyHpfHz > 0) {
    applyBiquadToChannels(channels, makeHighpass(sampleRate, resolved.safetyHpfHz, 0.707));
    actions.push(`Safety HPF ${resolved.safetyHpfHz.toFixed(0)} Hz`);
  } else {
    actions.push(transparentReferenceCheck ? "Safety HPF bypassed for transparent Reference check" : "Safety HPF bypassed");
  }

  if (!transparentReferenceCheck && resolved.stages.tiltBalance && Math.abs(resolved.tiltDb) >= 0.05) {
    const lowGainDb = -resolved.tiltDb * 0.5;
    const highGainDb = resolved.tiltDb * 0.5;
    applyBiquadToChannels(channels, makeLowshelf(sampleRate, resolved.tiltPivotHz, lowGainDb, 0.7));
    applyBiquadToChannels(channels, makeHighshelf(sampleRate, resolved.tiltPivotHz, highGainDb, 0.7));
    actions.push(`Tilt Balance ${resolved.tiltDb >= 0 ? "+" : ""}${resolved.tiltDb.toFixed(1)} dB around ${resolved.tiltPivotHz.toFixed(0)} Hz`);
  } else {
    actions.push("Tilt Balance bypassed");
  }

  if (!transparentReferenceCheck && resolved.stages.toneCleanup && resolved.toneCleanupAmount > 0) {
    const amount = resolved.toneCleanupAmount;
    const sheenOnlyCatchUp = clarityGuardActive &&
      (resolved.presenceCatchUpDb ?? 0) < 0.08 &&
      (resolved.clarityCatchUpDb ?? 0) < 0.08 &&
      (resolved.sheenCatchUpDb ?? 0) > 0.3;
    const presenceCleanupDb = clarityGuardActive
      ? (resolved.presenceCatchUpDb ?? 0) > 0.45 ? 0 : sheenOnlyCatchUp ? -0.45 * amount : -0.08 * amount
      : -0.35 * amount;
    applyBiquadToChannels(channels, makePeaking(sampleRate, 280, -0.75 * amount, 0.9));
    if (Math.abs(presenceCleanupDb) >= 0.01) {
      applyBiquadToChannels(channels, makePeaking(sampleRate, 3500, presenceCleanupDb, 1.1));
    }
    actions.push(clarityGuardActive
      ? `Tone Cleanup muffle guard: 280Hz cleanup kept / 3.5kHz cut ${presenceCleanupDb.toFixed(2)}dB`
      : amount < 0.99
        ? `Tone Cleanup softened ${(amount * 100).toFixed(0)}%`
        : "Tone Cleanup: gentle low-mid and presence smoothing");
  } else {
    actions.push("Tone Cleanup bypassed");
  }

  if (!transparentReferenceCheck && resolved.stages.harshnessGuard && resolved.harshnessAmount > 0) {
    const amount = resolved.harshnessAmount;
    const harshnessScale = clarityGuardActive ? 0.35 : 1;
    applyBiquadToChannels(channels, makePeaking(sampleRate, 6500, -1.2 * amount * harshnessScale, 2.2));
    applyBiquadToChannels(channels, makePeaking(sampleRate, 9200, -0.9 * amount * harshnessScale, 2.0));
    actions.push(clarityGuardActive
      ? `Harshness Guard muffle-safe ${(amount * harshnessScale * 100).toFixed(0)}%`
      : `Harshness Guard ${(amount * 100).toFixed(0)}%`);
  } else {
    actions.push("Harshness Guard bypassed");
  }

  if (resolved.artifactGuardAmount > 0.01 && resolved.mode !== "loudnessOnly") {
    const artifactAnalysis = analyzeMasterArtifacts(channels, sampleRate);
    const transparentArtifactAllowed = !transparentReferenceCheck ||
      artifactAnalysis.scores.hiss >= 65 ||
      artifactAnalysis.scores.metallic >= 65 ||
      artifactAnalysis.scores.fakeAirRisk >= 78;
    if (transparentArtifactAllowed) {
      const preArtifactHarshnessApplied = !transparentReferenceCheck && resolved.stages.harshnessGuard && resolved.harshnessAmount > 0;
      const baseMaxCutDb = resolved.mode === "loudRelease" ? 1.35 : 1.55;
      const artifactMaxCutDb = preArtifactHarshnessApplied
        ? Math.min(baseMaxCutDb, resolved.mode === "loudRelease" ? 1.1 : 0.95)
        : baseMaxCutDb;
      const artifactAmount = transparentReferenceCheck
        ? Math.min(resolved.artifactGuardAmount, 0.12)
        : resolved.artifactGuardAmount;
      const artifactGuard = applyMasterArtifactGuard(channels, sampleRate, {
        amount: artifactAmount,
        preserveBrightness: clarityGuardActive || resolved.referenceClarityMode === "catchUp",
        maxCutDb: artifactMaxCutDb,
      });
      actions.push(artifactGuard.action);
      warnings.push(...artifactGuard.warnings);
    } else {
      actions.push(`Master Artifact Guard transparent bypassed: hiss ${artifactAnalysis.scores.hiss.toFixed(0)} / metallic ${artifactAnalysis.scores.metallic.toFixed(0)} / fake-air ${artifactAnalysis.scores.fakeAirRisk.toFixed(0)}`);
    }
  } else {
    actions.push("Master Artifact Guard bypassed");
  }

  if (!transparentReferenceCheck && resolved.mode === "directWavPolish") {
    actions.push(applyDirectWavSpatialPolish(channels, sampleRate));
  }

  if (!transparentReferenceCheck && resolved.referenceClarityMode === "catchUp") {
    actions.push(...(hasMeasuredReferenceTonalTargets
      ? ["Reference Clarity Catch-Up delegated to one frozen Reference Master Plan."]
      : applyReferenceClarityCatchUp(channels, sampleRate, resolved)));
    actions.push(...applyReferenceMeasuredCorrections(channels, sampleRate, resolved));

    const sidePolicy = getSideHighClampPolicy(channels, sampleRate, resolved);
    frozenReferenceMasterPlan = buildReferenceMasterPlan(
      resolved,
      measureReferenceTonalEnergy(channels, sampleRate),
      {
        blockHighShelfBoost: Boolean(sidePolicy?.blockHighShelfBoost) || Boolean(resolved.falseAirRisk),
        preferMidOnlySheen: shouldPreferMidOnlySheen(sidePolicy, resolved),
      },
    );
    actions.push(...applyFrozenReferenceMasterPlan(channels, sampleRate, frozenReferenceMasterPlan, "Reference Master Plan"));
    actions.push(applyReferenceSideHighClamp(channels, sampleRate, resolved, sidePolicy ?? undefined));
  }

  if (!transparentReferenceCheck && (resolved.imageCatchUpAmount ?? 0) > 0) {
    actions.push(applyReferenceImageCatchUp(channels, resolved));
  }

  if (!transparentReferenceCheck && resolved.stages.glueCompression) {
    const densityGuarded = resolved.mode === "referenceCatchUp" && (resolved.referenceDensityGateAmount ?? 0) > 0.02;
    const compressed = applyGlueCompression(
      channels,
      resolved.mode === "loudRelease" ? -15 : densityGuarded ? -12.2 : -13,
      resolved.mode === "loudRelease" ? 1.7 : densityGuarded ? 1.32 : 1.45,
    );
    glueGainReductionDb = compressed.maxGainReductionDb;
    actions.push(`Glue Compression${densityGuarded ? " density-safe" : ""} max GR ${glueGainReductionDb.toFixed(1)} dB`);
    if (glueGainReductionDb > 2.5) {
      warnings.push("Glue compression is working hard. Consider a lighter mode.");
    }
  } else {
    actions.push("Glue Compression bypassed");
  }

  if (!transparentReferenceCheck && resolved.stages.preLimiterClipper && resolved.clipperMix > 0 && resolved.clipperDriveDb > 0) {
    const beforeClip = analyzeSingleFileMastering(channels, sampleRate);
    const referenceDensityAmount = resolved.mode === "referenceCatchUp"
      ? clampNumber(resolved.referenceDensityGateAmount ?? 0, 0, 1)
      : 1;
    const referenceClipScale = resolved.mode === "referenceCatchUp"
      ? clampNumber(0.52 + referenceDensityAmount * 0.38, 0.52, 0.92)
      : 1;
    const referenceClipMixScale = resolved.mode === "referenceCatchUp"
      ? clampNumber(0.56 + referenceDensityAmount * 0.34, 0.56, 0.92)
      : 1;
    const clipperDriveDb = resolved.clipperDriveDb * referenceClipScale;
    const clipperMix = resolved.clipperMix * referenceClipMixScale;
    processSoftClipperBuffer(channels, {
      mode: resolved.mode === "loudRelease" ? "medium" : "soft",
      driveDb: clipperDriveDb,
      ceilingDb: resolved.clipperCeilingDb,
      knee: resolved.mode === "loudRelease" ? 0.38 : 0.55,
      hardness: resolved.mode === "loudRelease" ? 0.55 : resolved.mode === "referenceCatchUp" ? 0.24 + referenceDensityAmount * 0.1 : 0.35,
      mix: clipperMix,
      outputDb: -0.3,
    }, { copy: false });
    const afterClip = analyzeSingleFileMastering(channels, sampleRate);
    const peakReductionDb = Math.max(0, beforeClip.estimatedTruePeakDb - afterClip.estimatedTruePeakDb);
    actions.push(
      `Pre-Limiter Clipper drive +${clipperDriveDb.toFixed(1)}dB / ceiling ${resolved.clipperCeilingDb.toFixed(1)}dB / mix ${(clipperMix * 100).toFixed(0)}% / peak ${peakReductionDb.toFixed(1)}dB${resolved.mode === "referenceCatchUp" ? " / reference-transparent" : ""}`,
    );
    if (clipperDriveDb > 3 || clipperMix > 0.75 || peakReductionDb > 3) {
      warnings.push("Pre-limiter clipping is strong. Reduce target loudness or fix track peaks before mastering.");
    }
  } else {
    actions.push("Pre-Limiter Clipper bypassed");
  }

  if (!transparentReferenceCheck && resolved.stages.targetLoudness) {
    const current = analyzeSingleFileMastering(channels, sampleRate, { quality: finalQuality });
    let gainDb = useChunkedFixedTarget
      ? chunkedFixedTargetGainDb ?? 0
      : clampNumber(resolved.targetLufs - current.estimatedLufs, -18, 18);
    if (!useChunkedFixedTarget) {
      const maxTargetGainDb = getSingleFileMaxTargetGainDb(resolved, current);
      if (gainDb > maxTargetGainDb + 0.05) {
        actions.push(`Target Guard: gain capped at ${maxTargetGainDb >= 0 ? "+" : ""}${maxTargetGainDb.toFixed(1)}dB to protect PLR/limiter load`);
        gainDb = maxTargetGainDb;
      }
      const protectedGainDb = protectReferenceGainForAudition(channels, sampleRate, resolved, gainDb);
      if (protectedGainDb < gainDb - 0.05) {
        actions.push(`Audition Guard: target gain held ${protectedGainDb >= 0 ? "+" : ""}${protectedGainDb.toFixed(1)}dB instead of ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)}dB to avoid limiter haze`);
        gainDb = protectedGainDb;
      }
    }
    applyGainToChannels(channels, dbToGain(gainDb));
    actions.push(useChunkedFixedTarget
      ? `Target Loudness ${resolved.targetLufs.toFixed(1)} LUFS / fixed full-song chunk gain ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB${Number.isFinite(resolved.chunkedGlobalLufs) ? ` / scanned ${Number(resolved.chunkedGlobalLufs).toFixed(1)} LUFS` : ""}`
      : `Target Loudness ${resolved.targetLufs.toFixed(1)} LUFS / gain ${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB`);
  } else {
    actions.push(transparentReferenceCheck ? "Target Loudness bypassed for transparent Reference check" : "Target Loudness bypassed");
  }

  if (resolved.stages.truePeakLimiter) {
    const preLimiterReliefDb = applyReferencePreLimiterRelief(channels, sampleRate, resolved);
    if (preLimiterReliefDb < 0) {
      actions.push(`Reference Peak Relief ${preLimiterReliefDb.toFixed(1)}dB before limiter to preserve transients`);
    }
    const limited = applyPeakCeiling(channels, resolved.truePeakCeilingDb);
    limiterGainReductionDb = limited.gainReductionDb;
    actions.push(`True Peak Limiter ceiling ${resolved.truePeakCeilingDb.toFixed(1)} dBTP / GR ${limiterGainReductionDb.toFixed(1)} dB`);
  } else {
    actions.push("True Peak Limiter bypassed");
  }

  if (!transparentReferenceCheck && resolved.mode === "referenceCatchUp" && resolved.stages.targetLoudness && resolved.stages.truePeakLimiter && !useChunkedFixedTarget) {
    const catchUp = applyReferenceCatchUp(channels, sampleRate, resolved, limiterGainReductionDb);
    limiterGainReductionDb = Math.max(limiterGainReductionDb, catchUp.limiterGainReductionDb);
    actions.push(...catchUp.actions);
    warnings.push(...catchUp.warnings);

    const densityRecovery = applyReferencePeakDensityRecovery(channels, sampleRate, resolved, limiterGainReductionDb, finalQuality);
    limiterGainReductionDb = Math.max(limiterGainReductionDb, densityRecovery.limiterGainReductionDb);
    actions.push(...densityRecovery.actions);
    warnings.push(...densityRecovery.warnings);
  } else if (!transparentReferenceCheck && useChunkedFixedTarget && resolved.mode === "referenceCatchUp") {
    actions.push("Chunked full-song target: per-chunk Reference gain catch-up bypassed to avoid loudness pumping.");
  }

  if (!transparentReferenceCheck && resolved.mode === "referenceCatchUp") {
    const crestSafety = applyReferenceCrestSafetyPass(channels, sampleRate, resolved, finalQuality);
    actions.push(...crestSafety.actions);
    warnings.push(...crestSafety.warnings);
    limiterGainReductionDb = Math.max(limiterGainReductionDb, crestSafety.limiterGainReductionDb);
  }

  if (!transparentReferenceCheck && !useChunkedFixedTarget && resolved.mode === "referenceCatchUp" && resolved.stages.targetLoudness && resolved.stages.truePeakLimiter) {
    const finalCatchUp = applyFinalTargetLufsCatchUpGain(channels, sampleRate, {
      targetLufs: resolved.targetLufs,
      truePeakCeilingDb: resolved.truePeakCeilingDb,
      quality: finalQuality,
    });
    if (finalCatchUp.applied) {
      const limited = applyPeakCeiling(channels, resolved.truePeakCeilingDb);
      limiterGainReductionDb = Math.max(limiterGainReductionDb, limited.gainReductionDb);
      actions.push(`Post-density target recovery +${finalCatchUp.gainDb.toFixed(2)}dB / ${finalCatchUp.beforeLufs.toFixed(1)} -> ${finalCatchUp.afterLufs.toFixed(1)} LUFS`);
    } else {
      actions.push("Post-density target recovery bypassed: no safe peak headroom.");
    }
  }

  if (!transparentReferenceCheck && resolved.stages.targetLoudness && !useChunkedFixedTarget) {
    const targetAuthority = applyFinalTargetLufsAuthorityTrim(channels, sampleRate, {
      targetLufs: resolved.targetLufs,
      upperToleranceLu: 0.2,
      quality: finalQuality,
    });
    targetAuthorityTrimDb = targetAuthority.trimDb;
    if (targetAuthority.applied) {
      actions.push(`Target LUFS authority trim ${targetAuthority.trimDb.toFixed(2)} dB / ${targetAuthority.beforeLufs.toFixed(1)} -> ${targetAuthority.afterLufs.toFixed(1)} LUFS`);
    }
  } else if (!transparentReferenceCheck && useChunkedFixedTarget && resolved.stages.targetLoudness) {
    actions.push("Chunked full-song target: final LUFS authority trim bypassed for chunk consistency.");
  }

  if (!transparentReferenceCheck && resolved.mode === "referenceCatchUp" && resolved.referenceClarityMode === "catchUp") {
    const residualSidePolicy = getSideHighClampPolicy(channels, sampleRate, resolved);
    const residualPlan = buildReferenceMasterPlan(
      resolved,
      measureReferenceTonalEnergy(channels, sampleRate),
      {
        blockHighShelfBoost: Boolean(residualSidePolicy?.blockHighShelfBoost) || Boolean(resolved.falseAirRisk),
        preferMidOnlySheen: shouldPreferMidOnlySheen(residualSidePolicy, resolved),
      },
    );
    actions.push(...applyFrozenReferenceMasterPlan(
      channels,
      sampleRate,
      residualPlan == null ? null : capReferenceMasterPlan(residualPlan, 0.25),
      "Reference Residual Tonal Safety",
    ));
  }

  if (resolved.stages.truePeakLimiter) {
    finalSafety = applyFinalTruePeakSafetyTrim(channels, sampleRate, resolved.truePeakCeilingDb, finalQuality);
    if (finalSafety.trimDb < 0) {
      actions.push(`Final true-peak authority trim ${finalSafety.trimDb.toFixed(2)} dB / final ${finalSafety.finalTruePeakDbtp.toFixed(2)} dBTP`);
    } else {
      actions.push(`Final true-peak authority checked / final ${finalSafety.finalTruePeakDbtp.toFixed(2)} dBTP`);
    }
    if (!finalSafety.reachedCeiling) {
      warnings.push(`Final true-peak authority could not fully reach ${resolved.truePeakCeilingDb.toFixed(2)} dBTP. Final estimate: ${finalSafety.finalTruePeakDbtp.toFixed(2)} dBTP.`);
    }
  }

  if (resolved.stages.truePeakLimiter && resolved.artifactGuardAmount > 0.01 && resolved.mode !== "loudnessOnly") {
    const finalArtifactAnalysis = analyzeMasterArtifacts(channels, sampleRate);
    const finalArtifactNeeded =
      finalArtifactAnalysis.scores.fakeAirRisk >= 84 ||
      finalArtifactAnalysis.scores.hiss >= 74 ||
      finalArtifactAnalysis.scores.metallic >= 78;
    if (finalArtifactNeeded) {
      const finalArtifactGuard = applyMasterArtifactGuard(channels, sampleRate, {
        amount: clampNumber(resolved.artifactGuardAmount * 0.85, 0.14, 0.28),
        preserveBrightness: true,
        maxCutDb: 0.75,
        finalPass: true,
      });
      actions.push(finalArtifactGuard.action);
      warnings.push(...finalArtifactGuard.warnings);
      finalSafety = applyFinalTruePeakSafetyTrim(channels, sampleRate, resolved.truePeakCeilingDb, finalQuality);
      actions.push(`Post Artifact Guard ceiling recheck ${resolved.truePeakCeilingDb.toFixed(1)} dBTP / final ${finalSafety.finalTruePeakDbtp.toFixed(2)} dBTP`);
    } else {
      actions.push(`Final Master Artifact Guard analysis passed: hiss ${finalArtifactAnalysis.scores.hiss.toFixed(0)} / metallic ${finalArtifactAnalysis.scores.metallic.toFixed(0)} / fake-air ${finalArtifactAnalysis.scores.fakeAirRisk.toFixed(0)}`);
    }
  }

  if (resolved.mode === "directWavPolish" && resolved.stages.truePeakLimiter) {
    const nonEscalatingCeilingDb = Math.min(resolved.truePeakCeilingDb, before.estimatedTruePeakDb + 0.2);
    const directPeakSafety = applyFinalTruePeakSafetyTrim(channels, sampleRate, nonEscalatingCeilingDb, finalQuality);
    finalSafety = directPeakSafety;
    actions.push(directPeakSafety.trimDb < 0
      ? `Direct WAV Peak Guard ${directPeakSafety.trimDb.toFixed(2)}dB / source ${before.estimatedTruePeakDb.toFixed(2)}dBTP / final ${directPeakSafety.finalTruePeakDbtp.toFixed(2)}dBTP`
      : `Direct WAV Peak Guard checked / source ${before.estimatedTruePeakDb.toFixed(2)}dBTP / final ${directPeakSafety.finalTruePeakDbtp.toFixed(2)}dBTP`);
  }

  clampChannels(channels);
  const after = analyzeSingleFileMastering(channels, sampleRate, { quality: finalQuality });
  if (finalQuality !== "fast") {
    actions.push(`Mobile HQ final metrics: ${finalQuality} / LUFS ${after.estimatedLufs.toFixed(1)} / true peak ${after.estimatedTruePeakDb.toFixed(2)}dBTP / mono fold ${after.monoFoldDownRmsLossDb?.toFixed(2) ?? "n/a"}dB`);
  }
  const targetReport = buildSingleFileTargetReport(before, after, resolved, targetAuthorityTrimDb);
  if (!targetReport.passed) {
    warnings.push(`Target report warning: final ${targetReport.afterLufs.toFixed(1)} LUFS / PLR ${targetReport.plrDb.toFixed(1)} dB / target ${targetReport.effectiveTargetLufs.toFixed(1)} LUFS.`);
  }
  if (targetReport.plrDb < targetReport.minPlrDb) {
    warnings.push(`PLR guard: ${targetReport.plrDb.toFixed(1)} dB is below the ${targetReport.minPlrDb.toFixed(1)} dB minimum for this target.`);
  }
  collectSafetyWarnings(before, after, resolved, limiterGainReductionDb, glueGainReductionDb, warnings);
  const exportSafetyReport = buildSingleFileExportSafetyReport(before, after, resolved, headroomReport, finalSafety);
  const referenceCatchUpGuardReport = buildReferenceCatchUpGuardReport(before, after, resolved, limiterGainReductionDb, exportSafetyReport);

  return {
    channels,
    before,
    after,
    limiterGainReductionDb: round2(limiterGainReductionDb),
    glueGainReductionDb: round2(glueGainReductionDb),
    exportSafetyReport,
    referenceCatchUpGuardReport,
    targetReport,
    warnings,
    actions,
  };
}

function buildReferenceCatchUpGuardReport(
  before: SingleFileMasteringMetrics,
  after: SingleFileMasteringMetrics,
  settings: SingleFileMasteringSettings,
  limiterGainReductionDb: number,
  exportSafetyReport: SingleFileExportSafetyReport,
): ReferenceCatchUpGuardReport | undefined {
  if (settings.mode !== "referenceCatchUp" && settings.referenceClarityMode !== "catchUp") return undefined;
  const requestedPushDb = settings.mode === "referenceCatchUp" ? Math.max(0, settings.targetLufs - before.estimatedLufs) : 0;
  const appliedPushDb = Math.max(0, after.estimatedLufs - before.estimatedLufs);
  const falseAirRisk = Boolean(settings.falseAirRisk);
  const sideClampPriority = (settings.sideHighClampAmount ?? 0) > 0.05 && (settings.referenceAirNoiseSideMidDb ?? 0) > 3;
  const presenceLiftDb = clampNumber(settings.presenceCatchUpDb ?? 0, 0, 1.5);
  const clarityDb = clampNumber(settings.clarityCatchUpDb ?? 0, 0, 1.1);
  const airDb = falseAirRisk ? 0 : clampNumber(settings.airCatchUpDb ?? 0, 0, 0.8);
  const sheenDb = falseAirRisk || sideClampPriority ? 0 : clampNumber(settings.sheenCatchUpDb ?? 0, 0, 4.8);
  const densityAmount = clampNumber(settings.referenceDensityGateAmount ?? 0, 0, 1);
  const targetLimiterBudgetDb = getReferenceTransparentLimiterTargetDb(settings);
  const reportWarnings: string[] = [];
  if (limiterGainReductionDb > 3) reportWarnings.push("Limiter GR is above the transparent catch-up budget.");
  if (exportSafetyReport.heldBackByTruePeakDb > 1.5) reportWarnings.push("True peak ceiling held back a large part of the requested gain.");
  if (sheenDb > 2) reportWarnings.push("Sheen catch-up is strong. Check for shimmer or hiss.");
  if (presenceLiftDb > 1.2) reportWarnings.push("Presence catch-up is strong. Check vocal edge and upper-mid hardness.");
  if (densityAmount > 0.65) reportWarnings.push("Density gate is strong. Check if transients feel flattened.");
  if (falseAirRisk) reportWarnings.push("False-Air guard reduced high-frequency catch-up.");
  if (sideClampPriority) reportWarnings.push("Side high clamp had priority over extra Air boost.");
  return {
    requestedPushDb: round2(requestedPushDb),
    appliedPushDb: round2(appliedPushDb),
    heldBackDb: round2(Math.max(0, requestedPushDb - appliedPushDb, exportSafetyReport.heldBackByTruePeakDb)),
    limiterGainReductionDb: round2(limiterGainReductionDb),
    targetLimiterBudgetDb: round2(targetLimiterBudgetDb),
    presenceLiftDb: round2(presenceLiftDb),
    clarityDb: round2(clarityDb),
    airDb: round2(airDb),
    sheenDb: round2(sheenDb),
    densityAmount: round2(densityAmount),
    warnings: reportWarnings,
  };
}

function collectSafetyWarnings(
  before: SingleFileMasteringMetrics,
  after: SingleFileMasteringMetrics,
  settings: SingleFileMasteringSettings,
  limiterGainReductionDb: number,
  glueGainReductionDb: number,
  warnings: string[],
) {
  if (after.estimatedTruePeakDb > settings.truePeakCeilingDb + 0.05) {
    warnings.push(`True peak estimate exceeds ceiling: ${after.estimatedTruePeakDb.toFixed(2)} dBTP`);
  }
  const limiterWarningThresholdDb = settings.mode === "referenceCatchUp"
    ? (settings.referenceDensityGateAmount ?? 0) > 0.5 ? 4.1 : 3.4
    : settings.mode === "loudRelease" ? 3.5 : 3;
  if (limiterGainReductionDb > limiterWarningThresholdDb) {
    warnings.push("Limiter gain reduction is high. The target loudness may be too loud for this file.");
  }
  if (glueGainReductionDb > 3) {
    warnings.push("Glue compression gain reduction is high.");
  }
  if (settings.stages.targetLoudness && after.estimatedLufs < settings.targetLufs - 1) {
    warnings.push(settings.mode === "referenceCatchUp"
      ? "Reference Catch-Up stopped at the peak ceiling. Use Hard Limit / Loud Release only if the extra loudness is worth flatter dynamics."
      : "Target LUFS could not be reached without exceeding the peak ceiling.");
  }
  if (Math.abs(after.durationSec - before.durationSec) > 0.001 || after.channels !== before.channels) {
    warnings.push("Duration or channel count changed unexpectedly.");
  }
  if (!Number.isFinite(after.estimatedLufs) || !Number.isFinite(after.estimatedTruePeakDb)) {
    warnings.push("Invalid audio metric detected after processing.");
  }
}

type HeadroomPrepReport = {
  action: string;
  headroomMode: SingleFileHeadroomMode;
  requestedPreMasterPeakCeilingDbfs: number | null;
  requestedPreMasterLoudnessHintLufs: number | null;
  measuredPreMasterPeakBeforeDbfs: number | null;
  measuredPreMasterLufsBefore: number | null;
  appliedHeadroomTrimDb: number;
  measuredPreMasterPeakAfterDbfs: number | null;
  measuredPreMasterLufsAfter: number | null;
};

function applyHeadroomPrep(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
): HeadroomPrepReport {
  const mode = settings.headroomMode;
  const requestedPeak = finiteOptional(settings.preMasterPeakCeilingDbfs) ?? null;
  const requestedLufs = finiteOptional(settings.preMasterLoudnessHintLufs) ?? null;
  const inactiveReport = (action: string): HeadroomPrepReport => ({
    action,
    headroomMode: mode,
    requestedPreMasterPeakCeilingDbfs: requestedPeak,
    requestedPreMasterLoudnessHintLufs: requestedLufs,
    measuredPreMasterPeakBeforeDbfs: null,
    measuredPreMasterLufsBefore: null,
    appliedHeadroomTrimDb: 0,
    measuredPreMasterPeakAfterDbfs: null,
    measuredPreMasterLufsAfter: null,
  });

  if (mode === "off") return inactiveReport("Headroom Prep off");
  if (requestedPeak == null && requestedLufs == null) return inactiveReport("Headroom Prep skipped: no target");

  const before = analyzeSingleFileMastering(channels, sampleRate, { quality: "fast" });
  if (mode === "analysis") {
    return {
      action: `Headroom analysis only: peak ${before.peakDb.toFixed(2)} dBFS / LUFS ${before.estimatedLufs.toFixed(1)}`,
      headroomMode: mode,
      requestedPreMasterPeakCeilingDbfs: requestedPeak,
      requestedPreMasterLoudnessHintLufs: requestedLufs,
      measuredPreMasterPeakBeforeDbfs: before.peakDb,
      measuredPreMasterLufsBefore: before.estimatedLufs,
      appliedHeadroomTrimDb: 0,
      measuredPreMasterPeakAfterDbfs: before.peakDb,
      measuredPreMasterLufsAfter: before.estimatedLufs,
    };
  }

  const peakTrimDb = requestedPeak == null || before.peakDb <= requestedPeak
    ? 0
    : requestedPeak - before.peakDb - 0.05;
  const lufsTrimDb = requestedLufs == null || before.estimatedLufs <= requestedLufs
    ? 0
    : -Math.min(before.estimatedLufs - requestedLufs, 3);
  const appliedTrimDb = round2(clampNumber(Math.min(0, peakTrimDb, lufsTrimDb), -12, 0));
  if (appliedTrimDb < 0) {
    applyGainToChannels(channels, dbToGain(appliedTrimDb));
  }
  const after = analyzeSingleFileMastering(channels, sampleRate, { quality: "fast" });

  return {
    action: appliedTrimDb < 0
      ? `Headroom Prep applied ${appliedTrimDb.toFixed(2)} dB / peak ${before.peakDb.toFixed(2)} -> ${after.peakDb.toFixed(2)} dBFS`
      : `Headroom Prep apply mode: no trim needed / peak ${before.peakDb.toFixed(2)} dBFS`,
    headroomMode: mode,
    requestedPreMasterPeakCeilingDbfs: requestedPeak,
    requestedPreMasterLoudnessHintLufs: requestedLufs,
    measuredPreMasterPeakBeforeDbfs: before.peakDb,
    measuredPreMasterLufsBefore: before.estimatedLufs,
    appliedHeadroomTrimDb: appliedTrimDb,
    measuredPreMasterPeakAfterDbfs: after.peakDb,
    measuredPreMasterLufsAfter: after.estimatedLufs,
  };
}

function buildSingleFileExportSafetyReport(
  before: SingleFileMasteringMetrics,
  after: SingleFileMasteringMetrics,
  settings: SingleFileMasteringSettings,
  headroom: HeadroomPrepReport,
  finalSafety: FinalTruePeakSafetyResult | null,
): SingleFileExportSafetyReport {
  const targetShortfallDb = Math.max(0, settings.targetLufs - after.estimatedLufs);
  const truePeakCeilingReached = finalSafety?.reachedCeiling ?? after.estimatedTruePeakDb <= settings.truePeakCeilingDb + 0.03;
  return {
    requestedTruePeakCeilingDbtp: round2(settings.truePeakCeilingDb),
    measuredFinalTruePeakDbtp: round2(after.estimatedTruePeakDb),
    truePeakCeilingReached,
    requestedReferenceTrimDb: settings.mode === "referenceCatchUp" ? round2(settings.targetLufs - before.estimatedLufs) : 0,
    appliedFinalOutputTrimDb: round2(after.estimatedLufs - before.estimatedLufs),
    truePeakSafetyTrimDb: round2(finalSafety?.trimDb ?? 0),
    heldBackByTruePeakDb: round2(truePeakCeilingReached ? targetShortfallDb : Math.max(targetShortfallDb, after.estimatedTruePeakDb - settings.truePeakCeilingDb)),
    headroomMode: headroom.headroomMode,
    requestedPreMasterPeakCeilingDbfs: headroom.requestedPreMasterPeakCeilingDbfs,
    requestedPreMasterLoudnessHintLufs: headroom.requestedPreMasterLoudnessHintLufs,
    measuredPreMasterPeakBeforeDbfs: headroom.measuredPreMasterPeakBeforeDbfs,
    measuredPreMasterLufsBefore: headroom.measuredPreMasterLufsBefore,
    appliedHeadroomTrimDb: headroom.appliedHeadroomTrimDb,
    measuredPreMasterPeakAfterDbfs: headroom.measuredPreMasterPeakAfterDbfs,
    measuredPreMasterLufsAfter: headroom.measuredPreMasterLufsAfter,
    targetLufs: round2(settings.targetLufs),
    measuredFinalLufs: round2(after.estimatedLufs),
    targetLufsReached: after.estimatedLufs >= settings.targetLufs - 0.5,
    targetLufsLimitedByTruePeak: settings.stages.targetLoudness && targetShortfallDb > 0.5 && truePeakCeilingReached,
  };
}

function applyReferenceCatchUp(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
  existingLimiterGainReductionDb = 0,
) {
  const actions: string[] = [];
  const warnings: string[] = [];
  let limiterGainReductionDb = 0;
  let totalCatchUpDb = 0;
  let heldBackDb = 0;
  let limiterBudgetDb = getReferenceTransparentLimiterBudgetDb(settings, existingLimiterGainReductionDb);

  for (let pass = 0; pass < 2; pass += 1) {
    const current = analyzeSingleFileMastering(channels, sampleRate);
    const shortfallDb = settings.targetLufs - current.estimatedLufs;
    if (shortfallDb <= 0.45) break;
    const peakRoomDb = settings.truePeakCeilingDb - current.estimatedTruePeakDb;
    const requestedPushDb = Math.min(shortfallDb * 0.5, Math.max(0.2, peakRoomDb + 1.4));
    const transparentPushLimitDb = settings.mode === "referenceCatchUp"
      ? Math.max(0, peakRoomDb + limiterBudgetDb)
      : Number.POSITIVE_INFINITY;
    const pushDb = clampNumber(Math.min(requestedPushDb, transparentPushLimitDb), 0, pass === 0 ? 2.8 : 1.8);
    heldBackDb += Math.max(0, requestedPushDb - pushDb);
    if (pushDb <= 0.05) break;

    applyGainToChannels(channels, dbToGain(pushDb));
    const densityAmount = settings.mode === "referenceCatchUp"
      ? clampNumber(settings.referenceDensityGateAmount ?? 0, 0, 1)
      : 1;
    const referenceClipScale = settings.mode === "referenceCatchUp"
      ? clampNumber(0.64 + densityAmount * 0.3, 0.64, 0.95)
      : 1;
    const referenceMixScale = settings.mode === "referenceCatchUp"
      ? clampNumber(0.62 + densityAmount * 0.28, 0.62, 0.94)
      : 1;
    processSoftClipperBuffer(channels, {
      mode: pass === 0 ? "medium" : "soft",
      driveDb: clampNumber(settings.clipperDriveDb * referenceClipScale + shortfallDb * 0.12 - pass * 0.45, 0.75, 4.2),
      ceilingDb: settings.truePeakCeilingDb,
      knee: 0.42,
      hardness: settings.mode === "referenceCatchUp" ? 0.36 + densityAmount * 0.1 : 0.5,
      mix: clampNumber(settings.clipperMix * referenceMixScale + 0.03 - pass * 0.08, 0.32, 0.82),
      outputDb: -0.15,
    }, { copy: false });

    const limited = applyPeakCeiling(channels, settings.truePeakCeilingDb);
    limiterGainReductionDb = Math.max(limiterGainReductionDb, limited.gainReductionDb);
    limiterBudgetDb = getReferenceTransparentLimiterBudgetDb(settings, Math.max(existingLimiterGainReductionDb, limiterGainReductionDb));
    totalCatchUpDb += pushDb;
  }

  const after = analyzeSingleFileMastering(channels, sampleRate);
  actions.push(`Reference Catch-Up ${totalCatchUpDb > 0 ? "+" : ""}${totalCatchUpDb.toFixed(1)}dB before final ceiling / now ${after.estimatedLufs.toFixed(1)} LUFS`);
  if (heldBackDb > 0.05) {
    actions.push(`Reference Catch-Up Audition Guard held back ${heldBackDb.toFixed(1)}dB to keep limiter GR near ${getReferenceTransparentLimiterTargetDb(settings).toFixed(1)}dB`);
  }
  if (totalCatchUpDb > 3.5 || limiterGainReductionDb > 3.5) {
    warnings.push("Reference Catch-Up is working hard. Dynamics may become flatter if you push further.");
  }
  return {
    actions,
    warnings,
    limiterGainReductionDb: round2(limiterGainReductionDb),
  };
}

function applyReferencePeakDensityRecovery(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
  existingLimiterGainReductionDb: number,
  quality: MobileAudioQuality,
) {
  const actions: string[] = [];
  const warnings: string[] = [];
  let limiterGainReductionDb = 0;

  if (settings.mode !== "referenceCatchUp" || !settings.stages.targetLoudness || !settings.stages.truePeakLimiter) {
    return { actions, warnings, limiterGainReductionDb };
  }

  const before = analyzeSingleFileMastering(channels, sampleRate, { quality });
  const shortfallDb = settings.targetLufs - before.estimatedLufs;
  const peakRoomDb = settings.truePeakCeilingDb - before.estimatedTruePeakDb;
  const plrDb = before.estimatedTruePeakDb - before.estimatedLufs;
  const minPlrDb = getSingleFileMinPlr(settings.mode, settings.targetLufs);
  const crestExcessDb = plrDb - minPlrDb;
  const densityAmount = clampNumber(settings.referenceDensityGateAmount ?? 0, 0, 1);
  const peakLimited = shortfallDb > 0.55 && peakRoomDb < 1.15;
  const crestLimited = crestExcessDb > 2.0 && shortfallDb > 0.35;

  if (!peakLimited && !crestLimited) {
    actions.push("Reference Peak-Density Recovery bypassed");
    return { actions, warnings, limiterGainReductionDb };
  }

  const recoveryAmount = clampNumber(
    0.24 + Math.max(0, shortfallDb - 0.25) * 0.2 + Math.max(0, crestExcessDb - 1.5) * 0.14 + densityAmount * 0.35,
    0.24,
    1.55,
  );
  const driveDb = clampNumber(0.9 + recoveryAmount * 1.42, 0.9, 3.25);
  const mix = clampNumber(0.27 + recoveryAmount * 0.18, 0.27, 0.58);

  processSoftClipperBuffer(channels, {
    mode: "soft",
    driveDb,
    ceilingDb: settings.truePeakCeilingDb,
    knee: 0.68,
    hardness: 0.22 + densityAmount * 0.12,
    mix,
    outputDb: -0.08,
  }, { copy: false });

  let limited = applyPeakCeiling(channels, settings.truePeakCeilingDb);
  limiterGainReductionDb = Math.max(limiterGainReductionDb, limited.gainReductionDb);
  let after = analyzeSingleFileMastering(channels, sampleRate, { quality });
  let makeupDb = 0;
  const remainingShortfallDb = settings.targetLufs - after.estimatedLufs;
  const updatedPeakRoomDb = settings.truePeakCeilingDb - after.estimatedTruePeakDb;
  const limiterBudgetDb = getReferenceTransparentLimiterBudgetDb(settings, Math.max(existingLimiterGainReductionDb, limiterGainReductionDb));
  const allowedMakeupDb = clampNumber(
    Math.min(remainingShortfallDb * 0.62, updatedPeakRoomDb + limiterBudgetDb * 0.25, recoveryAmount * 0.95),
    0,
    1.35,
  );

  if (allowedMakeupDb > 0.08) {
    makeupDb = allowedMakeupDb;
    applyGainToChannels(channels, dbToGain(makeupDb));
    limited = applyPeakCeiling(channels, settings.truePeakCeilingDb);
    limiterGainReductionDb = Math.max(limiterGainReductionDb, limited.gainReductionDb);
    after = analyzeSingleFileMastering(channels, sampleRate, { quality });
  }

  const afterPlrDb = after.estimatedTruePeakDb - after.estimatedLufs;
  actions.push("Reference Peak-Density Recovery: drive +" + driveDb.toFixed(1) + "dB / mix " + (mix * 100).toFixed(0) + "% / PLR " + plrDb.toFixed(1) + " -> " + afterPlrDb.toFixed(1) + "dB" + (makeupDb > 0.05 ? " / makeup +" + makeupDb.toFixed(2) + "dB" : ""));

  if (settings.targetLufs - after.estimatedLufs > 1.2 && after.estimatedTruePeakDb > settings.truePeakCeilingDb - 0.55) {
    warnings.push("Reference Peak-Density Recovery hit the true-peak ceiling before the target. Lower the target or repair track peaks before mastering.");
  }

  return {
    actions,
    warnings,
    limiterGainReductionDb: round2(limiterGainReductionDb),
  };
}

function applyReferenceClarityCatchUp(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
) {
  const actions: string[] = [];
  const presenceDb = clampNumber(settings.presenceCatchUpDb ?? 0, 0, 1.5);
  const presenceLiftDb = clampNumber(presenceDb * (settings.falseAirRisk ? 1.18 : 1), 0, 1.65);
  const bodyPresenceDb = presenceDb > 0.45 ? clampNumber(presenceDb * 0.28, 0, 0.42) : 0;
  const focusDb = clampNumber(presenceLiftDb * 0.38, 0, 0.58);
  const clarityDb = clampNumber(settings.clarityCatchUpDb ?? 0, 0, 1.1);
  const airDb = settings.falseAirRisk ? 0 : clampNumber(settings.airCatchUpDb ?? 0, 0, 0.8);
  const sidePolicy = getSideHighClampPolicy(channels, sampleRate, settings);
  const blockSheenBoost = Boolean(sidePolicy?.blockHighShelfBoost);
  const preferMidOnlySheen = shouldPreferMidOnlySheen(sidePolicy, settings);
  const requestedSheenDb = clampNumber(settings.sheenCatchUpDb ?? 0, 0, 4.8);
  const sheenDb = settings.falseAirRisk || preferMidOnlySheen ? 0 : requestedSheenDb;
  const midSheenScale = preferMidOnlySheen ? 0.56 : 0.42;
  const midSheenDb = settings.falseAirRisk || preferMidOnlySheen
    ? clampNumber(requestedSheenDb * midSheenScale, 0, preferMidOnlySheen ? 2.7 : 1.7)
    : 0;

  if (presenceDb > 0.02) {
    if (bodyPresenceDb > 0.02) {
      applyBiquadToChannels(channels, makePeaking(sampleRate, 2450, bodyPresenceDb, 0.95));
    }
    applyBiquadToChannels(channels, makePeaking(sampleRate, 3200, presenceLiftDb, 0.65));
  }
  if (focusDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 4200, focusDb, 1.25));
  }
  if (clarityDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 6500, clarityDb, 1.15));
  }
  if (airDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 9500, airDb, 1.0));
  }
  if (sheenDb > 0.02) {
    applyBiquadToChannels(channels, makeHighshelf(sampleRate, 14000, sheenDb, 0.65));
    applyBiquadToChannels(channels, makePeaking(sampleRate, 16000, clampNumber(sheenDb * 0.32, 0, 1.35), 0.85));
  }
  if (midSheenDb > 0.02) {
    if (preferMidOnlySheen && !settings.falseAirRisk) {
      applyMidOnlyUpperSheenToStereo(channels, sampleRate, midSheenDb);
    } else {
      applyMidOnlySheenToStereo(channels, sampleRate, midSheenDb);
    }
  }

  if (presenceDb > 0.02 || clarityDb > 0.02 || airDb > 0.02 || sheenDb > 0.02 || midSheenDb > 0.02 || settings.falseAirRisk || blockSheenBoost) {
    actions.push(`Reference Clarity Catch-Up: presence ${presenceLiftDb.toFixed(2)}dB${bodyPresenceDb > 0.02 ? ` + body ${bodyPresenceDb.toFixed(2)}dB` : ""} / focus ${focusDb.toFixed(2)}dB / clarity ${clarityDb.toFixed(2)}dB / air ${airDb.toFixed(2)}dB / sheen ${sheenDb.toFixed(2)}dB${midSheenDb > 0.02 ? ` / mid sheen ${midSheenDb.toFixed(2)}dB` : ""}${settings.falseAirRisk ? " / false Air guarded" : ""}${preferMidOnlySheen ? " / high-side protected" : ""}`);
  } else {
    actions.push("Reference Clarity Catch-Up bypassed");
  }
  return actions;
}

function applyReferenceMeasuredCorrections(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
) {
  const actions: string[] = [];
  const subTrimDb = clampNumber(settings.referenceSubTrimDb ?? 0, 0, 3);
  const densityAmount = clampNumber(settings.referenceDensityGateAmount ?? 0, 0, 1);
  const midSideRecoveryDb = clampNumber(settings.referenceMidSideRecoveryDb ?? 0, 0, 2);
  const requestedMidGlossShiftDb = clampNumber(settings.referenceMidGlossShiftDb ?? 0, 0, 4);
  const sidePolicy = getSideHighClampPolicy(channels, sampleRate, settings);
  const blockSideHighBoost = Boolean(sidePolicy?.blockHighShelfBoost) || Boolean(settings.falseAirRisk);
  const sheenDemandDb = clampNumber(settings.sheenCatchUpDb ?? 0, 0, 4.8);
  const midGlossShiftDb = blockSideHighBoost && sheenDemandDb > 0.8
    ? Math.min(requestedMidGlossShiftDb, 0.62)
    : requestedMidGlossShiftDb;
  const redirectedUpperSheenDb = blockSideHighBoost && requestedMidGlossShiftDb > midGlossShiftDb
    ? clampNumber((requestedMidGlossShiftDb - midGlossShiftDb) * 0.48 + Math.max(0, sheenDemandDb - 1.2) * 0.12, 0, 0.82)
    : 0;

  if (subTrimDb > 0.04) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 45, -subTrimDb, 0.75));
    applyBiquadToChannels(channels, makeLowshelf(sampleRate, 58, -subTrimDb * 0.28, 0.7));
    actions.push(`Reference Sub Trim: 20-60Hz -${subTrimDb.toFixed(2)}dB before density`);
  }

  if (densityAmount > 0.02) {
    const before = analyzeSingleFileMastering(channels, sampleRate);
    processSoftClipperBuffer(channels, {
      mode: "soft",
      driveDb: clampNumber(0.7 + densityAmount * 3.0, 0.7, 3.65),
      ceilingDb: settings.truePeakCeilingDb,
      knee: 0.62,
      hardness: 0.26 + densityAmount * 0.2,
      mix: clampNumber(0.2 + densityAmount * 0.36, 0.2, 0.58),
      outputDb: -0.12,
    }, { copy: false });
    let after = analyzeSingleFileMastering(channels, sampleRate);
    const densityMakeupDb = clampNumber(before.estimatedLufs - after.estimatedLufs, 0, densityAmount > 0.55 ? 1.25 : 0.75);
    if (densityMakeupDb > 0.05) {
      applyGainToChannels(channels, dbToGain(densityMakeupDb));
      after = analyzeSingleFileMastering(channels, sampleRate);
    }
    actions.push(`Reference Density Gate: amount ${(densityAmount * 100).toFixed(0)}% / crest ${(before.estimatedTruePeakDb - before.estimatedLufs).toFixed(1)} -> ${(after.estimatedTruePeakDb - after.estimatedLufs).toFixed(1)}dB${densityMakeupDb > 0.05 ? ` / density makeup +${densityMakeupDb.toFixed(2)}dB` : ""}`);
  } else if (settings.mode === "referenceCatchUp" && (subTrimDb > 0.04 || midSideRecoveryDb > 0.04 || midGlossShiftDb > 0.04)) {
    actions.push("Reference Density Gate skipped: crest/PLR already matched for this reference pass");
  }

  if (midSideRecoveryDb > 0.04) {
    applyBandSideGainToStereo(channels, sampleRate, 500, 5000, dbToGain(midSideRecoveryDb));
    actions.push(`Reference Mid-Side Recovery: 500Hz-5kHz side +${midSideRecoveryDb.toFixed(2)}dB / full widener bypassed`);
  }

  if (midGlossShiftDb > 0.04) {
    applyMidOnlyGlossShiftToStereo(channels, sampleRate, midGlossShiftDb);
    actions.push(`Reference Mid Gloss Shift: 9-14kHz mid +${midGlossShiftDb.toFixed(2)}dB${requestedMidGlossShiftDb > midGlossShiftDb + 0.03 ? ` / capped from ${requestedMidGlossShiftDb.toFixed(2)}dB` : ""} / high-side boost bypassed`);
  }

  if (redirectedUpperSheenDb > 0.04) {
    applyMidOnlyUpperSheenToStereo(channels, sampleRate, redirectedUpperSheenDb);
    actions.push(`Reference Upper Sheen Redirect: 15-18kHz mid +${redirectedUpperSheenDb.toFixed(2)}dB / gloss cap active`);
  }

  if (actions.length === 0) actions.push("Reference measured corrections bypassed");
  return actions;
}

function applyReferenceImageCatchUp(
  channels: SingleFileAudioChannel[],
  settings: SingleFileMasteringSettings,
) {
  if (channels.length < 2) return "Reference Image Catch-Up bypassed: mono source";
  const targetSideMidDb = Number(settings.referenceSideMidDb);
  const targetCorrelation = Number(settings.referenceCorrelation);
  const hasSideTarget = Number.isFinite(targetSideMidDb);
  const hasCorrelationTarget = Number.isFinite(targetCorrelation);
  if (!hasSideTarget && !hasCorrelationTarget) return "Reference Image Catch-Up bypassed";

  const amount = clampNumber(settings.imageCatchUpAmount ?? 0, 0, 1);
  if (amount <= 0.01) return "Reference Image Catch-Up bypassed";

  const before = measureStereoImage(channels);
  const sideExcessDb = hasSideTarget ? before.sideMidDb - targetSideMidDb : 0;
  const correlationShortfall = hasCorrelationTarget ? targetCorrelation - before.correlation : 0;
  const trimDb = clampNumber(Math.max(sideExcessDb - 0.45, correlationShortfall * 5), 0, 2.2) * amount;

  if (trimDb <= 0.05) {
    return `Reference Image Catch-Up: already safe / Side ${before.sideMidDb.toFixed(1)}dB / Corr ${before.correlation.toFixed(2)}`;
  }

  applySideGainToStereo(channels, dbToGain(-trimDb));
  const after = measureStereoImage(channels);
  return `Reference Image Catch-Up: side trim -${trimDb.toFixed(1)}dB / Side ${before.sideMidDb.toFixed(1)} -> ${after.sideMidDb.toFixed(1)}dB / Corr ${before.correlation.toFixed(2)} -> ${after.correlation.toFixed(2)}`;
}

function applyReferenceCrestSafetyPass(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
  quality: MobileAudioQuality,
) {
  const actions: string[] = [];
  const warnings: string[] = [];
  let limiterGainReductionDb = 0;
  const referencePlrDb = finiteOptional(settings.referencePlrDb);
  if (referencePlrDb == null || !settings.stages.truePeakLimiter) {
    return { actions: ["Reference Crest Safety bypassed"], warnings, limiterGainReductionDb };
  }

  const before = analyzeSingleFileMastering(channels, sampleRate, { quality });
  const currentPlrDb = before.estimatedTruePeakDb - before.estimatedLufs;
  const excessPlrDb = currentPlrDb - referencePlrDb;
  const peakConstrainedShortfall = before.estimatedLufs < settings.targetLufs - 0.8
    && before.estimatedTruePeakDb > settings.truePeakCeilingDb - 1.8;
  if (peakConstrainedShortfall) {
    return { actions: ["Reference Crest Safety checked / peak-constrained shortfall kept natural"], warnings, limiterGainReductionDb };
  }
  if (excessPlrDb <= 1.45) {
    return { actions: ["Reference Crest Safety checked / no peak reshape"], warnings, limiterGainReductionDb };
  }

  const amount = clampNumber((excessPlrDb - 1.0) * 0.26, 0.08, 0.68);
  const driveDb = clampNumber(0.35 + amount * 1.45, 0.35, 1.45);
  const mix = clampNumber(0.1 + amount * 0.24, 0.1, 0.28);
  processSoftClipperBuffer(channels, {
    mode: "soft",
    driveDb,
    ceilingDb: settings.truePeakCeilingDb,
    knee: 0.82,
    hardness: 0.12 + amount * 0.06,
    mix,
    outputDb: -0.25,
  }, { copy: false });
  const limited = applyPeakCeiling(channels, settings.truePeakCeilingDb);
  limiterGainReductionDb = Math.max(limiterGainReductionDb, limited.gainReductionDb);
  const after = analyzeSingleFileMastering(channels, sampleRate, { quality });
  const afterPlrDb = after.estimatedTruePeakDb - after.estimatedLufs;
  actions.push("Reference Crest Safety: PLR " + currentPlrDb.toFixed(1) + " -> " + afterPlrDb.toFixed(1) + "dB / ref " + referencePlrDb.toFixed(1) + "dB / drive +" + driveDb.toFixed(1) + "dB / mix " + (mix * 100).toFixed(0) + "%");
  if (afterPlrDb - referencePlrDb > 3.35) {
    warnings.push("Reference Crest Safety still leaves extra crest. Check the stem peaks or lower the mastering target slightly.");
  }
  return { actions, warnings, limiterGainReductionDb: round2(limiterGainReductionDb) };
}

function applyDirectWavSpatialPolish(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
) {
  if (channels.length < 2) return "Direct WAV Spatial bypassed: mono source";
  const beforeImage = measureStereoImage(channels);
  if (beforeImage.correlation < 0.72 || beforeImage.sideMidDb > -7.5) {
    return `Direct WAV Spatial protected: existing image kept / Side ${beforeImage.sideMidDb.toFixed(1)}dB / Corr ${beforeImage.correlation.toFixed(2)}`;
  }

  const requestedSideGainDb = clampNumber(
    Math.max(0, (-10.5 - beforeImage.sideMidDb) * 0.08) + Math.max(0, beforeImage.correlation - 0.86) * 0.75,
    0,
    0.6,
  );
  if (requestedSideGainDb < 0.08) {
    return `Direct WAV Spatial bypassed: stereo image already balanced / Side ${beforeImage.sideMidDb.toFixed(1)}dB / Corr ${beforeImage.correlation.toFixed(2)}`;
  }

  const beforeLevel = analyzeSingleFileMastering(channels, sampleRate, { quality: "fast" });
  applyBandSideGainToStereo(channels, sampleRate, 500, 5000, dbToGain(requestedSideGainDb));
  const afterLevel = analyzeSingleFileMastering(channels, sampleRate, { quality: "fast" });
  const outputMatchDb = clampNumber(beforeLevel.rmsDb - afterLevel.rmsDb, -0.25, 0);
  if (outputMatchDb < -0.01) applyGainToChannels(channels, dbToGain(outputMatchDb));
  const afterImage = measureStereoImage(channels);

  return `Direct WAV Spatial: 500Hz-5kHz side +${requestedSideGainDb.toFixed(2)}dB / low and 10kHz+ protected / Side ${beforeImage.sideMidDb.toFixed(1)} -> ${afterImage.sideMidDb.toFixed(1)}dB / Corr ${beforeImage.correlation.toFixed(2)} -> ${afterImage.correlation.toFixed(2)}${outputMatchDb < -0.01 ? ` / output match ${outputMatchDb.toFixed(2)}dB` : ""}`;
}

function applyFrozenReferenceMasterPlan(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  plan: ReferenceMasterPlan | null,
  label: string,
) {
  if (plan == null) return [`${label} bypassed: no measured tonal targets`];

  if (Math.abs(plan.presenceDb) > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, plan.presenceDb > 0 ? 3100 : 3300, plan.presenceDb, plan.presenceDb > 0 ? 0.78 : 0.9));
  }
  if (plan.presenceFocusDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 4300, plan.presenceFocusDb, 1.05));
  }
  if (Math.abs(plan.airDb) > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, plan.airDb > 0 ? 6800 : 7200, plan.airDb, plan.airDb > 0 ? 1.1 : 1.05));
  }
  if (Math.abs(plan.glossDb) > 0.02) {
    if (plan.glossMidOnly && channels.length >= 2) {
      applyMidOnlyGlossShiftToStereo(channels, sampleRate, plan.glossDb);
    } else {
      applyBiquadToChannels(channels, makePeaking(sampleRate, plan.glossDb > 0 ? 11000 : 10800, plan.glossDb, plan.glossDb > 0 ? 0.9 : 0.85));
    }
  }
  if (plan.sheenDb > 0.02) {
    if (plan.sheenMidOnly && channels.length >= 2) {
      applyMidOnlyUpperSheenToStereo(channels, sampleRate, plan.sheenDb);
    } else {
      applyBiquadToChannels(channels, makeHighshelf(sampleRate, 14000, plan.sheenDb, 0.65));
    }
  }

  const moved = plan.tonalMoveBudgetDb > 0.03;
  const reason = plan.reasons.length > 0 ? ` / ${plan.reasons.join(", ")}` : "";
  return [moved
    ? `${label}: presence ${plan.presenceDb.toFixed(2)}dB / focus ${plan.presenceFocusDb.toFixed(2)}dB / air ${plan.airDb.toFixed(2)}dB / gloss ${plan.glossDb.toFixed(2)}dB / sheen ${plan.sheenDb.toFixed(2)}dB / total ${plan.tonalMoveBudgetDb.toFixed(2)}dB${plan.glossMidOnly || plan.sheenMidOnly ? " / high-side protected" : ""}${reason}`
    : `${label} checked / no EQ move`];
}

function applyReferenceFinalTonalSafetyPass(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
) {
  if (settings.mode !== "referenceCatchUp" || settings.referenceClarityMode !== "catchUp") return [];
  const target = {
    presence: finiteOptional(settings.referencePresenceDb),
    air: finiteOptional(settings.referenceAirDb),
    gloss: finiteOptional(settings.referenceGlossDb),
    ultra: finiteOptional(settings.referenceUltraAirDb),
    sheen: finiteOptional(settings.referenceSheenDb),
  };
  if (target.presence == null && target.air == null && target.gloss == null && target.ultra == null && target.sheen == null) {
    return ["Reference Final Tonal Safety bypassed"];
  }

  const before = measureReferenceTonalEnergy(channels, sampleRate);
  const actions: string[] = [];
  const sidePolicy = getSideHighClampPolicy(channels, sampleRate, settings);
  const blockSideHighBoost = Boolean(sidePolicy?.blockHighShelfBoost) || Boolean(settings.falseAirRisk);
  const preferMidOnlySheen = shouldPreferMidOnlySheen(sidePolicy, settings);
  let presenceMoveDb = 0;
  let airMoveDb = 0;
  let glossMoveDb = 0;
  let sheenMoveDb = 0;

  if (target.presence != null) {
    const gapDb = target.presence - before.presence;
    const excessDb = before.presence - target.presence;
    if (gapDb > 1.05) {
      presenceMoveDb = clampNumber((gapDb - 0.65) * (settings.falseAirRisk ? 0.36 : 0.28), 0.12, settings.falseAirRisk ? 0.95 : 0.68);
      applyBiquadToChannels(channels, makePeaking(sampleRate, 3100, presenceMoveDb, 0.78));
      if (gapDb > 1.65) {
        const focusSupportDb = clampNumber((gapDb - 1.35) * 0.14, 0.06, settings.falseAirRisk ? 0.28 : 0.2);
        applyBiquadToChannels(channels, makePeaking(sampleRate, 4300, focusSupportDb, 1.05));
      }
    } else if (excessDb > 1.15) {
      presenceMoveDb = -clampNumber((excessDb - 0.7) * 0.36, 0.12, 0.72);
      applyBiquadToChannels(channels, makePeaking(sampleRate, 3300, presenceMoveDb, 0.9));
    }
  }

  if (target.air != null) {
    const gapDb = target.air - before.air;
    const excessDb = before.air - target.air;
    if (gapDb > 1.25 && !blockSideHighBoost) {
      airMoveDb = clampNumber((gapDb - 0.95) * 0.07, 0.04, 0.18);
      applyBiquadToChannels(channels, makePeaking(sampleRate, 6800, airMoveDb, 1.1));
    } else if (excessDb > 1.35) {
      airMoveDb = -clampNumber((excessDb - 0.9) * 0.18, 0.08, 0.42);
      applyBiquadToChannels(channels, makePeaking(sampleRate, 7200, airMoveDb, 1.05));
    }
  }

  if (target.gloss != null) {
    const gapDb = target.gloss - before.gloss;
    const excessDb = before.gloss - target.gloss;
    if (gapDb > 1.25) {
      glossMoveDb = clampNumber((gapDb - 0.95) * (blockSideHighBoost ? 0.2 : 0.12), 0.08, blockSideHighBoost ? 0.72 : 0.36);
      if (blockSideHighBoost && channels.length >= 2) {
        applyMidOnlyGlossShiftToStereo(channels, sampleRate, glossMoveDb);
      } else {
        applyBiquadToChannels(channels, makePeaking(sampleRate, 11000, glossMoveDb, 0.9));
      }
    } else if (excessDb > 1.2) {
      glossMoveDb = -clampNumber((excessDb - 0.8) * 0.24, 0.1, 0.62);
      applyBiquadToChannels(channels, makePeaking(sampleRate, 10800, glossMoveDb, 0.85));
    }
  }

  if (target.ultra != null || target.sheen != null) {
    const ultraGapDb = target.ultra == null ? 0 : target.ultra - before.ultra;
    const sheenGapDb = target.sheen == null ? 0 : target.sheen - before.sheen;
    const requestedSheenDb = Math.max(ultraGapDb - 1.35, sheenGapDb - 1.8);
    if (requestedSheenDb > 0.1) {
      sheenMoveDb = clampNumber(requestedSheenDb * (preferMidOnlySheen ? 0.46 : 0.22), 0.08, preferMidOnlySheen ? 1.2 : 0.5);
      if (preferMidOnlySheen && channels.length >= 2) {
        applyMidOnlyUpperSheenToStereo(channels, sampleRate, sheenMoveDb);
      } else {
        applyBiquadToChannels(channels, makeHighshelf(sampleRate, 14000, sheenMoveDb, 0.65));
      }
    }
  }

  const moved = Math.abs(presenceMoveDb) + Math.abs(airMoveDb) + Math.abs(glossMoveDb) + Math.abs(sheenMoveDb);
  if (moved <= 0.03) return ["Reference Final Tonal Safety checked / no EQ move"];
  const after = measureReferenceTonalEnergy(channels, sampleRate);
  actions.push("Reference Final Tonal Safety: presence " + presenceMoveDb.toFixed(2) + "dB / air " + airMoveDb.toFixed(2) + "dB / gloss " + glossMoveDb.toFixed(2) + "dB / sheen " + sheenMoveDb.toFixed(2) + "dB / P " + before.presence.toFixed(1) + "->" + after.presence.toFixed(1) + " / G " + before.gloss.toFixed(1) + "->" + after.gloss.toFixed(1));
  return actions;
}

function applyReferenceSideHighClamp(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
  frozenPolicy?: SideHighClampPolicy,
) {
  const policy = frozenPolicy ?? getSideHighClampPolicy(channels, sampleRate, settings);
  if (!policy) return "Reference Side High Clamp bypassed";
  const { before, target, ultraExcessDb, airNoiseExcessDb, trimDb, highpassHz } = policy;
  if (!policy.shouldClamp || trimDb <= 0.05) {
    return `Reference Side High Clamp: safe / Gloss ${before.gloss.toFixed(1)}dB / 10-20k ${before.ultra.toFixed(1)}dB / 14-20k ${before.airNoise.toFixed(1)}dB`;
  }

  applyHighSideGainToStereo(channels, sampleRate, highpassHz, dbToGain(-trimDb));
  let after = measureHighBandSideImage(channels, sampleRate);
  let extraTrimDb = 0;
  const maxTotalTrimDb = airNoiseExcessDb > 12 ? 24 : airNoiseExcessDb > 8 ? 15 : 6.5;
  let airNoiseFocusedTrimDb = 0;
  for (let pass = 0; pass < 5; pass += 1) {
    const postUltraExcess = target.ultra == null ? 0 : after.ultra - target.ultra;
    const postAirNoiseExcess = target.airNoise == null ? 0 : after.airNoise - target.airNoise;
    if ((postUltraExcess <= 2.4 && postAirNoiseExcess <= 7) || trimDb + extraTrimDb >= maxTotalTrimDb) break;
    const nextTrimDb = clampNumber(0.55 + Math.max(postUltraExcess - 2.1, postAirNoiseExcess - 6.0) * 0.5, 0, 5.5);
    if (nextTrimDb <= 0.05) break;
    const boundedTrimDb = Math.min(nextTrimDb, Math.max(0, maxTotalTrimDb - trimDb - extraTrimDb));
    applyHighSideGainToStereo(channels, sampleRate, highpassHz, dbToGain(-boundedTrimDb));
    extraTrimDb += boundedTrimDb;
    after = measureHighBandSideImage(channels, sampleRate);
  }

  const remainingAirNoiseExcess = target.airNoise == null ? 0 : after.airNoise - target.airNoise;
  if (remainingAirNoiseExcess > 8 && trimDb + extraTrimDb < maxTotalTrimDb) {
    airNoiseFocusedTrimDb = Math.min(
      clampNumber(0.9 + (remainingAirNoiseExcess - 7) * 0.64, 0, 10),
      Math.max(0, maxTotalTrimDb - trimDb - extraTrimDb),
    );
    if (airNoiseFocusedTrimDb > 0.05) {
      applyBandSideGainToStereo(channels, sampleRate, 14000, 20000, dbToGain(-airNoiseFocusedTrimDb));
      after = measureHighBandSideImage(channels, sampleRate);
    }
  }

  let midSheenRecoveryDb = 0;
  const targetTonal = {
    ultra: finiteOptional(settings.referenceUltraAirDb),
    sheen: finiteOptional(settings.referenceSheenDb),
  };
  if (targetTonal.ultra != null || targetTonal.sheen != null) {
    const postUltraExcess = target.ultra == null ? 0 : after.ultra - target.ultra;
    const postAirNoiseExcess = target.airNoise == null ? 0 : after.airNoise - target.airNoise;
    const tonalAfterClamp = measureReferenceTonalEnergy(channels, sampleRate);
    const ultraEnergyGapDb = targetTonal.ultra == null ? 0 : targetTonal.ultra - tonalAfterClamp.ultra;
    const sheenEnergyGapDb = targetTonal.sheen == null ? 0 : targetTonal.sheen - tonalAfterClamp.sheen;
    const needsMidSheenRecovery = ultraEnergyGapDb > 1.5 || sheenEnergyGapDb > 2.0;
    if (needsMidSheenRecovery && postUltraExcess <= 3.2 && postAirNoiseExcess <= 7) {
      midSheenRecoveryDb = clampNumber(Math.max(ultraEnergyGapDb - 1.1, sheenEnergyGapDb - 1.6) * 0.18, 0.08, 0.45);
      applyMidOnlyUpperSheenToStereo(channels, sampleRate, midSheenRecoveryDb);
      after = measureHighBandSideImage(channels, sampleRate);
    }
  }

  const totalTrimDb = trimDb + extraTrimDb + airNoiseFocusedTrimDb;
  return `Reference Side High Clamp: HPF ${highpassHz.toFixed(0)}Hz side -${totalTrimDb.toFixed(1)}dB${extraTrimDb > 0.05 ? " multi-pass" : ""}${airNoiseFocusedTrimDb > 0.05 ? " / 14k focused" : ""}${midSheenRecoveryDb > 0.02 ? ` / mid sheen recovery +${midSheenRecoveryDb.toFixed(2)}dB` : ""} / 10-20k Side ${before.ultra.toFixed(1)} -> ${after.ultra.toFixed(1)}dB (ref ${target.ultra?.toFixed(1) ?? "n/a"}, excess ${ultraExcessDb.toFixed(1)}dB) / 14-20k Side ${before.airNoise.toFixed(1)} -> ${after.airNoise.toFixed(1)}dB (ref ${target.airNoise?.toFixed(1) ?? "n/a"}, excess ${airNoiseExcessDb.toFixed(1)}dB)`;
}

function applyPostClaritySafetyPass(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
) {
  const actions: string[] = [];
  const sidePolicy = getSideHighClampPolicy(channels, sampleRate, settings);
  const preferMidOnlySheen = shouldPreferMidOnlySheen(sidePolicy, settings);
  const postPresenceDb = clampNumber((settings.presenceCatchUpDb ?? 0) * 0.22, 0, 0.34);
  const postFocusDb = clampNumber(postPresenceDb * 0.45, 0, 0.16);
  const clarityDb = settings.falseAirRisk ? 0 : clampNumber((settings.clarityCatchUpDb ?? 0) * 0.18, 0, 0.16);
  const airDb = settings.falseAirRisk ? 0 : clampNumber((settings.airCatchUpDb ?? 0) * 0.22, 0, 0.14);
  const requestedSheenDb = settings.sheenCatchUpDb ?? 0;
  const sheenDb = settings.falseAirRisk || preferMidOnlySheen ? 0 : clampNumber(requestedSheenDb * 0.27, 0, 1.2);
  const midSheenDb = settings.falseAirRisk || preferMidOnlySheen ? clampNumber(requestedSheenDb * 0.34, 0, 1.35) : 0;

  if (postPresenceDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 3100, postPresenceDb, 0.7));
  }
  if (postFocusDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 4300, postFocusDb, 1.25));
  }
  if (clarityDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 6500, clarityDb, 1.1));
  }
  if (airDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 9500, airDb, 1.0));
  }
  if (sheenDb > 0.02) {
    applyBiquadToChannels(channels, makeHighshelf(sampleRate, 14000, sheenDb, 0.65));
    applyBiquadToChannels(channels, makePeaking(sampleRate, 16000, clampNumber(sheenDb * 0.28, 0, 0.45), 0.85));
  }
  if (midSheenDb > 0.02) {
    if (preferMidOnlySheen && !settings.falseAirRisk) {
      applyMidOnlyUpperSheenToStereo(channels, sampleRate, midSheenDb);
    } else {
      applyMidOnlySheenToStereo(channels, sampleRate, midSheenDb);
    }
  }
  const glareSheenDb = settings.falseAirRisk ? 0 : clampNumber(settings.sheenCatchUpDb ?? 0, 0, 4.8);
  const glareGuardDb = settings.falseAirRisk ? 0 : clampNumber(glareSheenDb * 0.24 + airDb * 0.25, 0, 1.35);
  if (glareGuardDb > 0.02) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 7800, -glareGuardDb, 1.05));
  }
  actions.push(postPresenceDb > 0.02 || clarityDb > 0.02 || airDb > 0.02 || sheenDb > 0.02 || midSheenDb > 0.02
    ? `Post Clarity Safety Pass: presence ${postPresenceDb.toFixed(2)}dB / clarity ${clarityDb.toFixed(2)}dB / air ${airDb.toFixed(2)}dB / sheen ${sheenDb.toFixed(2)}dB${midSheenDb > 0.02 ? ` / mid sheen ${midSheenDb.toFixed(2)}dB` : ""} / glare guard -${glareGuardDb.toFixed(2)}dB${preferMidOnlySheen ? " / high-side protected" : ""}`
    : "Post Clarity Safety Pass bypassed");
  return actions;
}

type FinalTruePeakSafetyResult = {
  trimDb: number;
  finalTruePeakDbtp: number;
  reachedCeiling: boolean;
};

function applyFinalTruePeakSafetyTrim(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  ceilingDb: number,
  quality: MobileAudioQuality,
): FinalTruePeakSafetyResult {
  let totalTrimDb = 0;
  const emergencyMaxTrimDb = 6;
  for (let pass = 0; pass < 6; pass += 1) {
    const metrics = analyzeSingleFileMastering(channels, sampleRate, { quality });
    const overDb = metrics.estimatedTruePeakDb - ceilingDb;
    if (overDb <= 0.03) break;
    const remainingTrimDb = emergencyMaxTrimDb - totalTrimDb;
    if (remainingTrimDb <= 0) break;
    const trimAmountDb = clampNumber(overDb + 0.08, 0.1, Math.min(1.5, remainingTrimDb));
    if (trimAmountDb <= 0) break;
    applyGainToChannels(channels, dbToGain(-trimAmountDb));
    totalTrimDb += trimAmountDb;
  }
  const finalMetrics = analyzeSingleFileMastering(channels, sampleRate, { quality });
  return {
    trimDb: totalTrimDb > 0 ? -round2(totalTrimDb) : 0,
    finalTruePeakDbtp: round2(finalMetrics.estimatedTruePeakDb),
    reachedCeiling: finalMetrics.estimatedTruePeakDb <= ceilingDb + 0.03,
  };
}


type FinalTargetLufsAuthorityTrimResult = {
  applied: boolean;
  beforeLufs: number;
  afterLufs: number;
  trimDb: number;
};

function applyFinalTargetLufsAuthorityTrim(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  options: {
    targetLufs: number;
    upperToleranceLu: number;
    quality: MobileAudioQuality;
  },
): FinalTargetLufsAuthorityTrimResult {
  const before = analyzeSingleFileMastering(channels, sampleRate, { quality: options.quality });
  const maxAllowedLufs = options.targetLufs + Math.max(0, options.upperToleranceLu);
  const overshootLu = before.estimatedLufs - maxAllowedLufs;
  if (overshootLu <= 0.02) {
    return {
      applied: false,
      beforeLufs: round2(before.estimatedLufs),
      afterLufs: round2(before.estimatedLufs),
      trimDb: 0,
    };
  }

  const trimDb = -round2(clampNumber(overshootLu + 0.02, 0.05, 6));
  applyGainToChannels(channels, dbToGain(trimDb));
  const after = analyzeSingleFileMastering(channels, sampleRate, { quality: options.quality });
  return {
    applied: true,
    beforeLufs: round2(before.estimatedLufs),
    afterLufs: round2(after.estimatedLufs),
    trimDb,
  };
}

type FinalTargetLufsCatchUpGainResult = {
  applied: boolean;
  beforeLufs: number;
  afterLufs: number;
  gainDb: number;
};

function applyFinalTargetLufsCatchUpGain(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  options: {
    targetLufs: number;
    truePeakCeilingDb: number;
    quality: MobileAudioQuality;
  },
): FinalTargetLufsCatchUpGainResult {
  const before = analyzeSingleFileMastering(channels, sampleRate, { quality: options.quality });
  const shortfallLu = options.targetLufs - before.estimatedLufs;
  const peakHeadroomDb = options.truePeakCeilingDb - before.estimatedTruePeakDb - 0.18;
  if (shortfallLu <= 0.35 || peakHeadroomDb <= 0.18) {
    return {
      applied: false,
      beforeLufs: round2(before.estimatedLufs),
      afterLufs: round2(before.estimatedLufs),
      gainDb: 0,
    };
  }

  const gainDb = round2(clampNumber(Math.min(shortfallLu - 0.18, peakHeadroomDb), 0.18, 1.45));
  applyGainToChannels(channels, dbToGain(gainDb));
  const after = analyzeSingleFileMastering(channels, sampleRate, { quality: options.quality });
  return {
    applied: true,
    beforeLufs: round2(before.estimatedLufs),
    afterLufs: round2(after.estimatedLufs),
    gainDb,
  };
}

function buildSingleFileTargetReport(
  before: SingleFileMasteringMetrics,
  after: SingleFileMasteringMetrics,
  settings: SingleFileMasteringSettings,
  finalTrimDb: number,
): SingleFileTargetReport {
  const plrDb = after.estimatedTruePeakDb - after.estimatedLufs;
  if (!settings.stages.targetLoudness) {
    return {
      requestedTargetLufs: round2(settings.targetLufs),
      effectiveTargetLufs: round2(before.estimatedLufs),
      targetLufsSource: settings.targetLufsSource ?? "preset",
      referenceTargetLufs: Number.isFinite(settings.referenceTargetLufs) ? round2(Number(settings.referenceTargetLufs)) : undefined,
      beforeLufs: round2(before.estimatedLufs),
      afterLufs: round2(after.estimatedLufs),
      overshootLu: 0,
      underTargetLu: 0,
      finalTrimDb: round2(finalTrimDb),
      plrDb: round2(plrDb),
      minPlrDb: 0,
      passed: after.estimatedTruePeakDb <= settings.truePeakCeilingDb + 0.05,
    };
  }
  const minPlrDb = getSingleFileMinPlr(settings.mode, settings.targetLufs);
  const referenceTargetToleranceLu = settings.mode === "referenceCatchUp" && Number.isFinite(settings.referenceTargetLufs)
    ? 1.8
    : 0.3;
  const overshootLu = Math.max(0, after.estimatedLufs - (settings.targetLufs + referenceTargetToleranceLu));
  const underTargetLu = Math.max(0, settings.targetLufs - after.estimatedLufs);
  const peakConstrainedShortfall = underTargetLu > 0.75 && after.estimatedTruePeakDb > settings.truePeakCeilingDb - 0.8;
  return {
    requestedTargetLufs: round2(settings.targetLufs),
    effectiveTargetLufs: round2(settings.targetLufs),
    targetLufsSource: settings.targetLufsSource ?? "preset",
    referenceTargetLufs: Number.isFinite(settings.referenceTargetLufs) ? round2(Number(settings.referenceTargetLufs)) : undefined,
    beforeLufs: round2(before.estimatedLufs),
    afterLufs: round2(after.estimatedLufs),
    overshootLu: round2(overshootLu),
    underTargetLu: round2(underTargetLu),
    finalTrimDb: round2(finalTrimDb),
    plrDb: round2(plrDb),
    minPlrDb: round2(minPlrDb),
    passed: overshootLu <= 0.2 && !peakConstrainedShortfall && after.estimatedTruePeakDb <= settings.truePeakCeilingDb + 0.05 && plrDb >= minPlrDb,
  };
}

function getSingleFileMinPlr(mode: SingleFileMasteringMode, targetLufs: number) {
  if (mode === "loudRelease") return targetLufs <= -10 ? 8.8 : 8.5;
  if (targetLufs <= -13) return 9.8;
  if (targetLufs <= -11) return 9.2;
  if (targetLufs <= -10) return 8.8;
  if (targetLufs <= -9) return 8.5;
  return 8.3;
}

function getSingleFileMaxTargetGainDb(settings: SingleFileMasteringSettings, current: SingleFileMasteringMetrics) {
  if (settings.targetLufs <= current.estimatedLufs) return settings.targetLufs - current.estimatedLufs;
  if (settings.mode === "lightMaster" || settings.mode === "loudnessOnly" || settings.mode === "existing") return 18;
  const currentPlrDb = current.estimatedTruePeakDb - current.estimatedLufs;
  const minPlrDb = getSingleFileMinPlr(settings.mode, settings.targetLufs);
  const plrPenaltyDb = currentPlrDb < minPlrDb ? (minPlrDb - currentPlrDb) * 0.5 : 0;
  const limiterBudgetDb = getReferenceTransparentLimiterTargetDb(settings);
  const peakRoomWithBudgetDb = settings.truePeakCeilingDb - current.estimatedTruePeakDb + limiterBudgetDb;
  const modeGainLimitDb = settings.mode === "loudRelease" ? 5 : settings.mode === "referenceCatchUp" ? 4.2 : 6;
  return clampNumber(Math.min(modeGainLimitDb, peakRoomWithBudgetDb - plrPenaltyDb), 0, modeGainLimitDb);
}
function cloneAndSanitizeChannels(inputChannels: SingleFileAudioChannel[], warnings: string[]): SingleFileAudioChannel[] {
  let replaced = 0;
  const sampleCount = getCommonLength(inputChannels);
  const channels = inputChannels.map((channel) => {
    const copy = new Float32Array(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = channel[index] ?? 0;
      if (Number.isFinite(sample)) {
        copy[index] = sample;
      } else {
        copy[index] = 0;
        replaced += 1;
      }
    }
    return copy;
  });
  if (replaced > 0) warnings.push(`Replaced ${replaced} invalid samples with silence.`);
  return channels;
}

function sanitizeChannelsInPlace(inputChannels: SingleFileAudioChannel[], warnings: string[]): SingleFileAudioChannel[] {
  let replaced = 0;
  for (const channel of inputChannels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index] ?? 0;
      if (!Number.isFinite(sample)) {
        channel[index] = 0;
        replaced += 1;
      }
    }
  }
  if (replaced > 0) warnings.push(`Replaced ${replaced} invalid samples with silence.`);
  return inputChannels;
}

function applyBiquadToChannels(channels: SingleFileAudioChannel[], coefficients: BiquadCoefficients) {
  for (const channel of channels) {
    applyBiquadInPlace(channel, coefficients);
  }
}

function applyBiquadInPlace(input: SingleFileAudioChannel, coefficients: BiquadCoefficients) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let index = 0; index < input.length; index += 1) {
    const x0 = input[index] ?? 0;
    const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 + coefficients.b2 * x2 - coefficients.a1 * y1 - coefficients.a2 * y2;
    input[index] = sanitizeSample(y0);
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
}

function applyMidOnlySheenToStereo(channels: SingleFileAudioChannel[], sampleRate: number, gainDb: number) {
  if (channels.length < 2) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 16000, gainDb, 0.78));
    applyBiquadToChannels(channels, makePeaking(sampleRate, 18500, clampNumber(gainDb * 0.55, 0, 1.25), 0.7));
    return;
  }
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  const sheenBody = makeBiquadSampleProcessor(makePeaking(sampleRate, 16000, gainDb, 0.78));
  const sheenTop = makeBiquadSampleProcessor(makePeaking(sampleRate, 18500, clampNumber(gainDb * 0.55, 0, 1.25), 0.7));
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const processedMid = sheenTop(sheenBody(mid));
    const delta = processedMid - mid;
    left[index] = sanitizeSample(l + delta);
    right[index] = sanitizeSample(r + delta);
  }
}

function applyMidOnlyUpperSheenToStereo(channels: SingleFileAudioChannel[], sampleRate: number, gainDb: number) {
  const safeGainDb = clampNumber(gainDb, 0, 2.2);
  if (channels.length < 2) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 15200, safeGainDb, 0.72));
    applyBiquadToChannels(channels, makePeaking(sampleRate, 18200, clampNumber(safeGainDb * 0.45, 0, 0.9), 0.68));
    return;
  }
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  const sheenBody = makeBiquadSampleProcessor(makePeaking(sampleRate, 15200, safeGainDb, 0.72));
  const sheenTop = makeBiquadSampleProcessor(makePeaking(sampleRate, 18200, clampNumber(safeGainDb * 0.45, 0, 0.9), 0.68));
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const processedMid = sheenTop(sheenBody(mid));
    const delta = processedMid - mid;
    left[index] = sanitizeSample(l + delta);
    right[index] = sanitizeSample(r + delta);
  }
}

function applyMidOnlyGlossShiftToStereo(channels: SingleFileAudioChannel[], sampleRate: number, gainDb: number) {
  const safeGainDb = clampNumber(gainDb, 0, 4);
  if (channels.length < 2) {
    applyBiquadToChannels(channels, makePeaking(sampleRate, 11000, safeGainDb, 0.85));
    applyBiquadToChannels(channels, makePeaking(sampleRate, 13500, clampNumber(safeGainDb * 0.42, 0, 1.4), 0.95));
    return;
  }
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  const glossBody = makeBiquadSampleProcessor(makePeaking(sampleRate, 11000, safeGainDb, 0.85));
  const glossTop = makeBiquadSampleProcessor(makePeaking(sampleRate, 13500, clampNumber(safeGainDb * 0.42, 0, 1.4), 0.95));
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const processedMid = glossTop(glossBody(mid));
    const delta = processedMid - mid;
    left[index] = sanitizeSample(l + delta);
    right[index] = sanitizeSample(r + delta);
  }
}

function applyBandSideGainToStereo(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  lowHz: number,
  highHz: number,
  sideGain: number,
) {
  if (channels.length < 2) return;
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  const highpass = makeBiquadSampleProcessor(makeHighpass(sampleRate, lowHz, 0.707));
  const lowpass = makeBiquadSampleProcessor(makeLowpass(sampleRate, highHz, 0.707));
  const sideDeltaGain = clampNumber(sideGain, 0.1, 1.8) - 1;
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const sideBand = lowpass(highpass(side));
    const nextSide = side + sideBand * sideDeltaGain;
    left[index] = sanitizeSample(mid + nextSide);
    right[index] = sanitizeSample(mid - nextSide);
  }
}

function makeBiquadSampleProcessor(coefficients: BiquadCoefficients) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x0: number) => {
    const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 + coefficients.b2 * x2 - coefficients.a1 * y1 - coefficients.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    return sanitizeSample(y0);
  };
}

function protectReferenceGainForAudition(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
  requestedGainDb: number,
) {
  if (settings.mode !== "referenceCatchUp" || !settings.stages.truePeakLimiter || requestedGainDb <= 0) {
    return requestedGainDb;
  }
  const current = analyzeSingleFileMastering(channels, sampleRate);
  const projectedLimiterLoadDb = Math.max(0, current.estimatedTruePeakDb + requestedGainDb - settings.truePeakCeilingDb);
  const transparentTargetDb = getReferenceTransparentLimiterTargetDb(settings);
  if (projectedLimiterLoadDb <= transparentTargetDb) return requestedGainDb;
  const reductionDb = projectedLimiterLoadDb - transparentTargetDb;
  return clampNumber(requestedGainDb - reductionDb, 0, requestedGainDb);
}

function applyReferencePreLimiterRelief(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
) {
  if (settings.mode !== "referenceCatchUp" || !settings.stages.truePeakLimiter) return 0;
  const current = analyzeSingleFileMastering(channels, sampleRate);
  const measuredLimiterLoadDb = Math.max(0, current.estimatedTruePeakDb - settings.truePeakCeilingDb);
  const transparentTargetDb = getReferenceTransparentLimiterTargetDb(settings);
  if (measuredLimiterLoadDb <= transparentTargetDb + 0.05) return 0;
  const trimDb = -round2(clampNumber(measuredLimiterLoadDb - transparentTargetDb, 0.1, 1.2));
  applyGainToChannels(channels, dbToGain(trimDb));
  return trimDb;
}

function getReferenceTransparentLimiterTargetDb(settings: SingleFileMasteringSettings) {
  if (settings.mode === "referenceCatchUp") {
    return (settings.referenceDensityGateAmount ?? 0) > 0.2 ? 3.2 : 2.5;
  }
  return settings.mode === "loudRelease" ? 3.5 : 3;
}

function getReferenceTransparentLimiterBudgetDb(settings: SingleFileMasteringSettings, usedLimiterGainReductionDb: number) {
  return Math.max(0, getReferenceTransparentLimiterTargetDb(settings) - Math.max(0, usedLimiterGainReductionDb));
}

function applyGlueCompression(channels: SingleFileAudioChannel[], thresholdDb: number, ratio: number) {
  const threshold = dbToGain(thresholdDb);
  let maxGainReductionDb = 0;
  for (const channel of channels) {
    let envelope = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index] ?? 0;
      const abs = Math.abs(sample);
      envelope += (abs - envelope) * (abs > envelope ? 0.015 : 0.0025);
      let gain = 1;
      if (envelope > threshold) {
        const inputDb = gainToDb(envelope);
        const overDb = inputDb - thresholdDb;
        const compressedOverDb = overDb / ratio;
        const gainReductionDb = overDb - compressedOverDb;
        maxGainReductionDb = Math.max(maxGainReductionDb, gainReductionDb);
        gain = dbToGain(-Math.min(3, gainReductionDb));
      }
      channel[index] = sanitizeSample(sample * gain);
    }
  }

  return {
    channels,
    maxGainReductionDb: round2(maxGainReductionDb),
  };
}

function applyGainToChannels(channels: SingleFileAudioChannel[], gain: number) {
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = sanitizeSample((channel[index] ?? 0) * gain);
    }
  }
}

function applySideGainToStereo(channels: SingleFileAudioChannel[], sideGain: number) {
  if (channels.length < 2) return;
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5 * sideGain;
    left[index] = sanitizeSample(mid + side);
    right[index] = sanitizeSample(mid - side);
  }
}

function measureStereoImage(channels: SingleFileAudioChannel[]) {
  if (channels.length < 2) return { sideMidDb: -60, correlation: 1 };
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  let leftSquares = 0;
  let rightSquares = 0;
  let cross = 0;
  let midSquares = 0;
  let sideSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    leftSquares += l * l;
    rightSquares += r * r;
    cross += l * r;
    midSquares += mid * mid;
    sideSquares += side * side;
  }
  const sideMidDb = gainToDb(Math.sqrt(sideSquares / Math.max(1, sampleCount))) - gainToDb(Math.sqrt(midSquares / Math.max(1, sampleCount)));
  const correlation = cross / Math.max(1e-9, Math.sqrt(leftSquares * rightSquares));
  return {
    sideMidDb: round2(sideMidDb),
    correlation: round2(clampNumber(correlation, -1, 1)),
  };
}

type ReferenceTonalEnergy = {
  presence: number;
  air: number;
  gloss: number;
  ultra: number;
  sheen: number;
};

function measureReferenceTonalEnergy(channels: SingleFileAudioChannel[], sampleRate: number): ReferenceTonalEnergy {
  return {
    presence: measureBandEnergyDb(channels, sampleRate, [2200, 3500, 4800]),
    air: measureBandEnergyDb(channels, sampleRate, [5500, 7500, 9500]),
    gloss: measureBandEnergyDb(channels, sampleRate, [9200, 11000, 13500]),
    ultra: measureBandEnergyDb(channels, sampleRate, [10500, 14000, 18000]),
    sheen: measureBandEnergyDb(channels, sampleRate, [14500, 16500, 19000]),
  };
}

function measureBandEnergyDb(channels: SingleFileAudioChannel[], sampleRate: number, points: readonly number[]) {
  const values = points.map((frequency) => measureFrequencyEnergyDb(channels, sampleRate, frequency));
  const powers = values.map((value) => 10 ** (value / 10));
  return round2(10 * Math.log10(Math.max(1e-12, powers.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length))));
}

function measureFrequencyEnergyDb(channels: SingleFileAudioChannel[], sampleRate: number, frequency: number) {
  const left = channels[0] ?? new Float32Array(0);
  const right = channels[1] ?? left;
  const sampleCount = Math.min(left.length, right.length);
  const windowSize = Math.min(2048, Math.max(256, Math.floor(sampleCount / 2)));
  if (sampleCount < 8 || windowSize < 8) return -96;

  const durationSec = sampleCount / sampleRate;
  const frameCount = Math.max(4, Math.min(48, Math.floor(durationSec)));
  const omega = (2 * Math.PI * Math.min(frequency, sampleRate / 2 - 100)) / sampleRate;
  let magnitudeSum = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frameCount === 1 ? 0 : Math.floor((frame / (frameCount - 1)) * Math.max(0, sampleCount - windowSize));
    let real = 0;
    let imag = 0;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const l = left[start + offset] ?? 0;
      const r = right[start + offset] ?? l;
      const sample = (l + r) * 0.5;
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / Math.max(1, windowSize - 1));
      real += sample * win * Math.cos(omega * offset);
      imag -= sample * win * Math.sin(omega * offset);
    }
    magnitudeSum += Math.sqrt(real * real + imag * imag) / (windowSize * 0.5);
  }

  return round2(gainToDb(magnitudeSum / Math.max(1, frameCount)));
}

type HighBandSideImage = {
  gloss: number;
  ultra: number;
  airNoise: number;
};

type SideHighClampPolicy = {
  shouldClamp: boolean;
  blockHighShelfBoost: boolean;
  trimDb: number;
  highpassHz: number;
  before: HighBandSideImage;
  target: {
    gloss?: number;
    ultra?: number;
    airNoise?: number;
  };
  glossExcessDb: number;
  ultraExcessDb: number;
  airNoiseExcessDb: number;
};

function getSideHighClampPolicy(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  settings: SingleFileMasteringSettings,
): SideHighClampPolicy | null {
  if (channels.length < 2 || (settings.sideHighClampAmount ?? 0) <= 0.01) return null;
  const target = {
    gloss: finiteOptional(settings.referenceGlossSideMidDb),
    ultra: finiteOptional(settings.referenceUltraAirSideMidDb),
    airNoise: finiteOptional(settings.referenceAirNoiseSideMidDb),
  };
  if (target.gloss == null && target.ultra == null && target.airNoise == null) return null;

  const before = measureHighBandSideImage(channels, sampleRate);
  const glossExcessDb = target.gloss == null ? 0 : before.gloss - target.gloss;
  const ultraExcessDb = target.ultra == null ? 0 : before.ultra - target.ultra;
  const airNoiseExcessDb = target.airNoise == null ? 0 : before.airNoise - target.airNoise;
  const ultraPriority = ultraExcessDb > 3;
  const airNoisePriority = airNoiseExcessDb > 8;
  const shouldClamp = ultraPriority || airNoisePriority;
  const amount = clampNumber(settings.sideHighClampAmount ?? 0, 0, 1);
  const trimFromUltra = ultraPriority
    ? clampNumber((ultraExcessDb - 2) * 0.5, 0.8, 3.2)
    : 0;
  const trimFromAirNoise = airNoisePriority
    ? clampNumber((airNoiseExcessDb - 6) * 0.58, 2, 9)
    : 0;
  const trimDb = clampNumber(Math.max(trimFromUltra, trimFromAirNoise) * amount, 0, airNoisePriority ? 9 : 3.2);

  return {
    shouldClamp,
    blockHighShelfBoost: airNoisePriority || ultraPriority,
    trimDb,
    highpassHz: ultraPriority ? 10000 : 14000,
    before,
    target,
    glossExcessDb: round2(glossExcessDb),
    ultraExcessDb: round2(ultraExcessDb),
    airNoiseExcessDb: round2(airNoiseExcessDb),
  };
}

function shouldPreferMidOnlySheen(
  policy: SideHighClampPolicy | null,
  settings: SingleFileMasteringSettings,
) {
  if (settings.falseAirRisk) return true;
  if (!policy) return false;
  return policy.blockHighShelfBoost ||
    policy.airNoiseExcessDb > 2.5 ||
    policy.ultraExcessDb > 1.5;
}

function measureHighBandSideImage(channels: SingleFileAudioChannel[], sampleRate: number): HighBandSideImage {
  return {
    gloss: measureBandSideMidDb(channels, sampleRate, [9200, 11000, 13500]),
    ultra: measureBandSideMidDb(channels, sampleRate, [10500, 14000, 18000]),
    airNoise: measureBandSideMidDb(channels, sampleRate, [14500, 16500, 19000]),
  };
}

function measureBandSideMidDb(channels: SingleFileAudioChannel[], sampleRate: number, points: readonly number[]) {
  const values = points.map((frequency) => measureFrequencySideMidDb(channels, sampleRate, frequency));
  return round2(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length));
}

function measureFrequencySideMidDb(channels: SingleFileAudioChannel[], sampleRate: number, frequency: number) {
  if (channels.length < 2) return -60;
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  const windowSize = Math.min(2048, Math.max(256, Math.floor(sampleCount / 2)));
  if (sampleCount < 8 || windowSize < 8) return -60;

  const durationSec = sampleCount / sampleRate;
  const frameCount = Math.max(4, Math.min(32, Math.floor(durationSec)));
  const omega = (2 * Math.PI * Math.min(frequency, sampleRate / 2 - 100)) / sampleRate;
  let midMagnitudeSum = 0;
  let sideMagnitudeSum = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frameCount === 1 ? 0 : Math.floor((frame / (frameCount - 1)) * Math.max(0, sampleCount - windowSize));
    let midReal = 0;
    let midImag = 0;
    let sideReal = 0;
    let sideImag = 0;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const l = left[start + offset] ?? 0;
      const r = right[start + offset] ?? l;
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / Math.max(1, windowSize - 1));
      const cos = Math.cos(omega * offset);
      const sin = Math.sin(omega * offset);
      midReal += mid * win * cos;
      midImag -= mid * win * sin;
      sideReal += side * win * cos;
      sideImag -= side * win * sin;
    }
    midMagnitudeSum += Math.sqrt(midReal * midReal + midImag * midImag) / (windowSize * 0.5);
    sideMagnitudeSum += Math.sqrt(sideReal * sideReal + sideImag * sideImag) / (windowSize * 0.5);
  }

  return gainToDb(sideMagnitudeSum / Math.max(1, frameCount)) - gainToDb(midMagnitudeSum / Math.max(1, frameCount));
}

function applyHighSideGainToStereo(
  channels: SingleFileAudioChannel[],
  sampleRate: number,
  highpassHz: number,
  sideGain: number,
) {
  if (channels.length < 2) return;
  const left = channels[0]!;
  const right = channels[1]!;
  const sampleCount = Math.min(left.length, right.length);
  const highpass = makeBiquadSampleProcessor(makeHighpass(sampleRate, highpassHz, 0.707));
  const reduction = 1 - clampNumber(sideGain, 0, 1);
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const sideHigh = highpass(side);
    const nextSide = side - sideHigh * reduction;
    left[index] = sanitizeSample(mid + nextSide);
    right[index] = sanitizeSample(mid - nextSide);
  }
}

function applyPeakCeiling(channels: SingleFileAudioChannel[], ceilingDb: number): { channels: SingleFileAudioChannel[]; gainReductionDb: number } {
  const sampleCount = getCommonLength(channels);
  const ceiling = dbToGain(ceilingDb - 0.35);
  const kneeStart = ceiling * 0.78;
  const kneeRange = Math.max(1e-6, ceiling - kneeStart);
  let maxGainReductionDb = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    let framePeak = 0;
    for (const channel of channels) framePeak = Math.max(framePeak, Math.abs(channel[index] ?? 0));
    if (framePeak <= kneeStart || framePeak <= 0) continue;

    const over = framePeak - kneeStart;
    const limitedPeak = kneeStart + kneeRange * Math.tanh(over / kneeRange);
    const gain = Math.min(1, limitedPeak / framePeak);
    maxGainReductionDb = Math.max(maxGainReductionDb, -gainToDb(gain));
    for (const channel of channels) channel[index] = sanitizeSample((channel[index] ?? 0) * gain);
  }

  const safetyGain = getPeakSafetyGain(channels, ceiling);
  if (safetyGain < 1) {
    applyGainToChannels(channels, safetyGain);
    maxGainReductionDb = Math.max(maxGainReductionDb, -gainToDb(safetyGain));
  }

  return {
    channels,
    gainReductionDb: round2(maxGainReductionDb),
  };
}

function getPeakSafetyGain(channels: SingleFileAudioChannel[], ceiling: number) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
  }
  if (peak <= ceiling || peak <= 0) return 1;
  return ceiling / peak;
}

function clampChannels(channels: SingleFileAudioChannel[]) {
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.max(-1, Math.min(1, sanitizeSample(channel[index] ?? 0)));
    }
  }
}

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

function makeHighpass(sampleRate: number, frequency: number, q: number): BiquadCoefficients {
  const omega = 2 * Math.PI * clampNumber(frequency, 10, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return normalizeBiquad(b0, b1, b2, a0, a1, a2);
}

function makeLowpass(sampleRate: number, frequency: number, q: number): BiquadCoefficients {
  const omega = 2 * Math.PI * clampNumber(frequency, 20, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const b0 = (1 - cos) / 2;
  const b1 = 1 - cos;
  const b2 = (1 - cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return normalizeBiquad(b0, b1, b2, a0, a1, a2);
}

function makePeaking(sampleRate: number, frequency: number, gainDb: number, q: number): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const omega = 2 * Math.PI * clampNumber(frequency, 20, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const b0 = 1 + alpha * a;
  const b1 = -2 * cos;
  const b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a;
  const a1 = -2 * cos;
  const a2 = 1 - alpha / a;
  return normalizeBiquad(b0, b1, b2, a0, a1, a2);
}

function makeLowshelf(sampleRate: number, frequency: number, gainDb: number, slope: number): BiquadCoefficients {
  return makeShelf(sampleRate, frequency, gainDb, slope, "low");
}

function makeHighshelf(sampleRate: number, frequency: number, gainDb: number, slope: number): BiquadCoefficients {
  return makeShelf(sampleRate, frequency, gainDb, slope, "high");
}

function makeShelf(sampleRate: number, frequency: number, gainDb: number, slope: number, type: "low" | "high"): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const omega = 2 * Math.PI * clampNumber(frequency, 20, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const safeSlope = clampNumber(slope, 0.3, 1.2);
  const beta = 2 * Math.sqrt(a) * Math.sqrt(Math.max(0, (a + 1 / a) * (1 / safeSlope - 1) + 2));
  if (type === "low") {
    const b0 = a * ((a + 1) - (a - 1) * cos + beta * sin);
    const b1 = 2 * a * ((a - 1) - (a + 1) * cos);
    const b2 = a * ((a + 1) - (a - 1) * cos - beta * sin);
    const a0 = (a + 1) + (a - 1) * cos + beta * sin;
    const a1 = -2 * ((a - 1) + (a + 1) * cos);
    const a2 = (a + 1) + (a - 1) * cos - beta * sin;
    return normalizeBiquad(b0, b1, b2, a0, a1, a2);
  }
  const b0 = a * ((a + 1) + (a - 1) * cos + beta * sin);
  const b1 = -2 * a * ((a - 1) + (a + 1) * cos);
  const b2 = a * ((a + 1) + (a - 1) * cos - beta * sin);
  const a0 = (a + 1) - (a - 1) * cos + beta * sin;
  const a1 = 2 * ((a - 1) - (a + 1) * cos);
  const a2 = (a + 1) - (a - 1) * cos - beta * sin;
  return normalizeBiquad(b0, b1, b2, a0, a1, a2);
}

function normalizeBiquad(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefficients {
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function estimateInterSamplePeakMarginDb(channels: SingleFileAudioChannel[], sampleCount: number) {
  const streamingTruePeakDb = estimateTruePeakDbtpFromChannels(channels, 2, sampleCount);
  let samplePeak = 0;
  for (const channel of channels) {
    for (let index = 0; index < sampleCount; index += 1) {
      samplePeak = Math.max(samplePeak, Math.abs(channel[index] ?? 0));
    }
  }
  const samplePeakDb = gainToDb(samplePeak);
  return clampNumber(streamingTruePeakDb - samplePeakDb, 0.1, 0.45);
}

function calculateMonoFoldDownRmsLossDb(channels: SingleFileAudioChannel[], sampleCount: number) {
  if (channels.length < 2) return null;
  const left = channels[0]!;
  const right = channels[1]!;
  let stereoSquares = 0;
  let monoSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    stereoSquares += (l * l + r * r) * 0.5;
    const mono = (l + r) * 0.5;
    monoSquares += mono * mono;
  }
  const stereoRms = Math.sqrt(stereoSquares / Math.max(1, sampleCount));
  const monoRms = Math.sqrt(monoSquares / Math.max(1, sampleCount));
  return round2(gainToDb(monoRms) - gainToDb(stereoRms));
}

function getCommonLength(channels: SingleFileAudioChannel[]) {
  return Math.min(...channels.map((channel) => channel.length));
}

function assertValidAudio(channels: SingleFileAudioChannel[], sampleRate: number) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Invalid sample rate.");
  }
  if (channels.length === 0) {
    throw new Error("Cannot master audio without channels.");
  }
  const sampleCount = getCommonLength(channels);
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    throw new Error("Cannot master empty audio.");
  }
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function gainToDb(gain: number) {
  return gain > 0 ? 20 * Math.log10(gain) : -120;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function finiteOptional(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
