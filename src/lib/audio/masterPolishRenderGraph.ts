import { processSingleFileMastering, resolveSingleFileMasteringSettings, type SingleFileAudioChannel } from "@/daw/mastering/singleFileMastering";
import { applySweetFinalRepairModulesToChannels, type SweetFinalRepairParams } from "./finalRepairModules";
import { estimateBandEnergyDbFromPcm, toMasterPolishTargetHints, type SweetMasterPolishTargetHints, type SweetReferenceDeltaReport } from "./referenceDelta";
import { getSweetMasterTargetProfile, type SweetMasterTargetProfileId } from "./targetProfiles";
import { createDefaultSweetMasterPolish2Params, sanitizeSweetMasterPolish2Params, type SweetMasterPolish2Params, type SweetMasterPolish2Report } from "./masterPolishTypes";

export type SweetUnifiedRenderStageId =
  | "source-clip-edit"
  | "repair-region-pre-cleanup"
  | "track-plugins"
  | "track-gain-pan-routing"
  | "aimix-unmask-priority-ducking"
  | "track-summing"
  | "master-repair-safety-pass"
  | "master-polish-2"
  | "limiter-ceiling-export-normalization"
  | "wav-export-swtd-save";

export interface SweetUnifiedRenderStage {
  id: SweetUnifiedRenderStageId;
  order: number;
  label: string;
  description: string;
  previewUsesSameDsp: boolean;
  exportUsesSameDsp: boolean;
  connected: boolean;
  warnings: string[];
}

export interface SweetUnifiedRenderGraph {
  id: "sweet-unified-render-graph-v0.8";
  stages: SweetUnifiedRenderStage[];
  warnings: string[];
}

export interface SweetUnifiedRenderGraphWiring {
  repairRegions?: boolean;
  aimixUnmask?: boolean;
  masterRepairSafetyPass?: boolean;
  masterPolish2?: boolean;
  limiterCeilingExportNormalization?: boolean;
}

export interface SweetMasterPolish2ProcessOptions {
  referenceDelta?: SweetReferenceDeltaReport | null;
  targetHints?: SweetMasterPolishTargetHints | null;
  copyInput?: boolean;
}

export interface SweetMasterPolish2ProcessResult {
  channels: SingleFileAudioChannel[];
  report: SweetMasterPolish2Report;
  graph: SweetUnifiedRenderGraph;
  actions: string[];
  targetHints: SweetMasterPolishTargetHints;
}

const GRAPH_STAGE_DEFINITIONS: Array<Omit<SweetUnifiedRenderStage, "warnings">> = [
  {
    id: "source-clip-edit",
    order: 1,
    label: "Source / clip edit",
    description: "Source start, trim, fades, reverse, clip gain, and clip pan automation.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "repair-region-pre-cleanup",
    order: 2,
    label: "RepairRegion pre-cleanup",
    description: "Fixed spectral repair regions are rendered before track inserts.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "track-plugins",
    order: 3,
    label: "Track plug-ins",
    description: "Track EQ, character, compressor, and insert plug-in chains.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "track-gain-pan-routing",
    order: 4,
    label: "Track gain / pan / routing",
    description: "Track volume, pan, sends, and bus routing.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "aimix-unmask-priority-ducking",
    order: 5,
    label: "AIMIX Unmask / Priority Ducking",
    description: "AIMIX unmask operations and dynamic vocal ducking before summing.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "track-summing",
    order: 6,
    label: "Track summing",
    description: "Audible non-reference tracks sum into the master input.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "master-repair-safety-pass",
    order: 7,
    label: "Master repair safety pass",
    description: "Final repair modules can clean sub/phase/harshness risks before final polish.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "master-polish-2",
    order: 8,
    label: "Master Polish 2",
    description: "Target profile, reference delta hints, headroom prep, artifact control, peak restore, and final polish.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "limiter-ceiling-export-normalization",
    order: 9,
    label: "Limiter / ceiling / export normalization",
    description: "Final peak ceiling and optional export normalization.",
    previewUsesSameDsp: true,
    exportUsesSameDsp: true,
    connected: true,
  },
  {
    id: "wav-export-swtd-save",
    order: 10,
    label: "WAV export / .swtd save",
    description: "WAV encoding and project package save are terminal file operations, not extra DSP.",
    previewUsesSameDsp: false,
    exportUsesSameDsp: true,
    connected: true,
  },
];

