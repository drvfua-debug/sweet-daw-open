import type { Project, StemRole } from "@/daw/model/Project";
import type { StemFeatureReport } from "@/daw/mix/mixDoctorTypes";
import type { EffectiveStemRole } from "./effectiveRole";
import { getEffectiveRoleForTrack, isCenterProtectedRole } from "./effectiveRole";

export type PlacementPlan = {
  trackId: string;
  effectiveRole: StemRole;
  centerProtection: "hard-center" | "soft-center" | "free";
  panBias: number;
  widthIntent: number;
  widthBand: "none" | "high-side" | "air-only";
  lowMonoHz: number;
  reason: string;
};

export type PlacementPlannerOptions = {
  stemFeatureReports?: StemFeatureReport[];
};

export function buildPlacementPlan(
  project: Project,
  effectiveRoles: EffectiveStemRole[],
  options: PlacementPlannerOptions = {},
): PlacementPlan[] {
  const featureByTrackId = new Map((options.stemFeatureReports ?? []).map((report) => [report.trackId, report]));
  let supportIndex = 0;
  return project.tracks
    .filter((track) => track.role !== "reference")
    .map((track) => {
      const effectiveRole = getEffectiveRoleForTrack(track.id, effectiveRoles, track.role);
      const feature = featureByTrackId.get(track.id);
      if (isCenterProtectedRole(effectiveRole) || isLowDominantFeature(feature)) {
        return {
          trackId: track.id,
          effectiveRole,
          centerProtection: "hard-center",
          panBias: 0,
          widthIntent: 0,
          widthBand: "none",
          lowMonoHz: 120,
          reason: `${effectiveRole} stays center protected; low band is never widened.`,
        } satisfies PlacementPlan;
      }

      const side = supportIndex % 2 === 0 ? -1 : 1;
      const lane = Math.floor(supportIndex / 2);
      supportIndex += 1;
      const roleLimit = getRolePanLimit(effectiveRole);
      const roleBase = getRolePanBase(effectiveRole);
      const panBias = round2(clamp(side * (roleBase + lane * 0.025), -roleLimit, roleLimit));
      const widthIntent = getRoleWidthIntent(effectiveRole, feature);
      const softCenter = effectiveRole === "backingVocal";

      return {
        trackId: track.id,
        effectiveRole,
        centerProtection: softCenter ? "soft-center" : "free",
        panBias: softCenter ? round2(clamp(panBias, -0.18, 0.18)) : panBias,
        widthIntent,
        widthBand: widthIntent <= 0.01 ? "none" : effectiveRole === "fx" ? "air-only" : "high-side",
        lowMonoHz: 120,
        reason: `${effectiveRole} placed with small pan bias and high-side-only width.`,
      };
    });
}

function getRolePanLimit(role: StemRole) {
  if (role === "backingVocal") return 0.18;
  if (role === "fx") return 0.32;
  if (role === "guitar" || role === "synth" || role === "keys" || role === "music" || role === "loop") return 0.24;
  return 0.2;
}

function getRolePanBase(role: StemRole) {
  if (role === "backingVocal") return 0.08;
  if (role === "fx") return 0.16;
  if (role === "guitar" || role === "synth" || role === "keys") return 0.1;
  if (role === "music" || role === "loop") return 0.12;
  return 0.08;
}

function getRoleWidthIntent(role: StemRole, feature: StemFeatureReport | undefined) {
  const sideIsWeak = Number.isFinite(feature?.sideMidRatioDb) ? Number(feature?.sideMidRatioDb) < -16 : true;
  const base = role === "fx"
    ? 0.12
    : role === "guitar" || role === "synth" || role === "keys" || role === "music" || role === "loop"
      ? 0.08
      : role === "backingVocal"
        ? 0.04
        : 0;
  return round2(clamp(sideIsWeak ? base : base * 0.6, 0, 0.14));
}

function isLowDominantFeature(feature: StemFeatureReport | undefined) {
  if (!feature) return false;
  const low = averageBands(feature, ["35-60", "60-120"]);
  const mid = averageBands(feature, ["250-500", "500-900", "900-1500"]);
  return low > mid + 3 && feature.spectralCentroidHz < 900;
}

function averageBands(report: StemFeatureReport, keys: string[]) {
  const values = keys
    .map((key) => report.bandEnergyDb[key as keyof typeof report.bandEnergyDb])
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return -60;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
