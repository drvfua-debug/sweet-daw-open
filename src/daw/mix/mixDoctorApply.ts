import { createSpectralRepairRegion, type RepairOperation, type RepairProblemType, type RepairTargetLayer } from "../repair/repairTypes";
import type { Project, StemRole, Track } from "../model/Project";
import type { BuiltinPluginId, PluginInstance } from "../model/Plugin";
import type { ArtifactProblem, AutoMixPlan, AutoMixTrackPlan, MasterFinishMode, MasterFinishReport, MixDoctorMode, PluginInsertPlan, SendPlan, SpectralEditOp, SpectralRepairReport } from "./mixDoctorTypes";
import { buildRepairHeatmap } from "./repair/repairHeatmapBuilder";
import { applyPluginQualityGuards } from "../../audio/plugins/pluginQualityGuards";

export const AI_LAYOUT_WIDTH_PLUGIN_NAME = "AI Layout Width";
export const AI_LAYOUT_DEPTH_PLUGIN_NAME = "AI Layout Depth";
export const AI_SEND_FALLBACK_PLUGIN_NAME = "AI Send Fallback";
export const AI_ARTIFACT_DEESSER_PLUGIN_NAME = "AI Artifact De-Esser";
export const AI_MASTER_WIDTH_PLUGIN_NAME = "AI Master High Width";
export const AI_MASTER_DENSITY_PLUGIN_NAME = "AI Master Density";
export const AI_MASTER_DEESSER_PLUGIN_NAME = "AI Master Guard De-Esser";

const BUILTIN_PLUGIN_IDS = new Set<string>([
  "sweet-parametric-eq",
  "sweet-character",
  "sweet-compressor",
  "sweet-limiter",
  "sweet-filter",
  "sweet-drive",
  "sweet-saturator",
  "sweet-clipper",
  "sweet-low-end-translator",
  "sweet-air-exciter",
  "sweet-tilt-eq",
  "sweet-aimix-glow",
  "sweet-utility",
  "sweet-delay-lite",
  "sweet-reverb-lite",
  "sweet-guitar-fx",
  "sweet-guitar-drive",
  "sweet-guitar-amp",
  "sweet-guitar-cab",
  "sweet-guitar-rig",
  "sweet-vocal-fx",
  "sweet-bass-enhancer",
  "sweet-de-esser",
  "sweet-vocal-duck-eq",
  "sweet-parallel-comp",
  "sweet-gate-lite",
  "sweet-chorus",
  "sweet-phaser",
  "sweet-stereo-widener",
  "sweet-support-widener",
  "sweet-transient-shaper",
  "sweet-rhythm-chopper",
  "sweet-guitarizer",
  "sweet-vocal-formant-color",
  "sweet-ir-space",
  "sweet-vocoder-lite",
  "sweet-pitch-assist",
  "sweet-granular-texture",
  "sweet-multiband-comp",
  "sweet-wavetable-carrier",
]);

type MasterFinishPreset = {
  mode: MasterFinishMode;
  label: string;
  targetLoudness: string;
  ceilingDb: number;
  gainTrimDb: number;
  hpfHz: number;
  lowShelfDb: number;
  mudCutDb: number;
  presenceDb: number;
  airDb: number;
  compressor: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    knee: number;
    makeupGainDb: number;
  };
  width: number;
  density: number;
  deEssAmount: number;
};