export function buildSweetUnifiedRenderGraph(
  warnings: string[] = [],
  actualWiring: SweetUnifiedRenderGraphWiring = {},
): SweetUnifiedRenderGraph {
  return {
    id: "sweet-unified-render-graph-v0.8",
    stages: GRAPH_STAGE_DEFINITIONS.map((stage) => {
      const connected = resolveStageConnected(stage, actualWiring);
      const stageWarnings = stage.id === "wav-export-swtd-save" ? ["File encoding is export-only by design."] : [];
      if (!connected) stageWarnings.push(`${stage.label} is not connected to this render/export path.`);
      return {
        ...stage,
        connected,
        exportUsesSameDsp: stage.exportUsesSameDsp && connected,
        previewUsesSameDsp: stage.previewUsesSameDsp && connected,
        warnings: stageWarnings,
      };
    }),
    warnings,
  };
}

function resolveStageConnected(stage: Omit<SweetUnifiedRenderStage, "warnings">, actualWiring: SweetUnifiedRenderGraphWiring) {
  if (stage.id === "repair-region-pre-cleanup" && actualWiring.repairRegions !== undefined) return actualWiring.repairRegions;
  if (stage.id === "aimix-unmask-priority-ducking" && actualWiring.aimixUnmask !== undefined) return actualWiring.aimixUnmask;
  if (stage.id === "master-repair-safety-pass" && actualWiring.masterRepairSafetyPass !== undefined) return actualWiring.masterRepairSafetyPass;
  if (stage.id === "master-polish-2" && actualWiring.masterPolish2 !== undefined) return actualWiring.masterPolish2;
  if (stage.id === "limiter-ceiling-export-normalization" && actualWiring.limiterCeilingExportNormalization !== undefined) {
    return actualWiring.limiterCeilingExportNormalization;
  }
  return stage.connected;
}

export function resolveSweetMasterPolish2Params(input: Partial<SweetMasterPolish2Params> = {}, profileId?: SweetMasterTargetProfileId): SweetMasterPolish2Params {
  const base = createDefaultSweetMasterPolish2Params(profileId);
  return sanitizeSweetMasterPolish2Params({ ...base, ...input, profileId: input.profileId ?? profileId ?? base.profileId });
}

