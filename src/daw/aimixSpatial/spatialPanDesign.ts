import { createClipHistoryItem, createId, type Clip, type ClipPanAutomation, type Project, type StemRole, type Track } from "../model/Project";
import type { AimixSpatialApplyContext, AimixSpatialOptions, SpatialPanScene } from "./aimixSpatialTypes";

export type ClipPanMotionTemplate =
  | "static-support"
  | "gentle-arc"
  | "counter-motion"
  | "call-response"
  | "hook-spread"
  | "ear-candy-fly";

export type SpatialPanDesignResult = {
  project: Project;
  pannedTracks: number;
  pannedClips: number;
  restoredPannedTracks: number;
  restoredPannedClips: number;
  actions: string[];
  warnings: string[];
};

const ROLE_TRACK_PAN_LIMITS: Record<SpatialPanScene, Record<StemRole, number>> = {
  "pro-balanced": {
    vocal: 0.02,
    backingVocal: 0.22,
    drums: 0.03,
    bass: 0.02,
    guitar: 0.48,
    synth: 0.52,
    keys: 0.36,
    fx: 0.72,
    music: 0.36,
    loop: 0.34,
    other: 0.34,
    reference: 0,
  },
  "wide-hook": {
    vocal: 0.02,
    backingVocal: 0.24,
    drums: 0.03,
    bass: 0.02,
    guitar: 0.54,
    synth: 0.62,
    keys: 0.42,
    fx: 0.78,
    music: 0.46,
    loop: 0.44,
    other: 0.44,
    reference: 0,
  },
  "vocal-focus": {
    vocal: 0.015,
    backingVocal: 0.18,
    drums: 0.025,
    bass: 0.015,
    guitar: 0.38,
    synth: 0.38,
    keys: 0.32,
    fx: 0.62,
    music: 0.32,
    loop: 0.3,
    other: 0.3,
    reference: 0,
  },
  "cinematic-wide": {
    vocal: 0.015,
    backingVocal: 0.24,
    drums: 0.025,
    bass: 0.015,
    guitar: 0.56,
    synth: 0.68,
    keys: 0.5,
    fx: 0.82,
    music: 0.56,
    loop: 0.5,
    other: 0.56,
    reference: 0,
  },
  manual: {
    vocal: 0.03,
    backingVocal: 0.24,
    drums: 0.04,
    bass: 0.02,
    guitar: 0.42,
    synth: 0.48,
    keys: 0.38,
    fx: 0.62,
    music: 0.36,
    loop: 0.34,
    other: 0.32,
    reference: 0,
  },
};

export function shouldApplyTrackPan(options: AimixSpatialOptions) {
  return options.panMode === "track" || options.panMode === "track-clip" || options.panMode === "reference-plus";
}

export function shouldApplyClipPan(options: AimixSpatialOptions) {
  return options.panMode === "clip" || options.panMode === "track-clip" || options.panMode === "reference-plus";
}

function isLegacyAimixClipPan(clip: Clip): boolean {
  return (
    (clip.intentTags ?? []).includes("aimix-auto-pan") ||
    (clip.actionHistory ?? []).some((item) => item.type === "aimixClipPan")
  );
}