const MASTER_FINISH_PRESETS: Record<MasterFinishMode, MasterFinishPreset> = {
  clean: {
    mode: "clean",
    label: "Clean",
    targetLoudness: "-13 to -12 LUFS approx",
    ceilingDb: -1.2,
    gainTrimDb: -0.6,
    hpfHz: 28,
    lowShelfDb: 0.2,
    mudCutDb: -0.5,
    presenceDb: 0.35,
    airDb: 0.35,
    compressor: { threshold: -17, ratio: 1.45, attack: 0.025, release: 0.22, knee: 18, makeupGainDb: 0.2 },
    width: 0,
    density: 0,
    deEssAmount: 0,
  },
  warm: {
    mode: "warm",
    label: "Warm",
    targetLoudness: "-12 to -11 LUFS approx",
    ceilingDb: -1.1,
    gainTrimDb: -0.4,
    hpfHz: 28,
    lowShelfDb: 0.45,
    mudCutDb: -0.7,
    presenceDb: 0.15,
    airDb: 0.2,
    compressor: { threshold: -18, ratio: 1.6, attack: 0.03, release: 0.26, knee: 20, makeupGainDb: 0.35 },
    width: 0,
    density: 0.06,
    deEssAmount: 0,
  },
  loud: {
    mode: "loud",
    label: "Loud",
    targetLoudness: "-10.5 to -9.8 LUFS approx",
    ceilingDb: -1,
    gainTrimDb: 0.2,
    hpfHz: 30,
    lowShelfDb: 0.15,
    mudCutDb: -0.85,
    presenceDb: 0.65,
    airDb: 0.55,
    compressor: { threshold: -21, ratio: 2.15, attack: 0.012, release: 0.16, knee: 14, makeupGainDb: 0.8 },
    width: 0.08,
    density: 0.12,
    deEssAmount: 0,
  },
  vocal_forward: {
    mode: "vocal_forward",
    label: "Vocal Forward",
    targetLoudness: "-11.8 to -10.8 LUFS approx",
    ceilingDb: -1,
    gainTrimDb: -0.2,
    hpfHz: 28,
    lowShelfDb: 0,
    mudCutDb: -0.8,
    presenceDb: 0.75,
    airDb: 0.45,
    compressor: { threshold: -18.5, ratio: 1.8, attack: 0.016, release: 0.18, knee: 16, makeupGainDb: 0.45 },
    width: 0.02,
    density: 0.06,
    deEssAmount: 0.3,
  },
  wide_pop: {
    mode: "wide_pop",
    label: "Wide Pop",
    targetLoudness: "-11.5 to -10.5 LUFS approx",
    ceilingDb: -1,
    gainTrimDb: -0.25,
    hpfHz: 28,
    lowShelfDb: 0.15,
    mudCutDb: -0.65,
    presenceDb: 0.45,
    airDb: 0.55,
    compressor: { threshold: -18, ratio: 1.75, attack: 0.018, release: 0.19, knee: 16, makeupGainDb: 0.4 },
    width: 0.14,
    density: 0.08,
    deEssAmount: 0,
  },
  reference_polish: {
    mode: "reference_polish",
    label: "Reference",
    targetLoudness: "mastering-safe reference guide",
    ceilingDb: -1,
    gainTrimDb: -0.25,
    hpfHz: 28,
    lowShelfDb: 0.05,
    mudCutDb: -0.28,
    presenceDb: 0.22,
    airDb: 0.1,
    compressor: { threshold: -17.5, ratio: 1.45, attack: 0.024, release: 0.22, knee: 18, makeupGainDb: 0.12 },
    width: 0,
    density: 0.04,
    deEssAmount: 0,
  },
  tight_rock: {
    mode: "tight_rock",
    label: "Tight Rock",
    targetLoudness: "-11 to -10 LUFS approx",
    ceilingDb: -1,
    gainTrimDb: -0.1,
    hpfHz: 30,
    lowShelfDb: 0.25,
    mudCutDb: -0.95,
    presenceDb: 0.55,
    airDb: 0.25,
    compressor: { threshold: -20, ratio: 2, attack: 0.01, release: 0.14, knee: 12, makeupGainDb: 0.55 },
    width: 0.04,
    density: 0.08,
    deEssAmount: 0,
  },
  dark_electronic: {
    mode: "dark_electronic",
    label: "Dark Electronic",
    targetLoudness: "-11.5 to -10.5 LUFS approx",
    ceilingDb: -1,
    gainTrimDb: -0.25,
    hpfHz: 26,
    lowShelfDb: 0.35,
    mudCutDb: -0.5,
    presenceDb: -0.2,
    airDb: -0.15,
    compressor: { threshold: -18, ratio: 1.75, attack: 0.018, release: 0.2, knee: 16, makeupGainDb: 0.35 },
    width: 0.04,
    density: 0.04,
    deEssAmount: 0,
  },
  club: {
    mode: "club",
    label: "Club",
    targetLoudness: "-10.8 to -9.8 LUFS approx",
    ceilingDb: -1,
    gainTrimDb: 0,
    hpfHz: 28,
    lowShelfDb: 0.55,
    mudCutDb: -0.9,
    presenceDb: 0.35,
    airDb: 0.35,
    compressor: { threshold: -20.5, ratio: 2.05, attack: 0.011, release: 0.15, knee: 12, makeupGainDb: 0.65 },
    width: 0.08,
    density: 0.1,
    deEssAmount: 0,
  },
  streaming_safe: {
    mode: "streaming_safe",
    label: "Streaming Safe",
    targetLoudness: "-13 to -11.5 LUFS approx",
    ceilingDb: -1.2,
    gainTrimDb: -0.8,
    hpfHz: 28,
    lowShelfDb: 0.1,
    mudCutDb: -0.6,
    presenceDb: 0.25,
    airDb: 0.25,
    compressor: { threshold: -17, ratio: 1.5, attack: 0.024, release: 0.22, knee: 18, makeupGainDb: 0.15 },
    width: 0,
    density: 0,
    deEssAmount: 0,
  },
};

export function applyAutoMixPlanToProject(project: Project, plan: AutoMixPlan): Project {
  const trackPlanMap = new Map(plan.trackPlans.map((trackPlan) => [trackPlan.trackId, trackPlan]));
  const pluginPlanMap = new Map((plan.pluginPlan?.trackPlans ?? []).map((trackPlan) => [trackPlan.trackId, trackPlan.insertPlans]));
  const sendPlanMap = new Map((plan.pluginPlan?.trackPlans ?? []).map((trackPlan) => [trackPlan.trackId, trackPlan.sendPlans]));
  const masterInsertPlans = plan.pluginPlan?.masterInsertPlans ?? [];

  return {
    ...project,
    master: {
      ...project.master,
      insertChain: applyAutoPluginInsertPlans(project.master.insertChain, masterInsertPlans, "master"),
    },
    tracks: project.tracks.map((track) => {
      const trackPlan = trackPlanMap.get(track.id);
      const insertPlans = pluginPlanMap.get(track.id) ?? [];
      const sendPlans = sendPlanMap.get(track.id) ?? [];
      return trackPlan ? applyAutoMixPlanToTrack(track, trackPlan, insertPlans, sendPlans) : track;
    }),
  };
}

export function applyArtifactLightFixToProject(project: Project, problems: ArtifactProblem[]): Project {
  const problemsByTrack = new Map<string, ArtifactProblem[]>();
  for (const problem of problems) {
    if (problem.stemId === "mix" || problem.score < 62) continue;
    const current = problemsByTrack.get(problem.stemId) ?? [];
    current.push(problem);
    problemsByTrack.set(problem.stemId, current);
  }

  return {
    ...project,
    tracks: project.tracks.map((track) => {
      const trackProblems = problemsByTrack.get(track.id);
      return trackProblems && trackProblems.length > 0 ? applyArtifactProblemsToTrack(track, trackProblems) : track;
    }),
  };
}

