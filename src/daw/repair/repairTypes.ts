export type SpectralTransformKind =
  | "waveform"
  | "stft"
  | "artifact_heatmap"
  | "mid_side"
  | "future_cqt"
  | "future_cwt"
  | "future_reassigned"
  | "future_hpss";

export type RepairProblemType =
  | "sibilance"
  | "metallic_high"
  | "hiss"
  | "mud"
  | "rumble"
  | "click"
  | "clipping"
  | "reverb_smear"
  | "phase_risk"
  | "vocal_plastic"
  | "low_end_blur";

export type RepairAnalysisBand =
  | "clipping"
  | "click"
  | "crackle"
  | "sibilance"
  | "harshness"
  | "chirp"
  | "low_sub"
  | "low_mud"
  | "low_side"
  | "phase_risk";

export type RepairOperation =
  | "attenuate"
  | "smooth"
  | "declick"
  | "deess"
  | "declick_lite"
  | "decrackle_lite"
  | "deess_lite"
  | "deharsh_lite"
  | "dechirp_lite"
  | "lowend_tighten_lite"
  | "protect";

export type RepairTargetLayer =
  | "mix"
  | "vocal"
  | "drums"
  | "bass"
  | "instrument"
  | "other"
  | "residual"
  | "mid"
  | "side";

export type RepairCoordinateSpace = "timeline" | "source";

export type SpectralRepairRegion = {
  id: string;
  fileId?: string;
  clipId?: string;
  trackId?: string;
  coordinateSpace: RepairCoordinateSpace;
  targetLayer: RepairTargetLayer;
  transformHint: SpectralTransformKind;
  problemType: RepairProblemType;
  startSec: number;
  endSec: number;
  lowHz: number;
  highHz: number;
  operation: RepairOperation;
  amountDb: number;
  strength: number;
  confidence: number;
  featherTimeMs: number;
  featherFreqHz: number;
  enabled: boolean;
  fixed: boolean;
  protectVocal?: boolean;
  protectDrumAttack?: boolean;
  analysisSource?: {
    band?: RepairAnalysisBand;
    score?: number;
    createdAt?: string;
    fftSize?: number;
  };
  createdAt: string;
  updatedAt: string;
};

export type RepairViewMode = "waveform" | "stft" | "artifact_heatmap";

export type RepairPreviewMode = "original" | "processed" | "removed_only" | "delta";

export type RepairViewState = {
  selectedRegionId?: string;
  viewMode: RepairViewMode;
  minDb: number;
  maxDb: number;
  showOverlay: boolean;
  previewMode: RepairPreviewMode;
};

export const REPAIR_PROBLEM_LABELS: Record<RepairProblemType, string> = {
  sibilance: "Sibilance",
  metallic_high: "Metallic High",
  hiss: "Hiss",
  mud: "Mud",
  rumble: "Rumble",
  click: "Click",
  clipping: "Clipping",
  reverb_smear: "Reverb Smear",
  phase_risk: "Phase Risk",
  vocal_plastic: "Vocal Plastic",
  low_end_blur: "Low-End Blur",
};

export const REPAIR_OPERATION_LABELS: Record<RepairOperation, string> = {
  attenuate: "Attenuate",
  smooth: "Smooth (legacy)",
  declick: "De-click (legacy)",
  deess: "De-ess (legacy)",
  declick_lite: "De-click Lite",
  decrackle_lite: "De-crackle Lite",
  deess_lite: "De-ess Lite",
  deharsh_lite: "De-harsh Lite",
  dechirp_lite: "De-chirp Lite",
  lowend_tighten_lite: "Low-end Tighten Lite",
  protect: "Protect",
};

export function createDefaultRepairViewState(): RepairViewState {
  return {
    viewMode: "waveform",
    minDb: -72,
    maxDb: -12,
    showOverlay: true,
    previewMode: "original",
  };
}

export function createRepairRegionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `repair_${crypto.randomUUID()}`;
  }
  return `repair_${Math.random().toString(36).slice(2, 10)}`;
}

