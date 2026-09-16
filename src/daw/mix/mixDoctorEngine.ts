import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Project, StemRole, Track } from "@/daw/model/Project";
import type {
  ArtifactProblem,
  ArtifactProblemType,
  AutoMixPlan,
  AutoMixTrackPlan,
  AutoPluginPlan,
  ABCompareReport,
  AmbienceSeatPlan,
  DamageGuardReport,
  DirtyStemPlan,
  ExportModePlan,
  KickBassRoleReport,
  LowEndKingReport,
  MasterReadinessScore,
  MixDoctorMode,
  MixDoctorReport,
  MixDoctorTarget,
  PeakCulpritReport,
  PerceptualScoreReport,
  PhilosophyScore,
  ReferenceDelta,
  ReferenceClarityGapReport,
  ReferenceProfile,
  ReferenceRepairDiagnosis,
  RenderedMixMetricsReport,
  BandEnergyMap,
  StemContaminationReport,
  StemFeatureReport,
  StemPurityReport,
  StemMixScore,
} from "./mixDoctorTypes";
import type { RenderedAudioMetrics } from "./renderDamageGuard";
import { averageDbAsPower, estimateIntegratedLufsApproxFromRms } from "./loudnessApprox";
import { makeStemFeatureReport } from "./mixDoctorAnalysisUtils";
import { analyzeReferenceMix } from "./reference/referenceAnalyzer";
import { analyzeStemPurity } from "./dirtyStem/stemPurityAnalyzer";
import { buildDirtyStemPlans } from "./dirtyStem/dirtyStemPlanner";
import { buildAutoPluginPlan, buildPerceptualScoreReport } from "./pluginPlan/autoPluginPlanner";
import { analyzeLowEndKing } from "./lowEndKingReport";
import { analyzePeakCulprits } from "./peakCulpritReport";
import { buildAmbienceSeatPlan } from "./ambienceSeatPlanner";
import { analyzeReferenceClarityGap } from "./reference/referenceClarityGap";

export type AnalyzeMixDoctorOptions = {
  mode?: MixDoctorMode;
  target?: MixDoctorTarget;
  renderedMetrics?: RenderedAudioMetrics | null;
};

export function analyzeMixDoctor(
  project: Project,
  peaksByFileId: Record<string, PeakSummary>,
  options: AnalyzeMixDoctorOptions = {},
): MixDoctorReport {
  const mode = options.mode ?? "light";
  const target = options.target ?? "streaming_safe";
  const createdAt = new Date().toISOString();
  const renderedMixMetrics = options.renderedMetrics ? summarizeRenderedMixMetrics(options.renderedMetrics) : null;
  const renderedMixFeatureReport = options.renderedMetrics ? makeRenderedMixFeatureReport(options.renderedMetrics, createdAt) : null;
  const audibleTracks = project.tracks.filter((track) => track.role !== "reference" && !track.mute);
  const featureReports = buildFeatureReports(project, peaksByFileId, project.tracks);
  const workFeatureReports = featureReports.filter((report) => report.role !== "reference");
  const referenceFeatureReports = renderedMixFeatureReport
    ? [...featureReports.filter((report) => report.role === "reference"), renderedMixFeatureReport]
    : featureReports;
  const stemScores = audibleTracks.map((track) => scoreTrack(project, track, peaksByFileId));
  const problems = stemScores.flatMap((score) => score.problems);
  const stemPurityResults = workFeatureReports.map((feature) => analyzeStemPurity(feature));
  const stemPurityReports = stemPurityResults.map((result) => result.purityReport);
  const contaminationReports = stemPurityResults.map((result) => result.contaminationReport);
  const referenceAnalysis = analyzeReferenceMix(referenceFeatureReports, mode);
  const referenceClarityGap = analyzeReferenceClarityGap(workFeatureReports, referenceAnalysis.referenceProfile);
  const dirtyStemAnalysis = buildDirtyStemPlans(workFeatureReports, stemPurityReports);
  const currentWorkLufs = workFeatureReports.length > 0
    ? averageDbAsPower(workFeatureReports.map((report) => report.integratedLufsApprox))
    : null;
  const remainingLufsShortfallDb = referenceAnalysis.referenceProfile && currentWorkLufs !== null
    ? referenceAnalysis.referenceProfile.integratedLufsApprox - currentWorkLufs
    : null;
  const lowEndKingReport = analyzeLowEndKing(workFeatureReports, project);
  const peakCulpritReport = analyzePeakCulprits(workFeatureReports, stemScores, {
    lufsShortfallDb: remainingLufsShortfallDb,
  });
  const ambienceSeatPlan = buildAmbienceSeatPlan(workFeatureReports, {
    target,
    stemPurityReports,
    contaminationReports,
    lowEndKingReport,
    peakCulpritReport,
  });
  const basePerceptualScoreReport = buildPerceptualScoreReport(workFeatureReports);
  const renderedPerceptualScoreReport = options.renderedMetrics ? buildRenderedPerceptualScore(options.renderedMetrics) : null;
  const perceptualScoreReport = renderedPerceptualScoreReport ?? basePerceptualScoreReport;
  const autoMixPlan = createAutoMixPlan(stemScores, mode, target, createdAt);
  const philosophyScore = buildPhilosophyScore(perceptualScoreReport, autoMixPlan, project, renderedMixMetrics);
  const baseMasterReadiness = scoreMasterReadiness(stemScores, project.tracks.length);
  const masterReadiness = options.renderedMetrics
    ? mergeMasterReadinessWithRendered(baseMasterReadiness, perceptualScoreReport, options.renderedMetrics)
    : baseMasterReadiness;
  const autoPluginPlan = buildAutoPluginPlan({
    featureReports: workFeatureReports,
    autoMixPlan,
    stemPurityReports,
    contaminationReports,
    referenceDelta: referenceAnalysis.referenceDelta,
    referenceClarityGap,
    loudnessMatchReport: referenceAnalysis.loudnessMatchReport,
    kickBassRoleReport: dirtyStemAnalysis.kickBassRoleReport,
    lowEndKingReport,
    peakCulpritReport,
    ambienceSeatPlan,
  });
  autoMixPlan.pluginPlan = autoPluginPlan;
  autoMixPlan.exportModePlan = autoPluginPlan.exportModePlan;
  const damageGuardReport = autoPluginPlan.damageGuardReport;
  const abCompareReport = autoPluginPlan.abCompareReport;
  const summary = createSummary(
    masterReadiness,
    problems,
    stemScores,
    referenceAnalysis.referenceProfile,
    referenceAnalysis.loudnessMatchReport,
    referenceAnalysis.referenceRepair,
    referenceClarityGap,
    dirtyStemAnalysis.kickBassRoleReport,
    lowEndKingReport,
    peakCulpritReport,
    ambienceSeatPlan,
    perceptualScoreReport,
    philosophyScore,
    renderedMixMetrics,
  );

  return {
    id: `mix-doctor-${Date.now().toString(36)}`,
    createdAt,
    version: "mix-doctor-v2",
    mode,
    target,
    stemScores,
    masterReadiness,
    autoMixPlan,
    problems,
    summary,
    stemFeatureReports: featureReports,
    referenceProfile: referenceAnalysis.referenceProfile,
    loudnessMatchReport: referenceAnalysis.loudnessMatchReport,
    referenceDelta: referenceAnalysis.referenceDelta,
    referenceClarityGap,
    referenceRepair: referenceAnalysis.referenceRepair,
    perceptualScoreReport,
    philosophyScore,
    contaminationReports,
    stemPurityReports,
    dirtyStemPlans: dirtyStemAnalysis.dirtyStemPlans,
    kickBassRoleReport: dirtyStemAnalysis.kickBassRoleReport,
    lowEndKingReport,
    peakCulpritReport,
    ambienceSeatPlan,
    autoPluginPlan,
    damageGuardReport,
    abCompareReport,
    exportModePlan: autoPluginPlan.exportModePlan,
    renderedMixMetrics,
  };
}