export function createSpectralRepairReport(problems: ArtifactProblem[], mode: MixDoctorMode = "light"): SpectralRepairReport {
  const createdAt = new Date().toISOString();
  const ops = problems
    .filter((problem) => problem.score >= 58)
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, mode === "strong" ? 10 : mode === "balanced" ? 8 : 6)
    .map((problem, index) => createSpectralOpFromProblem(problem, index, mode, createdAt));
  const heatmap = buildRepairHeatmap({ problems, ops, mode });

  return {
    id: `spectral-repair-${Date.now().toString(36)}`,
    createdAt,
    mode,
    ops,
    heatmapCells: heatmap.cells,
    beforeSummary: heatmap.beforeSummary,
    afterPreviewSummary: heatmap.afterPreviewSummary,
    previewNotes: [
      ...heatmap.notes,
      "Selected repairs become fixed non-destructive Repair Regions and are used by offline export.",
      "Difference preview is visual until rendered preview is generated.",
    ],
    removedOnlyAvailable: false,
  };
}

export type ApplySpectralRepairOptions = {
  applyCompatibilityGlobalFix?: boolean;
};

export function applySpectralRepairOpsToProject(project: Project, ops: SpectralEditOp[], options: ApplySpectralRepairOptions = {}): Project {
  const problems = ops.map((op) => spectralOpToArtifactProblem(op));
  const compatibilityProject = options.applyCompatibilityGlobalFix ? applyArtifactLightFixToProject(project, problems) : project;
  const repairRegions = ops
    .filter((op) => op.operation !== "protect")
    .flatMap((op) => spectralOpToRepairRegions(project, op));
  if (repairRegions.length === 0) return compatibilityProject;

  const existingIds = new Set(compatibilityProject.repairRegions.map((region) => region.id));
  const nextRegions = [
    ...compatibilityProject.repairRegions,
    ...repairRegions.filter((region) => !existingIds.has(region.id)),
  ]
    .sort((a, b) => a.startSec - b.startSec || a.lowHz - b.lowHz)
    .slice(0, 256);

  return {
    ...compatibilityProject,
    repairRegions: nextRegions,
    repairViewState: {
      ...compatibilityProject.repairViewState,
      selectedRegionId: repairRegions[0]?.id ?? compatibilityProject.repairViewState.selectedRegionId,
      viewMode: "artifact_heatmap",
      previewMode: "processed",
    },
  };
}

export function applyMasterFinishToProject(project: Project, mode: MasterFinishMode): { project: Project; report: MasterFinishReport } {
  const preset = MASTER_FINISH_PRESETS[mode] ?? MASTER_FINISH_PRESETS.streaming_safe;
  const beforeGain = project.master.gainDb;
  const nextMaster = {
    ...project.master,
    gainDb: round1(clamp(project.master.gainDb + preset.gainTrimDb, -12, 3)),
    eq: {
      ...project.master.eq,
      enabled: true,
      analyzerEnabled: true,
      bands: project.master.eq.bands.map((band) => ({ ...band })),
    },
    compressor: {
      ...project.master.compressor,
      enabled: true,
      ...preset.compressor,
    },
    limiterEnabled: preset.mode !== "reference_polish",
    exportNormalizePeak: preset.mode !== "reference_polish",
    insertChain: applyMasterFinishPlugins(project.master.insertChain, preset),
  };

  nextMaster.eq = setHighpass(nextMaster.eq, preset.hpfHz);
  nextMaster.eq = setMasterEqBand(nextMaster.eq, "lowshelf", 75, preset.lowShelfDb, 0.7);
  nextMaster.eq = setMasterEqBand(nextMaster.eq, "peaking", 230, preset.mudCutDb, 1.05);
  nextMaster.eq = setMasterEqBand(nextMaster.eq, "peaking", 3600, preset.presenceDb, 1.05);
  nextMaster.eq = setHighShelf(nextMaster.eq, 11000, preset.airDb, 0.72);

  const warnings: string[] = [];
  if (preset.mode === "loud" || preset.mode === "club") {
    warnings.push("Dynamics may become flatter. Use A/B and reduce master gain if the chorus feels squeezed.");
  }
  if (preset.mode === "reference_polish") {
    warnings.push("Reference Polish is advisory and mastering-safe; it avoids loudness hype, broad air boost, and master widening.");
  }
  if (preset.airDb > 0.5) {
    warnings.push("Air boost capped below aggressive AI-song brightness.");
  }
  if (beforeGain > 1.5) {
    warnings.push("Existing master gain was already high, so gain push was kept conservative.");
  }

  return {
    project: {
      ...project,
      master: nextMaster,
    },
    report: {
      mode: preset.mode,
      label: preset.label,
      targetLoudness: preset.targetLoudness,
      ceilingDb: preset.ceilingDb,
      changes: [
        `HPF ${preset.hpfHz}Hz and low-mid cleanup around 230Hz`,
        preset.density > 0 ? `Density stage before limiter (${round2(preset.density)})` : "No extra density saturation",
        `Master compressor ${preset.compressor.ratio}:1 with safe makeup gain`,
        preset.mode === "reference_polish" ? "Limiter and peak normalization left off for mastering-safe export" : `Limiter enabled with export peak normalization`,
        preset.width > 0 ? `High-side width added gently (${round2(preset.width)})` : "Stereo width kept conservative",
      ],
      warnings,
      damageChecks: createMasterDamageChecks(preset, beforeGain),
    },
  };
}