export function createSpectralRepairRegion(
  patch: Partial<SpectralRepairRegion> & Pick<SpectralRepairRegion, "startSec" | "endSec" | "lowHz" | "highHz" | "problemType">,
): SpectralRepairRegion {
  const now = new Date().toISOString();
  const problemType = isRepairProblemType(patch.problemType) ? patch.problemType : "mud";
  const startSec = clampNumber(patch.startSec, 0, 60 * 60);
  const lowHz = clampNumber(patch.lowHz, 20, 20000);
  return {
    id: patch.id ?? createRepairRegionId(),
    fileId: patch.fileId,
    clipId: patch.clipId,
    trackId: patch.trackId,
    coordinateSpace: isRepairCoordinateSpace(patch.coordinateSpace) ? patch.coordinateSpace : "timeline",
    targetLayer: isRepairTargetLayer(patch.targetLayer) ? patch.targetLayer : "mix",
    transformHint: isSpectralTransformKind(patch.transformHint) ? patch.transformHint : "stft",
    problemType,
    startSec,
    endSec: Math.max(startSec + 0.02, clampNumber(patch.endSec, 0, 60 * 60)),
    lowHz,
    highHz: Math.max(lowHz + 10, clampNumber(patch.highHz, 20, 20000)),
    operation: isRepairOperation(patch.operation) ? patch.operation : defaultOperationForProblem(problemType),
    amountDb: clampNumber(patch.amountDb ?? defaultAmountForProblem(problemType), -24, 6),
    strength: clampNumber(patch.strength ?? 0.45, 0, 1),
    confidence: clampNumber(patch.confidence ?? 0.65, 0, 1),
    featherTimeMs: clampNumber(patch.featherTimeMs ?? 30, 0, 2000),
    featherFreqHz: clampNumber(patch.featherFreqHz ?? 120, 0, 6000),
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : true,
    fixed: Boolean(patch.fixed),
    protectVocal: typeof patch.protectVocal === "boolean" ? patch.protectVocal : undefined,
    protectDrumAttack: typeof patch.protectDrumAttack === "boolean" ? patch.protectDrumAttack : undefined,
    analysisSource: sanitizeAnalysisSource(patch.analysisSource),
    createdAt: typeof patch.createdAt === "string" ? patch.createdAt : now,
    updatedAt: typeof patch.updatedAt === "string" ? patch.updatedAt : now,
  };
}

export function sanitizeRepairRegions(value: unknown): SpectralRepairRegion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((region) =>
      createSpectralRepairRegion({
        id: stringOr(region.id, createRepairRegionId()),
        fileId: typeof region.fileId === "string" ? region.fileId : undefined,
        clipId: typeof region.clipId === "string" ? region.clipId : undefined,
        trackId: typeof region.trackId === "string" ? region.trackId : undefined,
        coordinateSpace: isRepairCoordinateSpace(region.coordinateSpace) ? region.coordinateSpace : "timeline",
        targetLayer: isRepairTargetLayer(region.targetLayer) ? region.targetLayer : "mix",
        transformHint: isSpectralTransformKind(region.transformHint) ? region.transformHint : "stft",
        problemType: isRepairProblemType(region.problemType) ? region.problemType : "mud",
        startSec: numberOr(region.startSec, 0),
        endSec: numberOr(region.endSec, 0.25),
        lowHz: numberOr(region.lowHz, 180),
        highHz: numberOr(region.highHz, 600),
        operation: isRepairOperation(region.operation) ? region.operation : "attenuate",
        amountDb: numberOr(region.amountDb, -1.5),
        strength: numberOr(region.strength, 0.45),
        confidence: numberOr(region.confidence, 0.5),
        featherTimeMs: numberOr(region.featherTimeMs, 30),
        featherFreqHz: numberOr(region.featherFreqHz, 120),
        enabled: typeof region.enabled === "boolean" ? region.enabled : true,
        fixed: Boolean(region.fixed),
        protectVocal: typeof region.protectVocal === "boolean" ? region.protectVocal : undefined,
        protectDrumAttack: typeof region.protectDrumAttack === "boolean" ? region.protectDrumAttack : undefined,
        analysisSource: sanitizeAnalysisSource(region.analysisSource),
        createdAt: stringOr(region.createdAt, new Date().toISOString()),
        updatedAt: stringOr(region.updatedAt, new Date().toISOString()),
      }),
    )
    .sort((a, b) => a.startSec - b.startSec || a.lowHz - b.lowHz)
    .slice(0, 256);
}