function scoreTrack(project: Project, track: Track, peaksByFileId: Record<string, PeakSummary>): StemMixScore {
  const clips = project.clips.filter((clip) => clip.trackId === track.id);
  const summaries = clips.map((clip) => peaksByFileId[clip.fileId]).filter(Boolean) as PeakSummary[];
  const peakStats = summarizePeaks(summaries);
  const gainAdjustedPeak = peakStats.peak * dbToGain(track.gainDb);
  const gainAdjustedRms = peakStats.rms * dbToGain(track.gainDb);
  const peakDb = ampToDb(gainAdjustedPeak);
  const rmsDb = ampToDb(gainAdjustedRms);
  const crestFactor = Math.max(0, peakDb - rmsDb);
  const loudnessApprox = estimateIntegratedLufsApproxFromRms(rmsDb);
  const highBoost = getEqHighBoost(track);
  const lowBoost = getEqLowBoost(track);
  const hasHpf = track.eq.bands.some((band) => band.enabled && band.type === "highpass" && band.frequency >= 24);
  const role = track.role;

  const mudScore = clampScore(roleWeight(role, "mud") * 42 + Math.max(0, -rmsDb - 14) * 1.4 + lowBoost * 6);
  const harshnessScore = clampScore(roleWeight(role, "harsh") * 34 + highBoost * 14 + Math.max(0, peakDb + 6) * 6);
  const sibilanceScore = clampScore((role === "vocal" || role === "backingVocal" ? 34 : 10) + highBoost * 12);
  const metallicScore = clampScore(roleWeight(role, "metallic") * 34 + highBoost * 12 + (role === "synth" ? 12 : 0));
  const rumbleScore = clampScore((role === "bass" || role === "drums" ? 24 : 8) + (hasHpf ? 0 : 18) + lowBoost * 11);
  const stereoWidthScore = clampScore(Math.abs(track.pan) * 100);
  const maskingRisk = clampScore(roleWeight(role, "masking") * 34 + (Math.abs(track.pan) < 0.12 ? 12 : 0) + Math.max(0, track.gainDb + 2) * 5);
  const aiArtifactScore = clampScore((harshnessScore + sibilanceScore + metallicScore + mudScore) / 4);
  const problems = buildProblems(track, {
    mudScore,
    harshnessScore,
    sibilanceScore,
    metallicScore,
    rumbleScore,
    maskingRisk,
    peakDb,
  });

  return {
    stemId: clips[0]?.fileId ?? track.id,
    trackId: track.id,
    trackName: track.name,
    role,
    rms: round1(rmsDb),
    peak: round1(peakDb),
    crestFactor: round1(crestFactor),
    loudnessApprox: round1(loudnessApprox),
    mudScore: Math.round(mudScore),
    harshnessScore: Math.round(harshnessScore),
    sibilanceScore: Math.round(sibilanceScore),
    metallicScore: Math.round(metallicScore),
    rumbleScore: Math.round(rumbleScore),
    stereoWidthScore: Math.round(stereoWidthScore),
    maskingRisk: Math.round(maskingRisk),
    aiArtifactScore: Math.round(aiArtifactScore),
    problems,
  };
}

