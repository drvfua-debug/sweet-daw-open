import type { Project, StemRole } from "@/daw/model/Project";

export type SweetTrackRole =
  | "lead_vocal"
  | "backing_vocal"
  | "vocal"
  | "kick"
  | "snare"
  | "drums"
  | "bass"
  | "guitar"
  | "piano"
  | "synth"
  | "pad"
  | "strings"
  | "main_instrument"
  | "fx"
  | "reverb_return"
  | "other"
  | "unknown";

export type SweetMaskingBandId =
  | "sub"
  | "bass_weight"
  | "bass_punch"
  | "low_mud"
  | "low_mid_body"
  | "mid_body"
  | "presence_low"
  | "presence"
  | "harsh"
  | "air";

export type SweetUnmaskPreviewMode = "original" | "unmask" | "removed" | "delta";

export interface MixPriorityRule {
  role: SweetTrackRole;
  priority: number;
  protectPresence: boolean;
  protectTransient: boolean;
  protectLowEnd: boolean;
  defaultTargetBands: SweetMaskingBandId[];
}

export interface SweetMaskingBand {
  id: SweetMaskingBandId;
  label: string;
  minHz: number;
  maxHz: number;
  defaultMaxReductionDb: number;
  hardMaxReductionDb: number;
  risk: "low" | "medium" | "high";
}

export interface SweetTrackSpectralProfile {
  trackId: string;
  role: SweetTrackRole;
  durationSec: number;
  sampleRate: number;
  windowSec: number;
  hopSec: number;
  bands: Record<SweetMaskingBandId, {
    rms: number[];
    peak: number[];
    activity: number[];
    transientActivity?: number[];
    centroidHint?: number[];
  }>;
  global: {
    rms: number;
    peak: number;
    crest: number;
    activeRatio: number;
    stereoCorrelation?: number;
    sideLowRisk?: number;
  };
}

export interface SweetMaskingConflict {
  id: string;
  winnerTrackId: string;
  winnerRole: SweetTrackRole;
  targetTrackId: string;
  targetRole: SweetTrackRole;
  bandId: SweetMaskingBandId;
  startSec: number;
  endSec: number;
  activeRatio: number;
  overlapScore: number;
  priorityScore: number;
  recommendedReductionDb: number;
  hardLimitDb: number;
  attackMs: number;
  releaseMs: number;
  reason: string;
  risk: "low" | "medium" | "high";
  warnings: string[];
}

export interface SweetUnmaskOperation {
  id: string;
  kind: "aimix_unmask";
  enabled: boolean;
  fixed: boolean;
  source: "proposal" | "manual" | "reference_delta" | "preset";
  winnerTrackId: string;
  targetTrackId: string;
  bandId: SweetMaskingBandId;
  startSec: number;
  endSec: number;
  reductionDb: number;
  maxReductionDb: number;
  attackMs: number;
  releaseMs: number;
  threshold?: number;
  knee?: number;
  makeupDb?: number;
  protectTransient?: boolean;
  protectVocalConsonant?: boolean;
  protectBassFundamental?: boolean;
  description: string;
  warnings: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SweetReferenceDeltaSummary {
  available: boolean;
  source: "mix_doctor" | "reference_wav" | "direct_wav" | "none";
  tonalTiltDb?: number;
  bassWeightDeltaDb?: number;
  vocalPresenceDeltaDb?: number;
  harshnessDeltaDb?: number;
  airDeltaDb?: number;
  sideLowRiskDelta?: number;
  confidence: number;
  warnings: string[];
}

export interface SweetAimixUnmaskState {
  enabled: boolean;
  analysisVersion: number;
  lastAnalyzedAt?: number;
  profilesByTrackId: Record<string, SweetTrackSpectralProfile>;
  conflicts: SweetMaskingConflict[];
  operations: SweetUnmaskOperation[];
  previewMode: SweetUnmaskPreviewMode;
  equalLoudness: boolean;
  referenceDelta?: SweetReferenceDeltaSummary;
  warnings: string[];
}

export type AimixUnmaskMode = "safe" | "balanced" | "strong";

export function createDefaultAimixUnmaskState(): SweetAimixUnmaskState {
  return {
    enabled: false,
    analysisVersion: 1,
    profilesByTrackId: {},
    conflicts: [],
    operations: [],
    previewMode: "original",
    equalLoudness: false,
    warnings: [],
  };
}

export function sanitizeAimixUnmaskState(value: unknown): SweetAimixUnmaskState {
  const fallback = createDefaultAimixUnmaskState();
  if (!isRecord(value)) return fallback;
  const operations = Array.isArray(value.operations) ? value.operations.map(sanitizeOperation).filter((op): op is SweetUnmaskOperation => !!op).slice(0, 64) : [];
  const conflicts = Array.isArray(value.conflicts) ? value.conflicts.map(sanitizeConflict).filter((conflict): conflict is SweetMaskingConflict => !!conflict).slice(0, 64) : [];
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    analysisVersion: numberOr(value.analysisVersion, 1),
    lastAnalyzedAt: typeof value.lastAnalyzedAt === "number" ? value.lastAnalyzedAt : undefined,
    profilesByTrackId: {},
    conflicts,
    operations,
    previewMode: isPreviewMode(value.previewMode) ? value.previewMode : fallback.previewMode,
    equalLoudness: typeof value.equalLoudness === "boolean" ? value.equalLoudness : fallback.equalLoudness,
    referenceDelta: sanitizeReferenceDelta(value.referenceDelta),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 20) : [],
  };
}

