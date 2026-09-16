import type { DirtyStemPlan, KickBassRoleReport, StemFeatureReport, StemPurityReport, ComponentSafeOperation } from "../mixDoctorTypes";
import { clamp, round1 } from "../mixDoctorAnalysisUtils";

export function buildDirtyStemPlans(
  featureReports: StemFeatureReport[],
  purityReports: StemPurityReport[],
): { dirtyStemPlans: DirtyStemPlan[]; kickBassRoleReport: KickBassRoleReport } {
  const purityByTrackId = new Map(purityReports.map((report) => [report.trackId, report]));
  const dirtyStemPlans = featureReports.map((feature) => {
    const purity = purityByTrackId.get(feature.trackId);
    const operations = buildOperations(feature, purity?.purityScore ?? 100, purity?.mode ?? "normal_track_processing_allowed");
    return {
      stemId: feature.stemId,
      trackId: feature.trackId,
      trackName: feature.trackName,
      role: feature.role,
      purityScore: purity?.purityScore ?? 100,
      mode: purity?.mode ?? "normal_track_processing_allowed",
      operations,
      removedOnlyAvailable: true,
      notes: buildNotes(feature, purity?.purityScore ?? 100, operations),
    };
  });

  return {
    dirtyStemPlans,
    kickBassRoleReport: buildKickBassRoleReport(featureReports, purityReports),
  };
}

function buildOperations(
  feature: StemFeatureReport,
  purityScore: number,
  mode: StemPurityReport["mode"],
): ComponentSafeOperation[] {
  if (mode === "normal_track_processing_allowed") return [];

  const operations: ComponentSafeOperation[] = [];
  const harshPresence = averageBands(feature, ["1500-3000", "3000-5000", "5000-9000"]);
  const lowEnergy = averageBands(feature, ["20-35", "35-60", "60-120"]);

  if (feature.role === "drums" || feature.role === "music") {
    if (feature.bandEnergyDb["5000-9000"] > -9 || feature.bandEnergyDb["9000-12000"] > -10) {
      operations.push(componentOp(feature, "cymbal_like", "smooth", 0.48, "Smooth the cymbal-like content before adding any air boost."));
    }
    if (feature.crestFactorDb < 8) {
      operations.push(componentOp(feature, "room_wash_like", "tighten", 0.5, "Tighten room wash before compression."));
    }
  }

  if (feature.role === "vocal" || feature.role === "backingVocal") {
    if (harshPresence > -9) {
      operations.push(componentOp(feature, "vocal_bleed_like", "debleed", 0.42, "Push back bleed before using broad presence EQ."));
    }
    if (feature.bandEnergyDb["5000-9000"] > -10) {
      operations.push(componentOp(feature, "vocal_bleed_like", "duck", 0.35, "Use dynamic de-ess style ducking instead of bright air boosts."));
    }
  }

  if (feature.role !== "bass" && lowEnergy > -11) {
    operations.push(componentOp(feature, "tonal_bleed_like", "reduce", 0.34, "Reduce low-end contamination rather than broad boosting."));
  }

  if (purityScore < 45) {
    operations.push(componentOp(feature, "residual", "reduce", 0.3, "Manual review is safer than broad track processing."));
  }

  return operations.slice(0, 4);
}

function buildNotes(feature: StemFeatureReport, purityScore: number, operations: ComponentSafeOperation[]) {
  const notes = [`Purity ${purityScore.toFixed(1)}`];
  if (operations.length > 0) {
    notes.push(...operations.map((operation) => operation.reason));
  } else {
    notes.push("No component-safe repair needed.");
  }
  if (feature.role === "bass" || feature.role === "drums") {
    notes.push("Protect center low-end before any broad polish.");
  }
  return notes;
}

function buildKickBassRoleReport(featureReports: StemFeatureReport[], purityReports: StemPurityReport[]): KickBassRoleReport {
  const kick = featureReports.find((report) => report.role === "drums") ?? null;
  const bass = featureReports.find((report) => report.role === "bass") ?? null;
  const kickPurity = purityReports.find((report) => report.trackId === kick?.trackId);
  const bassPurity = purityReports.find((report) => report.trackId === bass?.trackId);
  const lowEndOverlapScore = round1(clamp(((kick ? lowBandEnergy(kick) : -16) + (bass ? lowBandEnergy(bass) : -16) + 30) * 2.2, 0, 100));
  const timingCollisionScore = round1(clamp((kick && bass ? 42 : 18) + Math.max(0, 18 - Math.abs((kick?.sideMidRatioDb ?? 0) - (bass?.sideMidRatioDb ?? 0))), 0, 100));
  const monoRisk = round1(clamp((kick ? Math.abs(kick.sideMidRatioDb) * 3 : 8) + (bass ? Math.abs(bass.sideMidRatioDb) * 2 : 8), 0, 100));
  const phaseRisk = round1(clamp((kick ? 100 - kick.lrCorrelation * 100 : 20) * 0.32 + (bass ? 100 - bass.lrCorrelation * 100 : 20) * 0.32, 0, 100));
  const harmonicWeakness = round1(clamp(100 - (((kick ? lowBandEnergy(kick) : -18) + (bass ? lowBandEnergy(bass) : -18)) * -3.5), 0, 100));

  return {
    kickTrackId: kick?.trackId ?? null,
    bassTrackId: bass?.trackId ?? null,
    kickOwner: kick ? "kick" : "unknown",
    bassOwner: bass ? "bass" : "unknown",
    lowEndOverlapScore,
    timingCollisionScore,
    monoRisk,
    phaseRisk,
    harmonicWeakness,
    recommendations: [
      "Solve kick and bass separation before any broad low-end boost.",
      "Keep sub below 120Hz mono-safe.",
      purityWarning(kickPurity?.purityScore),
      purityWarning(bassPurity?.purityScore),
    ].filter(Boolean) as string[],
  };
}

function purityWarning(purityScore?: number) {
  if (typeof purityScore !== "number") return "";
  if (purityScore < 45) return "At least one low-end stem is dirty enough to need component-safe repair.";
  if (purityScore < 75) return "At least one low-end stem should stay in component-safe mode.";
  return "";
}

function componentOp(feature: StemFeatureReport, component: ComponentSafeOperation["component"], operation: ComponentSafeOperation["operation"], strength: number, reason: string): ComponentSafeOperation {
  return {
    stemId: feature.stemId,
    trackId: feature.trackId,
    role: feature.role,
    component,
    operation,
    strength: round1(clamp(strength, 0.1, 1)),
    reason,
    bypassable: true,
  };
}

function averageBands(feature: StemFeatureReport, bands: Array<keyof StemFeatureReport["bandEnergyDb"]>) {
  return bands.reduce((sum, band) => sum + feature.bandEnergyDb[band], 0) / Math.max(1, bands.length);
}

function lowBandEnergy(feature: StemFeatureReport) {
  return averageBands(feature, ["20-35", "35-60", "60-120"]);
}