function buildFeatureReports(project: Project, peaksByFileId: Record<string, PeakSummary>, tracks: Track[]): StemFeatureReport[] {
  return tracks.map((track, index) => {
    const summaries = project.clips.filter((clip) => clip.trackId === track.id).map((clip) => peaksByFileId[clip.fileId]).filter(Boolean) as PeakSummary[];
    return makeStemFeatureReport(track, mergePeakSummaries(summaries), index);
  });
}

function mergePeakSummaries(summaries: PeakSummary[]): PeakSummary | null {
  if (summaries.length === 0) return null;

  const bins = Math.max(...summaries.map((summary) => summary.bins));
  const min = new Array<number>(bins).fill(0);
  const max = new Array<number>(bins).fill(0);

  for (let bin = 0; bin < bins; bin += 1) {
    let binMin = 0;
    let binMax = 0;
    for (const summary of summaries) {
      const currentMax = Math.abs(summary.max[bin] ?? 0);
      const currentMin = Math.abs(summary.min[bin] ?? 0);
      binMax = Math.max(binMax, currentMax);
      binMin = Math.min(binMin, -currentMin);
    }
    min[bin] = binMin;
    max[bin] = binMax;
  }

  return {
    bins,
    min,
    max,
    durationSec: Math.max(...summaries.map((summary) => summary.durationSec)),
    ...mergeMeasuredFeatures(summaries),
  };
}

function mergeMeasuredFeatures(summaries: PeakSummary[]): Partial<PeakSummary> {
  const measuredBandSummaries = summaries.filter((summary) => summary.bandEnergyDb);
  if (measuredBandSummaries.length === 0) return {};

  const durationTotal = Math.max(1e-6, measuredBandSummaries.reduce((sum, summary) => sum + Math.max(0.001, summary.durationSec), 0));
  const bandKeys = Object.keys(measuredBandSummaries[0]?.bandEnergyDb ?? {});
  const sideBandKeys = Array.from(new Set(measuredBandSummaries.flatMap((summary) => Object.keys(summary.bandSideMidDb ?? {}))));
  const bandEnergyDb = Object.fromEntries(
    bandKeys.map((key) => {
      const weightedPower = measuredBandSummaries.reduce((sum, summary) => {
        const db = summary.bandEnergyDb?.[key];
        if (typeof db !== "number" || !Number.isFinite(db)) return sum;
        return sum + 10 ** (db / 10) * Math.max(0.001, summary.durationSec);
      }, 0) / durationTotal;
      return [key, round1(10 * Math.log10(Math.max(1e-12, weightedPower)))];
    }),
  );
  const bandSideMidDb = Object.fromEntries(
    sideBandKeys.map((key) => {
      const weighted = measuredBandSummaries.reduce((sum, summary) => {
        const db = summary.bandSideMidDb?.[key];
        if (typeof db !== "number" || !Number.isFinite(db)) return sum;
        return sum + db * Math.max(0.001, summary.durationSec);
      }, 0) / durationTotal;
      return [key, round1(weighted)];
    }),
  );

  return {
    bandEnergyDb,
    ...(sideBandKeys.length > 0 ? { bandSideMidDb } : {}),
    lrCorrelation: weightedAverage(measuredBandSummaries, (summary) => summary.lrCorrelation),
    sideMidRatioDb: weightedAverage(measuredBandSummaries, (summary) => summary.sideMidRatioDb),
    spectralCentroidHz: weightedAverage(measuredBandSummaries, (summary) => summary.spectralCentroidHz),
    spectralFlatness: weightedAverage(measuredBandSummaries, (summary) => summary.spectralFlatness),
  };
}

function weightedAverage(summaries: PeakSummary[], selector: (summary: PeakSummary) => number | undefined) {
  let weighted = 0;
  let weight = 0;
  for (const summary of summaries) {
    const value = selector(summary);
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const duration = Math.max(0.001, summary.durationSec);
    weighted += value * duration;
    weight += duration;
  }
  return weight > 0 ? round1(weighted / weight) : undefined;
}

function summarizePeaks(summaries: PeakSummary[]) {
  if (summaries.length === 0) {
    return { peak: 0.35, rms: 0.12 };
  }

  let peak = 0;
  let rmsSum = 0;
  let sampleCount = 0;

  for (const summary of summaries) {
    for (let index = 0; index < summary.bins; index += 1) {
      const high = Math.abs(summary.max[index] ?? 0);
      const low = Math.abs(summary.min[index] ?? 0);
      const binPeak = Math.max(high, low);
      peak = Math.max(peak, binPeak);
      rmsSum += Math.pow((high + low) / 2, 2);
      sampleCount += 1;
    }
  }

  return {
    peak: Math.max(0.00001, peak),
    rms: Math.max(0.00001, Math.sqrt(rmsSum / Math.max(1, sampleCount))),
  };
}

function buildProblems(
  track: Track,
  scores: {
    mudScore: number;
    harshnessScore: number;
    sibilanceScore: number;
    metallicScore: number;
    rumbleScore: number;
    maskingRisk: number;
    peakDb: number;
  },
) {
  const problems: ArtifactProblem[] = [];
  addProblem(problems, track, "mud", scores.mudScore, 150, 350, "Low-mid mud may blur the mix.", "Try a small 180-260Hz cleanup before boosting lows.");
  addProblem(problems, track, "harshness", scores.harshnessScore, 2500, 6000, "Presence range may feel sharp.", "Use light de-harsh EQ and avoid extra air boost.");
  addProblem(problems, track, "sibilance", scores.sibilanceScore, 5000, 9000, "Vocal or high content may contain sibilance.", "Apply a light de-ess style dip around 6-8kHz.");
  addProblem(problems, track, "metallic_high", scores.metallicScore, 5000, 12000, "AI metallic high texture may be audible.", "Reduce narrow high bands and keep exciter amount low.");
  addProblem(problems, track, "rumble", scores.rumbleScore, 20, 35, "Sub rumble may eat headroom.", "Keep HPF around 25-30Hz and avoid 20-35Hz boost.");
  addProblem(problems, track, "masking", scores.maskingRisk, 2000, 5000, "This stem may mask the lead range.", "Lower priority stems or pan them slightly away from center.");

  if (scores.peakDb > -1.2) {
    addProblem(problems, track, "peak_risk", 78, undefined, undefined, "Peak is close to the safety ceiling.", "Reduce gain or limiter push before export.");
  }

  return problems;
}