export function stemRoleToSweetRole(role: StemRole): SweetTrackRole {
  if (role === "vocal") return "lead_vocal";
  if (role === "backingVocal") return "backing_vocal";
  if (role === "drums") return "drums";
  if (role === "bass") return "bass";
  if (role === "guitar") return "guitar";
  if (role === "keys") return "piano";
  if (role === "synth") return "synth";
  if (role === "fx") return "fx";
  if (role === "music") return "main_instrument";
  if (role === "reference") return "unknown";
  return "other";
}

export function summarizeReferenceDelta(input: unknown): SweetReferenceDeltaSummary | undefined {
  if (!isRecord(input)) return undefined;
  return {
    available: true,
    source: "mix_doctor",
    tonalTiltDb: numberOrUndefined(input.tonalTiltDb),
    bassWeightDeltaDb: numberOrUndefined(input.lowEndDeltaDb ?? input.bassWeightDeltaDb),
    vocalPresenceDeltaDb: numberOrUndefined(input.presenceDeltaDb ?? input.vocalPresenceDeltaDb),
    harshnessDeltaDb: numberOrUndefined(input.harshnessDeltaDb),
    airDeltaDb: numberOrUndefined(input.airDeltaDb),
    sideLowRiskDelta: numberOrUndefined(input.stereoWidthDelta ?? input.sideLowRiskDelta),
    confidence: 0.65,
    warnings: [],
  };
}

function sanitizeOperation(value: unknown): SweetUnmaskOperation | null {
  if (!isRecord(value) || value.kind !== "aimix_unmask") return null;
  const now = Date.now();
  const bandId = isBandId(value.bandId) ? value.bandId : "presence";
  return {
    id: typeof value.id === "string" ? value.id : `unmask_${now}`,
    kind: "aimix_unmask",
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    fixed: typeof value.fixed === "boolean" ? value.fixed : false,
    source: value.source === "manual" || value.source === "reference_delta" || value.source === "preset" ? value.source : "proposal",
    winnerTrackId: typeof value.winnerTrackId === "string" ? value.winnerTrackId : "",
    targetTrackId: typeof value.targetTrackId === "string" ? value.targetTrackId : "",
    bandId,
    startSec: clamp(numberOr(value.startSec, 0), 0, 60 * 60),
    endSec: clamp(numberOr(value.endSec, 0), 0, 60 * 60),
    reductionDb: clamp(numberOr(value.reductionDb, -1), -4, 0),
    maxReductionDb: clamp(numberOr(value.maxReductionDb, 2), 0, 4),
    attackMs: clamp(numberOr(value.attackMs, 18), 2, 80),
    releaseMs: clamp(numberOr(value.releaseMs, 140), 40, 400),
    threshold: numberOrUndefined(value.threshold),
    knee: numberOrUndefined(value.knee),
    makeupDb: numberOrUndefined(value.makeupDb),
    protectTransient: typeof value.protectTransient === "boolean" ? value.protectTransient : undefined,
    protectVocalConsonant: typeof value.protectVocalConsonant === "boolean" ? value.protectVocalConsonant : undefined,
    protectBassFundamental: typeof value.protectBassFundamental === "boolean" ? value.protectBassFundamental : undefined,
    description: typeof value.description === "string" ? value.description : "AIMIX Unmask operation",
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 8) : [],
    createdAt: numberOr(value.createdAt, now),
    updatedAt: numberOr(value.updatedAt, now),
  };
}

