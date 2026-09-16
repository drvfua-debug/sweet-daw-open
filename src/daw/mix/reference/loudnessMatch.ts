import type { LoudnessMatchReport, MixDoctorMode, ReferenceProfile, StemFeatureReport } from "../mixDoctorTypes";
import { round1 } from "../mixDoctorAnalysisUtils";

export function buildLoudnessMatchReport(
  mixReports: StemFeatureReport[],
  referenceProfile: ReferenceProfile | null,
  mode: MixDoctorMode,
): LoudnessMatchReport | null {
  if (!referenceProfile || mixReports.length === 0) return null;

  const mixLufsApprox = energySumDb(mixReports.map((report) => report.integratedLufsApprox));
  const referenceLufsApprox = referenceProfile.integratedLufsApprox;
  const beforeMatchDiffDb = referenceLufsApprox - mixLufsApprox;
  void mode;
  const matchAmount = 1;
  const appliedGainDb = round1(beforeMatchDiffDb);
  const afterMatchDiffDb = round1(beforeMatchDiffDb - appliedGainDb);
  const notes = [
    "Reference gain is matched directly without partial scaling.",
    "Hard limiting is controlled separately by the user; this report only describes the gain difference.",
  ];

  return {
    mode,
    currentLufsApprox: round1(mixLufsApprox),
    referenceLufsApprox: round1(referenceLufsApprox),
    appliedGainDb,
    matchAmount,
    beforeMatchDiffDb: round1(beforeMatchDiffDb),
    afterMatchDiffDb,
    notes,
  };
}

function energySumDb(values: number[]) {
  const energy = values.reduce((sum, value) => sum + 10 ** (value / 10), 0);
  return 10 * Math.log10(Math.max(1e-12, energy));
}