function addProblem(
  problems: ArtifactProblem[],
  track: Track,
  type: ArtifactProblemType,
  score: number,
  lowFreq: number | undefined,
  highFreq: number | undefined,
  reason: string,
  suggestedFix: string,
) {
  if (score < 62) return;
  problems.push({
    id: `${track.id}-${type}`,
    stemId: track.id,
    role: track.role,
    type,
    lowFreq,
    highFreq,
    score: Math.round(score),
    confidence: round2(Math.min(0.95, 0.45 + score / 160)),
    reason,
    suggestedFix,
  });
}

function scoreMasterReadiness(stems: StemMixScore[], totalTracks: number): MasterReadinessScore {
  if (stems.length === 0) {
    return {
      overall: 0,
      loudness: 0,
      tonalBalance: 0,
      lowEnd: 0,
      vocalPresence: 0,
      stereoImage: 0,
      harshness: 0,
      mud: 0,
      aiArtifact: 0,
      peakSafety: 0,
      notes: ["Import stems before running Mix Doctor."],
    };
  }

  const avg = (selector: (score: StemMixScore) => number) =>
    stems.reduce((sum, score) => sum + selector(score), 0) / stems.length;
  const maxPeak = Math.max(...stems.map((score) => score.peak));
  const vocal = stems.find((score) => score.role === "vocal");
  const lowRisk = avg((score) => Math.max(score.rumbleScore, score.mudScore));
  const highRisk = avg((score) => Math.max(score.harshnessScore, score.sibilanceScore, score.metallicScore));
  const widthAverage = avg((score) => score.stereoWidthScore);
  const peakSafety = clampScore(100 - Math.max(0, maxPeak + 1) * 20);
  const loudness = clampScore(100 - Math.abs(avg((score) => score.loudnessApprox) + 13) * 5);
  const tonalBalance = clampScore(100 - (lowRisk + highRisk) / 3);
  const lowEnd = clampScore(100 - lowRisk);
  const vocalPresence = vocal ? clampScore(100 - vocal.maskingRisk + 12) : 55;
  const stereoImage = clampScore(55 + widthAverage * 0.55 - (totalTracks > 6 ? 5 : 0));
  const harshness = clampScore(100 - highRisk);
  const mud = clampScore(100 - avg((score) => score.mudScore));
  const aiArtifact = clampScore(100 - avg((score) => score.aiArtifactScore));
  const overall = Math.round(
    (loudness + tonalBalance + lowEnd + vocalPresence + stereoImage + harshness + mud + aiArtifact + peakSafety) / 9,
  );
  const notes = [
    maxPeak > -1 ? "Peak safety is tight. Keep limiter ceiling at -1.0dB or lower." : "Peak safety is acceptable.",
    lowRisk > 58 ? "Low-end cleanup should happen before bass enhancement." : "Low-end is ready for light polish.",
    highRisk > 58 ? "High-band polish should use Harshness Guard." : "High band can take a small polish.",
  ];

  return {
    overall,
    loudness: Math.round(loudness),
    tonalBalance: Math.round(tonalBalance),
    lowEnd: Math.round(lowEnd),
    vocalPresence: Math.round(vocalPresence),
    stereoImage: Math.round(stereoImage),
    harshness: Math.round(harshness),
    mud: Math.round(mud),
    aiArtifact: Math.round(aiArtifact),
    peakSafety: Math.round(peakSafety),
    notes,
  };
}

function createAutoMixPlan(
  stems: StemMixScore[],
  mode: MixDoctorMode,
  target: MixDoctorTarget,
  createdAt: string,
): AutoMixPlan {
  const strength = mode === "strong" ? 0.65 : mode === "balanced" ? 0.42 : 0.22;
  const stageScale = target === "reference_polish" ? 0.82 : target === "wide_pop" ? 0.92 : 0.86;
  const trackPlans = stems.map((stem, index): AutoMixTrackPlan => {
    const layout = getStemAwareLayout(stem, index, strength, stageScale);

    return {
      trackId: stem.trackId,
      trackName: stem.trackName,
      role: stem.role,
      volumeTrimDb: round1(layout.volumeTrimDb),
      pan: round2(layout.pan),
      width: round2(layout.width),
      depth: round2(layout.depth),
      priority: layout.priority,
      protectFlags: layout.protectFlags,
      reason: layout.reason,
      confidence: round2(clampScore(100 - stem.aiArtifactScore * 0.55 - stem.maskingRisk * 0.2) / 100),
    };
  });

  return {
    id: `auto-mix-plan-${Date.now().toString(36)}`,
    createdAt,
    mode,
    target,
    trackPlans,
    masterPlan: {
      limiterCeilingDb: mode === "light" ? -1.2 : -1,
      maxGainPushDb: target === "reference_polish" ? 0.2 : mode === "strong" ? 0.55 : mode === "balanced" ? 0.28 : 0.12,
      tone: target === "reference_polish" ? "clean" : target === "warm" ? "warm" : target === "dark_electronic" ? "dark" : target === "loud" ? "bright" : "clean",
      notes: [
        "Use non-destructive parameter changes.",
        "Place stems first, then master gently.",
        "Keep vocal, kick, bass, and sub information center-safe.",
        "Use high-side width only on support and decoration stems.",
        target === "reference_polish" ? "Reference target is safety-bound: follow loudness, tone, air, and width conservatively without copying artifacts or forcing hard limiting." : "Target tone remains subordinate to stem safety.",
      ],
    },
  };
}

