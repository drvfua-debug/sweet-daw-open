import type { PeakSummary } from "../../audio/analysis/PeakBuilder";
import {
  createClipHistoryItem,
  createId,
  type ArtifactReason,
  type Clip,
  type ClipPanAutomation,
  type ParametricEQState,
  type Project,
  type StemRole,
  type Track,
} from "../model/Project";
import type { ReferenceDelta, ReferenceProfile, StemFeatureReport } from "./mixDoctorTypes";

export type ClipIntelligenceMode = "safe" | "balanced" | "dense" | "referenceMatch" | "suggestOnly";
export type ClipPanDesignMode = "off" | "role" | "referencePlus";

export type ClipIntelligenceDecision = {
  id: string;
  type: "clip-pan" | "reference-follow" | "role-mismatch" | "artifact-guard";
  trackId?: string;
  clipId?: string;
  role?: StemRole;
  message: string;
  applied: boolean;
  confidence: number;
};

export type ClipIntelligenceReport = {
  decisions: ClipIntelligenceDecision[];
  panAutomationClipIds: string[];
  referenceAdjustedTrackIds: string[];
  mismatchClipIds: string[];
  artifactGuardClipIds: string[];
};

export type ClipIntelligenceOptions = {
  mode: ClipIntelligenceMode;
  referenceDelta?: ReferenceDelta | null;
  referenceProfile?: ReferenceProfile | null;
  stemFeatureReports?: StemFeatureReport[];
  panDesignMode?: ClipPanDesignMode;
  panDesignAmount?: number;
  enableClipPan?: boolean;
};

type ClipMismatch = {
  likelyRole: StemRole;
  confidence: number;
  reason: string;
  artifactReason: ArtifactReason;
};

type SpectralGuess = {
  role: StemRole;
  confidence: number;
  reason: string;
};

const CENTER_ROLES = new Set<StemRole>(["vocal", "drums", "bass", "reference"]);
const REFERENCE_FOLLOW_ROLES = new Set<StemRole>([
  "vocal",
  "backingVocal",
  "drums",
  "bass",
  "guitar",
  "synth",
  "keys",
  "fx",
  "music",
  "loop",
  "other",
]);

export function buildClipIntelligenceReport(
  project: Project,
  peaksByFileId: Record<string, PeakSummary>,
  options: ClipIntelligenceOptions,
): ClipIntelligenceReport {
  const decisions: ClipIntelligenceDecision[] = [];
  const panAutomationClipIds: string[] = [];
  const mismatchClipIds: string[] = [];
  const artifactGuardClipIds: string[] = [];
  const referenceAdjustedTrackIds: string[] = [];
  const suggestOnly = options.mode === "suggestOnly";
  const panDesignMode = options.panDesignMode ?? "role";
  const panDesignEnabled = Boolean(options.enableClipPan) && panDesignMode !== "off";
  const trackById = new Map(project.tracks.map((track) => [track.id, track]));

  for (const clip of project.clips) {
    const track = trackById.get(clip.trackId);
    if (!track || track.role === "reference") continue;
    const summary = peaksByFileId[clip.fileId];

    if (panDesignEnabled && clip.durationSec >= 0.35) {
      panAutomationClipIds.push(clip.id);
      decisions.push({
        id: createId("decision"),
        type: "clip-pan",
        trackId: track.id,
        clipId: clip.id,
        role: track.role,
        message: `${track.name}: 時間軸Panアンカーを作成します。Vocal/Bass/Kickは中央保護、伴奏/FXは少し左右へ逃がします。`,
        applied: !suggestOnly,
        confidence: CENTER_ROLES.has(track.role) ? 0.72 : 0.86,
      });
    }

    if (!summary) continue;

    const mismatch = detectRoleMismatch(track, summary);
    if (mismatch) {
      mismatchClipIds.push(clip.id);
      decisions.push({
        id: createId("decision"),
        type: "role-mismatch",
        trackId: track.id,
        clipId: clip.id,
        role: track.role,
        message: `${track.name}: ${track.role}の中に${mismatch.likelyRole}寄りの成分を検出しました。元音は消さず、クリップへ確認タグとRepair Queueを付けます。`,
        applied: !suggestOnly,
        confidence: mismatch.confidence,
      });
    }

    if (detectArtifactRisk(track, summary)) {
      artifactGuardClipIds.push(clip.id);
      decisions.push({
        id: createId("decision"),
        type: "artifact-guard",
        trackId: track.id,
        clipId: clip.id,
        role: track.role,
        message: `${track.name}: AI grain / harshnessの疑いがあるため、過剰な高域処理を避ける保護候補にします。`,
        applied: !suggestOnly,
        confidence: 0.74,
      });
    }
  }

  if (options.referenceProfile && options.referenceDelta) {
    for (const feature of options.stemFeatureReports ?? []) {
      if (feature.role === "reference" || !REFERENCE_FOLLOW_ROLES.has(feature.role)) continue;
      const track = project.tracks.find((candidate) => candidate.id === feature.trackId);
      if (!track || track.mute) continue;
      const adjustment = buildReferenceStemAdjustment(feature, options.referenceProfile, options.referenceDelta, options.mode);
      if (!adjustment) continue;
      referenceAdjustedTrackIds.push(track.id);
      decisions.push({
        id: createId("decision"),
        type: "reference-follow",
        trackId: track.id,
        role: track.role,
        message: `${track.name}: Reference解析を元に${adjustment}を安全範囲で反映します。`,
        applied: !suggestOnly,
        confidence: 0.7,
      });
    }
  }

  return {
    decisions,
    panAutomationClipIds: Array.from(new Set(panAutomationClipIds)),
    referenceAdjustedTrackIds: Array.from(new Set(referenceAdjustedTrackIds)),
    mismatchClipIds: Array.from(new Set(mismatchClipIds)),
    artifactGuardClipIds: Array.from(new Set(artifactGuardClipIds)),
  };
}