export function applySpatialPanDesignToProject(
  project: Project,
  options: AimixSpatialOptions,
  context: AimixSpatialApplyContext,
  createdAt: string,
): SpatialPanDesignResult {
  if (options.panMode === "off") {
    return { project, pannedTracks: 0, pannedClips: 0, restoredPannedTracks: 0, restoredPannedClips: 0, actions: [], warnings: [] };
  }

  const targetTracks = project.tracks.filter((track) =>
    !track.mute &&
    track.role !== "reference" &&
    !track.aimixSpatial?.isAimixSpatialGenerated &&
    project.clips.some((clip) => clip.trackId === track.id),
  );
  const targetTrackIds = new Set(targetTracks.map((track) => track.id));
  const trackIndexById = new Map(targetTracks.map((track, index) => [track.id, index]));
  const roleCounts = buildRoleCounts(targetTracks);
  const roleIndexByTrackId = buildRoleIndexByTrackId(targetTracks);
  let pannedTracks = 0;
  let restoredPannedTracks = 0;
  const actions: string[] = [];
  const warnings: string[] = [];
  const trackPanEnabled = shouldApplyTrackPan(options);

  const tracks = project.tracks.map((track) => {
    const restored = restoreTrackSpatialPan(track, options);
    if (restored.restored) restoredPannedTracks += 1;
    if (!targetTrackIds.has(track.id) || !trackPanEnabled) return restored.track;

    const basePan = restored.track.pan;
    const nextPan = computeSpatialTrackPan(
      restored.track.role,
      trackIndexById.get(track.id) ?? 0,
      roleIndexByTrackId.get(track.id) ?? 0,
      roleCounts.get(restored.track.role) ?? 1,
      basePan,
      options,
      context,
    );
    if (Math.abs(nextPan - basePan) < 0.005) return restored.track;
    pannedTracks += 1;
    return {
      ...restored.track,
      pan: nextPan,
      aimixSpatialPan: {
        isAimixSpatialPanApplied: true as const,
        previousPan: track.aimixSpatialPan?.previousPan ?? track.pan,
        createdAt,
        mode: options.mode,
      },
    };
  });

  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const clipOrderById = buildClipOrderById(project.clips);
  const overlapCountById = buildClipOverlapCountById(project.clips);
  let pannedClips = 0;
  let restoredPannedClips = 0;
  const clipPanEnabled = shouldApplyClipPan(options);

  const clips = project.clips.map((clip) => {
    const restored = restoreClipSpatialPan(clip, options);
    if (restored.restored) restoredPannedClips += 1;
    const track = trackById.get(clip.trackId);
    if (!track || !targetTrackIds.has(track.id) || !clipPanEnabled) return restored.clip;
    const legacyAimixPan = isLegacyAimixClipPan(restored.clip);
    const clipForSpatialPan: Clip = legacyAimixPan
      ? {
          ...restored.clip,
          panAutomation: undefined,
          intentTags: (restored.clip.intentTags ?? []).filter((tag) => tag !== "aimix-auto-pan"),
          actionHistory: [
            createClipHistoryItem("aimixSpatialPanMigration", "Migrated legacy AIMIX clip pan to AIMIX Spatial", {
              role: track.role,
            }),
            ...(restored.clip.actionHistory ?? []).filter((item) => item.type !== "aimixClipPan"),
          ].slice(0, 40),
        }
      : restored.clip;
    const automation = computeSpatialClipPanAutomation(
      clipForSpatialPan,
      track,
      trackIndexById.get(track.id) ?? 0,
      clipOrderById.get(clip.id) ?? 0,
      overlapCountById.get(clip.id) ?? 1,
      options,
      context,
    );
    if (!automation) return clipForSpatialPan;
    pannedClips += 1;
    const tags = new Set(clipForSpatialPan.intentTags ?? []);
    const template = selectClipPanMotionTemplate(track.role, clipOrderById.get(clip.id) ?? 0, options.panScene);
    tags.add("aimix-spatial-pan");
    tags.add(`pan-${template}`);
    return {
      ...clipForSpatialPan,
      panAutomation: automation,
      intentTags: Array.from(tags).slice(0, 16),
      actionHistory: [
        createClipHistoryItem("aimixSpatialPan", "AIMIX Spatial clip pan automation", {
          role: track.role,
          template,
          scene: options.panScene,
        }),
        ...(clipForSpatialPan.actionHistory ?? []),
      ].slice(0, 40),
      aimixSpatialPan: {
        isAimixSpatialPanApplied: true as const,
        previousPanAutomation: legacyAimixPan ? undefined : clip.aimixSpatialPan?.previousPanAutomation ?? clip.panAutomation,
        createdAt,
        mode: options.mode,
      },
    };
  });

  if (pannedTracks > 0) actions.push(`Pan Mix: arranged ${pannedTracks} tracks by role/reference.`);
  if (pannedClips > 0) actions.push(`Clip Pan: created time-based pan automation for ${pannedClips} clips.`);
  const referenceAction = buildSpatialReferenceAction(context.referenceProfile ?? null, context.referenceDelta ?? null, options);
  if (referenceAction) actions.push(referenceAction);
  if (options.referencePanFollow && options.panMode === "reference-plus" && !context.referenceProfile) {
    warnings.push("Reference+ Pan: Reference analysis was not available; used role-safe pan design.");
  }
  if (pannedTracks === 0 && pannedClips === 0) warnings.push("Pan Mix: no eligible source clips were changed.");

  return {
    project: { ...project, tracks, clips },
    pannedTracks,
    pannedClips,
    restoredPannedTracks,
    restoredPannedClips,
    actions,
    warnings,
  };
}