function makeRenderedMixFeatureReport(metrics: RenderedAudioMetrics, createdAt: string): StemFeatureReport {
  const bandEnergyDb = buildRenderedBandEnergy(metrics);
  return {
    stemId: "rendered-mix",
    trackId: "rendered-mix",
    trackName: "Rendered Current Mix",
    role: "music",
    rmsDb: round1(metrics.rmsDb),
    peakDb: round1(metrics.peakDb),
    truePeakApproxDb: round1(metrics.peakDb + 0.2),
    crestFactorDb: round1(metrics.crestFactorDb),
    integratedLufsApprox: round1(estimateIntegratedLufsApproxFromRms(metrics.rmsDb)),
    lrCorrelation: round2(metrics.correlation),
    sideMidRatioDb: round1(metrics.sideMidRatioDb),
    stereoWidthScore: round1(clampScore((metrics.sideMidRatioDb + 24) * 2.4 + Math.max(0, 1 - metrics.correlation) * 18)),
    spectralCentroidHz: estimateRenderedCentroidHz(bandEnergyDb),
    spectralFlatness: estimateRenderedFlatness(bandEnergyDb),
    bandEnergyDb,
    notes: [`Measured from offline rendered mix at ${createdAt}.`],
  };
}

function summarizeRenderedMixMetrics(metrics: RenderedAudioMetrics): RenderedMixMetricsReport {
  return {
    source: "offline-render",
    peakDb: round1(metrics.peakDb),
    rmsDb: round1(metrics.rmsDb),
    crestFactorDb: round1(metrics.crestFactorDb),
    lowDb: round1(metrics.lowDb),
    lowMidDb: round1(metrics.lowMidDb),
    presenceDb: round1(metrics.presenceDb),
    highDb: round1(metrics.highDb),
    airDb: round1(metrics.airDb),
    sideMidRatioDb: round1(metrics.sideMidRatioDb),
    correlation: round2(metrics.correlation),
  };
}

function buildRenderedPerceptualScore(metrics: RenderedAudioMetrics): PerceptualScoreReport {
  const peakSafety = clampScore(100 - Math.max(0, metrics.peakDb + 1) * 30 - Math.max(0, 6 - metrics.crestFactorDb) * 4);
  const harshnessRisk = clampScore(35 + Math.max(0, metrics.highDb - metrics.lowMidDb) * 5 + Math.max(0, metrics.airDb - metrics.presenceDb) * 4);
  const mudRisk = clampScore(35 + Math.max(0, metrics.lowMidDb - metrics.presenceDb) * 4 + Math.max(0, metrics.lowDb - metrics.lowMidDb - 4) * 2);
  const clarity = clampScore(74 + (metrics.presenceDb - metrics.lowMidDb) * 3 - Math.max(0, metrics.highDb - metrics.presenceDb) * 2);
  const body = clampScore(70 + (metrics.lowMidDb - metrics.highDb) * 1.5 - Math.max(0, metrics.lowMidDb - metrics.presenceDb - 10) * 1.5);
  const stereoImage = clampScore(58 + (metrics.sideMidRatioDb + 18) * 1.8 - Math.max(0, 0.15 - Math.abs(metrics.correlation)) * 18);
  const lowEndTightness = clampScore(100 - mudRisk + Math.max(0, metrics.lowDb - metrics.lowMidDb) * 0.5);
  const reverbCleanliness = clampScore(100 - Math.max(0, 7 - metrics.crestFactorDb) * 8);
  const aiArtifact = clampScore(100 - harshnessRisk * 0.35);
  const overall = round1((clarity + body + stereoImage + peakSafety + lowEndTightness + reverbCleanliness + aiArtifact + (100 - harshnessRisk) + (100 - mudRisk)) / 9);

  return {
    overall,
    clarity: round1(clarity),
    body: round1(body),
    vocalFocus: round1(clarity),
    lowEndTightness: round1(lowEndTightness),
    stereoImage: round1(stereoImage),
    harshness: round1(harshnessRisk),
    mud: round1(mudRisk),
    reverbCleanliness: round1(reverbCleanliness),
    aiArtifact: round1(aiArtifact),
    peakSafety: round1(peakSafety),
    notes: ["Measured from the actual offline-rendered mix path."],
  };
}

