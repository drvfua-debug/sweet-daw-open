import type { ReferenceClarityGapReport, ReferenceProfile, StemFeatureReport, MixDoctorBandId } from "../mixDoctorTypes";
import { clamp, round2 } from "../mixDoctorAnalysisUtils";
import { averageDbAsPower } from "../loudnessApprox";

const BODY_BANDS: MixDoctorBandId[] = ["500-900", "900-1500", "1500-3000"];
const PRESENCE_BANDS: MixDoctorBandId[] = ["1500-3000", "3000-5000"];
const CLARITY_BANDS: MixDoctorBandId[] = ["5000-9000", "9000-12000"];
const AIR_BANDS: MixDoctorBandId[] = ["9000-12000", "12000-16000"];

export function analyzeReferenceClarityGap(
  workFeatureReports: StemFeatureReport[],
  referenceProfile: ReferenceProfile | null,
): ReferenceClarityGapReport | null {
  if (!referenceProfile || workFeatureReports.length === 0) return null;

  const current = {
    body: aggregateBands(workFeatureReports, BODY_BANDS),
    presence: aggregateBands(workFeatureReports, PRESENCE_BANDS),
    clarity: aggregateBands(workFeatureReports, CLARITY_BANDS),
    air: aggregateBands(workFeatureReports, AIR_BANDS),
  };
  const reference = {
    body: averageBands(referenceProfile, BODY_BANDS),
    presence: averageBands(referenceProfile, PRESENCE_BANDS),
    clarity: averageBands(referenceProfile, CLARITY_BANDS),
    air: averageBands(referenceProfile, AIR_BANDS),
  };

  const bodyGapDb = round2(reference.body - current.body);
  const presenceGapDb = round2(reference.presence - current.presence);
  const clarityGapDb = round2(reference.clarity - current.clarity);
  const airGapDb = round2(reference.air - current.air);
  const coreGap = Math.max(presenceGapDb, clarityGapDb);
  const falseAirRisk = coreGap > 1 && (airGapDb > 1.8 || airGapDb < coreGap - 0.35);
  const status = presenceGapDb > 1.8 || clarityGapDb > 2 || (falseAirRisk && coreGap > 1.45)
    ? "fail"
    : presenceGapDb > 1 || clarityGapDb > 1.2 || airGapDb > 1.8 || (bodyGapDb < -1.5 && presenceGapDb > 1.2)
      ? "warn"
      : "pass";

  const recommendations = buildRecommendations({
    bodyGapDb,
    presenceGapDb,
    clarityGapDb,
    airGapDb,
    falseAirRisk,
  });
  const muffleRisk = Math.round(clamp(
    Math.max(0, presenceGapDb) * 24 +
      Math.max(0, clarityGapDb) * 24 +
      Math.max(0, airGapDb) * 8 +
      Math.max(0, -bodyGapDb - 1.2) * 12 +
      (falseAirRisk ? 18 : 0),
    0,
    100,
  ));

  return {
    status,
    bodyGapDb,
    presenceGapDb,
    clarityGapDb,
    airGapDb,
    falseAirRisk,
    muffleRisk,
    recommendations,
  };
}

function aggregateBands(reports: StemFeatureReport[], bands: MixDoctorBandId[]) {
  return averageDbAsPower(reports.map((report) => averageBands(report, bands)));
}

function averageBands(report: StemFeatureReport, bands: MixDoctorBandId[]) {
  return averageDbAsPower(bands.map((band) => report.bandEnergyDb[band]).filter((value) => Number.isFinite(value)));
}

function buildRecommendations(report: Pick<ReferenceClarityGapReport, "bodyGapDb" | "presenceGapDb" | "clarityGapDb" | "airGapDb" | "falseAirRisk">) {
  const recommendations: string[] = [];
  if (report.presenceGapDb > 1) {
    recommendations.push(`Reference Clarity: 2-5kHz is ${report.presenceGapDb.toFixed(1)}dB below Reference. Soften mastering presence cuts before adding Air.`);
  }
  if (report.clarityGapDb > 1.2) {
    recommendations.push(`Reference Clarity: 5-10kHz is ${report.clarityGapDb.toFixed(1)}dB below Reference. Reduce Harshness Guard before using high-shelf Air.`);
  }
  if (report.falseAirRisk) {
    recommendations.push("Reference Clarity: false Air risk. Restore 2-10kHz first; do not solve muffle by boosting only 12kHz+.");
  }
  if (report.bodyGapDb < -1.5 && report.presenceGapDb > 1.2) {
    recommendations.push("Reference Clarity: low-mid is already heavy while presence is behind. Clean 300-600Hz gently and lift 2-5kHz instead.");
  }
  if (report.airGapDb > 1.8 && !report.falseAirRisk) {
    recommendations.push(`Reference Clarity: 10-16kHz is ${report.airGapDb.toFixed(1)}dB below Reference. Add only a small air shelf after 2-10kHz is restored.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Reference Clarity: 2-10kHz is close enough; keep mastering tone changes gentle.");
  }
  return recommendations;
}