function createSpectralOpFromProblem(problem: ArtifactProblem, index: number, mode: MixDoctorMode, createdAt: string): SpectralEditOp {
  const frequency = problemFrequencyRange(problem);
  const strengthBase = mode === "strong" ? 0.72 : mode === "balanced" ? 0.58 : 0.42;
  const strength = round2(clamp(strengthBase + (problem.score - 70) / 100, 0.25, mode === "strong" ? 0.85 : 0.65));
  const operation = problemToSpectralOperation(problem.type);
  const defaultStart = typeof problem.startTime === "number" ? problem.startTime : 0;
  const defaultEnd = typeof problem.endTime === "number" ? problem.endTime : Math.max(defaultStart + 2, 8);

  return {
    id: `spectral-op-${Date.now().toString(36)}-${index}`,
    stemId: problem.stemId,
    role: problem.role,
    startTime: round2(Math.max(0, defaultStart)),
    endTime: round2(Math.max(defaultStart + 0.1, defaultEnd)),
    lowFreq: frequency.low,
    highFreq: frequency.high,
    operation,
    gainDb: operation === "protect" ? undefined : -problemReductionDb(problem.score),
    strength,
    softness: operation === "declick" ? 0.25 : 0.58,
    protectMain: problem.role === "vocal" || problem.role === "bass" || problem.role === "drums",
    createdBy: mode === "strong" ? "auto-strong" : mode === "balanced" ? "auto-balanced" : "auto-light",
    confidence: problem.confidence,
    reason: problem.reason || problem.suggestedFix,
    createdAt,
  };
}

function spectralOpToArtifactProblem(op: SpectralEditOp): ArtifactProblem {
  return {
    id: `problem-from-${op.id}`,
    stemId: op.stemId,
    role: op.role,
    type: spectralOperationToProblemType(op.operation),
    startTime: op.startTime,
    endTime: op.endTime,
    lowFreq: op.lowFreq,
    highFreq: op.highFreq,
    score: Math.round(clamp(58 + op.strength * 42, 58, 92)),
    confidence: op.confidence ?? 0.7,
    reason: op.reason,
    suggestedFix: `Apply ${op.operation} from ${op.lowFreq}-${op.highFreq}Hz`,
  };
}

function problemToSpectralOperation(type: ArtifactProblem["type"]): SpectralEditOp["operation"] {
  if (type === "sibilance") return "deess";
  if (type === "harshness" || type === "metallic_high" || type === "vocal_plastic") return "deharsh";
  if (type === "rumble") return "derumble";
  if (type === "mud" || type === "low_end_blur" || type === "masking") return "reduce";
  if (type === "reverb_smear" || type === "flatness") return "smooth";
  return "reduce";
}

function spectralOperationToProblemType(operation: SpectralEditOp["operation"]): ArtifactProblem["type"] {
  if (operation === "deess") return "sibilance";
  if (operation === "deharsh") return "vocal_plastic";
  if (operation === "derumble") return "rumble";
  if (operation === "smooth") return "metallic_high";
  return "mud";
}

function spectralOpToRepairRegions(project: Project, op: SpectralEditOp) {
  const trackId = op.stemId === "mix" ? undefined : op.stemId;
  const clips = trackId
    ? project.clips.filter((clip) => clip.trackId === trackId && clip.timelineStartSec < op.endTime && clip.timelineStartSec + clip.durationSec > op.startTime)
    : [];
  const targets = clips.length > 0 ? clips : [undefined];
  const problemType = repairProblemTypeForSpectralOperation(op.operation);
  const operation = repairOperationForSpectralOperation(op.operation, op.lowFreq, op.highFreq);
  const amountDb = op.operation === "protect" ? 0 : clamp(op.gainDb ?? -1.2, -6, 0);
  const targetLayer = repairTargetLayerForRole(op.role);

  return targets.map((clip, index) =>
    createSpectralRepairRegion({
      id: `repair-from-${op.id}-${index}`,
      fileId: clip?.fileId,
      clipId: clip?.id,
      trackId,
      coordinateSpace: "timeline",
      targetLayer,
      transformHint: "stft",
      problemType,
      startSec: Math.max(0, op.startTime),
      endSec: Math.max(op.startTime + 0.02, op.endTime),
      lowHz: op.lowFreq,
      highHz: op.highFreq,
      operation,
      amountDb,
      strength: clamp(op.strength, 0, 1),
      confidence: clamp(op.confidence ?? 0.65, 0, 1),
      featherTimeMs: Math.round(clamp(op.softness, 0, 1) * 160),
      featherFreqHz: Math.round(Math.max(80, (op.highFreq - op.lowFreq) * clamp(op.softness, 0.2, 1) * 0.12)),
      enabled: true,
      fixed: true,
      protectVocal: op.role === "vocal" || op.protectMain,
      protectDrumAttack: op.role === "drums" || op.protectMain,
      analysisSource: {
        score: Math.round(clamp((op.confidence ?? 0.65) * 100, 0, 100)),
        createdAt: op.createdAt,
      },
      createdAt: op.createdAt,
      updatedAt: new Date().toISOString(),
    }),
  );
}

function repairOperationForSpectralOperation(operation: SpectralEditOp["operation"], lowFreq: number, highFreq: number): RepairOperation {
  if (operation === "deess") return "deess_lite";
  if (operation === "deharsh") return "deharsh_lite";
  if (operation === "derumble") return highFreq <= 120 ? "lowend_tighten_lite" : "attenuate";
  if (operation === "declick") return "declick_lite";
  if (operation === "smooth") return highFreq >= 9000 ? "dechirp_lite" : "deharsh_lite";
  if (operation === "protect") return "protect";
  return lowFreq <= 80 ? "lowend_tighten_lite" : "attenuate";
}

