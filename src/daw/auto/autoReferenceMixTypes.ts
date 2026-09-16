import type { Project } from "@/daw/model/Project";
import type { AimixSpatialReport } from "@/daw/aimixSpatial/aimixSpatialTypes";
import type { LowEndKingReport, MixDoctorReport, PeakCulpritReport } from "@/daw/mix/mixDoctorTypes";
import type { ReferenceAlignmentResult } from "./referenceAlignmentGuard";

export type AutoReferenceMixMode =
  | "off"
  | "reference-only"
  | "reference-then-spatial-auto";

export type AutoReferenceMixStatus =
  | "idle"
  | "waiting-for-files"
  | "analyzing-reference"
  | "aligning-reference"
  | "applying-aimix-reference"
  | "trying-spatial-auto"
  | "accepted-aimix-reference"
  | "accepted-sweet-no-reference"
  | "accepted-spatial-auto"
  | "accepted-sweet-no-reference-spatial"
  | "reverted-spatial-auto"
  | "reverted-sweet-no-reference-spatial"
  | "warning"
  | "error";

export type AutoReferenceMixSettings = {
  enabled: boolean;
  mode: AutoReferenceMixMode;
  debounceMs: number;
  oneTapPrimary: boolean;
  autoRunOnReferenceReady: boolean;
  showAdvancedByDefault: boolean;
  requireReference: boolean;
  requireAtLeastOneStem: boolean;
  autoFixAfterProposal: boolean;
  autoTrySpatial: boolean;
  acceptSpatialOnlyIfImproved: boolean;
  allowStemAirLayer: boolean;
  allowReferenceAirGlue: boolean;
  allowReferenceBackbone: boolean;
  maxAllowedLagMs: number;
  maxAllowedDriftMs: number;
  maxSpatialLufsDrop: number;
  minSideMidImprovementDb: number;
};

export type VocalClarityGateStatus = "pass" | "warn" | "fail";
export type StemAirLayerStatus = "enabled" | "reduced" | "bypassed";

export type VocalClarityGateItem = {
  id: "sub_20_60" | "mid_500_2000" | "presence_2000_5000" | "air_5000_10000" | "ultra_air_10000_20000" | "side_mid";
  label: string;
  status: VocalClarityGateStatus;
  deltaDb: number;
  detail: string;
};

export type VocalClarityGateReport = {
  passed: boolean;
  stemAirLayer: StemAirLayerStatus;
  items: VocalClarityGateItem[];
  summary: string;
  warnings: string[];
};

export type AutoReferenceMixRuntime = {
  enabled: boolean;
  pending: boolean;
  status: AutoReferenceMixStatus;
  lastImportAt?: number;
  lastRunAt?: number;
  message?: string | null;
  vocalClarityGate?: VocalClarityGateReport | null;
};

export type AutoReferenceMixMetrics = {
  peakDb: number;
  integratedLufs: number;
  truePeakDb: number;
  rmsDb: number;
  crestDb: number;
  lowMidDb: number;
  presenceDb: number;
  airDb: number;
  widthDb: number;
  sub2060Db: number;
  low120250Db: number;
  body250500Db: number;
  mid5002000Db: number;
  presence20005000Db: number;
  air500010000Db: number;
  ultraAir1000020000Db: number;
};

export type AutoReferenceMixResult = {
  ok: boolean;
  status: AutoReferenceMixStatus;
  before: Project;
  after: Project;
  aimixReference: Project;
  mixDoctorReport: MixDoctorReport | null;
  lowEndKingReport?: LowEndKingReport | null;
  peakCulpritReport?: PeakCulpritReport | null;
  alignment: ReferenceAlignmentResult;
  spatialReport: AimixSpatialReport | null;
  beforeMetrics: AutoReferenceMixMetrics;
  aimixMetrics: AutoReferenceMixMetrics;
  afterMetrics: AutoReferenceMixMetrics;
  decisions: string[];
  message: string;
  vocalClarityGate?: VocalClarityGateReport | null;
};

export const DEFAULT_AUTO_REFERENCE_MIX_SETTINGS: AutoReferenceMixSettings = {
  enabled: true,
  mode: "reference-then-spatial-auto",
  debounceMs: 900,
  oneTapPrimary: true,
  autoRunOnReferenceReady: false,
  showAdvancedByDefault: false,
  requireReference: false,
  requireAtLeastOneStem: true,
  autoFixAfterProposal: true,
  autoTrySpatial: true,
  acceptSpatialOnlyIfImproved: true,
  allowStemAirLayer: true,
  allowReferenceAirGlue: false,
  allowReferenceBackbone: false,
  maxAllowedLagMs: 50,
  maxAllowedDriftMs: 10,
  maxSpatialLufsDrop: 0.8,
  minSideMidImprovementDb: 0.1,
};

export const DEFAULT_AUTO_REFERENCE_MIX_RUNTIME: AutoReferenceMixRuntime = {
  enabled: true,
  pending: false,
  status: "idle",
  message: null,
  vocalClarityGate: null,
};
