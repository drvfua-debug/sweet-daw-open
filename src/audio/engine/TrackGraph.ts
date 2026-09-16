import type { Project, Track } from "@/daw/model/Project";

export function dbToGain(db: number) {
  if (db <= -60) return 0;
  return 10 ** (db / 20);
}

export function getProjectDurationSec(project: Pick<Project, "clips">) {
  return project.clips.reduce((duration, clip) => {
    return Math.max(duration, clip.timelineStartSec + clip.durationSec);
  }, 0);
}

export function isReferenceTrack(track: Track) {
  return track.role === "reference" || track.type === "reference";
}

export function hasSoloTrack(tracks: Track[]) {
  return tracks.some((track) => !isReferenceTrack(track) && track.solo);
}

export function isTrackAudible(track: Track, soloActive: boolean) {
  if (isReferenceTrack(track)) return false;
  if (track.mute) return false;
  if (soloActive && !track.solo) return false;
  return true;
}

export function getAudibleTrackGain(track: Track, soloActive: boolean) {
  return isTrackAudible(track, soloActive) ? dbToGain(track.gainDb) : 0;
}