function repairProblemTypeForSpectralOperation(operation: SpectralEditOp["operation"]): RepairProblemType {
  if (operation === "deess") return "sibilance";
  if (operation === "deharsh") return "vocal_plastic";
  if (operation === "derumble") return "rumble";
  if (operation === "declick") return "click";
  if (operation === "smooth") return "metallic_high";
  if (operation === "protect") return "phase_risk";
  return "mud";
}

function repairTargetLayerForRole(role: StemRole | "mix"): RepairTargetLayer {
  if (role === "vocal") return "vocal";
  if (role === "drums") return "drums";
  if (role === "bass") return "bass";
  if (role === "music" || role === "guitar" || role === "synth" || role === "keys" || role === "loop") return "instrument";
  if (role === "mix" || role === "reference") return "mix";
  return "other";
}

function problemFrequencyRange(problem: ArtifactProblem) {
  if (typeof problem.lowFreq === "number" && typeof problem.highFreq === "number") {
    return { low: Math.round(problem.lowFreq), high: Math.round(problem.highFreq) };
  }

  if (problem.type === "rumble") return { low: 20, high: 45 };
  if (problem.type === "mud" || problem.type === "low_end_blur") return { low: 150, high: 350 };
  if (problem.type === "harshness" || problem.type === "masking") return { low: 2500, high: 6000 };
  if (problem.type === "sibilance") return { low: 5000, high: 9000 };
  if (problem.type === "metallic_high" || problem.type === "vocal_plastic") return { low: 6000, high: 12000 };
  return { low: 80, high: 12000 };
}

function applyAutoMixPlanToTrack(track: Track, plan: AutoMixTrackPlan, insertPlans: PluginInsertPlan[] = [], sendPlans: SendPlan[] = []): Track {
  let insertChain = applyWidthPlugin(track.insertChain, plan);
  insertChain = applyDepthPlugin(insertChain, plan);
  insertChain = applyAutoPluginInsertPlans(insertChain, insertPlans);
  const consumedInputTrimDb = getConsumedInputTrimDb(insertPlans);
  return {
    ...track,
    gainDb: round1(clamp(track.gainDb + plan.volumeTrimDb - consumedInputTrimDb, -24, 12)),
    pan: round2(clamp(plan.pan, -0.75, 0.75)),
    insertChain,
    sends: applyAutoSendPlans(track.sends, sendPlans),
  };
}

function getConsumedInputTrimDb(insertPlans: PluginInsertPlan[]) {
  return round1(insertPlans.reduce((sum, plan) => {
    if (!plan.enabled || plan.pluginId !== "sweet-utility" || plan.params.inputTrimConsumesFader !== true) return sum;
    const gainDb = typeof plan.params.gainDb === "number" && Number.isFinite(plan.params.gainDb) ? plan.params.gainDb : 0;
    return sum + gainDb;
  }, 0));
}

function applyAutoSendPlans(trackSends: Track["sends"], sendPlans: SendPlan[]): Track["sends"] {
  let nextSends = [...trackSends];
  for (const plan of sendPlans) {
    const existingIndex = nextSends.findIndex((send) => send.targetBusId === plan.targetBusId && send.id.startsWith("ai-send-"));
    const nextSend = {
      id: `ai-send-${plan.targetBusId}`,
      targetBusId: plan.targetBusId,
      gainDb: round1(clamp(plan.gainDb, -30, -9)),
      enabled: plan.enabled,
    };
    if (existingIndex >= 0) {
      nextSends = nextSends.map((send, index) => index === existingIndex ? nextSend : send);
    } else if (plan.enabled) {
      nextSends = [...nextSends, nextSend];
    }
  }
  return nextSends;
}

function applyAutoPluginInsertPlans(chain: PluginInstance[], plans: PluginInsertPlan[], target: "track" | "master" = "track"): PluginInstance[] {
  let nextChain = [...chain];
  for (const plan of plans) {
    if (plan.target !== target) continue;
    if (!isBuiltinPluginId(plan.pluginId)) continue;
    if (plan.routePreference === "send" && !canUseSendFallback(plan)) continue;

    const existingIndex = nextChain.findIndex((plugin) => isSameAutoInsertPlugin(plugin, plan));
    const instance = createPluginFromInsertPlan(plan, target);
    if (existingIndex >= 0) {
      nextChain = nextChain.map((plugin, index) =>
        index === existingIndex
          ? touchPlugin({
              ...plugin,
              pluginId: instance.pluginId,
              enabled: instance.enabled,
              params: {
                ...plugin.params,
                ...instance.params,
              },
            })
          : plugin,
      );
    } else if (plan.enabled) {
      nextChain = [...nextChain, instance];
    }
  }
  return nextChain;
}

