import type { Clip, Project, StemRole, Track } from "@/daw/model/Project";
import type { StemFeatureReport } from "@/daw/mix/mixDoctorTypes";

export type EffectiveStemRole = {
  trackId: string;
  declaredRole: StemRole;
  effectiveRole: StemRole;
  confidence: number;
  source: "declared" | "intentTags" | "actionHistory" | "featureAnalysis";
  reason: string;
};

export type EffectiveRoleOptions = {
  stemFeatureReports?: StemFeatureReport[];
};

type RoleCandidate = {
  role: StemRole;
  confidence: number;
  source: EffectiveStemRole["source"];
  reason: string;
};

const LIKELY_ROLE_TAGS: Array<[string, StemRole]> = [
  ["likely-bass", "bass"],
  ["likely-guitar", "guitar"],
  ["likely-vocal", "vocal"],
  ["likely-drums", "drums"],
  ["likely-synth", "synth"],
  ["likely-keys", "keys"],
  ["likely-fx", "fx"],
  ["likely-music", "music"],
];

export function resolveEffectiveStemRoles(project: Project, options: EffectiveRoleOptions = {}): EffectiveStemRole[] {
  const clipsByTrackId = groupClipsByTrack(project.clips);
  const featureByTrackId = new Map((options.stemFeatureReports ?? []).map((report) => [report.trackId, report]));
  return project.tracks.map((track) => {
    if (track.role === "reference") {
      return declaredRole(track, "Reference tracks are excluded from Clean Rebuild processing.");
    }

    const clips = clipsByTrackId.get(track.id) ?? [];
    const candidates = [
      ...readActionHistoryCandidates(clips),
      ...readIntentTagCandidates(clips),
    ];
    const featureCandidate = readFeatureCandidate(track, featureByTrackId.get(track.id));
    if (featureCandidate) candidates.push(featureCandidate);

    const best = candidates.sort((left, right) => right.confidence - left.confidence)[0];
    if (!best || best.confidence < 0.68) {
      return declaredRole(track, best ? `Low confidence ${best.source} hint stayed as ${track.role}.` : "No reliable role mismatch evidence.");
    }

    return {
      trackId: track.id,
      declaredRole: track.role,
      effectiveRole: best.role,
      confidence: round2(best.confidence),
      source: best.source,
      reason: best.reason,
    };
  });
}

export function getEffectiveRoleForTrack(trackId: string, roles: EffectiveStemRole[], fallback: StemRole): StemRole {
  return roles.find((role) => role.trackId === trackId)?.effectiveRole ?? fallback;
}

export function isLowDominantRole(role: StemRole) {
  return role === "bass";
}

export function isCenterProtectedRole(role: StemRole) {
  return role === "vocal" || role === "bass" || role === "drums" || role === "reference";
}

function declaredRole(track: Track, reason: string): EffectiveStemRole {
  return {
    trackId: track.id,
    declaredRole: track.role,
    effectiveRole: track.role,
    confidence: 0.55,
    source: "declared",
    reason,
  };
}

function groupClipsByTrack(clips: Clip[]) {
  const map = new Map<string, Clip[]>();
  for (const clip of clips) {
    const list = map.get(clip.trackId) ?? [];
    list.push(clip);
    map.set(clip.trackId, list);
  }
  return map;
}

function readActionHistoryCandidates(clips: Clip[]): RoleCandidate[] {
  const candidates: RoleCandidate[] = [];
  for (const clip of clips) {
    for (const item of clip.actionHistory ?? []) {
      const likelyRole = readStemRole(item.details?.likelyRole);
      if (!likelyRole) continue;
      const isMismatch = item.type === "aimixRoleMismatch" || item.label.toLowerCase().includes("mismatch");
      candidates.push({
        role: likelyRole,
        confidence: isMismatch ? 0.92 : 0.82,
        source: "actionHistory",
        reason: `clip ${clip.id} actionHistory likelyRole=${likelyRole}`,
      });
    }
  }
  return candidates;
}

function readIntentTagCandidates(clips: Clip[]): RoleCandidate[] {
  const scores = new Map<StemRole, number>();
  for (const clip of clips) {
    for (const tag of clip.intentTags ?? []) {
      const role = LIKELY_ROLE_TAGS.find(([candidate]) => candidate === tag)?.[1];
      if (!role) continue;
      scores.set(role, (scores.get(role) ?? 0) + 1);
    }
  }
  const total = Math.max(1, Array.from(scores.values()).reduce((sum, value) => sum + value, 0));
  return Array.from(scores.entries()).map(([role, score]) => ({
    role,
    confidence: clamp(0.72 + (score / total) * 0.18, 0.72, 0.9),
    source: "intentTags",
    reason: `intentTags suggest ${role}`,
  }));
}

function readFeatureCandidate(track: Track, report: StemFeatureReport | undefined): RoleCandidate | null {
  if (!report) return null;
  const low = averageBands(report, ["35-60", "60-120"]);
  const body = averageBands(report, ["250-500", "500-900"]);
  const presence = averageBands(report, ["1500-3000", "3000-5000"]);
  const air = averageBands(report, ["9000-12000", "12000-16000"]);
  if (low > body + 2 && low > presence + 3 && report.spectralCentroidHz < 900) {
    return { role: "bass", confidence: 0.72, source: "featureAnalysis", reason: "low band dominates feature report." };
  }
  if (report.crestFactorDb > 12 && air > body + 1.5 && track.role !== "vocal") {
    return { role: "drums", confidence: 0.7, source: "featureAnalysis", reason: "transient and high band suggest drums/percussion." };
  }
  if (presence > body + 1.5 && report.spectralCentroidHz > 1200 && track.role !== "bass") {
    return { role: track.role === "drums" ? "guitar" : track.role, confidence: 0.64, source: "featureAnalysis", reason: "presence band suggests support instrument, but confidence is low." };
  }
  return null;
}

function averageBands(report: StemFeatureReport, keys: string[]) {
  const values = keys
    .map((key) => report.bandEnergyDb[key as keyof typeof report.bandEnergyDb])
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return -60;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readStemRole(value: unknown): StemRole | null {
  return typeof value === "string" && isKnownRole(value) ? value : null;
}

function isKnownRole(value: string): value is StemRole {
  return ["vocal", "backingVocal", "drums", "bass", "guitar", "synth", "keys", "fx", "music", "loop", "other", "reference"].includes(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
