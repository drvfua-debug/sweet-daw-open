import type { ABCompareReport, BandEnergyMap, MixDoctorMode, ReferenceDelta, ReferenceProfile, StemFeatureReport } from "../mixDoctorTypes";
import { clamp, getBandKeys, round1 } from "../mixDoctorAnalysisUtils";
import { buildLoudnessMatchReport } from "./loudnessMatch";
import { buildReferenceDelta } from "./referenceDelta";
import { buildReferenceRepairDiagnosis } from "./referenceRepair";

export type ReferenceAnalysisResult = {
  referenceProfile: ReferenceProfile | null;
  loudnessMatchReport: ReturnType<typeof buildLoudnessMatchReport>;
  referenceDelta: ReferenceDelta | null;
  referenceRepair: ReturnType<typeof buildReferenceRepairDiagnosis>;
  abCompareReport: ABCompareReport | null;
};

export function analyzeReferenceMix(
  mixReports: StemFeatureReport[],
  mode: MixDoctorMode,
): ReferenceAnalysisResult {
  const referenceProfile = buildReferenceProfile(mixReports);
  const loudnessMatchReport = buildLoudnessMatchReport(mixReports.filter((report) => report.role !== "reference"), referenceProfile, mode);
  const referenceDelta = buildReferenceDelta(mixReports.filter((report) => report.role !== "reference"), referenceProfile);
  const referenceRepair = buildReferenceRepairDiagnosis(mixReports, referenceProfile);
  const abCompareReport = buildAbCompareReport(loudnessMatchReport);

  return {
    referenceProfile,
    loudnessMatchReport,
    referenceDelta,
    referenceRepair,
    abCompareReport,
  };
}

export function buildReferenceProfile(mixReports: StemFeatureReport[]): ReferenceProfile | null {
  const reference = mixReports.find((report) => report.role === "reference");
  if (!reference) return null;

  return {
    ...reference,
    sourceRole: reference.role,
    loudnessTargetLabel: "reference-range",
    targetRanges: buildTargetRanges(reference.bandEnergyDb),
  };
}

function buildTargetRanges(bandEnergyDb: BandEnergyMap) {
  const ranges = {} as Partial<Record<keyof BandEnergyMap, [number, number]>>;
  for (const bandId of getBandKeys()) {
    const value = bandEnergyDb[bandId];
    const margin = bandId === "20-35" || bandId === "35-60" || bandId === "60-120" ? 1.2 : bandId === "120-250" || bandId === "250-500" ? 1.1 : 0.9;
    ranges[bandId] = [round1(value - margin), round1(value + margin)];
  }
  return ranges;
}

function buildAbCompareReport(loudnessMatchReport: ReturnType<typeof buildLoudnessMatchReport>): ABCompareReport | null {
  if (!loudnessMatchReport) return null;

  return {
    beforeLabel: "Current Mix",
    afterLabel: "Reference Matched",
    loudnessMatched: Math.abs(loudnessMatchReport.afterMatchDiffDb) <= 0.75,
    gainCompensationDb: loudnessMatchReport.appliedGainDb,
    notes: [
      "A/B is loudness matched before comparing tone.",
      "Reference gain match is direct; hard limiting is controlled separately.",
    ],
  };
}

export function buildReferenceBandSummary(bandEnergyDb: BandEnergyMap) {
  return getBandKeys().reduce((acc, bandId) => {
    acc[bandId] = clamp(bandEnergyDb[bandId], -24, 0);
    return acc;
  }, {} as BandEnergyMap);
}