export function applySweetMasterPolish2ToChannels(
  inputChannels: SingleFileAudioChannel[],
  sampleRate: number,
  paramsInput: Partial<SweetMasterPolish2Params> = {},
  options: SweetMasterPolish2ProcessOptions = {},
): SweetMasterPolish2ProcessResult {
  const params = resolveSweetMasterPolish2Params(paramsInput, paramsInput.profileId);
  const profile = getSweetMasterTargetProfile(params.profileId);
  const targetHints = options.targetHints ?? toMasterPolishTargetHints(options.referenceDelta ?? null, profile);
  const graphWarnings: string[] = [];
  const actions: string[] = [];
  const channels = options.copyInput === false ? inputChannels : inputChannels.map((channel) => new Float32Array(channel));
  const beforeMetrics = analyzeMasterPolish2Channels(channels, sampleRate);
  const beforeRisk = computeMasterPolishRisk(channels, sampleRate);

  if (!params.enabled) {
    graphWarnings.push("Master Polish 2 is disabled; audio was returned unchanged.");
    return {
      channels,
      graph: buildSweetUnifiedRenderGraph(graphWarnings, {
        masterRepairSafetyPass: false,
        masterPolish2: false,
      }),
      targetHints,
      actions: ["Master Polish 2 bypassed"],
      report: {
        beforeLufsApprox: beforeMetrics.lufs,
        afterLufsApprox: beforeMetrics.lufs,
        beforeTruePeakEstimate: beforeMetrics.truePeak,
        afterTruePeakEstimate: beforeMetrics.truePeak,
        gainReductionPeakDb: 0,
        lowEndRiskBefore: beforeRisk.lowEndRisk,
        lowEndRiskAfter: beforeRisk.lowEndRisk,
        harshRiskBefore: beforeRisk.harshRisk,
        harshRiskAfter: beforeRisk.harshRisk,
        warnings: graphWarnings,
      },
    };
  }

  const finalRepairParams = buildMasterRepairSafetyParams(params, beforeRisk);
  let finalRepairConnected = false;
  if (finalRepairParams.length > 0) {
    const repaired = applySweetFinalRepairModulesToChannels(channels, sampleRate, finalRepairParams);
    channels.splice(0, channels.length, ...repaired.channels);
    actions.push(...repaired.appliedModules.map((module) => `Master repair safety: ${module}`));
    graphWarnings.push(...repaired.warnings);
    finalRepairConnected = repaired.appliedModules.length > 0;
  }

  const masteringSettings = resolveSingleFileMasteringSettings("referenceCatchUp", {
    targetLufs: params.targetLufsApprox,
    truePeakCeilingDb: params.ceilingDbTpEstimate,
    safetyHpfHz: 30 + params.headroomPrepAmount * 40,
    toneCleanupAmount: clampNumber(params.lowEndControlAmount * 0.8, 0, 1),
    harshnessAmount: clampNumber(Math.max(params.deHarshAmount, params.deChirpAmount * 0.65), 0, 0.8),
    clipperDriveDb: clampNumber(0.6 + params.limiterDrive * 2.4, 0, params.safeMode ? 2.4 : 3.8),
    clipperCeilingDb: params.ceilingDbTpEstimate,
    clipperMix: clampNumber(0.28 + params.limiterDrive * 0.36, 0, params.safeMode ? 0.58 : 0.72),
    referenceClarityMode: "softenCuts",
    airCatchUpDb: clampNumber(getHighBandCatchUpDb(targetHints), 0, profile.maxHighBoostDb),
    sheenCatchUpDb: clampNumber(getSheenCatchUpDb(targetHints), 0, Math.max(0.25, profile.maxHighBoostDb * 0.7)),
    sideHighClampAmount: params.stereoGuardAmount,
    referenceSubTrimDb: -Math.min(1.8, Math.max(0, beforeRisk.lowEndRisk * params.lowEndControlAmount * 2.4)),
    referenceDensityGateAmount: params.limiterDrive,
    stages: {
      safetyHpf: true,
      tiltBalance: true,
      toneCleanup: params.lowEndControlAmount > 0.02,
      harshnessGuard: params.deHarshAmount > 0.02 || params.deChirpAmount > 0.02,
      glueCompression: params.limiterDrive > 0.1,
      preLimiterClipper: params.limiterDrive > 0.05,
      targetLoudness: true,
      truePeakLimiter: true,
    },
  });

  const polished = processSingleFileMastering(channels, sampleRate, masteringSettings, { copyInput: false, quality: "mobile-hq" });
  channels.splice(0, channels.length, ...polished.channels);
  actions.push(...polished.actions.map((action) => `Master Polish 2: ${action}`));
  graphWarnings.push(...polished.warnings);

  if (params.equalLoudnessAB) actions.push("Equal-loudness A/B is report-only and is not printed into exported audio.");
  if (params.safeMode && polished.limiterGainReductionDb > 2.8) graphWarnings.push("Safe Mode: limiter gain reduction is above the transparent target.");
  if (targetHints.warnings.length > 0) graphWarnings.push(...targetHints.warnings.slice(0, 3));

  const afterMetrics = analyzeMasterPolish2Channels(channels, sampleRate);
  const afterRisk = computeMasterPolishRisk(channels, sampleRate);
  const report: SweetMasterPolish2Report = {
    beforeLufsApprox: beforeMetrics.lufs,
    afterLufsApprox: afterMetrics.lufs,
    beforeTruePeakEstimate: beforeMetrics.truePeak,
    afterTruePeakEstimate: afterMetrics.truePeak,
    gainReductionPeakDb: round2(Math.max(0, beforeMetrics.truePeak - afterMetrics.truePeak)),
    lowEndRiskBefore: beforeRisk.lowEndRisk,
    lowEndRiskAfter: afterRisk.lowEndRisk,
    harshRiskBefore: beforeRisk.harshRisk,
    harshRiskAfter: afterRisk.harshRisk,
    warnings: dedupeWarnings(graphWarnings),
  };

  return {
    channels,
    report,
    graph: buildSweetUnifiedRenderGraph(report.warnings, {
      masterRepairSafetyPass: finalRepairConnected,
      masterPolish2: true,
      limiterCeilingExportNormalization: true,
    }),
    actions,
    targetHints,
  };
}

