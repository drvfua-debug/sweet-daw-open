import type { ReferenceDelta, ReferenceProfile, StemFeatureReport } from "../mixDoctorTypes";
import { clamp, round1 } from "../mixDoctorAnalysisUtils";

export function buildReferenceDelta(
  mixReports: StemFeatureReport[],
  referenceProfile: ReferenceProfile | null,
): ReferenceDelta | null {
  if (!referenceProfile || mixReports.length === 0) return null;

  const mixAverage = averageReport(mixReports);
  const referenceAverage = averageReport([referenceProfile]);
  const lowEndDeltaDb = round1(referenceAverage.lowEnd - mixAverage.lowEnd);
  const bodyDeltaDb = round1(referenceAverage.body - mixAverage.body);
  const presenceDeltaDb = round1(referenceAverage.presence - mixAverage.presence);
  const airDeltaDb = round1(referenceAverage.air - mixAverage.air);

  return {
    loudnessDeltaDb: round1(referenceAverage.loudness - mixAverage.loudness),
    peakDeltaDb: round1(referenceAverage.peak - mixAverage.peak),
    crestFactorDeltaDb: round1(referenceAverage.crestFactor - mixAverage.crestFactor),
    lowEndDeltaDb,
    bodyDeltaDb,
    presenceDeltaDb,
    airDeltaDb,
    stereoWidthDelta: round1(referenceAverage.stereoWidth - mixAverage.stereoWidth),
    correlationDelta: round2(clamp(referenceAverage.correlation - mixAverage.correlation, -1, 1)),
    advisory: buildAdvisory(lowEndDeltaDb, bodyDeltaDb, presenceDeltaDb, airDeltaDb),
  };
}

function averageReport(reports: Array<Pick<StemFeatureReport, "integratedLufsApprox" | "peakDb" | "crestFactorDb" | "sideMidRatioDb" | "lrCorrelation" | "stereoWidthScore" | "bandEnergyDb">>) {
  const count = Math.max(1, reports.length);
  const lowEnd = bandGroupEnergyDb(reports, ["35-60", "60-120"]);
  const body = bandGroupEnergyDb(reports, ["120-250", "250-500"]);
  const presence = bandGroupEnergyDb(reports, ["1500-3000", "3000-5000"]);
  const air = bandGroupEnergyDb(reports, ["5000-9000", "9000-12000", "12000-16000"]);
  const loudness = energySumDb(reports.map((report) => report.integratedLufsApprox));
  const peak = Math.max(...reports.map((report) => report.peakDb));
  const crestFactor = reports.reduce((sum, report) => sum + report.crestFactorDb, 0) / count;
  const stereoWidth = reports.reduce((sum, report) => sum + report.stereoWidthScore, 0) / count;
  const correlation = reports.reduce((sum, report) => sum + report.lrCorrelation, 0) / count;

  return {
    lowEnd,
    body,
    presence,
    air,
    loudness,
    peak,
    crestFactor,
    stereoWidth,
    correlation,
  };
}

function bandGroupEnergyDb(
  reports: Array<Pick<StemFeatureReport, "bandEnergyDb">>,
  bands: Array<keyof StemFeatureReport["bandEnergyDb"]>,
) {
  return energySumDb(reports.flatMap((report) => bands.map((band) => report.bandEnergyDb[band])));
}

function energySumDb(values: number[]) {
  const energy = values.reduce((sum, value) => sum + 10 ** (value / 10), 0);
  return 10 * Math.log10(Math.max(1e-12, energy));
}

function buildAdvisory(lowEndDeltaDb: number, bodyDeltaDb: number, presenceDeltaDb: number, airDeltaDb: number) {
  const advisory: string[] = [];
  if (airDeltaDb > 1.2) advisory.push("Reference suggests more air, but keep the lift conservative.");
  if (lowEndDeltaDb > 1.2) advisory.push("Reference suggests more low-end, but check kick/bass separation first.");
  if (bodyDeltaDb < -1.2) advisory.push("Reference is leaner in the body range; do not strip body blindly.");
  if (presenceDeltaDb > 1.0) advisory.push("Reference is more forward in the presence range; apply only after bleed checks.");
  if (advisory.length === 0) advisory.push("Reference delta is small enough for advisory use only.");
  return advisory;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