function buildPhilosophyScore(
  perceptual: PerceptualScoreReport,
  autoMixPlan: AutoMixPlan,
  project: Project,
  renderedMixMetrics: RenderedMixMetricsReport | null,
): PhilosophyScore {
  const masterHasWidener = project.master.insertChain.some((plugin) => plugin.enabled && plugin.pluginId === "sweet-stereo-widener");
  const supportTracks = autoMixPlan.trackPlans.filter((track) => !["vocal", "bass", "drums", "reference"].includes(track.role));
  const centerTracks = autoMixPlan.trackPlans.filter((track) => track.role === "vocal" || track.role === "bass" || track.role === "drums");
  const supportAllCenter = supportTracks.length > 1 && supportTracks.every((track) => Math.abs(track.pan) < 0.04);
  const centerPenalty = centerTracks.reduce((sum, track) => {
    const limit = track.role === "vocal" ? 0.04 : track.role === "bass" ? 0.03 : 0.06;
    return sum + Math.max(0, Math.abs(track.pan) - limit) * 260;
  }, 0);
  const maxMasterPush = autoMixPlan.masterPlan.maxGainPushDb;
  const renderedCrestPenalty = renderedMixMetrics ? Math.max(0, 7 - renderedMixMetrics.crestFactorDb) * 8 : 0;
  const renderedPeakPenalty = renderedMixMetrics ? Math.max(0, renderedMixMetrics.peakDb + 1) * 18 : 0;
  const renderedMudPenalty = renderedMixMetrics ? Math.max(0, renderedMixMetrics.lowMidDb - renderedMixMetrics.presenceDb - 7) * 4 : 0;
  const renderedSubPenalty = renderedMixMetrics ? Math.max(0, renderedMixMetrics.lowDb - renderedMixMetrics.lowMidDb - 4) * 4 : 0;

  const lowTranslation = clampScore(perceptual.lowEndTightness - renderedSubPenalty - renderedMudPenalty * 0.4);
  const vocalClarity = clampScore(perceptual.vocalFocus - Math.max(0, perceptual.harshness - 55) * 0.35 - Math.max(0, perceptual.mud - 55) * 0.28);
  const stagePlacement = clampScore(perceptual.stereoImage - centerPenalty - (masterHasWidener ? 25 : 0) - (supportAllCenter ? 10 : 0));
  const reverbCleanliness = clampScore(perceptual.reverbCleanliness - (autoMixPlan.trackPlans.reduce((sum, track) => sum + track.depth, 0) > 1.2 ? 8 : 0));
  const loudnessByContrast = clampScore(perceptual.peakSafety - maxMasterPush * 20 - renderedCrestPenalty - renderedPeakPenalty);
  const harshnessSafety = clampScore(100 - perceptual.harshness);
  const overall = round1((lowTranslation + vocalClarity + stagePlacement + reverbCleanliness + loudnessByContrast + harshnessSafety) / 6);
  const notes = [
    "Philosophy Score favors role, band, placement, and contrast before limiter loudness.",
    masterHasWidener ? "Master widener is active; prefer support-track placement before master widening." : "Master widening is not used for automatic placement.",
    supportAllCenter ? "Support tracks are still close to center; use small role-based pan before adding full-band width." : "Support placement has usable left/right separation.",
    maxMasterPush > 0.55 ? "Master gain push is high for Sweet DAW philosophy." : "Master gain push stays conservative.",
  ];

  return {
    overall,
    lowTranslation: round1(lowTranslation),
    vocalClarity: round1(vocalClarity),
    stagePlacement: round1(stagePlacement),
    reverbCleanliness: round1(reverbCleanliness),
    loudnessByContrast: round1(loudnessByContrast),
    harshnessSafety: round1(harshnessSafety),
    notes,
  };
}

function mergeMasterReadinessWithRendered(
  base: MasterReadinessScore,
  perceptual: PerceptualScoreReport,
  metrics: RenderedAudioMetrics,
): MasterReadinessScore {
  const loudnessApprox = estimateIntegratedLufsApproxFromRms(metrics.rmsDb);
  const loudness = clampScore(100 - Math.abs(loudnessApprox + 12.5) * 5);
  const tonalBalance = clampScore((perceptual.clarity + perceptual.body + perceptual.lowEndTightness + (100 - perceptual.harshness) + (100 - perceptual.mud)) / 5);
  const lowEnd = perceptual.lowEndTightness;
  const vocalPresence = clampScore((base.vocalPresence * 0.55) + (perceptual.vocalFocus * 0.45));
  const stereoImage = perceptual.stereoImage;
  const harshness = clampScore(100 - perceptual.harshness);
  const mud = clampScore(100 - perceptual.mud);
  const aiArtifact = perceptual.aiArtifact;
  const peakSafety = perceptual.peakSafety;
  const overall = Math.round((loudness + tonalBalance + lowEnd + vocalPresence + stereoImage + harshness + mud + aiArtifact + peakSafety) / 9);

  return {
    overall,
    loudness: Math.round(loudness),
    tonalBalance: Math.round(tonalBalance),
    lowEnd: Math.round(lowEnd),
    vocalPresence: Math.round(vocalPresence),
    stereoImage: Math.round(stereoImage),
    harshness: Math.round(harshness),
    mud: Math.round(mud),
    aiArtifact: Math.round(aiArtifact),
    peakSafety: Math.round(peakSafety),
    notes: [
      "Master readiness includes an actual offline-rendered mix measurement.",
      ...base.notes.slice(0, 2),
    ],
  };
}

function buildRenderedBandEnergy(metrics: RenderedAudioMetrics): BandEnergyMap {
  const raw: BandEnergyMap = {
    "20-35": metrics.lowDb - 7,
    "35-60": metrics.lowDb - 1,
    "60-120": metrics.lowDb,
    "120-250": metrics.lowMidDb,
    "250-500": metrics.lowMidDb,
    "500-900": metrics.lowMidDb - 1,
    "900-1500": metrics.presenceDb - 2,
    "1500-3000": metrics.presenceDb,
    "3000-5000": metrics.presenceDb - 0.5,
    "5000-9000": metrics.highDb,
    "9000-12000": metrics.highDb - 1,
    "12000-16000": metrics.airDb,
    "16000-20000": metrics.airDb - 2,
  };
  return normalizeRenderedBandEnergy(raw, metrics.rmsDb);
}

function normalizeRenderedBandEnergy(raw: BandEnergyMap, rmsDb: number): BandEnergyMap {
  const values = Object.values(raw).filter((value) => Number.isFinite(value));
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] ?? -30 : -30;
  const anchor = clamp(rmsDb + 18, -18, 3);
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key, round1(clamp(value - median + anchor, -24, 0))]),
  ) as BandEnergyMap;
}