function buildMasterRepairSafetyParams(params: SweetMasterPolish2Params, risk: ReturnType<typeof computeMasterPolishRisk>): SweetFinalRepairParams[] {
  const repairs: SweetFinalRepairParams[] = [];
  if (params.lowEndControlAmount > 0.02 || params.stereoGuardAmount > 0.02) {
    repairs.push({
      module: "stereo-phase-guard",
      amount: clampNumber(Math.max(params.stereoGuardAmount, risk.lowEndRisk * 0.4), 0, params.safeMode ? 0.72 : 1),
      focus: "full-mix",
      protect: ["low-end"],
      safeMode: params.safeMode,
    });
  }
  if (params.headroomPrepAmount > 0.12 || risk.lowEndRisk > 0.4) {
    repairs.push({
      module: "plosive-breath-tamer-lite",
      amount: clampNumber(params.headroomPrepAmount * 0.28 + risk.lowEndRisk * 0.18, 0, params.safeMode ? 0.42 : 0.58),
      focus: "full-mix",
      protect: ["vocal-clarity", "air"],
      safeMode: params.safeMode,
    });
  }
  if (params.peakRestoreAmount > 0.05) {
    repairs.push({
      module: "peak-restore-lite",
      amount: clampNumber(params.peakRestoreAmount, 0, params.safeMode ? 0.55 : 0.8),
      focus: "full-mix",
      protect: ["drum-attack"],
      safeMode: params.safeMode,
    });
  }
  return repairs;
}

function analyzeMasterPolish2Channels(channels: SingleFileAudioChannel[], sampleRate: number) {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      const value = Number.isFinite(sample) ? sample : 0;
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      count += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  const lufs = round2(gainToDb(rms) - 1.2);
  const truePeak = round2(gainToDb(peak) + estimateInterSampleMargin(channels, sampleRate));
  return { lufs, truePeak };
}

function computeMasterPolishRisk(channels: SingleFileAudioChannel[], sampleRate: number) {
  const bands = estimateBandEnergyDbFromPcm(channels, sampleRate);
  const sub = averageBandDb(bands, ["20-35", "35-60"]);
  const bass = averageBandDb(bands, ["60-120"]);
  const mud = averageBandDb(bands, ["250-500", "500-900"]);
  const harsh = averageBandDb(bands, ["5000-9000", "9000-12000"]);
  const body = averageBandDb(bands, ["900-1500", "1500-3000", "3000-5000"]);
  return {
    lowEndRisk: round2(clampNumber((sub + bass - body + 8) / 18, 0, 1)),
    harshRisk: round2(clampNumber((harsh - body + 10) / 20, 0, 1)),
    mudRisk: round2(clampNumber((mud - body + 8) / 18, 0, 1)),
  };
}

function getHighBandCatchUpDb(hints: SweetMasterPolishTargetHints) {
  return Math.max(0, averageBounded(hints, ["5000-9000", "9000-12000"]) * 0.35);
}

function getSheenCatchUpDb(hints: SweetMasterPolishTargetHints) {
  return Math.max(0, averageBounded(hints, ["12000-16000", "16000-20000"]) * 0.32);
}

function averageBounded(hints: SweetMasterPolishTargetHints, bandIds: string[]) {
  const values = hints.boundedBandDeltas.filter((band) => bandIds.includes(band.bandId)).map((band) => band.boundedDeltaDb);
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageBandDb(bands: Partial<Record<string, number>>, bandIds: string[]) {
  const values = bandIds.map((id) => bands[id]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return -90;
  const energy = values.reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length;
  return 10 * Math.log10(Math.max(1e-12, energy));
}

function estimateInterSampleMargin(channels: SingleFileAudioChannel[], sampleRate: number) {
  const maxStep = channels.reduce((max, channel) => {
    let local = max;
    const stride = Math.max(1, Math.floor(sampleRate / 12000));
    for (let index = stride; index < channel.length; index += stride) {
      local = Math.max(local, Math.abs((channel[index] ?? 0) - (channel[index - stride] ?? 0)));
    }
    return local;
  }, 0);
  return clampNumber(maxStep * 1.8, 0.1, 0.45);
}

function gainToDb(gain: number) {
  return 20 * Math.log10(Math.max(1e-12, Math.abs(Number.isFinite(gain) ? gain : 0)));
}

function dedupeWarnings(warnings: string[]) {
  return [...new Set(warnings.filter(Boolean))];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