function sanitizeConflict(value: unknown): SweetMaskingConflict | null {
  if (!isRecord(value)) return null;
  const bandId = isBandId(value.bandId) ? value.bandId : "presence";
  return {
    id: typeof value.id === "string" ? value.id : `conflict_${Date.now()}`,
    winnerTrackId: typeof value.winnerTrackId === "string" ? value.winnerTrackId : "",
    winnerRole: isSweetRole(value.winnerRole) ? value.winnerRole : "unknown",
    targetTrackId: typeof value.targetTrackId === "string" ? value.targetTrackId : "",
    targetRole: isSweetRole(value.targetRole) ? value.targetRole : "unknown",
    bandId,
    startSec: clamp(numberOr(value.startSec, 0), 0, 60 * 60),
    endSec: clamp(numberOr(value.endSec, 0), 0, 60 * 60),
    activeRatio: clamp(numberOr(value.activeRatio, 0), 0, 1),
    overlapScore: clamp(numberOr(value.overlapScore, 0), 0, 1),
    priorityScore: clamp(numberOr(value.priorityScore, 0), 0, 1),
    recommendedReductionDb: clamp(numberOr(value.recommendedReductionDb, -1), -4, 0),
    hardLimitDb: clamp(numberOr(value.hardLimitDb, -2), -4, 0),
    attackMs: clamp(numberOr(value.attackMs, 18), 2, 80),
    releaseMs: clamp(numberOr(value.releaseMs, 140), 40, 400),
    reason: typeof value.reason === "string" ? value.reason : "Cross-track masking candidate",
    risk: value.risk === "high" || value.risk === "medium" ? value.risk : "low",
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 8) : [],
  };
}

function sanitizeReferenceDelta(value: unknown): SweetReferenceDeltaSummary | undefined {
  if (!isRecord(value)) return undefined;
  return {
    available: Boolean(value.available),
    source: value.source === "mix_doctor" || value.source === "reference_wav" || value.source === "direct_wav" ? value.source : "none",
    tonalTiltDb: numberOrUndefined(value.tonalTiltDb),
    bassWeightDeltaDb: numberOrUndefined(value.bassWeightDeltaDb),
    vocalPresenceDeltaDb: numberOrUndefined(value.vocalPresenceDeltaDb),
    harshnessDeltaDb: numberOrUndefined(value.harshnessDeltaDb),
    airDeltaDb: numberOrUndefined(value.airDeltaDb),
    sideLowRiskDelta: numberOrUndefined(value.sideLowRiskDelta),
    confidence: clamp(numberOr(value.confidence, 0), 0, 1),
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === "string").slice(0, 8) : [],
  };
}

function isPreviewMode(value: unknown): value is SweetUnmaskPreviewMode {
  return value === "original" || value === "unmask" || value === "removed" || value === "delta";
}

function isBandId(value: unknown): value is SweetMaskingBandId {
  return value === "sub" || value === "bass_weight" || value === "bass_punch" || value === "low_mud" || value === "low_mid_body" || value === "mid_body" || value === "presence_low" || value === "presence" || value === "harsh" || value === "air";
}

function isSweetRole(value: unknown): value is SweetTrackRole {
  return typeof value === "string" && ["lead_vocal", "backing_vocal", "vocal", "kick", "snare", "drums", "bass", "guitar", "piano", "synth", "pad", "strings", "main_instrument", "fx", "reverb_return", "other", "unknown"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function withAimixUnmaskState(project: Project, state: SweetAimixUnmaskState): Project {
  return { ...project, aimixUnmaskState: sanitizeAimixUnmaskState(state) };
}