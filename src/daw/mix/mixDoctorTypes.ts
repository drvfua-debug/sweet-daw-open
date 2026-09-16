import type { StemRole } from "@/daw/model/Project";

export type MixDoctorMode = "light" | "balanced" | "strong";

export type MixDoctorTarget =
  | "clean"
  | "warm"
  | "loud"
  | "vocal_forward"
  | "wide_pop"
  | "reference_polish"
  | "tight_rock"
  | "dark_electronic"
  | "club"
  | "streaming_safe";

export type MasterFinishMode =
  | "clean"
  | "warm"
  | "loud"
  | "vocal_forward"
  | "wide_pop"
  | "reference_polish"
  | "tight_rock"
  | "dark_electronic"
  | "club"
  | "streaming_safe";

export type ArtifactProblemType =
  | "metallic_high"
  | "sibilance"
  | "harshness"
  | "mud"
  | "rumble"
  | "reverb_smear"
  | "flatness"
  | "vocal_plastic"
  | "low_end_blur"
  | "masking"
  | "peak_risk";

export type ArtifactProblem = {
  id: string;
  stemId: string | "mix";
  role: StemRole | "mix";
  type: ArtifactProblemType;
  startTime?: number;
  endTime?: number;
  lowFreq?: number;
  highFreq?: number;
  score: number;
  confidence: number;
  reason: string;
  suggestedFix: string;
};

export type StemMixScore = {
  stemId: string;
  trackId: string;
  trackName: string;
  role: StemRole;
  rms: number;
  peak: number;
  crestFactor: number;
  loudnessApprox: number;
  mudScore: number;
  harshnessScore: number;
  sibilanceScore: number;
  metallicScore: number;
  rumbleScore: number;
  stereoWidthScore: number;
  maskingRisk: number;
  aiArtifactScore: number;
  problems: ArtifactProblem[];
};

export type MixDoctorBandId =
  | "20-35"
  | "35-60"
  | "60-120"
  | "120-250"
  | "250-500"
  | "500-900"
  | "900-1500"
  | "1500-3000"
  | "3000-5000"
  | "5000-9000"
  | "9000-12000"
  | "12000-16000"
  | "16000-20000";

export type BandEnergyMap = Record<MixDoctorBandId, number>;

export type BandSideMidMap = Partial<{
  low_20_120: number;
  lowMid_120_500: number;
  mid_500_2000: number;
  presence_2000_5000: number;
  air_5000_10000: number;
  gloss_9000_14000: number;
  ultraAir_10000_20000: number;
  sheen_14000_20000: number;
}>;

export type StemFeatureReport = {
  stemId: string;
  trackId: string;
  trackName: string;
  role: StemRole;
  rmsDb: number;
  peakDb: number;
  truePeakApproxDb: number;
  crestFactorDb: number;
  integratedLufsApprox: number;
  lrCorrelation: number;
  sideMidRatioDb: number;
  stereoWidthScore: number;
  spectralCentroidHz: number;
  spectralFlatness: number;
  bandEnergyDb: BandEnergyMap;
  bandSideMidDb?: BandSideMidMap;
  notes: string[];
};

export type ReferenceProfile = StemFeatureReport & {
  sourceRole: StemRole;
  targetRanges: Partial<Record<MixDoctorBandId, [number, number]>>;
  loudnessTargetLabel: string;
};

export type LoudnessMatchReport = {
  mode: "light" | "balanced" | "strong";
  currentLufsApprox: number;
  referenceLufsApprox: number;
  appliedGainDb: number;
  matchAmount: number;
  beforeMatchDiffDb: number;
  afterMatchDiffDb: number;
  notes: string[];
};

export type ReferenceDelta = {
  loudnessDeltaDb: number;
  peakDeltaDb: number;
  crestFactorDeltaDb: number;
  lowEndDeltaDb: number;
  bodyDeltaDb: number;
  presenceDeltaDb: number;
  airDeltaDb: number;
  stereoWidthDelta: number;
  correlationDelta: number;
  advisory: string[];
};

export type ReferenceClarityGapReport = {
  status: "pass" | "warn" | "fail";
  bodyGapDb: number;
  presenceGapDb: number;
  clarityGapDb: number;
  airGapDb: number;
  falseAirRisk: boolean;
  muffleRisk: number;
  recommendations: string[];
};

export type ReferenceRepairSeverity = "info" | "warning" | "critical";

export type ReferenceRepairStatus =
  | "ok"
  | "low_rms_high_peak"
  | "too_dark"
  | "too_bright"
  | "side_missing"
  | "artifact_risk";

