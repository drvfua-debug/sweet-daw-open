import type { StemRole } from "@/daw/model/Project";
import { clamp, round1 } from "./mixDoctorAnalysisUtils";
import type {
  AmbienceSeatPlan,
  AmbienceSeatRole,
  AmbienceSeatTrackPlan,
  LowEndKingReport,
  MixDoctorTarget,
  PeakCulpritReport,
  StemContaminationReport,
  StemFeatureReport,
  StemPurityReport,
} from "./mixDoctorTypes";

type AmbienceSeatOptions = {
  target?: MixDoctorTarget;
  stemPurityReports?: StemPurityReport[];
  contaminationReports?: StemContaminationReport[];
  lowEndKingReport?: LowEndKingReport | null;
  peakCulpritReport?: PeakCulpritReport | null;
};

const DRY_ROLES = new Set<StemRole>(["vocal", "bass", "drums", "reference"]);
const NEAR_ROLES = new Set<StemRole>(["backingVocal", "guitar", "keys"]);
const SHARED_ROLES = new Set<StemRole>(["synth", "music", "loop", "other"]);

export function buildAmbienceSeatPlan(
  featureReports: StemFeatureReport[],
  options: AmbienceSeatOptions = {},
): AmbienceSeatPlan {
  const workReports = featureReports.filter((report) => report.role !== "reference");
  const purityByTrackId = new Map((options.stemPurityReports ?? []).map((report) => [report.trackId, report]));
  const contaminationByTrackId = new Map((options.contaminationReports ?? []).map((report) => [report.trackId, report]));
  const peakCulpritIds = new Set((options.peakCulpritReport?.topCulprits ?? []).map((item) => item.trackId));
  const tracks = workReports.map((report) =>
    buildTrackSeat(report, {
      purity: purityByTrackId.get(report.trackId),
      contamination: contaminationByTrackId.get(report.trackId),
      lowEndKingReport: options.lowEndKingReport ?? null,
      peakIsCulprit: peakCulpritIds.has(report.trackId),
    }),
  );

  const warnings = tracks.flatMap((track) => track.warnings);
  const activeSupportCount = tracks.filter((track) => track.seat !== "no_send" && track.sendDb > -30).length;
  const blockedCount = tracks.filter((track) => track.seat === "no_send").length;
  const status: AmbienceSeatPlan["status"] = options.lowEndKingReport?.status === "fail" || options.peakCulpritReport?.status === "fail"
    ? "warn"
    : warnings.length > 0
      ? "warn"
      : "pass";

  return {
    status,
    busPreset: chooseBusPreset(options.target),
    tracks,
    globalLowCutHz: 180,
    globalHighCutHz: options.target === "dark_electronic" ? 9000 : 12000,
    warnings: warnings.slice(0, 6),
    recommendations: [
      `Ambience Seat: Vocal / Bass / Kick protected dry; ${activeSupportCount} support track(s) sent; ${blockedCount} blocked.`,
      options.lowEndKingReport?.status === "fail"
        ? "Low-end conflict detected, so ambience sends stay extra conservative."
        : "Low-end owner is not blocking the ambience plan.",
      options.peakCulpritReport?.status === "fail"
        ? "Peak culprit detected, so ambience avoids adding limiter load."
        : "Peak culprit did not require ambience blocking.",
    ],
  };
}

function buildTrackSeat(
  report: StemFeatureReport,
  context: {
    purity?: StemPurityReport;
    contamination?: StemContaminationReport;
    lowEndKingReport: LowEndKingReport | null;
    peakIsCulprit: boolean;
  },
): AmbienceSeatTrackPlan {
  const warnings: string[] = [];
  const purityScore = context.purity?.purityScore ?? 100;
  const roomWash = context.contamination?.roomWashScore ?? 0;
  const cymbalMetallic = context.contamination?.cymbalMetallicScore ?? 0;
  const lowRisk = context.contamination?.lowEndContaminationScore ?? 0;
  let seat = chooseBaseSeat(report.role);
  let sendDb = baseSendDb(seat, report.role);
  let preDelayMs = seat === "far_texture" ? 24 : seat === "shared_room" ? 16 : seat === "near_support" ? 10 : 0;
  let lowCutHz = seat === "far_texture" ? 240 : seat === "shared_room" ? 210 : 180;
  let highCutHz = seat === "far_texture" ? 11500 : 12500;
  let width = seat === "far_texture" ? 0.34 : seat === "shared_room" ? 0.22 : seat === "near_support" ? 0.14 : 0;

  if (purityScore < 45 || roomWash >= 64 || cymbalMetallic >= 72) {
    seat = "no_send";
    sendDb = -96;
    warnings.push(`${report.trackName}: ambience blocked because purity/room wash is risky.`);
  } else if (purityScore < 65 || roomWash >= 52 || lowRisk >= 58) {
    sendDb = Math.min(sendDb, -26);
    width *= 0.65;
    warnings.push(`${report.trackName}: ambience reduced by purity or contamination guard.`);
  }

  if (context.lowEndKingReport?.status === "fail" && (report.role === "bass" || report.role === "drums" || lowRisk >= 48)) {
    seat = "no_send";
    sendDb = -96;
    warnings.push(`${report.trackName}: ambience blocked by Low-End King guard.`);
  }

  if (context.peakIsCulprit) {
    sendDb = Math.min(sendDb, -28);
    width *= 0.5;
    warnings.push(`${report.trackName}: ambience reduced because it is a peak culprit.`);
  }

  if (seat === "dry_anchor" && sendDb > -28) sendDb = -28;
  if (seat === "no_send") {
    preDelayMs = 0;
    width = 0;
  }

  return {
    trackId: report.trackId,
    trackName: report.trackName,
    role: report.role,
    seat,
    sendDb: round1(sendDb),
    preDelayMs: Math.round(preDelayMs),
    lowCutHz: Math.round(lowCutHz),
    highCutHz: Math.round(highCutHz),
    width: round1(clamp(width, 0, 0.5)),
    reason: buildReason(report.role, seat),
    warnings,
  };
}

function chooseBaseSeat(role: StemRole): AmbienceSeatRole {
  if (role === "reference" || role === "bass") return "no_send";
  if (role === "vocal" || role === "drums") return "dry_anchor";
  if (NEAR_ROLES.has(role)) return "near_support";
  if (SHARED_ROLES.has(role)) return "shared_room";
  if (role === "fx") return "far_texture";
  if (DRY_ROLES.has(role)) return "dry_anchor";
  return "shared_room";
}

function baseSendDb(seat: AmbienceSeatRole, role: StemRole) {
  if (seat === "no_send") return -96;
  if (seat === "dry_anchor") return role === "drums" ? -30 : -32;
  if (seat === "near_support") return -22;
  if (seat === "shared_room") return -20;
  return -18;
}

function buildReason(role: StemRole, seat: AmbienceSeatRole) {
  if (seat === "no_send") return "Keep this source dry so it does not smear the center or low end.";
  if (seat === "dry_anchor") return `${role} stays mostly dry as an anchor; any room is below the audible foreground.`;
  if (seat === "near_support") return `${role} gets a short, quiet shared room behind the lead.`;
  if (seat === "shared_room") return `${role} can share a clean room while low band stays protected.`;
  return `${role} can sit farther back as texture without carrying low end.`;
}

function chooseBusPreset(target?: MixDoctorTarget): AmbienceSeatPlan["busPreset"] {
  if (target === "dark_electronic") return "dark_space";
  if (target === "wide_pop") return "wide_air";
  if (target === "tight_rock" || target === "streaming_safe") return "tight_room";
  return "clean_plate";
}