export function sanitizeRepairViewState(value: unknown): RepairViewState {
  const fallback = createDefaultRepairViewState();
  if (!isRecord(value)) return fallback;
  return {
    selectedRegionId: typeof value.selectedRegionId === "string" ? value.selectedRegionId : undefined,
    viewMode: isRepairViewMode(value.viewMode) ? value.viewMode : fallback.viewMode,
    minDb: clampNumber(numberOr(value.minDb, fallback.minDb), -120, 0),
    maxDb: clampNumber(numberOr(value.maxDb, fallback.maxDb), -96, 12),
    showOverlay: typeof value.showOverlay === "boolean" ? value.showOverlay : fallback.showOverlay,
    previewMode: isRepairPreviewMode(value.previewMode) ? value.previewMode : fallback.previewMode,
  };
}

export function defaultOperationForProblem(problemType: RepairProblemType): RepairOperation {
  if (problemType === "click" || problemType === "clipping") return "declick_lite";
  if (problemType === "sibilance") return "deess_lite";
  if (problemType === "phase_risk") return "protect";
  if (problemType === "rumble" || problemType === "low_end_blur") return "lowend_tighten_lite";
  if (problemType === "metallic_high" || problemType === "reverb_smear" || problemType === "vocal_plastic") return "dechirp_lite";
  return "attenuate";
}

function defaultAmountForProblem(problemType: RepairProblemType) {
  if (problemType === "click" || problemType === "clipping") return -6;
  if (problemType === "sibilance") return -3;
  if (problemType === "metallic_high") return -2.5;
  if (problemType === "rumble" || problemType === "mud" || problemType === "low_end_blur") return -1.8;
  return -1.2;
}

function sanitizeAnalysisSource(value: unknown): SpectralRepairRegion["analysisSource"] {
  if (!isRecord(value)) return undefined;
  return {
    band: isRepairAnalysisBand(value.band) ? value.band : undefined,
    score: typeof value.score === "number" ? clampNumber(value.score, 0, 1) : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    fftSize: typeof value.fftSize === "number" ? Math.round(clampNumber(value.fftSize, 0, 8192)) : undefined,
  };
}

function isRepairAnalysisBand(value: unknown): value is RepairAnalysisBand {
  return (
    value === "clipping" ||
    value === "click" ||
    value === "crackle" ||
    value === "sibilance" ||
    value === "harshness" ||
    value === "chirp" ||
    value === "low_sub" ||
    value === "low_mud" ||
    value === "low_side" ||
    value === "phase_risk"
  );
}

function isRepairViewMode(value: unknown): value is RepairViewMode {
  return value === "waveform" || value === "stft" || value === "artifact_heatmap";
}

function isRepairCoordinateSpace(value: unknown): value is RepairCoordinateSpace {
  return value === "timeline" || value === "source";
}

function isRepairPreviewMode(value: unknown): value is RepairPreviewMode {
  return value === "original" || value === "processed" || value === "removed_only" || value === "delta";
}

function isSpectralTransformKind(value: unknown): value is SpectralTransformKind {
  return (
    value === "waveform" ||
    value === "stft" ||
    value === "artifact_heatmap" ||
    value === "mid_side" ||
    value === "future_cqt" ||
    value === "future_cwt" ||
    value === "future_reassigned" ||
    value === "future_hpss"
  );
}

function isRepairProblemType(value: unknown): value is RepairProblemType {
  return (
    value === "sibilance" ||
    value === "metallic_high" ||
    value === "hiss" ||
    value === "mud" ||
    value === "rumble" ||
    value === "click" ||
    value === "clipping" ||
    value === "reverb_smear" ||
    value === "phase_risk" ||
    value === "vocal_plastic" ||
    value === "low_end_blur"
  );
}

function isRepairOperation(value: unknown): value is RepairOperation {
  return (
    value === "attenuate" ||
    value === "smooth" ||
    value === "declick" ||
    value === "deess" ||
    value === "declick_lite" ||
    value === "decrackle_lite" ||
    value === "deess_lite" ||
    value === "deharsh_lite" ||
    value === "dechirp_lite" ||
    value === "lowend_tighten_lite" ||
    value === "protect"
  );
}

function isRepairTargetLayer(value: unknown): value is RepairTargetLayer {
  return (
    value === "mix" ||
    value === "vocal" ||
    value === "drums" ||
    value === "bass" ||
    value === "instrument" ||
    value === "other" ||
    value === "residual" ||
    value === "mid" ||
    value === "side"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
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