export type ReferenceRepairMetricSet = {
  label: string;
  rmsDb: number;
  peakDb: number;
  truePeakApproxDb: number;
  crestFactorDb: number;
  integratedLufsApprox: number;
  lrCorrelation: number;
  sideMidRatioDb: number;
  bandEnergyDb: BandEnergyMap;
};

export type ReferenceRepairBandDelta = {
  bandId: MixDoctorBandId;
  referenceDb: number;
  stemSumDb: number;
  diffDb: number;
  cappedEqDb: number;
  dynamicOnly: boolean;
};

export type ReferenceRepairResidualSummary = {
  estimated: boolean;
  gainMatchDb: number;
  residualRmsDb: number;
  residualPeakDb: number;
  residualToDirectDb: number;
  residualSideMidRatioDb: number;
  topDifferenceBands: ReferenceRepairBandDelta[];
};

export type ReferenceRepairDiagnosis = {
  direct: ReferenceRepairMetricSet;
  stemSum: ReferenceRepairMetricSet;
  rmsDiffDb: number;
  peakDiffDb: number;
  crestDiffDb: number;
  sideMidDiffDb: number;
  correlationDiff: number;
  lowEnergyDiffDb: number;
  lowMidEnergyDiffDb: number;
  presenceEnergyDiffDb: number;
  airEnergyDiffDb: number;
  status: ReferenceRepairStatus;
  severity: ReferenceRepairSeverity;
  messages: string[];
  safetyMessages: string[];
  recommendedChain: string[];
  bandDeltas: ReferenceRepairBandDelta[];
  residual: ReferenceRepairResidualSummary;
};

export type PerceptualScoreReport = {
  overall: number;
  clarity: number;
  body: number;
  vocalFocus: number;
  lowEndTightness: number;
  stereoImage: number;
  harshness: number;
  mud: number;
  reverbCleanliness: number;
  aiArtifact: number;
  peakSafety: number;
  notes: string[];
};

export type PhilosophyScore = {
  overall: number;
  lowTranslation: number;
  vocalClarity: number;
  stagePlacement: number;
  reverbCleanliness: number;
  loudnessByContrast: number;
  harshnessSafety: number;
  notes: string[];
};

export type RenderedMixMetricsReport = {
  source: "offline-render";
  peakDb: number;
  rmsDb: number;
  crestFactorDb: number;
  lowDb: number;
  lowMidDb: number;
  presenceDb: number;
  highDb: number;
  airDb: number;
  sideMidRatioDb: number;
  correlation: number;
};

export type VirtualComponent =
  | "kick_like"
  | "snare_like"
  | "tom_like"
  | "cymbal_like"
  | "room_wash_like"
  | "vocal_bleed_like"
  | "tonal_bleed_like"
  | "noise_artifact_like"
  | "residual";

export type StemContaminationReport = {
  stemId: string;
  trackId: string;
  trackName: string;
  role: StemRole;
  vocalBleedScore: number;
  cymbalMetallicScore: number;
  roomWashScore: number;
  lowEndContaminationScore: number;
  artifactScore: number;
  warnings: string[];
};

export type StemPurityReport = {
  stemId: string;
  trackId: string;
  trackName: string;
  role: StemRole;
  purityScore: number;
  mode: "normal_track_processing_allowed" | "component_safe_processing_only" | "manual_review_or_de_bleed_first";
  dominantComponents: VirtualComponent[];
  protectedComponents: VirtualComponent[];
  notes: string[];
};

export type ComponentSafeOperation = {
  stemId: string;
  trackId: string;
  role: StemRole;
  component: VirtualComponent;
  operation: "reduce" | "boost" | "duck" | "saturate" | "tighten" | "smooth" | "debleed";
  strength: number;
  reason: string;
  bypassable: boolean;
};

export type DirtyStemPlan = {
  stemId: string;
  trackId: string;
  trackName: string;
  role: StemRole;
  purityScore: number;
  mode: StemPurityReport["mode"];
  operations: ComponentSafeOperation[];
  removedOnlyAvailable: boolean;
  notes: string[];
};

export type KickBassRoleReport = {
  kickTrackId: string | null;
  bassTrackId: string | null;
  kickOwner: "kick" | "bass" | "shared" | "unknown";
  bassOwner: "kick" | "bass" | "shared" | "unknown";
  lowEndOverlapScore: number;
  timingCollisionScore: number;
  monoRisk: number;
  phaseRisk: number;
  harmonicWeakness: number;
  recommendations: string[];
};

export type LowEndKingOwner = "kick" | "bass" | "shared" | "none" | "unknown";