export function applyClipIntelligenceToProject(
  project: Project,
  report: ClipIntelligenceReport,
  peaksByFileId: Record<string, PeakSummary>,
  options: ClipIntelligenceOptions,
): Project {
  if (options.mode === "suggestOnly") return project;

  const panClipIds = new Set(report.panAutomationClipIds);
  const mismatchClipIds = new Set(report.mismatchClipIds);
  const artifactClipIds = new Set(report.artifactGuardClipIds);
  const referenceTrackIds = new Set(report.referenceAdjustedTrackIds);
  const trackIndexById = new Map(project.tracks.map((track, index) => [track.id, index]));
  const clipOrderById = buildClipOrderById(project.clips);
  const overlapCountById = buildClipOverlapCountById(project.clips);

  const tracks = project.tracks.map((track) => {
    if (!referenceTrackIds.has(track.id)) return track;
    const feature = options.stemFeatureReports?.find((candidate) => candidate.trackId === track.id);
    if (!feature || !options.referenceDelta || !options.referenceProfile) return track;
    return applyReferenceStemAdjustment(track, feature, options.referenceProfile, options.referenceDelta, options.mode);
  });

  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const clips = project.clips.map((clip) => {
    const track = trackById.get(clip.trackId);
    if (!track) return clip;
    const summary = peaksByFileId[clip.fileId];
    const mismatch = summary ? detectRoleMismatch(track, summary) : null;
    const shouldPan = panClipIds.has(clip.id);
    const shouldMismatch = mismatchClipIds.has(clip.id);
    const shouldArtifact = artifactClipIds.has(clip.id);
    if (!shouldPan && !shouldMismatch && !shouldArtifact) return clip;

    const nextTags = new Set(clip.intentTags ?? []);
    const history = [...(clip.actionHistory ?? [])];
    let nextClip: Clip = { ...clip };

    if (shouldPan) {
      nextTags.add("aimix-auto-pan");
      nextClip.panAutomation = createRolePanAutomation(
        clip,
        track,
        trackIndexById.get(track.id) ?? 0,
        clipOrderById.get(clip.id) ?? 0,
        overlapCountById.get(clip.id) ?? 1,
        options.mode,
        options.panDesignMode ?? "role",
        options.panDesignAmount ?? 65,
        options.referenceProfile ?? null,
        options.referenceDelta ?? null,
      );
      history.unshift(createClipHistoryItem("aimixClipPan", "AIMIX clip pan automation", { role: track.role }));
    }

    if (shouldMismatch && mismatch) {
      nextTags.add("role-mismatch");
      nextTags.add(`likely-${mismatch.likelyRole}`);
      nextTags.add("aimix-review-clip");
      nextClip = {
        ...nextClip,
        artifact: {
          originalClipId: clip.artifact?.originalClipId || clip.id,
          label: `Likely ${mismatch.likelyRole}`,
          reason: mismatch.artifactReason,
          isMuted: false,
          repairQueue: true,
          createdAt: new Date().toISOString(),
        },
      };
      history.unshift(
        createClipHistoryItem("aimixRoleMismatch", `Likely ${mismatch.likelyRole}: ${mismatch.reason}`, {
          role: track.role,
          likelyRole: mismatch.likelyRole,
        }),
      );
    }

    if (shouldArtifact) {
      nextTags.add("artifact-guard");
      nextClip = {
        ...nextClip,
        artifact: {
          originalClipId: nextClip.artifact?.originalClipId || clip.id,
          label: nextClip.artifact?.label ?? "Artifact Guard",
          reason: nextClip.artifact?.reason ?? "artifact",
          isMuted: false,
          repairQueue: true,
          createdAt: nextClip.artifact?.createdAt ?? new Date().toISOString(),
        },
      };
      history.unshift(createClipHistoryItem("aimixArtifactGuard", "AIMIX Artifact Guard candidate", { role: track.role }));
    }

    return {
      ...nextClip,
      intentTags: Array.from(nextTags).slice(0, 16),
      actionHistory: history.slice(0, 40),
    };
  });

  return {
    ...project,
    tracks,
    clips,
    updatedAt: new Date().toISOString(),
  };
}