export function restoreTrackSpatialPan(track: Track, options: Pick<AimixSpatialOptions, "resetPreviousSpatialPan">) {
  if (!options.resetPreviousSpatialPan || !track.aimixSpatialPan?.isAimixSpatialPanApplied) {
    return { track, restored: false };
  }
  return {
    track: {
      ...track,
      pan: track.aimixSpatialPan.previousPan,
      aimixSpatialPan: undefined,
    },
    restored: true,
  };
}

export function restoreClipSpatialPan(clip: Clip, options: Pick<AimixSpatialOptions, "resetPreviousSpatialPan">) {
  if (!options.resetPreviousSpatialPan || !clip.aimixSpatialPan?.isAimixSpatialPanApplied) {
    return { clip, restored: false };
  }
  return {
    clip: {
      ...clip,
      panAutomation: clip.aimixSpatialPan.previousPanAutomation,
      aimixSpatialPan: undefined,
      intentTags: (clip.intentTags ?? []).filter((tag) => tag !== "aimix-spatial-pan"),
    },
    restored: true,
  };
}

export function computeSpatialTrackPan(
  role: StemRole,
  trackIndex: number,
  roleIndex: number,
  roleCount: number,
  currentPan: number,
  options: AimixSpatialOptions,
  context: AimixSpatialApplyContext,
): number {
  const amount = clamp((options.panAmount / 100) * (options.trackPanAmount / 100), 0, 1);
  const side = getRolePairSide(roleIndex, roleCount, trackIndex);
  const limit = getRolePanLimit(role, options.panScene);

  if (role === "reference") return currentPan;
  if (role === "vocal" && options.protectLeadVocalPan) return round2(clamp(currentPan, -0.02, 0.02));
  if ((role === "bass" || role === "drums") && options.protectLowEndPan) return round2(clamp(currentPan, -0.025, 0.025));

  const referenceScale = options.referencePanFollow
    ? computeReferenceWidthScale(context.referenceProfile ?? null, context.referenceDelta ?? null)
    : 1;
  const target = side * limit * amount * referenceScale;
  return round2(clamp(target, -limit, limit));
}

export function computeSpatialClipPanAutomation(
  clip: Clip,
  track: Track,
  trackIndex: number,
  clipOrder: number,
  overlapCount: number,
  options: AimixSpatialOptions,
  context: AimixSpatialApplyContext,
): ClipPanAutomation | undefined {
  if (!shouldApplyClipPan(options)) return undefined;
  if (clip.durationSec < 0.35) return undefined;
  if (track.role === "reference") return undefined;

  const isCenter = track.role === "vocal" || track.role === "bass" || track.role === "drums";
  const amount = clamp((options.panAmount / 100) * (options.clipPanAmount / 100), 0, 1);
  const template = selectClipPanMotionTemplate(track.role, clipOrder, options.panScene);
  const referenceScale = options.referencePanFollow
    ? computeReferenceWidthScale(context.referenceProfile ?? null, context.referenceDelta ?? null)
    : 1;
  const trackPanAbs = Math.abs(track.pan);
  const available = clamp(0.82 - trackPanAbs, 0.04, 0.42);
  const centerDepth = track.role === "vocal" ? 0.015 : track.role === "bass" ? 0.005 : 0.02;
  const roleDepth = isCenter ? centerDepth : getRoleClipPanDepth(track.role, options.panScene) * amount * referenceScale;
  const overlapScale = clamp(1 + Math.max(0, overlapCount - 1) * 0.04, 1, 1.16);
  const safeDepth = clamp(Math.min(roleDepth * overlapScale, available * 0.65), 0, available);

  if (safeDepth < 0.01 && isCenter) return undefined;

  const side = getTimelineSide(track.role, trackIndex, clipOrder, clip.timelineStartSec);
  const safeDuration = Math.max(0.35, clip.durationSec);
  const anchorPattern = buildClipPanAnchorPattern(template, side, safeDepth, safeDuration);

  return {
    enabled: true,
    depth: isCenter ? 0.55 : template === "ear-candy-fly" ? 0.92 : 0.84,
    smoothingMs: isCenter ? 100 : 65,
    bypassed: false,
    anchorPoints: anchorPattern.map((point, index) => ({
      id: createId("pan"),
      time: round2(point.time),
      pan: round2(clamp(point.pan, -0.88, 0.88)),
      curve: index === 0 || index === anchorPattern.length - 1 ? "smooth" : "easeInOut",
    })),
  };
}

