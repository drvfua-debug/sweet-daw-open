export interface SweetSpectralSelection {
  id: string;
  startSec: number;
  endSec: number;
  minHz?: number;
  maxHz?: number;
  shape: "rectangle" | "brush" | "time-range" | "band-range";
  featherTimeSec: number;
  featherHz: number;
}

export type SweetSpectralBrushOperationKind =
  | "attenuate"
  | "band-attenuate"
  | "click-smooth"
  | "tone-reduce"
  | "chirp-soften"
  | "harsh-soften"
  | "sustain-shorten"
  | "low-end-tighten";

export interface SweetSpectralBrushOperation {
  id: string;
  kind: SweetSpectralBrushOperationKind;
  selection: SweetSpectralSelection;
  amount: number;
  fixed: boolean;
  enabled: boolean;
  createdAt: number;
  label?: string;
  warnings: string[];
}

export type SweetSpectralPreviewMode = "original" | "processed" | "removed_only" | "delta";

export type SweetSpectralProblemScoreKey =
  | "clipRisk"
  | "clickRisk"
  | "chirpRisk"
  | "harshRisk"
  | "mudRisk"
  | "sideLowRisk"
  | "reverbSmearRisk"
  | "maskingRisk";

export type SweetSpectralProblemScoreMap = Record<SweetSpectralProblemScoreKey, number>;

export interface SweetSpectralProblemHeatmapFrame {
  startSec: number;
  endSec: number;
  scores: SweetSpectralProblemScoreMap;
  peakHz?: number;
}

export interface SweetSpectralEditorBrushDefaults {
  kind: SweetSpectralBrushOperationKind;
  amount: number;
  label: string;
  minHz: number;
  maxHz: number;
  featherTimeSec: number;
  featherHz: number;
}

export interface SweetSpectralBrushProcessResult {
  channels: Float32Array[];
  removed: Float32Array[];
  appliedOperationIds: string[];
  warnings: string[];
}