export function summarizeClipIntelligence(report: ClipIntelligenceReport) {
  const summary: string[] = [];
  if (report.panAutomationClipIds.length > 0) {
    summary.push(`Clip Pan: ${report.panAutomationClipIds.length}個のクリップにPanアンカーを設定しました。`);
  }
  if (report.referenceAdjustedTrackIds.length > 0) {
    summary.push(`Reference Follow: ${report.referenceAdjustedTrackIds.length}本のstemへReference解析を反映しました。`);
  }
  if (report.mismatchClipIds.length > 0) {
    summary.push(`Role Mismatch: ${report.mismatchClipIds.length}個のクリップを確認候補としてタグ付けしました。`);
  }
  if (report.artifactGuardClipIds.length > 0) {
    summary.push(`Artifact Guard: ${report.artifactGuardClipIds.length}個のクリップをAI grain/harshness保護候補にしました。`);
  }
  return summary;
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
      const start = candidate.timelineStartSec;
      const end = candidate.timelineStartSec + Math.max(0, candidate.durationSec);
      return midpoint >= start && midpoint <= end;
    }).length;
    overlapById.set(clip.id, Math.max(1, overlapCount));
  }
  return overlapById;
}

function createRolePanAutomation(
  clip: Clip,
  track: Track,
  trackIndex: number,
  clipOrder: number,
  overlapCount: number,
  mode: ClipIntelligenceMode,
  panDesignMode: ClipPanDesignMode = "role",
  panDesignAmount = 65,
  referenceProfile: ReferenceProfile | null = null,
  referenceDelta: ReferenceDelta | null = null,
): ClipPanAutomation {
  const safeDuration = Math.max(0.35, clip.durationSec);
  const amountScale = clamp(panDesignAmount / 100, 0, 1);
  const isCenter = CENTER_ROLES.has(track.role);
  const side = getTimelinePanSide(track.role, trackIndex, clipOrder, clip.timelineStartSec);
  const baseDepth = mode === "dense" ? 0.52 : mode === "referenceMatch" ? 0.44 : mode === "safe" ? 0.26 : 0.38;
  const centerDepth = mode === "dense" ? 0.045 : mode === "referenceMatch" ? 0.035 : mode === "safe" ? 0.008 : 0.018;
  const referenceSpread = panDesignMode === "referencePlus" && referenceProfile
    ? clamp((referenceProfile.sideMidRatioDb + 20) / 16, 0.9, 1.22)
    : 1;
  const referenceNeedsWidth = panDesignMode === "referencePlus" && referenceDelta
    ? clamp(1 + Math.max(0, referenceDelta.stereoWidthDelta) / 120, 1, 1.22)
    : 1;
  const correlationRiskScale = panDesignMode === "referencePlus" && referenceProfile
    ? clamp(1 - Math.max(0, 0.68 - referenceProfile.lrCorrelation) / 0.18 * 0.32, 0.68, 1)
    : 1;
  const modeDepthScale = panDesignMode === "referencePlus" ? clamp(referenceSpread * referenceNeedsWidth * correlationRiskScale, 0.82, 1.32) : 1;
  const overlapSpread = clamp(1 + Math.max(0, overlapCount - 1) * 0.055, 1, 1.18);
  const timePhrase = Math.sin((clip.timelineStartSec / 16 + clipOrder * 0.37 + trackIndex * 0.19) * Math.PI);
  const roleBaseAbs = getPanDesignBase(track.role, panDesignMode) * modeDepthScale * overlapSpread;
  const userPanHint = Math.abs(track.pan) > 0.025 ? clamp(track.pan, -0.78, 0.78) : null;
  const roleBase = isCenter
    ? clamp(userPanHint ?? 0, -0.035, 0.035)
    : clamp(userPanHint ?? side * roleBaseAbs, -0.82, 0.82);
  const roleMotion = (isCenter ? centerDepth : baseDepth) * clamp(0.35 + amountScale * 0.7, 0.25, 1.08) * modeDepthScale;
  const phraseLift = isCenter ? 0 : timePhrase * 0.035 * amountScale;
  const startPan = clamp(roleBase * (isCenter ? 0.25 : 0.78), -0.82, 0.82);
  const earlyPan = clamp(roleBase + phraseLift + roleMotion * side * (isCenter ? 0.18 : 0.22), -0.86, 0.86);
  const midPan = clamp(roleBase + roleMotion * side * (isCenter ? 0.3 : 0.48), -0.88, 0.88);
  const latePan = clamp(roleBase - roleMotion * side * (isCenter ? 0.16 : 0.36), -0.86, 0.86);
  const endPan = clamp(roleBase * (isCenter ? 0.2 : 0.86), -0.82, 0.82);
  const depth = isCenter
    ? clamp(0.62 + amountScale * 0.18, 0.55, 0.82)
    : clamp(0.76 + amountScale * 0.2 + (panDesignMode === "referencePlus" ? 0.04 * correlationRiskScale : 0), 0.7, 1);

  return {
    enabled: true,
    depth,
    smoothingMs: isCenter ? 95 : 62,
    bypassed: false,
    anchorPoints: [
      { id: createId("pan"), time: 0, pan: startPan, curve: "smooth" },
      { id: createId("pan"), time: safeDuration * 0.18, pan: earlyPan, curve: "easeInOut" },
      { id: createId("pan"), time: safeDuration * 0.5, pan: midPan, curve: "easeInOut" },
      { id: createId("pan"), time: safeDuration * 0.78, pan: latePan, curve: "easeInOut" },
      { id: createId("pan"), time: safeDuration, pan: endPan, curve: "smooth" },
    ],
  };
}

