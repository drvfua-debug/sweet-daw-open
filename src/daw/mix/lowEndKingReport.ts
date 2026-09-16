import type { Project, StemRole } from "@/daw/model/Project";
import { averageDbAsPower } from "./loudnessApprox";
import { clamp, round1 } from "./mixDoctorAnalysisUtils";
import type { LowEndKingOwner, LowEndKingReport, StemFeatureReport } from "./mixDoctorTypes";

const SUPPORT_LOW_ROLES = new Set<StemRole>(["guitar", "synth", "keys", "music", "loop", "other", "fx", "backingVocal"]);

export function analyzeLowEndKing(featureReports: StemFeatureReport[], _project?: Project): LowEndKingReport {
  const workReports = featureReports.filter((report) => report.role !== "reference");
  if (workReports.length === 0) {
    return emptyReport("unknown", "Low-End King: import stems before judging the 20-60Hz owner.");
  }

  const kick = strongestByRole(workReports, "drums");
  const bass = strongestByRole(workReports, "bass");
  const kickSub = kick ? sub2060(kick) : -60;
  const bassSub = bass ? sub2060(bass) : -60;
  const strongest = strongestSub(workReports);
  const supportSub = workReports.filter((report) => SUPPORT_LOW_ROLES.has(report.role));
  const supportLowRisk = supportSub.reduce((risk, report) => Math.max(risk, supportSubRisk(report)), 0);
  const supportMud = supportSub.length > 0 ? averageDbAsPower(supportSub.map((report) => averageDbAsPower([report.bandEnergyDb["120-250"], report.bandEnergyDb["250-500"]]))) : -60;
  const subConflictDb = round1(Math.abs(kickSub - bassSub));
  const bothStrong = kickSub > -14 && bassSub > -14;
  const owner = chooseOwner(kick, bass, kickSub, bassSub, bothStrong, subConflictDb, strongest);
  const monoLowRisk = clamp(Math.max(owner === "shared" ? 88 : 0, supportLowRisk, strongest ? lowBandPressure(strongest) : 0), 0, 100);
  const phaseRisk = clamp((owner === "shared" ? 62 : 18) + supportLowRisk * 0.22 + Math.max(0, -9 - averageSub(workReports)) * 0.8, 0, 100);
  const limiterStressFromLowEnd = clamp((owner === "shared" ? 72 : 20) + monoLowRisk * 0.38 + Math.max(0, supportMud + 10) * 2.2, 0, 100);
  const status: LowEndKingReport["status"] = owner === "shared" || limiterStressFromLowEnd >= 78
    ? "fail"
    : monoLowRisk >= 58 || supportLowRisk >= 52 || owner === "unknown"
      ? "warn"
      : "pass";

  return {
    owner,
    kickTrackId: kick?.trackId ?? null,
    bassTrackId: bass?.trackId ?? null,
    kickTrackName: kick?.trackName ?? null,
    bassTrackName: bass?.trackName ?? null,
    sub2060ConflictDb: Number.isFinite(subConflictDb) ? subConflictDb : 0,
    sub2035Db: round1(averageDbAsPower(workReports.map((report) => report.bandEnergyDb["20-35"]))),
    sub3560Db: round1(averageDbAsPower(workReports.map((report) => report.bandEnergyDb["35-60"]))),
    low60120Db: round1(averageDbAsPower(workReports.map((report) => report.bandEnergyDb["60-120"]))),
    lowMid120250MudDb: round1(averageDbAsPower(workReports.map((report) => report.bandEnergyDb["120-250"]))),
    monoLowRisk: Math.round(monoLowRisk),
    phaseRisk: Math.round(phaseRisk),
    limiterStressFromLowEnd: Math.round(limiterStressFromLowEnd),
    status,
    recommendations: buildRecommendations(owner, kick, bass, supportSub, supportLowRisk, status),
  };
}

