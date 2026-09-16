import type { StemRole } from "@/daw/model/Project";
import { clamp, round1 } from "./mixDoctorAnalysisUtils";
import type { PeakCulpritAction, PeakCulpritItem, PeakCulpritReport, StemFeatureReport, StemMixScore } from "./mixDoctorTypes";

type PeakCulpritOptions = {
  lufsShortfallDb?: number | null;
};

export function analyzePeakCulprits(
  featureReports: StemFeatureReport[],
  stemScores: StemMixScore[] = [],
  options: PeakCulpritOptions = {},
): PeakCulpritReport {
  const workReports = featureReports.filter((report) => report.role !== "reference");
  if (workReports.length === 0) {
    return {
      status: "pass",
      topCulprits: [],
      limiterLoadRisk: 0,
      densityShortfallLikely: false,
      recommendations: ["Peak Culprit: import stems before judging limiter stress."],
    };
  }

  const scoreByTrackId = new Map(stemScores.map((score) => [score.trackId, score]));
  const lufsShortfallDb = options.lufsShortfallDb ?? null;
  const densityShortfallLikely = Boolean(
    lufsShortfallDb !== null &&
    lufsShortfallDb > 0.8 &&
    workReports.some((report) => report.truePeakApproxDb > -1.2),
  );
  const items = workReports
    .map((report) => buildItem(report, scoreByTrackId.get(report.trackId), densityShortfallLikely))
    .sort((a, b) => b.limiterStressScore - a.limiterStressScore);
  const topCulprits = items.filter((item) => item.limiterStressScore >= 18 || item.action !== "leave").slice(0, 4);
  const limiterLoadRisk = Math.round(clamp(items[0]?.limiterStressScore ?? 0, 0, 100));
  const status: PeakCulpritReport["status"] = densityShortfallLikely || limiterLoadRisk >= 48
    ? "fail"
    : limiterLoadRisk >= 28
      ? "warn"
      : "pass";

  return {
    status,
    topCulprits,
    limiterLoadRisk,
    densityShortfallLikely,
    recommendations: buildRecommendations(topCulprits, densityShortfallLikely, status),
  };
}

function buildItem(report: StemFeatureReport, score: StemMixScore | undefined, densityShortfallLikely: boolean): PeakCulpritItem {
  const peakDb = score?.peak ?? report.peakDb;
  const rmsDb = score?.rms ?? report.rmsDb;
  const crestFactorDb = score?.crestFactor ?? report.crestFactorDb;
  const truePeakApproxDb = report.truePeakApproxDb;
  const limiterStressScore = round1(
    clamp(
      Math.max(0, truePeakApproxDb + 1) * 22 +
        Math.max(0, crestFactorDb - 11) * 5 +
        roleWeight(report.role),
      0,
      100,
    ),
  );
  const action = chooseAction(report.role, truePeakApproxDb, crestFactorDb, peakDb, densityShortfallLikely);
  return {
    trackId: report.trackId,
    trackName: report.trackName,
    role: report.role,
    peakDb: round1(peakDb),
    truePeakApproxDb: round1(truePeakApproxDb),
    rmsDb: round1(rmsDb),
    crestFactorDb: round1(crestFactorDb),
    limiterStressScore,
    action,
    reason: buildReason(report.role, action, truePeakApproxDb, crestFactorDb),
  };
}

function chooseAction(
  role: StemRole,
  truePeakApproxDb: number,
  crestFactorDb: number,
  peakDb: number,
  densityShortfallLikely: boolean,
): PeakCulpritAction {
  if (densityShortfallLikely && truePeakApproxDb > -1.2) return "density_before_gain";
  if (truePeakApproxDb > -1 && crestFactorDb > 11) return "clip_before_limiter";
  if (role === "drums" && crestFactorDb > 12.5) return "transient_shape";
  if (peakDb > -2 && crestFactorDb <= 10.5) return "gain_down";
  return "leave";
}

function buildReason(role: StemRole, action: PeakCulpritAction, truePeakApproxDb: number, crestFactorDb: number) {
  if (action === "density_before_gain") {
    return "LUFS is still short while this stem is already close to the ceiling; improve density before adding master gain.";
  }
  if (action === "clip_before_limiter") {
    return `${role} has high crest and true peak near the limiter ceiling. Shape peaks before limiter gain.`;
  }
  if (action === "transient_shape") {
    return "Drum crest is high enough to hit the limiter before the mix feels loud.";
  }
  if (action === "gain_down") {
    return "Peak is hot but crest is not very high. A small gain trim is safer than limiter push.";
  }
  return `Peak headroom is acceptable (${round1(truePeakApproxDb)}dBTP approx / crest ${round1(crestFactorDb)}dB).`;
}

function buildRecommendations(topCulprits: PeakCulpritItem[], densityShortfallLikely: boolean, status: PeakCulpritReport["status"]) {
  if (topCulprits.length === 0) {
    return ["Peak Culprit: no stem is strongly driving limiter load."];
  }
  const lines: string[] = [];
  const top = topCulprits[0];
  if (densityShortfallLikely) {
    lines.push("Peak Culprit: LUFS is short but true peak is already near ceiling. Improve density before pushing limiter.");
  }
  if (top.role === "drums") {
    lines.push(`Peak Culprit: ${top.trackName} is hitting the ceiling first. Shape or clip peaks before limiter gain.`);
  } else if (top.role === "bass") {
    lines.push(`Peak Culprit: ${top.trackName} is driving limiter load. Do not add master gain until low-end peak is controlled.`);
  } else {
    lines.push(`Peak Culprit: ${top.trackName} is the top limiter stress source. Use ${top.action.replace(/_/g, " ")} before master gain.`);
  }
  if (status === "fail") {
    lines.push("Peak Culprit: keep Magic Polish and mastering gain conservative until the culprit is controlled.");
  }
  return lines.slice(0, 4);
}

function roleWeight(role: StemRole) {
  const weights: Record<StemRole, number> = {
    drums: 18,
    bass: 14,
    vocal: 8,
    backingVocal: 8,
    guitar: 6,
    synth: 6,
    keys: 6,
    music: 6,
    loop: 6,
    other: 6,
    fx: 4,
    reference: 0,
  };
  return weights[role];
}