function detectRoleMismatch(track: Track, summary: PeakSummary): ClipMismatch | null {
  if (track.role === "reference" || track.role === "other" || track.role === "music") return null;
  const guess = guessRoleFromSpectrum(summary);
  if (!guess || guess.role === track.role) return null;

  if (track.role === "vocal" || track.role === "backingVocal") {
    if (isCenterVocalLike(summary)) return null;
    if (guess.role === "guitar" || guess.role === "synth" || guess.role === "keys") {
      if (guess.confidence < 0.76) return null;
      return {
        likelyRole: guess.role,
        confidence: guess.confidence,
        reason: guess.reason,
        artifactReason: "vocal_leak",
      };
    }
  }

  if (track.role === "bass" && !["drums", "bass"].includes(guess.role)) {
    if (isLowDominant(summary) || guess.confidence < 0.72) return null;
    return {
      likelyRole: guess.role,
      confidence: Math.max(0.58, guess.confidence - 0.08),
      reason: guess.reason,
      artifactReason: "thin_bass",
    };
  }

  if (track.role === "drums" && !["drums", "fx"].includes(guess.role)) {
    return {
      likelyRole: guess.role,
      confidence: Math.max(0.55, guess.confidence - 0.1),
      reason: guess.reason,
      artifactReason: "other",
    };
  }

  if (guess.confidence >= 0.72) {
    return {
      likelyRole: guess.role,
      confidence: guess.confidence,
      reason: guess.reason,
      artifactReason: "other",
    };
  }

  return null;
}