function estimateRenderedCentroidHz(bandEnergyDb: BandEnergyMap) {
  const centers: Record<keyof BandEnergyMap, number> = {
    "20-35": 27.5,
    "35-60": 47.5,
    "60-120": 90,
    "120-250": 185,
    "250-500": 375,
    "500-900": 700,
    "900-1500": 1200,
    "1500-3000": 2200,
    "3000-5000": 4000,
    "5000-9000": 7000,
    "9000-12000": 10500,
    "12000-16000": 14000,
    "16000-20000": 18000,
  };
  let weighted = 0;
  let total = 0;
  for (const [key, value] of Object.entries(bandEnergyDb) as Array<[keyof BandEnergyMap, number]>) {
    const energy = 10 ** (value / 10);
    weighted += centers[key] * energy;
    total += energy;
  }
  return Math.round(total > 0 ? weighted / total : 1000);
}

function estimateRenderedFlatness(bandEnergyDb: BandEnergyMap) {
  const values = Object.values(bandEnergyDb).map((value) => 10 ** (value / 10));
  const gm = Math.exp(values.reduce((sum, value) => sum + Math.log(Math.max(value, 1e-12)), 0) / values.length);
  const am = values.reduce((sum, value) => sum + value, 0) / values.length;
  return round2(am > 0 ? clamp(gm / am, 0, 1) : 0);
}
function createSummary(
  master: MasterReadinessScore,
  problems: ArtifactProblem[],
  stems: StemMixScore[],
  referenceProfile: ReferenceProfile | null,
  loudnessMatchReport: { appliedGainDb: number; notes: string[] } | null,
  referenceRepair: ReferenceRepairDiagnosis | null,
  referenceClarityGap: ReferenceClarityGapReport | null,
  kickBassRoleReport: KickBassRoleReport,
  lowEndKingReport: LowEndKingReport,
  peakCulpritReport: PeakCulpritReport,
  ambienceSeatPlan: AmbienceSeatPlan,
  perceptualScoreReport: PerceptualScoreReport,
  philosophyScore: PhilosophyScore,
  renderedMixMetrics: RenderedMixMetricsReport | null,
) {
  const topProblems = problems.slice().sort((a, b) => b.score - a.score).slice(0, 3);
  const summary = [`Master readiness: ${master.overall}/100`, `${stems.length} audible stem(s) analyzed.`];
  summary.push(`Perceptual score: ${perceptualScoreReport.overall}/100`);
  summary.push(`Philosophy score: ${philosophyScore.overall}/100`);
  if (renderedMixMetrics) {
    summary.push(`Rendered mix measured: peak ${renderedMixMetrics.peakDb.toFixed(1)}dB / RMS ${renderedMixMetrics.rmsDb.toFixed(1)}dB / crest ${renderedMixMetrics.crestFactorDb.toFixed(1)}dB.`);
  }
  if (referenceProfile) {
    summary.push(`Reference loaded: ${referenceProfile.trackName}`);
  } else {
    summary.push("Reference not loaded.");
  }
  if (loudnessMatchReport) {
    summary.push(`Loudness match: ${loudnessMatchReport.appliedGainDb > 0 ? "+" : ""}${loudnessMatchReport.appliedGainDb} dB`);
  }
  if (referenceRepair) {
    summary.push(`Reference Repair: ${referenceRepair.status} / ${referenceRepair.severity}`);
    if (referenceRepair.status === "low_rms_high_peak") {
      summary.push("Reference Repair warns that simple gain boost would clip before matching the Direct WAV density.");
    }
  }
  if (referenceClarityGap && referenceClarityGap.status !== "pass") {
    summary.push(`Reference Clarity: 2-5kHz is ${referenceClarityGap.presenceGapDb.toFixed(1)}dB below Reference; soften mastering cuts and catch up clarity before adding only Air.`);
    if (referenceClarityGap.falseAirRisk) {
      summary.push("Reference Clarity: false Air risk; restore 2-10kHz before adding 12kHz+ sheen.");
    }
  }
  if (kickBassRoleReport.kickTrackId || kickBassRoleReport.bassTrackId) {
    summary.push(`Kick/Bass overlap: ${kickBassRoleReport.lowEndOverlapScore}/100`);
  }
  if (lowEndKingReport.recommendations[0]) {
    summary.push(lowEndKingReport.recommendations[0]);
  }
  if (peakCulpritReport.topCulprits[0]) {
    summary.push(`Peak Culprit: ${peakCulpritReport.topCulprits[0].trackName} / ${peakCulpritReport.topCulprits[0].action.replace(/_/g, " ")}`);
  } else if (peakCulpritReport.recommendations[0]) {
    summary.push(peakCulpritReport.recommendations[0]);
  }
  if (ambienceSeatPlan.recommendations[0]) {
    summary.push(ambienceSeatPlan.recommendations[0]);
  }
  if (topProblems.length > 0) {
    summary.push(...topProblems.map((problem) => `${problem.type}: ${problem.reason}`));
  } else {
    summary.push("No major repair issue was detected by the lightweight pass.");
  }
  return summary;
}

function getEqHighBoost(track: Track) {
  return track.eq.bands.reduce((sum, band) => {
    if (!band.enabled || band.frequency < 2500) return sum;
    return sum + Math.max(0, band.gainDb);
  }, 0);
}

function getEqLowBoost(track: Track) {
  return track.eq.bands.reduce((sum, band) => {
    if (!band.enabled || band.frequency > 160) return sum;
    return sum + Math.max(0, band.gainDb);
  }, 0);
}

