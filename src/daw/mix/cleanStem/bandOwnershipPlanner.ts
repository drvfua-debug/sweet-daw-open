import type { Project, StemRole, Track } from "@/daw/model/Project";
import type { MixDoctorBandId, StemFeatureReport } from "@/daw/mix/mixDoctorTypes";
import type { EffectiveStemRole } from "./effectiveRole";
import { getEffectiveRoleForTrack, isCenterProtectedRole } from "./effectiveRole";

export type BandOwnerPlan = {
  bandId: MixDoctorBandId;
  primaryTrackId: string | null;
  secondaryTrackIds: string[];
  cuts: Array<{
    trackId: string;
    frequency: number;
    gainDb: number;
    q: number;
    reason: string;
  }>;
};

export type BandOwnershipPlannerOptions = {
  stemFeatureReports?: StemFeatureReport[];
};

const CLEAN_REBUILD_BANDS: MixDoctorBandId[] = [
  "60-120",
  "120-250",
  "250-500",
  "1500-3000",
  "5000-9000",
  "12000-16000",
];

export function buildBandOwnershipPlan(
  project: Project,
  effectiveRoles: EffectiveStemRole[],
  options: BandOwnershipPlannerOptions = {},
): BandOwnerPlan[] {
  const tracks = project.tracks.filter((track) => track.role !== "reference" && !track.mute);
  const featureByTrackId = new Map((options.stemFeatureReports ?? []).map((report) => [report.trackId, report]));
  return CLEAN_REBUILD_BANDS.map((bandId) => {
    const ranked = tracks
      .map((track) => ({
        track,
        role: getEffectiveRoleForTrack(track.id, effectiveRoles, track.role),
        score: scoreBandOwner(track, getEffectiveRoleForTrack(track.id, effectiveRoles, track.role), bandId, featureByTrackId.get(track.id)),
      }))
      .sort((left, right) => right.score - left.score);
    const primary = ranked[0]?.score > 0 ? ranked[0] : null;
    const secondary = ranked.filter((entry) => entry.track.id !== primary?.track.id && entry.score >= primaryScoreFloor(bandId)).slice(0, bandId === "60-120" ? 1 : 2);
    const cuts = tracks.flatMap((track) => {
      const role = getEffectiveRoleForTrack(track.id, effectiveRoles, track.role);
      if (track.id === primary?.track.id || secondary.some((entry) => entry.track.id === track.id)) return [];
      return buildBandCuts(track, role, bandId, featureByTrackId.get(track.id), primary?.track.id ?? null);
    });
    return {
      bandId,
      primaryTrackId: primary?.track.id ?? null,
      secondaryTrackIds: secondary.map((entry) => entry.track.id),
      cuts,
    };
  });
}

function scoreBandOwner(track: Track, role: StemRole, bandId: MixDoctorBandId, feature: StemFeatureReport | undefined) {
  const measured = feature?.bandEnergyDb?.[bandId] ?? -60;
  const measuredScore = Number.isFinite(measured) ? clamp((measured + 42) / 18, 0, 2) : 0;
  if (bandId === "60-120") {
    if (role === "bass") return 8 + measuredScore;
    if (role === "drums") return 5.5 + measuredScore;
    return measuredScore - 0.8;
  }
  if (bandId === "120-250") {
    if (role === "bass" || role === "keys" || role === "synth") return 5 + measuredScore;
    if (role === "vocal" || role === "backingVocal") return 2 + measuredScore;
    return 3 + measuredScore;
  }
  if (bandId === "250-500") {
    if (role === "vocal" || role === "bass" || role === "keys" || role === "guitar") return 5 + measuredScore;
    return 3 + measuredScore;
  }
  if (bandId === "1500-3000") {
    if (role === "vocal") return 8 + measuredScore;
    if (role === "guitar" || role === "synth" || role === "keys") return 4 + measuredScore;
    return 2 + measuredScore;
  }
  if (bandId === "5000-9000") {
    if (role === "drums" || role === "vocal" || role === "guitar") return 5 + measuredScore;
    return 3 + measuredScore;
  }
  if (bandId === "12000-16000") {
    if (role === "fx" || role === "music" || role === "synth" || role === "keys") return 4 + measuredScore;
    if (role === "vocal") return 3 + measuredScore;
    return 2 + measuredScore;
  }
  return measuredScore;
}

function primaryScoreFloor(bandId: MixDoctorBandId) {
  return bandId === "60-120" ? 5 : 4.8;
}

function buildBandCuts(
  track: Track,
  role: StemRole,
  bandId: MixDoctorBandId,
  feature: StemFeatureReport | undefined,
  primaryTrackId: string | null,
): BandOwnerPlan["cuts"] {
  if (!primaryTrackId) return [];
  const cuts: BandOwnerPlan["cuts"] = [];
  const energy = feature?.bandEnergyDb?.[bandId] ?? -24;
  const energetic = energy > -32;

  if (bandId === "60-120" && !isCenterProtectedRole(role)) {
    cuts.push(cut(track.id, 90, energetic ? -0.8 : -0.45, 0.8, "Low band is reserved for bass/kick-like owners; support low energy is cleaned."));
  }
  if (bandId === "120-250" && role !== "bass" && energetic) {
    cuts.push(cut(track.id, 185, role === "vocal" || role === "backingVocal" ? -0.45 : -0.35, 0.95, "Low-mid ownership is reduced to avoid boxy buildup."));
  }
  if (bandId === "250-500" && role !== "bass") {
    cuts.push(cut(track.id, 360, energetic ? -0.85 : -0.45, 0.9, "Body band owner is limited; support body is lightly reduced."));
  }
  if (bandId === "1500-3000" && role !== "vocal" && role !== "backingVocal") {
    cuts.push(cut(track.id, role === "guitar" ? 2300 : 2600, -0.55, 1.05, "Lead vocal and main melody keep the presence lane."));
  }
  if (bandId === "5000-9000" && role !== "vocal" && energetic) {
    cuts.push(cut(track.id, 7600, -0.35, 1.6, "High band harshness guard; no broad air boost."));
  }
  return cuts;
}

function cut(trackId: string, frequency: number, gainDb: number, q: number, reason: string) {
  return {
    trackId,
    frequency,
    gainDb: round2(clamp(gainDb, -1.5, 1.5)),
    q,
    reason,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