function createPluginFromInsertPlan(plan: PluginInsertPlan, target: "track" | "master" = "track"): PluginInstance {
  const now = new Date().toISOString();
  const sendFallback = plan.routePreference === "send";
  const instance: PluginInstance = {
    id: `plugin-ai-plan-${plan.pluginId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: plan.pluginId as BuiltinPluginId,
    name: sendFallback ? AI_SEND_FALLBACK_PLUGIN_NAME : plan.name,
    enabled: plan.enabled,
    target,
    params: {
      ...(sendFallback ? makeSendFallbackParams(plan) : plan.params),
      autoInserted: true,
      autoInsertReason: plan.reason,
      autoPlanPluginId: plan.pluginId,
      autoPlanRoutePreference: plan.routePreference,
      autoInsertConfidence: plan.confidence,
      autoInsertStrength: plan.strength,
      autoInsertBypassable: plan.bypassable,
      routeFallback: sendFallback ? "send-to-safe-insert" : "insert",
    },
    createdAt: now,
    updatedAt: now,
  };
  return applyPluginQualityGuards(instance).instance;
}

function isSameAutoInsertPlugin(plugin: PluginInstance, plan: PluginInsertPlan) {
  if (plugin.params.autoPlanPluginId === plan.pluginId && plugin.params.planUndoLabel === plan.undoLabel) return true;
  if (plan.routePreference === "send" && plugin.name === AI_SEND_FALLBACK_PLUGIN_NAME && plugin.params.autoPlanPluginId === plan.pluginId) return true;
  return plugin.name === plan.name || plugin.params.planUndoLabel === plan.undoLabel;
}

function canUseSendFallback(plan: PluginInsertPlan) {
  if (!plan.enabled || plan.strength > 0.75) return false;
  return plan.pluginId === "sweet-reverb-lite" || plan.pluginId === "sweet-delay-lite";
}

function makeSendFallbackParams(plan: PluginInsertPlan) {
  const source = plan.params;
  if (plan.pluginId === "sweet-reverb-lite") {
    return {
      ...source,
      room: round2(clamp(readNumber(source.room, 0.18), 0.08, 0.32)),
      damp: round2(clamp(readNumber(source.damp, 0.76), 0.68, 0.9)),
      mix: round2(clamp(readNumber(source.mix, 0.06), 0.025, 0.08)),
      planReason: `${plan.reason} Applied as a low-mix insert fallback until shared send buses are available.`,
    };
  }

  return {
    ...source,
    feedback: round2(clamp(readNumber(source.feedback, 0.12), 0.02, 0.18)),
    mix: round2(clamp(readNumber(source.mix, 0.05), 0.02, 0.07)),
    planReason: `${plan.reason} Applied as a low-mix insert fallback until shared send buses are available.`,
  };
}

function isBuiltinPluginId(pluginId: string): pluginId is BuiltinPluginId {
  return BUILTIN_PLUGIN_IDS.has(pluginId);
}

function applyArtifactProblemsToTrack(track: Track, problems: ArtifactProblem[]): Track {
  let nextTrack: Track = {
    ...track,
    eq: {
      ...track.eq,
      enabled: true,
      bands: track.eq.bands.map((band) => ({ ...band })),
    },
    insertChain: [...track.insertChain],
  };

  for (const problem of problems.slice().sort((a, b) => b.score - a.score).slice(0, 4)) {
    const amount = problemReductionDb(problem.score);
    if (problem.type === "rumble") {
      nextTrack = {
        ...nextTrack,
        eq: setHighpass(nextTrack.eq, nextTrack.role === "bass" || nextTrack.role === "drums" ? 28 : 35),
      };
    } else if (problem.type === "mud" || problem.type === "low_end_blur") {
      const protectedFoundation = nextTrack.role === "vocal" || nextTrack.role === "bass" || nextTrack.role === "drums";
      const cutDb = protectedFoundation ? -Math.min(amount, 0.8) : -amount;
      nextTrack = {
        ...nextTrack,
        eq: setPeaking(nextTrack.eq, 240, cutDb, protectedFoundation ? 0.85 : 1.05),
      };
    } else if (problem.type === "harshness" || problem.type === "masking") {
      const cutDb = nextTrack.role === "vocal" ? -Math.min(amount, 0.8) : -Math.min(amount, 1.8);
      nextTrack = {
        ...nextTrack,
        eq: setPeaking(nextTrack.eq, 3600, cutDb, 1.15),
      };
    } else if (problem.type === "sibilance") {
      nextTrack = {
        ...nextTrack,
        eq: setPeaking(nextTrack.eq, 7200, -Math.min(amount, 2.1), 2.4),
        insertChain: applyArtifactDeEsser(nextTrack.insertChain, amount),
      };
    } else if (problem.type === "metallic_high" || problem.type === "vocal_plastic") {
      nextTrack = {
        ...nextTrack,
        eq: setHighShelf(nextTrack.eq, 10500, -Math.min(amount, 1.8), 0.75),
      };
    } else if (problem.type === "peak_risk") {
      nextTrack = {
        ...nextTrack,
        gainDb: round1(clamp(nextTrack.gainDb - Math.min(amount, 1.2), -24, 12)),
      };
    }
  }

  return nextTrack;
}

function setHighpass(eq: Track["eq"], frequency: number): Track["eq"] {
  return {
    ...eq,
    bands: eq.bands.map((band) =>
      band.type === "highpass"
        ? {
            ...band,
            enabled: true,
            frequency,
          }
        : band,
    ),
  };
}

function setHighShelf(eq: Track["eq"], frequency: number, gainDb: number, q: number): Track["eq"] {
  return {
    ...eq,
    bands: eq.bands.map((band) =>
      band.type === "highshelf"
        ? {
            ...band,
            enabled: true,
            frequency,
            gainDb: round1(clamp(gainDb, -2.5, 0.8)),
            q,
          }
        : band,
    ),
  };
}

function setPeaking(eq: Track["eq"], frequency: number, gainDb: number, q: number): Track["eq"] {
  const bands = eq.bands.map((band) => ({ ...band }));
  const band =
    bands.find((candidate) => candidate.type === "peaking" && Math.abs(candidate.frequency - frequency) < 260) ??
    bands.find((candidate) => candidate.type === "peaking" && Math.abs(candidate.gainDb) < 0.05);

  if (band) {
    band.enabled = true;
    band.frequency = frequency;
    band.gainDb = round1(clamp(gainDb, -2.5, 1.2));
    band.q = q;
  }

  return {
    ...eq,
    bands,
  };
}

function setMasterEqBand(eq: Track["eq"], type: "lowshelf" | "peaking" | "highshelf", frequency: number, gainDb: number, q: number): Track["eq"] {
  const bands = eq.bands.map((band) => ({ ...band }));
  const band =
    bands.find((candidate) => candidate.type === type && Math.abs(candidate.frequency - frequency) < (type === "peaking" ? 500 : 3500)) ??
    bands.find((candidate) => candidate.type === type);

  if (band) {
    band.enabled = true;
    band.frequency = frequency;
    band.gainDb = round1(clamp(gainDb, -2.5, 1.2));
    band.q = q;
  }

  return {
    ...eq,
    bands,
  };
}

function applyArtifactDeEsser(chain: PluginInstance[], amountDb: number) {
  const amount = round2(clamp(amountDb / 2.5, 0.25, 0.75));
  const existingIndex = chain.findIndex(
    (plugin) => plugin.pluginId === "sweet-de-esser" && plugin.name === AI_ARTIFACT_DEESSER_PLUGIN_NAME,
  );
  const params = {
    frequency: 7200,
    amount,
    sharpness: 0.58,
    mix: 0.65,
  };

  if (existingIndex >= 0) {
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: true,
            params: {
              ...plugin.params,
              ...params,
            },
          })
        : plugin,
    );
  }

  return [...chain, createArtifactDeEsserPlugin(params)];
}

function applyMasterFinishPlugins(chain: PluginInstance[], preset: MasterFinishPreset) {
  let nextChain = chain;
  nextChain = applyMasterDensityPlugin(nextChain, preset.density);
  nextChain = applyMasterWidthPlugin(nextChain, preset.width);
  nextChain = applyMasterDeEsser(nextChain, preset.deEssAmount, preset.mode === "vocal_forward");
  return nextChain;
}

function applyMasterDensityPlugin(chain: PluginInstance[], density: number) {
  const existingIndex = chain.findIndex(
    (plugin) => plugin.pluginId === "sweet-drive" && plugin.name === AI_MASTER_DENSITY_PLUGIN_NAME,
  );
  const safeDensity = round2(clamp(density, 0, 0.24));
  if (safeDensity <= 0.02) {
    if (existingIndex < 0) return chain;
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: false,
            params: {
              ...plugin.params,
              drive: 0,
              mix: 0,
            },
          })
        : plugin,
    );
  }

  const params = {
    drive: round2(clamp(0.08 + safeDensity * 0.72, 0.08, 0.24)),
    tone: round2(clamp(0.42 + safeDensity * 0.45, 0.42, 0.56)),
    mix: round2(clamp(0.08 + safeDensity * 0.58, 0.08, 0.2)),
  };

  if (existingIndex >= 0) {
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: true,
            params: {
              ...plugin.params,
              ...params,
            },
          })
        : plugin,
    );
  }

  const now = new Date().toISOString();
  const plugin: PluginInstance = {
    id: `plugin-ai-master-density-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: "sweet-drive",
    name: AI_MASTER_DENSITY_PLUGIN_NAME,
    enabled: true,
    target: "master",
    params,
    createdAt: now,
    updatedAt: now,
  };
  return [...chain, plugin];
}

