import type { MasterState, Project, Track } from "../model/Project";

export function hasDirectWavMasteringSource(project: Project) {
  return getDirectWavReferenceTrack(project) !== null;
}

export function createDirectWavMasteringSource(project: Project): Project | null {
  const referenceTrack = getDirectWavReferenceTrack(project);
  if (!referenceTrack) return null;

  const source = cloneProject(project);
  const sourceTrack = source.tracks.find((track) => track.id === referenceTrack.id);
  if (!sourceTrack) return null;

  const clips = source.clips
    .filter((clip) => clip.trackId === sourceTrack.id)
    .map((clip) => ({
      ...clip,
      role: "music" as const,
      insertChain: [],
      panAutomation: undefined,
      aimixSpatialPan: undefined,
    }));
  const fileIds = new Set(clips.map((clip) => clip.fileId));

  return {
    ...source,
    tracks: [createNeutralDirectWavTrack(sourceTrack)],
    clips,
    files: source.files
      .filter((file) => fileIds.has(file.id))
      .map((file) => ({ ...file, role: "music" as const })),
    master: createNeutralDirectWavMaster(source.master),
    analysis: {
      ...source.analysis,
      notes: [
        ...source.analysis.notes,
        "Direct WAV Polish render source created without changing the original Reference track.",
      ].slice(-80),
    },
  };
}

function getDirectWavReferenceTrack(project: Project) {
  const clipCountByTrack = new Map<string, number>();
  const durationByTrack = new Map<string, number>();
  for (const clip of project.clips) {
    clipCountByTrack.set(clip.trackId, (clipCountByTrack.get(clip.trackId) ?? 0) + 1);
    durationByTrack.set(clip.trackId, (durationByTrack.get(clip.trackId) ?? 0) + clip.durationSec);
  }

  return project.tracks
    .filter((track) =>
      (track.role === "reference" || track.type === "reference") &&
      (clipCountByTrack.get(track.id) ?? 0) > 0,
    )
    .sort((a, b) => (durationByTrack.get(b.id) ?? 0) - (durationByTrack.get(a.id) ?? 0))[0] ?? null;
}

function createNeutralDirectWavTrack(track: Track): Track {
  return {
    ...track,
    name: `${track.name} (Direct WAV Polish)`,
    role: "music",
    type: "music",
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    eq: { ...track.eq, enabled: false },
    character: { ...track.character, enabled: false },
    vocalImage: { ...track.vocalImage, enabled: false },
    compressor: { ...track.compressor, enabled: false, makeupGainDb: 0 },
    insertChain: [],
    sends: track.sends.map((send) => ({ ...send, enabled: false })),
    aimixSpatialPan: undefined,
  };
}

function createNeutralDirectWavMaster(master: MasterState): MasterState {
  return {
    ...master,
    gainDb: 0,
    mixBusTrimDb: 0,
    finalOutputTrimDb: 0,
    finalOutputTrimOwner: "single-wav-polish",
    eq: { ...master.eq, enabled: false },
    compressor: { ...master.compressor, enabled: false, makeupGainDb: 0 },
    limiterEnabled: false,
    vocalImageLayer: { enabled: false },
    insertChain: [],
    exportNormalizePeak: false,
    exportPeakTargetDb: -1.2,
  };
}

function cloneProject(project: Project): Project {
  if (typeof structuredClone === "function") return structuredClone(project);
  return JSON.parse(JSON.stringify(project)) as Project;
}