export function selectClipPanMotionTemplate(role: StemRole, clipOrder: number, scene: SpatialPanScene): ClipPanMotionTemplate {
  if (role === "vocal" || role === "bass" || role === "drums") return "static-support";
  if (role === "backingVocal" || role === "keys") return "gentle-arc";
  if (role === "guitar") return "counter-motion";
  if (role === "synth") return scene === "wide-hook" || scene === "cinematic-wide" ? "hook-spread" : "gentle-arc";
  if (role === "fx") return "ear-candy-fly";
  if (role === "music" || role === "other" || role === "loop") {
    if (scene === "wide-hook") return "hook-spread";
    return clipOrder % 2 === 0 ? "gentle-arc" : "counter-motion";
  }
  return "gentle-arc";
}

function buildClipPanAnchorPattern(template: ClipPanMotionTemplate, side: number, depth: number, durationSec: number) {
  const point = (ratio: number, multiplier: number) => ({
    time: durationSec * ratio,
    pan: side * depth * multiplier,
  });
  switch (template) {
    case "static-support":
      return [point(0, 0.15), point(0.2, 0.22), point(0.5, 0.22), point(0.8, 0.18), point(1, 0.12)];
    case "counter-motion":
      return [point(0, 0.35), point(0.2, 0.82), point(0.5, 1), point(0.8, -0.48), point(1, 0.25)];
    case "call-response":
      return [point(0, 0.2), point(0.2, 0.78), point(0.5, -0.72), point(0.8, 0.7), point(1, 0.18)];
    case "hook-spread":
      return [point(0, 0.32), point(0.2, 0.66), point(0.5, 1.08), point(0.8, 1.16), point(1, 0.58)];
    case "ear-candy-fly":
      return [point(0, 0.35), point(0.15, 1.05), point(0.3, -0.92), point(0.5, 1.15), point(0.7, -1.1), point(0.85, 0.88), point(1, 0.28)];
    case "gentle-arc":
    default:
      return [point(0, 0.28), point(0.2, 0.68), point(0.5, 1), point(0.8, 0.62), point(1, 0.24)];
  }
}

function getRoleClipPanDepth(role: StemRole, scene: SpatialPanScene) {
  const sceneBoost = scene === "wide-hook" ? 1.22 : scene === "cinematic-wide" ? 1.18 : scene === "vocal-focus" ? 0.85 : 1;
  switch (role) {
    case "backingVocal": return 0.12 * sceneBoost;
    case "guitar": return 0.2 * sceneBoost;
    case "keys": return 0.16 * sceneBoost;
    case "synth": return 0.22 * sceneBoost;
    case "fx": return 0.3 * (scene === "cinematic-wide" ? 1.25 : sceneBoost);
    case "music": return 0.16 * sceneBoost;
    case "loop": return 0.14 * sceneBoost;
    case "other": return 0.12 * sceneBoost;
    default: return 0.08 * sceneBoost;
  }
}

function getTimelineSide(role: StemRole, trackIndex: number, clipOrder: number, timelineStartSec: number) {
  if (role === "vocal" || role === "bass" || role === "drums") return trackIndex % 2 === 0 ? -1 : 1;
  const phase = Math.floor(timelineStartSec / 8) + clipOrder + trackIndex;
  return phase % 2 === 0 ? -1 : 1;
}