function applyMasterWidthPlugin(chain: PluginInstance[], width: number) {
  const existingIndex = chain.findIndex(
    (plugin) => plugin.pluginId === "sweet-stereo-widener" && plugin.name === AI_MASTER_WIDTH_PLUGIN_NAME,
  );
  const safeWidth = round2(clamp(width, 0, 0.28));
  const params = {
    width: safeWidth,
    delayMs: Math.round(5 + safeWidth * 16),
    tone: 0.52,
    mix: round2(clamp(0.06 + safeWidth * 0.3, 0.06, 0.14)),
  };

  if (existingIndex >= 0) {
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: safeWidth > 0.04,
            params: {
              ...plugin.params,
              ...params,
            },
          })
        : plugin,
    );
  }

  if (safeWidth <= 0.04) return chain;

  const now = new Date().toISOString();
  const plugin: PluginInstance = {
    id: `plugin-ai-master-width-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: "sweet-stereo-widener",
    name: AI_MASTER_WIDTH_PLUGIN_NAME,
    enabled: true,
    target: "master",
    params,
    createdAt: now,
    updatedAt: now,
  };
  return [...chain, plugin];
}

function applyMasterDeEsser(chain: PluginInstance[], amount: number, shouldEnable: boolean) {
  const existingIndex = chain.findIndex(
    (plugin) => plugin.pluginId === "sweet-de-esser" && plugin.name === AI_MASTER_DEESSER_PLUGIN_NAME,
  );
  if (!shouldEnable || amount <= 0) {
    if (existingIndex < 0) return chain;
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: false,
            params: {
              ...plugin.params,
              amount: 0,
              mix: 0,
            },
          })
        : plugin,
    );
  }
  const params = {
    frequency: 7900,
    amount: round2(clamp(amount, 0.12, 0.42)),
    sharpness: 0.5,
    mix: 0.42,
  };

  if (existingIndex >= 0) {
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: true,
            params: {
              ...plugin.params,
              ...params,
            },
          })
        : plugin,
    );
  }

  const now = new Date().toISOString();
  const plugin: PluginInstance = {
    id: `plugin-ai-master-deess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: "sweet-de-esser",
    name: AI_MASTER_DEESSER_PLUGIN_NAME,
    enabled: true,
    target: "master",
    params,
    createdAt: now,
    updatedAt: now,
  };
  return [...chain, plugin];
}