export type LowEndKingReport = {
  owner: LowEndKingOwner;
  kickTrackId: string | null;
  bassTrackId: string | null;
  kickTrackName: string | null;
  bassTrackName: string | null;
  sub2060ConflictDb: number;
  sub2035Db: number;
  sub3560Db: number;
  low60120Db: number;
  lowMid120250MudDb: number;
  monoLowRisk: number;
  phaseRisk: number;
  limiterStressFromLowEnd: number;
  status: "pass" | "warn" | "fail";
  recommendations: string[];
};

export type PeakCulpritAction =
  | "leave"
  | "gain_down"
  | "transient_shape"
  | "clip_before_limiter"
  | "density_before_gain";

export type PeakCulpritItem = {
  trackId: string;
  trackName: string;
  role: StemRole;
  peakDb: number;
  truePeakApproxDb: number;
  rmsDb: number;
  crestFactorDb: number;
  limiterStressScore: number;
  action: PeakCulpritAction;
  reason: string;
};

export type PeakCulpritReport = {
  status: "pass" | "warn" | "fail";
  topCulprits: PeakCulpritItem[];
  limiterLoadRisk: number;
  densityShortfallLikely: boolean;
  recommendations: string[];
};

export type AmbienceSeatRole =
  | "dry_anchor"
  | "near_support"
  | "shared_room"
  | "far_texture"
  | "no_send";

export type AmbienceSeatTrackPlan = {
  trackId: string;
  trackName: string;
  role: StemRole;
  seat: AmbienceSeatRole;
  sendDb: number;
  preDelayMs: number;
  lowCutHz: number;
  highCutHz: number;
  width: number;
  reason: string;
  warnings: string[];
};

export type AmbienceSeatPlan = {
  status: "pass" | "warn" | "fail";
  busPreset: "tight_room" | "clean_plate" | "dark_space" | "wide_air";
  tracks: AmbienceSeatTrackPlan[];
  globalLowCutHz: number;
  globalHighCutHz: number;
  warnings: string[];
  recommendations: string[];
};

export type PluginInsertPlan = {
  id: string;
  pluginId: string;
  name: string;
  target: "track" | "master" | "clip";
  params: Record<string, unknown>;
  reason: string;
  confidence: number;
  strength: number;
  enabled: boolean;
  bypassable: boolean;
  undoLabel: string;
  routePreference: "insert" | "send" | "bus";
};

export type SendPlan = {
  id: string;
  sourceTrackId: string;
  sourceTrackName: string;
  targetBusId: string;
  targetBusName: string;
  gainDb: number;
  enabled: boolean;
  reason: string;
};

export type BusProcessingPlan = {
  id: string;
  busId: string;
  busName: string;
  pluginPlans: PluginInsertPlan[];
  reason: string;
};

export type AutoPluginTrackPlan = {
  trackId: string;
  trackName: string;
  role: StemRole;
  purityScore: number;
  insertPlans: PluginInsertPlan[];
  sendPlans: SendPlan[];
  busPlans: BusProcessingPlan[];
  notes: string[];
};

export type AutoPluginPlan = {
  id: string;
  createdAt: string;
  sourceAutoMixPlanId: string;
  mode: MixDoctorMode;
  target: MixDoctorTarget;
  trackPlans: AutoPluginTrackPlan[];
  masterPlan: MasterPlan;
  masterInsertPlans: PluginInsertPlan[];
  exportModePlan: ExportModePlan;
  damageGuardReport: DamageGuardReport;
  abCompareReport: ABCompareReport;
  notes: string[];
};

export type MasterPlan = {
  mode: "preview_loud" | "mix_for_mastering" | "stem_export";
  limiterCeilingDb: number;
  maxGainPushDb: number;
  tone: "clean" | "warm" | "bright" | "dark";
  notes: string[];
};

export type ExportModePlan = {
  mode: "preview_loud" | "mix_for_mastering" | "stem_export";
  limiterEnabled: boolean;
  normalizePeak: boolean;
  bitDepth: "pcm16" | "pcm24" | "float32";
  sampleRate: 44100 | 48000 | "project";
  notes: string[];
};

export type DamageGuardReport = {
  allowed: boolean;
  before: {
    clarity: number;
    body: number;
    stereoImage: number;
    harshness: number;
    mud: number;
    peakSafety: number;
  };
  after: {
    clarity: number;
    body: number;
    stereoImage: number;
    harshness: number;
    mud: number;
    peakSafety: number;
  };
  warnings: string[];
  actions: Array<{
    type: "weaken" | "bypass" | "preserve";
    targetId: string;
    reason: string;
  }>;
};

export type ABCompareReport = {
  beforeLabel: string;
  afterLabel: string;
  loudnessMatched: boolean;
  gainCompensationDb: number;
  notes: string[];
};

export type MasterReadinessScore = {
  overall: number;
  loudness: number;
  tonalBalance: number;
  lowEnd: number;
  vocalPresence: number;
  stereoImage: number;
  harshness: number;
  mud: number;
  aiArtifact: number;
  peakSafety: number;
  notes: string[];
};