function guessRoleFromSpectrum(summary: PeakSummary): SpectralGuess | null {
  const low = avgBands(summary, ["35-60", "60-120"]);
  const body = avgBands(summary, ["120-250", "250-500"]);
  const lowMid = avgBands(summary, ["500-900", "900-1500"]);
  const presence = avgBands(summary, ["1500-3000", "3000-5000"]);
  const high = avgBands(summary, ["5000-9000", "9000-12000"]);
  const air = avgBands(summary, ["12000-16000", "16000-20000"]);
  const centroid = summary.spectralCentroidHz ?? 1200;
  const flatness = summary.spectralFlatness ?? 0.35;
  const sideMid = summary.sideMidRatioDb ?? -18;
  const lowDominant = isLowDominant(summary);
  const centerVocalLike = isCenterVocalLike(summary);

  if (lowDominant) {
    return { role: "bass", confidence: scoreToConfidence(low - Math.max(lowMid, presence), 0.18), reason: "low-end dominant" };
  }
  if (centerVocalLike) {
    return { role: "vocal", confidence: 0.64, reason: "centered vocal-core energy" };
  }
  if (presence - body > 4 && high - body > 2 && sideMid > -14 && centroid >= 1400 && centroid <= 5200 && flatness < 0.58) {
    return { role: "guitar", confidence: scoreToConfidence(presence - body, 0.22), reason: "wide presence and pick-like high mids" };
  }
  if (high - lowMid > 5 && air > body - 2 && centroid > 3200 && (sideMid > -12 || flatness > 0.45) && presence > body - 1) {
    return { role: "synth", confidence: scoreToConfidence(high - lowMid, 0.16), reason: "bright synthetic high-band energy" };
  }
  if (lowMid - high > 3 && body > low - 2 && centroid >= 700 && centroid <= 2600) {
    return { role: "keys", confidence: scoreToConfidence(lowMid - high, 0.1), reason: "stable mid-range harmonic body" };
  }
  if (flatness > 0.58 && high - body > 3) {
    return { role: "fx", confidence: scoreToConfidence(high - body, 0.12), reason: "noisy wide high-frequency texture" };
  }
  return null;
}

function isCenterVocalLike(summary: PeakSummary) {
  const low = avgBands(summary, ["35-60", "60-120"]);
  const body = avgBands(summary, ["120-250", "250-500"]);
  const lowMid = avgBands(summary, ["500-900", "900-1500"]);
  const presence = avgBands(summary, ["1500-3000", "3000-5000"]);
  const high = avgBands(summary, ["5000-9000", "9000-12000"]);
  const centroid = summary.spectralCentroidHz ?? 1200;
  const sideMid = summary.sideMidRatioDb ?? -18;
  return sideMid < -12.5
    && centroid >= 750
    && centroid <= 4300
    && presence > Math.max(body, lowMid) - 2.5
    && high < presence + 6
    && low - Math.max(lowMid, presence) < 7;
}