function chooseOwner(
  kick: StemFeatureReport | null,
  bass: StemFeatureReport | null,
  kickSub: number,
  bassSub: number,
  bothStrong: boolean,
  subConflictDb: number,
  strongest: StemFeatureReport | null,
): LowEndKingOwner {
  if (kick && bass && bothStrong && subConflictDb <= 1.5) return "shared";
  if (kick && (!bass || kickSub >= bassSub + 2 || (kickSub > -13 && bassSub <= -16))) return "kick";
  if (bass && (!kick || bassSub >= kickSub + 2 || (bassSub > -13 && kickSub <= -16))) return "bass";
  if (!kick && !bass && strongest && sub2060(strongest) > -14) return "unknown";
  if (!kick && !bass) return "none";
  if (kick && bass && Math.max(kickSub, bassSub) <= -18) return "none";
  return "unknown";
}

function strongestByRole(reports: StemFeatureReport[], role: StemRole) {
  return strongestSub(reports.filter((report) => report.role === role));
}

function strongestSub(reports: StemFeatureReport[]) {
  return reports.reduce<StemFeatureReport | null>((winner, report) => {
    if (!winner) return report;
    return sub2060(report) > sub2060(winner) ? report : winner;
  }, null);
}

function sub2060(report: StemFeatureReport) {
  return averageDbAsPower([report.bandEnergyDb["20-35"], report.bandEnergyDb["35-60"]]);
}

function averageSub(reports: StemFeatureReport[]) {
  return averageDbAsPower(reports.map((report) => sub2060(report)));
}

function lowBandPressure(report: StemFeatureReport) {
  const sub = sub2060(report);
  const low = report.bandEnergyDb["60-120"];
  return clamp((sub + 18) * 6 + (low + 16) * 3, 0, 100);
}

function supportSubRisk(report: StemFeatureReport) {
  const sub = sub2060(report);
  const lowMid = averageDbAsPower([report.bandEnergyDb["120-250"], report.bandEnergyDb["250-500"]]);
  return clamp((sub + 18) * 8 + Math.max(0, lowMid + 12) * 3, 0, 100);
}

function buildRecommendations(
  owner: LowEndKingOwner,
  kick: StemFeatureReport | null,
  bass: StemFeatureReport | null,
  supportSub: StemFeatureReport[],
  supportLowRisk: number,
  status: LowEndKingReport["status"],
) {
  const recommendations: string[] = [];
  if (owner === "shared") {
    recommendations.push("Low-End King: 20-60Hz is shared by drums and bass. Choose one owner before adding master gain.");
  } else if (owner === "bass") {
    recommendations.push(`Low-End King: ${bass?.trackName ?? "Bass"} owns 20-60Hz. Keep kick attack above 80-120Hz and avoid sub boost.`);
  } else if (owner === "kick") {
    recommendations.push(`Low-End King: ${kick?.trackName ?? "Drums"} owns 20-60Hz. Keep bass body around 80-160Hz and avoid 35-60Hz overlap.`);
  } else if (owner === "none") {
    recommendations.push("Low-End King: no strong 20-60Hz owner was detected. Avoid adding master low boost until the foundation is confirmed.");
  } else {
    recommendations.push("Low-End King: the 20-60Hz owner is unclear. Keep sub moves conservative and inspect kick/bass roles.");
  }
  if (supportLowRisk >= 45) {
    const names = supportSub
      .filter((report) => supportSubRisk(report) >= 35)
      .slice(0, 2)
      .map((report) => report.trackName)
      .join(", ");
    recommendations.push(`Low-End King: support stem${names ? ` (${names})` : ""} has unnecessary sub. Apply a small high-pass or low shelf cut before widening.`);
  }
  if (status === "fail") {
    recommendations.push("Low-End King: do not use limiter gain to solve low-end overlap; clean the sub lane first.");
  }
  return recommendations.slice(0, 4);
}

function emptyReport(owner: LowEndKingOwner, message: string): LowEndKingReport {
  return {
    owner,
    kickTrackId: null,
    bassTrackId: null,
    kickTrackName: null,
    bassTrackName: null,
    sub2060ConflictDb: 0,
    sub2035Db: -60,
    sub3560Db: -60,
    low60120Db: -60,
    lowMid120250MudDb: -60,
    monoLowRisk: 0,
    phaseRisk: 0,
    limiterStressFromLowEnd: 0,
    status: "warn",
    recommendations: [message],
  };
}