function buildSpatialReferenceAction(referenceProfile: AimixSpatialApplyContext["referenceProfile"], referenceDelta: AimixSpatialApplyContext["referenceDelta"], options: AimixSpatialOptions) {
  if (!referenceProfile || !referenceDelta || options.panMode !== "reference-plus") return null;
  return `Reference+ Pan: scene ${options.panScene}, target side/mid ${referenceProfile.sideMidRatioDb.toFixed(1)}dB, width delta ${referenceDelta.stereoWidthDelta.toFixed(1)}`;
}

function computeReferenceWidthScale(referenceProfile: AimixSpatialApplyContext["referenceProfile"], referenceDelta: AimixSpatialApplyContext["referenceDelta"]) {
  let scale = 1;
  if (referenceDelta) {
    scale += clamp(Math.max(0, referenceDelta.stereoWidthDelta) / 180, 0, 0.22);
    scale -= clamp(Math.max(0, -referenceDelta.stereoWidthDelta) / 220, 0, 0.16);
    scale += clamp(Math.max(0, -referenceDelta.correlationDelta) * 0.2, 0, 0.08);
  }
  if (referenceProfile) {
    scale += clamp((referenceProfile.sideMidRatioDb + 18) / 60, -0.1, 0.16);
    if (referenceProfile.lrCorrelation < 0.65) scale *= 0.72;
    else if (referenceProfile.lrCorrelation < 0.75) scale *= 0.9;
  }
  return clamp(scale, 0.72, 1.45);
}

function getRolePanLimit(role: StemRole, scene: SpatialPanScene) {
  return ROLE_TRACK_PAN_LIMITS[scene]?.[role] ?? ROLE_TRACK_PAN_LIMITS["pro-balanced"][role] ?? 0.3;
}

function getRolePairSide(roleIndex: number, roleCount: number, trackIndex: number) {
  if (roleCount <= 1) return trackIndex % 2 === 0 ? -1 : 1;
  const pairIndex = Math.floor(roleIndex / 2);
  const side = roleIndex % 2 === 0 ? -1 : 1;
  return pairIndex % 2 === 0 ? side : -side;
}

function buildRoleCounts(tracks: Track[]) {
  const counts = new Map<StemRole, number>();
  for (const track of tracks) {
    counts.set(track.role, (counts.get(track.role) ?? 0) + 1);
  }
  return counts;
}

function buildRoleIndexByTrackId(tracks: Track[]) {
  const seen = new Map<StemRole, number>();
  const indexes = new Map<string, number>();
  for (const track of tracks) {
    const index = seen.get(track.role) ?? 0;
    indexes.set(track.id, index);
    seen.set(track.role, index + 1);
  }
  return indexes;
}

function buildClipOrderById(clips: Clip[]) {
  const orderById = new Map<string, number>();
  const clipsByTrack = new Map<string, Clip[]>();
  for (const clip of clips) {
    const bucket = clipsByTrack.get(clip.trackId) ?? [];
    bucket.push(clip);
    clipsByTrack.set(clip.trackId, bucket);
  }
  for (const bucket of clipsByTrack.values()) {
    bucket
      .slice()
      .sort((a, b) => a.timelineStartSec - b.timelineStartSec || a.id.localeCompare(b.id))
      .forEach((clip, index) => orderById.set(clip.id, index));
  }
  return orderById;
}

function buildClipOverlapCountById(clips: Clip[]) {
  const overlapById = new Map<string, number>();
  for (const clip of clips) {
    const midpoint = clip.timelineStartSec + Math.max(0, clip.durationSec) * 0.5;
    const overlapCount = clips.filter((candidate) => {
      if (candidate.trackId === clip.trackId) return false;
      const start = candidate.timelineStartSec;
      const end = candidate.timelineStartSec + Math.max(0, candidate.durationSec);
      return midpoint >= start && midpoint <= end;
    }).length;
    overlapById.set(clip.id, Math.max(1, overlapCount + 1));
  }
  return overlapById;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