function isLowDominant(summary: PeakSummary) {
  const low = avgBands(summary, ["35-60", "60-120"]);
  const lowMid = avgBands(summary, ["500-900", "900-1500"]);
  const presence = avgBands(summary, ["1500-3000", "3000-5000"]);
  const centroid = summary.spectralCentroidHz ?? 1200;
  return low - Math.max(lowMid, presence) > 6.2 && centroid < 950;
}

function detectArtifactRisk(track: Track, summary: PeakSummary) {
  if (track.role === "reference" || track.role === "bass") return false;
  const high = avgBands(summary, ["5000-9000", "9000-12000"]);
  const upperAir = avgBands(summary, ["12000-16000", "16000-20000"]);
  const body = avgBands(summary, ["250-500", "500-900"]);
  const flatness = summary.spectralFlatness ?? 0;
  return (high - body > 8 && flatness > 0.35) || upperAir - body > 9;
}

function buildReferenceStemAdjustment(
  feature: StemFeatureReport,
  reference: ReferenceProfile,
  delta: ReferenceDelta,
  mode: ClipIntelligenceMode,
) {
  const moves: string[] = [];
  const scale = mode === "dense" ? 1 : mode === "referenceMatch" ? 0.95 : mode === "safe" ? 0.45 : 0.7;
  const bodyDiff = band(feature, "250-500") - band(reference, "250-500");
  const nasalDiff = band(feature, "500-900") - band(reference, "500-900");
  const lowDiff = avgReportBands(feature, ["35-60", "60-120"]) - avgReportBands(reference, ["35-60", "60-120"]);
  const airDiff = avgReportBands(reference, ["9000-12000", "12000-16000"]) - avgReportBands(feature, ["9000-12000", "12000-16000"]);

  if (bodyDiff > 0.7 || delta.bodyDeltaDb < -0.8) moves.push(`${round1(clamp(-bodyDiff * 0.28 * scale, -1.2, -0.15))}dB body cut`);
  if (nasalDiff > 0.7) moves.push(`${round1(clamp(-nasalDiff * 0.22 * scale, -0.9, -0.1))}dB nasal cut`);
  if (feature.role !== "bass" && lowDiff > 1.2) moves.push("low cleanup");
  if (!["vocal", "bass", "drums"].includes(feature.role) && delta.stereoWidthDelta > 0.05) moves.push("small width follow");
  if (feature.role !== "bass" && airDiff > 1.2 && band(feature, "12000-16000") < band(reference, "12000-16000") + 2) moves.push("gentle air follow");

  return moves.length > 0 ? moves.join(", ") : null;
}

function applyReferenceStemAdjustment(
  track: Track,
  feature: StemFeatureReport,
  reference: ReferenceProfile,
  delta: ReferenceDelta,
  mode: ClipIntelligenceMode,
): Track {
  const scale = mode === "dense" ? 1 : mode === "referenceMatch" ? 0.95 : mode === "safe" ? 0.45 : 0.7;
  const nextEq: ParametricEQState = JSON.parse(JSON.stringify(track.eq));
  nextEq.enabled = true;

  const bodyDiff = band(feature, "250-500") - band(reference, "250-500");
  const nasalDiff = band(feature, "500-900") - band(reference, "500-900");
  const lowDiff = avgReportBands(feature, ["35-60", "60-120"]) - avgReportBands(reference, ["35-60", "60-120"]);
  const airDiff = avgReportBands(reference, ["9000-12000", "12000-16000"]) - avgReportBands(feature, ["9000-12000", "12000-16000"]);

  if (bodyDiff > 0.45 || delta.bodyDeltaDb < -0.6) {
    applyEqMove(nextEq, 360, clamp(-Math.max(bodyDiff, Math.abs(delta.bodyDeltaDb)) * 0.24 * scale, -1.2, -0.1), 1.05);
  }
  if (nasalDiff > 0.45) {
    applyEqMove(nextEq, 720, clamp(-nasalDiff * 0.2 * scale, -0.85, -0.08), 1.1);
  }
  if (track.role !== "bass" && lowDiff > 1) {
    applyEqMove(nextEq, 185, clamp(-lowDiff * 0.18 * scale, -0.9, -0.08), 0.9);
  }
  if (track.role !== "bass" && airDiff > 1.1 && band(feature, "12000-16000") < band(reference, "12000-16000") + 2) {
    applyEqMove(nextEq, 10500, clamp(airDiff * 0.12 * scale, 0.05, 0.55), 0.75);
  }

  const isCenter = CENTER_ROLES.has(track.role);
  const widthPan = !isCenter && delta.stereoWidthDelta > 0.04 ? clamp(track.pan + Math.sign(track.pan || 1) * 0.04 * scale, -0.55, 0.55) : track.pan;
  const loudnessFollow = clamp(delta.loudnessDeltaDb * 0.06 * scale, -0.7, 0.55);

  return {
    ...track,
    gainDb: round1(track.gainDb + loudnessFollow),
    pan: isCenter ? clamp(track.pan, -0.04, 0.04) : round2(widthPan),
    eq: nextEq,
  };
}