export type AutoMixTrackPlan = {
  trackId: string;
  trackName: string;
  role: StemRole;
  volumeTrimDb: number;
  pan: number;
  width: number;
  depth: number;
  priority: "protect" | "support" | "decoration";
  protectFlags: string[];
  reason: string;
  confidence?: number;
};

export type AutoMixPlan = {
  id: string;
  createdAt: string;
  mode: MixDoctorMode;
  target: MixDoctorTarget;
  trackPlans: AutoMixTrackPlan[];
  masterPlan: {
    limiterCeilingDb: number;
    maxGainPushDb: number;
    tone: "clean" | "warm" | "bright" | "dark";
    notes: string[];
  };
  pluginPlan?: AutoPluginPlan;
  exportModePlan?: ExportModePlan;
};

export type MixDoctorReport = {
  id: string;
  createdAt: string;
  version: "mix-doctor-v2";
  mode: MixDoctorMode;
  target: MixDoctorTarget;
  stemScores: StemMixScore[];
  masterReadiness: MasterReadinessScore;
  autoMixPlan: AutoMixPlan;
  problems: ArtifactProblem[];
  summary: string[];
  stemFeatureReports?: StemFeatureReport[];
  referenceProfile?: ReferenceProfile | null;
  loudnessMatchReport?: LoudnessMatchReport | null;
  referenceDelta?: ReferenceDelta | null;
  referenceClarityGap?: ReferenceClarityGapReport | null;
  referenceRepair?: ReferenceRepairDiagnosis | null;
  perceptualScoreReport?: PerceptualScoreReport | null;
  philosophyScore?: PhilosophyScore | null;
  contaminationReports?: StemContaminationReport[];
  stemPurityReports?: StemPurityReport[];
  dirtyStemPlans?: DirtyStemPlan[];
  kickBassRoleReport?: KickBassRoleReport | null;
  lowEndKingReport?: LowEndKingReport | null;
  peakCulpritReport?: PeakCulpritReport | null;
  ambienceSeatPlan?: AmbienceSeatPlan | null;
  autoPluginPlan?: AutoPluginPlan | null;
  damageGuardReport?: DamageGuardReport | null;
  abCompareReport?: ABCompareReport | null;
  exportModePlan?: ExportModePlan | null;
  renderedMixMetrics?: RenderedMixMetricsReport | null;
};

export type MasterFinishReport = {
  mode: MasterFinishMode;
  label: string;
  targetLoudness: string;
  ceilingDb: number;
  changes: string[];
  warnings: string[];
  damageChecks: string[];
};

export type SpectralEditOperation =
  | "reduce"
  | "mute"
  | "smooth"
  | "deess"
  | "deharsh"
  | "derumble"
  | "declick"
  | "protect"
  | "restore";

export type SpectralEditOp = {
  id: string;
  stemId: string | "mix";
  role: StemRole | "mix";
  startTime: number;
  endTime: number;
  lowFreq: number;
  highFreq: number;
  operation: SpectralEditOperation;
  gainDb?: number;
  strength: number;
  softness: number;
  protectMain: boolean;
  createdBy: "manual" | "auto-light" | "auto-balanced" | "auto-strong";
  confidence?: number;
  reason: string;
  createdAt: string;
};

export type RepairHeatmapViewMode = "before" | "after" | "difference";

export type RepairHeatmapCell = {
  id: string;
  trackId: string;
  stemId: string;
  role: StemRole | "mix";
  startTime: number;
  endTime: number;
  lowFreq: number;
  highFreq: number;
  artifactScore: number;
  harshnessScore: number;
  mudScore: number;
  rumbleScore: number;
  metallicScore: number;
  vocalBleedScore: number;
  roomWashScore: number;
  beforeScore: number;
  afterScore?: number;
  differenceScore?: number;
  confidence: number;
  suggestedOperation: SpectralEditOperation;
  suggestedGainDb: number;
  strength: number;
  softness: number;
  protectMain: boolean;
  reason: string;
};

export type RepairVisualSummary = {
  totalCells: number;
  hotCells: number;
  maxScore: number;
  averageScore: number;
  improvedCells?: number;
  worsenedCells?: number;
  protectedCells?: number;
  notes: string[];
};

export type SpectralRepairReport = {
  id: string;
  createdAt: string;
  mode: MixDoctorMode;
  ops: SpectralEditOp[];
  heatmapCells?: RepairHeatmapCell[];
  beforeSummary?: RepairVisualSummary;
  afterPreviewSummary?: RepairVisualSummary;
  previewNotes: string[];
  removedOnlyAvailable: boolean;
};