function applyWidthPlugin(chain: PluginInstance[], plan: AutoMixTrackPlan) {
  const width = clamp(plan.width, 0, 0.55);
  const existingIndex = chain.findIndex(
    (plugin) => plugin.pluginId === "sweet-stereo-widener" && plugin.name === AI_LAYOUT_WIDTH_PLUGIN_NAME,
  );

  if (width <= 0.06) {
    if (existingIndex < 0) return chain;
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: false,
            params: {
              ...plugin.params,
              width: 0,
              mix: 0,
            },
          })
        : plugin,
    );
  }

  const params = {
    width: round2(width),
    delayMs: Math.round(5 + width * 9),
    tone: 0.56,
    mix: round2(clamp(0.12 + width * 0.22, 0.12, 0.24)),
  };

  if (existingIndex >= 0) {
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: true,
            params: {
              ...plugin.params,
              ...params,
            },
          })
        : plugin,
    );
  }

  const widthPlugin = createAutoWidthPlugin();
  return [
    ...chain,
    {
      ...widthPlugin,
      name: AI_LAYOUT_WIDTH_PLUGIN_NAME,
      params: {
        ...widthPlugin.params,
        ...params,
      },
    },
  ];
}

function createAutoWidthPlugin(): PluginInstance {
  const now = new Date().toISOString();
  return {
    id: `plugin-ai-width-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: "sweet-stereo-widener",
    name: AI_LAYOUT_WIDTH_PLUGIN_NAME,
    enabled: true,
    target: "track",
    params: {
      width: 0.45,
      delayMs: 9,
      tone: 0.56,
      mix: 0.22,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function applyDepthPlugin(chain: PluginInstance[], plan: AutoMixTrackPlan) {
  const foundation = plan.role === "vocal" || plan.role === "bass" || plan.role === "drums" || plan.role === "reference";
  const depth = foundation ? 0 : clamp(plan.depth, 0, 0.75);
  const existingIndex = chain.findIndex(
    (plugin) => plugin.pluginId === "sweet-reverb-lite" && plugin.name === AI_LAYOUT_DEPTH_PLUGIN_NAME,
  );

  if (depth <= 0.08) {
    if (existingIndex < 0) return chain;
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: false,
            params: {
              ...plugin.params,
              mix: 0,
            },
          })
        : plugin,
    );
  }

  const decorative = plan.priority === "decoration";
  const params = {
    room: round2(clamp(0.16 + depth * (decorative ? 0.42 : 0.28), 0.16, decorative ? 0.58 : 0.38)),
    damp: round2(clamp(0.68 + depth * 0.18, 0.68, 0.88)),
    mix: round2(clamp(0.035 + depth * (decorative ? 0.14 : 0.09), 0.035, decorative ? 0.14 : 0.095)),
  };

  if (existingIndex >= 0) {
    return chain.map((plugin, index) =>
      index === existingIndex
        ? touchPlugin({
            ...plugin,
            enabled: true,
            params: {
              ...plugin.params,
              ...params,
            },
          })
        : plugin,
    );
  }

  return [...chain, createAutoDepthPlugin(params)];
}

function createAutoDepthPlugin(params: Record<string, unknown>): PluginInstance {
  const now = new Date().toISOString();
  return {
    id: `plugin-ai-depth-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: "sweet-reverb-lite",
    name: AI_LAYOUT_DEPTH_PLUGIN_NAME,
    enabled: true,
    target: "track",
    params,
    createdAt: now,
    updatedAt: now,
  };
}

function createArtifactDeEsserPlugin(params: Record<string, unknown>): PluginInstance {
  const now = new Date().toISOString();
  return {
    id: `plugin-ai-deess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: "sweet-de-esser",
    name: AI_ARTIFACT_DEESSER_PLUGIN_NAME,
    enabled: true,
    target: "track",
    params,
    createdAt: now,
    updatedAt: now,
  };
}

function problemReductionDb(score: number) {
  return round1(clamp(0.7 + (score - 62) / 38 * 1.8, 0.7, 2.5));
}

function createMasterDamageChecks(preset: MasterFinishPreset, beforeGain: number) {
  const checks = [
    preset.mode === "reference_polish"
      ? `Ceiling target ${preset.ceilingDb} dBTP with limiter left available but not forced`
      : `Ceiling target ${preset.ceilingDb} dBTP with limiter enabled`,
    "Sub safety: HPF avoids heavy 20-35Hz boost",
    preset.width > 0
      ? "Vocal/kick/bass center is protected because only master high-side width is added"
      : "Stereo safety: no default master widening is applied",
  ];

  if (preset.mode === "reference_polish") {
    checks.push("Reference guard: reference tone is advisory and not copied as a loudness target");
    checks.push("Mastering-safe guard: limiter, normalize, and broad width stay off unless the user enables them");
  } else if (preset.mode === "loud" || preset.mode === "club") {
    checks.push("Watch crest factor: strong finish can reduce punch on dense AI mixes");
  } else {
    checks.push("Dynamics guard: compressor ratio and makeup gain are kept conservative");
  }

  if (beforeGain > 1.5) {
    checks.push("Limiter push reduced because master gain was already elevated");
  }

  return checks;
}

function touchPlugin(plugin: PluginInstance): PluginInstance {
  return {
    ...plugin,
    updatedAt: new Date().toISOString(),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