function applyEqMove(eq: ParametricEQState, frequency: number, gainDb: number, q: number) {
  let bandRef = eq.bands.find((band) => band.type === "peaking" && Math.abs(band.frequency - frequency) < 130);
  if (!bandRef) {
    bandRef = eq.bands.find((band) => band.type === "peaking" && Math.abs(band.gainDb) < 0.05);
  }
  if (!bandRef) return;
  bandRef.enabled = true;
  bandRef.frequency = frequency;
  bandRef.gainDb = round1(clamp(gainDb, -3, 2));
  bandRef.q = round2(clamp(q, 0.3, 5));
}

function getTimelinePanSide(role: StemRole, trackIndex: number, clipOrder: number, timelineStartSec: number) {
  const stableSide = trackIndex % 2 === 0 ? -1 : 1;
  const phraseIndex = Math.floor(Math.max(0, timelineStartSec) / 8);
  switch (role) {
    case "vocal":
    case "drums":
    case "bass":
    case "reference":
      return 0;
    case "backingVocal":
      return clipOrder % 2 === 0 ? stableSide : -stableSide;
    case "fx":
    case "loop":
    case "other":
      return (trackIndex + clipOrder + phraseIndex) % 2 === 0 ? -1 : 1;
    case "synth":
    case "keys":
      return (trackIndex + Math.floor(clipOrder / 2) + phraseIndex) % 2 === 0 ? -1 : 1;
    default:
      return stableSide;
  }
}

function roleDefaultPan(role: StemRole) {
  switch (role) {
    case "backingVocal":
      return 0.3;
    case "guitar":
      return 0.42;
    case "synth":
      return 0.46;
    case "fx":
      return 0.58;
    case "keys":
      return 0.32;
    case "loop":
    case "music":
      return 0.28;
    default:
      return 0.2;
  }
}

function getPanDesignBase(role: StemRole, mode: ClipPanDesignMode) {
  const base = roleDefaultPan(role);
  if (mode !== "referencePlus") return base;
  switch (role) {
    case "backingVocal":
      return 0.34;
    case "guitar":
      return 0.5;
    case "synth":
      return 0.54;
    case "fx":
      return 0.64;
    case "keys":
      return 0.38;
    case "loop":
    case "music":
      return 0.34;
    case "other":
      return 0.3;
    default:
      return base;
  }
}

function avgBands(summary: PeakSummary, ids: string[]) {
  const values = ids.map((id) => summary.bandEnergyDb?.[id]).filter((value): value is number => Number.isFinite(value));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : -72;
}

function band(report: StemFeatureReport | ReferenceProfile, id: keyof StemFeatureReport["bandEnergyDb"]) {
  const value = report.bandEnergyDb[id];
  return Number.isFinite(value) ? value : -72;
}

function avgReportBands(report: StemFeatureReport | ReferenceProfile, ids: Array<keyof StemFeatureReport["bandEnergyDb"]>) {
  const values = ids.map((id) => band(report, id));
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function scoreToConfidence(scoreDb: number, bonus = 0) {
  return round2(clamp(0.42 + scoreDb / 32 + bonus, 0, 0.95));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
