import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { ReferenceDelta, ReferenceProfile, StemFeatureReport } from "@/daw/mix/mixDoctorTypes";

export type AimixSpatialMode = "clean" | "spatial" | "clean-spatial" | "full";
export type AimixSpatialPanMode = "off" | "track" | "clip" | "track-clip" | "reference-plus";
export type SpatialPanScene =
  | "pro-balanced"
  | "wide-hook"
  | "vocal-focus"
  | "cinematic-wide"
  | "manual";

export type AimixSpatialApplyContext = {
  peaksByFileId?: Record<string, PeakSummary>;
  referenceProfile?: ReferenceProfile | null;
  referenceDelta?: ReferenceDelta | null;
  stemFeatureReports?: StemFeatureReport[];
};

export type AimixSpatialOptions = {
  mode: AimixSpatialMode;
  clarity: number;
  smooth: number;
  space: number;
  depth: number;
  motion: number;
  centerProtect: number;
  gainMatch: boolean;
  monoSafe: boolean;
  editableLayers: boolean;
  removePreviousAimixLayers: boolean;
  panMode: AimixSpatialPanMode;
  panScene: SpatialPanScene;
  panAmount: number;
  trackPanAmount: number;
  clipPanAmount: number;
  referencePanFollow: boolean;
  protectLeadVocalPan: boolean;
  protectLowEndPan: boolean;
  resetPreviousSpatialPan: boolean;
};

export type AimixSpatialReport = {
  ok: boolean;
  mode: AimixSpatialMode;
  cleanedTracks: number;
  generatedTracks: number;
  generatedClips: number;
  removedTracks: number;
  removedClips: number;
  pannedTracks: number;
  pannedClips: number;
  restoredPannedTracks: number;
  restoredPannedClips: number;
  warnings: string[];
  actions: string[];
};

export const DEFAULT_AIMIX_SPATIAL_OPTIONS: AimixSpatialOptions = {
  mode: "spatial",
  clarity: 35,
  smooth: 35,
  space: 50,
  depth: 30,
  motion: 0,
  centerProtect: 80,
  gainMatch: true,
  monoSafe: true,
  editableLayers: false,
  removePreviousAimixLayers: true,
  panMode: "track",
  panScene: "pro-balanced",
  panAmount: 70,
  trackPanAmount: 60,
  clipPanAmount: 0,
  referencePanFollow: true,
  protectLeadVocalPan: true,
  protectLowEndPan: true,
  resetPreviousSpatialPan: true,
};
