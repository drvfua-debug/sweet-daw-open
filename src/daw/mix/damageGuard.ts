import type { DamageGuardReport, PerceptualScoreReport } from "./mixDoctorTypes";
import { clamp, round1 } from "./mixDoctorAnalysisUtils";

export function evaluateDamageGuard(
  before: PerceptualScoreReport,
  after: PerceptualScoreReport,
  targetIds: string[],
): DamageGuardReport {
  const warnings: string[] = [];
  if (after.clarity < before.clarity - 2) warnings.push("Clarity dropped after the proposed changes.");
  if (after.body < before.body - 2) warnings.push("Body dropped after the proposed changes.");
  if (after.stereoImage < before.stereoImage - 4) warnings.push("Stereo image narrowed too much.");
  if (after.harshness > before.harshness + 2) warnings.push("Harshness increased.");
  if (after.mud > before.mud + 2) warnings.push("Mud increased.");
  if (after.peakSafety < before.peakSafety - 3) warnings.push("Peak safety worsened.");

  const severe = warnings.some((warning) => /increased|narrowed|dropped|worsened/i.test(warning));
  const allowed = !severe && after.peakSafety >= 45;
  const actions = targetIds.map((targetId) => {
    if (allowed) {
      return {
        targetId,
        type: "preserve" as const,
        reason: "Damage Guard accepted the change.",
      };
    }

    const peakCollapse = after.peakSafety < before.peakSafety - 8 || after.peakSafety < 38;
    const mudOrClarity = after.mud > before.mud + 3 || after.clarity < before.clarity - 4;
    return {
      targetId,
      type: peakCollapse || mudOrClarity ? "bypass" as const : "weaken" as const,
      reason: buildActionReason(before, after),
    };
  });

  if (warnings.length === 0) {
    warnings.push("Damage Guard did not detect a harmful regression.");
  }

  return {
    allowed,
    before: normalize(before),
    after: normalize(after),
    warnings,
    actions,
  };
}

function buildActionReason(before: PerceptualScoreReport, after: PerceptualScoreReport) {
  if (after.peakSafety < before.peakSafety - 8 || after.peakSafety < 38) {
    return "Bypass loudness or density moves because peak safety fell too far.";
  }
  if (after.mud > before.mud + 3) {
    return "Bypass ambience or low-end moves because mud increased.";
  }
  if (after.clarity < before.clarity - 4) {
    return "Bypass space or width moves because clarity dropped.";
  }
  if (after.harshness > before.harshness + 2) {
    return "Weaken air, presence, or exciter moves because harshness increased.";
  }
  if (after.body < before.body - 2) {
    return "Weaken cuts or widening because body dropped.";
  }
  return "Damage Guard asked to weaken the change.";
}

function normalize(score: PerceptualScoreReport) {
  return {
    clarity: round1(clamp(score.clarity, 0, 100)),
    body: round1(clamp(score.body, 0, 100)),
    stereoImage: round1(clamp(score.stereoImage, 0, 100)),
    harshness: round1(clamp(score.harshness, 0, 100)),
    mud: round1(clamp(score.mud, 0, 100)),
    peakSafety: round1(clamp(score.peakSafety, 0, 100)),
  };
}