function roleWeight(role: StemRole, area: "mud" | "harsh" | "metallic" | "masking") {
  const table: Record<StemRole, Record<typeof area, number>> = {
    vocal: { mud: 0.35, harsh: 0.82, metallic: 0.55, masking: 0.1 },
    backingVocal: { mud: 0.32, harsh: 0.72, metallic: 0.55, masking: 0.45 },
    drums: { mud: 0.5, harsh: 0.45, metallic: 0.35, masking: 0.35 },
    bass: { mud: 0.72, harsh: 0.12, metallic: 0.18, masking: 0.22 },
    guitar: { mud: 0.55, harsh: 0.75, metallic: 0.45, masking: 0.75 },
    synth: { mud: 0.48, harsh: 0.78, metallic: 0.85, masking: 0.78 },
    keys: { mud: 0.52, harsh: 0.52, metallic: 0.42, masking: 0.55 },
    fx: { mud: 0.2, harsh: 0.76, metallic: 0.82, masking: 0.45 },
    music: { mud: 0.62, harsh: 0.56, metallic: 0.55, masking: 0.7 },
    loop: { mud: 0.48, harsh: 0.54, metallic: 0.48, masking: 0.52 },
    other: { mud: 0.48, harsh: 0.48, metallic: 0.48, masking: 0.48 },
    reference: { mud: 0, harsh: 0, metallic: 0, masking: 0 },
  };
  return table[role][area];
}

function getStemAwareLayout(stem: StemMixScore, index: number, strength: number, stageScale = 1) {
  const side = index % 2 === 0 ? -1 : 1;
  const baseTrim = getVolumeTrim(stem) * strength;

  if (stem.role === "vocal") {
    return {
      volumeTrimDb: baseTrim,
      pan: 0,
      width: 0,
      depth: 0,
      priority: "protect" as const,
      protectFlags: ["center", "do-not-over-wide", "protect-700-3k"],
      reason: "Lead vocal stays centered and forward; competing stems should yield before broad vocal EQ cuts.",
    };
  }

  if (stem.role === "bass" || stem.role === "drums") {
    return {
      volumeTrimDb: baseTrim,
      pan: 0,
      width: 0,
      depth: stem.role === "bass" ? 0.02 : 0.04,
      priority: "protect" as const,
      protectFlags: ["center", "mono-low", "do-not-over-wide"],
      reason: "Low-end foundation stays centered and mono-safe; polish focuses on separation, not blind sub boost.",
    };
  }

  if (stem.role === "backingVocal") {
    return {
      volumeTrimDb: baseTrim - 0.15 * strength,
      pan: clamp(side * 0.26 * strength * stageScale, -0.42, 0.42),
      width: clamp(0.22 * strength * stageScale, 0, 0.32),
      depth: clamp(0.14 * strength * stageScale, 0, 0.26),
      priority: "decoration" as const,
      protectFlags: ["yield-to-lead-vocal"],
      reason: "Backing vocals sit wider and slightly behind the lead while keeping the lead intelligible.",
    };
  }

  if (stem.role === "fx") {
    return {
      volumeTrimDb: baseTrim - 0.3 * strength,
      pan: clamp(side * 0.34 * strength * stageScale, -0.5, 0.5),
      width: clamp(0.28 * strength * stageScale, 0, 0.38),
      depth: clamp(0.2 * strength * stageScale, 0, 0.34),
      priority: "decoration" as const,
      protectFlags: ["high-side-width-only"],
      reason: "FX are wide and low-priority so they enhance space without covering the song.",
    };
  }

  if (stem.role === "synth" || stem.role === "keys" || stem.role === "guitar" || stem.role === "music" || stem.role === "loop") {
    return {
      volumeTrimDb: baseTrim - 0.08 * strength,
      pan: clamp(getRolePan(stem.role, index) * strength * stageScale, -0.42, 0.42),
      width: clamp(0.16 * strength * stageScale, 0, 0.28),
      depth: clamp(0.1 * strength * stageScale, 0, 0.2),
      priority: "support" as const,
      protectFlags: ["yield-to-lead-vocal", "high-side-width-only"],
      reason: "Support stems are placed around the vocal with light width and small level moves before EQ.",
    };
  }

  return {
    volumeTrimDb: baseTrim - 0.06 * strength,
    pan: clamp(getRolePan(stem.role, index) * strength * stageScale, -0.36, 0.36),
    width: clamp(0.12 * strength * stageScale, 0, 0.22),
    depth: clamp(0.08 * strength * stageScale, 0, 0.18),
    priority: "support" as const,
    protectFlags: ["high-side-width-only"],
    reason: "Keep the move light and leave room for the lead and low-end foundation.",
  };
}

function getRolePan(role: StemRole, index: number) {
  if (role === "vocal" || role === "drums" || role === "bass" || role === "reference") return 0;
  const side = index % 2 === 0 ? -1 : 1;
  if (role === "backingVocal") return side * 0.26;
  if (role === "fx") return side * 0.34;
  if (role === "synth" || role === "guitar") return side * 0.24;
  if (role === "keys") return side * 0.18;
  if (role === "music" || role === "loop") return side * 0.14;
  return side * 0.1;
}

function getVolumeTrim(stem: StemMixScore) {
  if (stem.peak > -1.2) return -1.4;
  if (stem.role === "vocal") return stem.maskingRisk > 58 ? 0.05 : 0.18;
  if (stem.role === "backingVocal") return -0.28;
  if (stem.role === "bass") return stem.mudScore > 68 ? -0.32 : -0.05;
  if (stem.role === "drums") return stem.peak > -3 ? -0.22 : -0.05;
  if (stem.role === "fx") return -0.45;
  if (stem.maskingRisk > 62) return -0.55;
  if (stem.mudScore > 68) return -0.38;
  return -0.08;
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(0.00001, value));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}




