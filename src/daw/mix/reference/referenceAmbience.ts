import type { Project, StemRole, Track } from "../../model/Project";
import type { ReferenceDelta, ReferenceProfile } from "../mixDoctorTypes";

export type ReferenceAmbienceMode = "safe" | "balanced" | "loud" | "dense" | "referenceMatch" | "suggestOnly";

export type ReferenceAmbienceResult = {
  project: Project;
  decisions: string[];
  affectedTracks: number;
  amount: number;
};

const REFERENCE_AMBIENCE_SEND_PREFIX = "aimix-reference-ambience";
const AMBIENCE_BUS_ID = "bus-ambience";
const DRY_CENTER_ROLES = new Set<StemRole>(["reference", "drums", "bass"]);

export function applyReferenceAmbienceFollowToProject(
  project: Project,
  referenceProfile: ReferenceProfile | null,
  referenceDelta: ReferenceDelta | null,
  mode: ReferenceAmbienceMode,
): ReferenceAmbienceResult {
  if (!referenceProfile || mode === "suggestOnly") {
    return {
      project: stripReferenceAmbienceSends(project),
      decisions: referenceProfile ? ["Reference Ambience: Suggest modeなので空間sendは変更しません。"] : [],
      affectedTracks: 0,
      amount: 0,
    };
  }

  const amount = estimateReferenceAmbienceAmount(referenceProfile, referenceDelta, mode);
  if (amount < 0.18) {
    return {
      project: stripReferenceAmbienceSends(project),
      decisions: ["Reference Ambience: Referenceはドライ寄りなので、自動リバーブsendを足しません。"],
      affectedTracks: 0,
      amount,
    };
  }

  let affectedTracks = 0;
  const tracks = project.tracks.map((track) => {
    const cleanSends = removeAutoAmbienceSend(track.sends);
    if (track.mute || DRY_CENTER_ROLES.has(track.role)) {
      return cleanSends === track.sends ? track : { ...track, sends: cleanSends };
    }

    const gainDb = getReferenceAmbienceSendGain(track.role, amount, mode);
    if (gainDb == null) return cleanSends === track.sends ? track : { ...track, sends: cleanSends };

    affectedTracks += 1;
    return {
      ...track,
      sends: [
        ...cleanSends,
        {
          id: `${REFERENCE_AMBIENCE_SEND_PREFIX}-${track.id}`,
          targetBusId: AMBIENCE_BUS_ID,
          gainDb,
          enabled: true,
        },
      ],
    };
  });

  return {
    project: {
      ...project,
      tracks,
      updatedAt: new Date().toISOString(),
    },
    decisions: [
      `Reference Ambience: ${affectedTracks}本のstemへ控えめな空間sendを反映しました。`,
      "Reference Ambience: bass/drums/referenceはドライ・センター維持です。",
    ],
    affectedTracks,
    amount,
  };
}

function stripReferenceAmbienceSends(project: Project): Project {
  let changed = false;
  const tracks = project.tracks.map((track) => {
    const sends = removeAutoAmbienceSend(track.sends);
    if (sends === track.sends) return track;
    changed = true;
    return { ...track, sends };
  });
  return changed ? { ...project, tracks, updatedAt: new Date().toISOString() } : project;
}

function removeAutoAmbienceSend(sends: Track["sends"]): Track["sends"] {
  const next = sends.filter((send) => !(send.targetBusId === AMBIENCE_BUS_ID && send.id.startsWith(REFERENCE_AMBIENCE_SEND_PREFIX)));
  return next.length === sends.length ? sends : next;
}

function estimateReferenceAmbienceAmount(
  referenceProfile: ReferenceProfile,
  referenceDelta: ReferenceDelta | null,
  mode: ReferenceAmbienceMode,
) {
  const widthScore = clamp01((referenceProfile.sideMidRatioDb + 22) / 16);
  const decorrelationScore = clamp01((0.95 - referenceProfile.lrCorrelation) / 0.48);
  const airScore = clamp01((averageBands(referenceProfile, ["9000-12000", "12000-16000"]) + 34) / 20);
  const widthDeltaScore = referenceDelta ? clamp(referenceDelta.stereoWidthDelta / 35, -0.18, 0.24) : 0;
  const modeBias = mode === "safe" ? -0.06 : mode === "dense" || mode === "loud" ? 0.06 : mode === "referenceMatch" ? 0.04 : 0;
  return round2(clamp(widthScore * 0.42 + decorrelationScore * 0.34 + airScore * 0.14 + widthDeltaScore + modeBias, 0, 1));
}

function getReferenceAmbienceSendGain(role: StemRole, amount: number, mode: ReferenceAmbienceMode) {
  const modeScale = mode === "safe" ? 0.78 : mode === "dense" || mode === "loud" ? 1.15 : 1;
  if (role === "vocal") return round1(clamp(-26 + amount * 10 * modeScale, -26, -16));
  if (role === "backingVocal") return round1(clamp(-25 + amount * 11 * modeScale, -26, -15));
  if (role === "fx") return round1(clamp(-27 + amount * 10 * modeScale, -28, -17));
  if (role === "music" || role === "synth" || role === "keys" || role === "guitar" || role === "loop" || role === "other") {
    return round1(clamp(-28 + amount * 10 * modeScale, -28, -14));
  }
  return null;
}

function averageBands(profile: ReferenceProfile, ids: Array<keyof ReferenceProfile["bandEnergyDb"]>) {
  const values = ids.map((id) => profile.bandEnergyDb[id]).filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return -60;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
