import type { Project } from "@/daw/model/Project";

const MB = 1024 * 1024;

export type SingleFileExportPlan = {
  sampleRate: 44100 | 48000;
  durationSec: number;
  estimatedPcmBytes: number;
  estimatedResidentPcmBytes: number;
  estimatedWorkingBytes: number;
  activeTrackCount: number;
  previewDurationSec: number;
  chunkDurationSec: number;
  lowMemoryMode: boolean;
  reasons: string[];
};

export type SingleFileExportPlanInput = {
  project: Project;
  sampleRate: 44100 | 48000;
  durationSec: number;
  isMobile: boolean;
  registryPcmBytes?: number;
};

export function buildSingleFileExportPlan(input: SingleFileExportPlanInput): SingleFileExportPlan {
  const durationSec = Math.max(0.1, input.durationSec);
  const estimatedPcmBytes = Math.ceil(durationSec * input.sampleRate * 2 * Float32Array.BYTES_PER_ELEMENT);
  const metadataPcmBytes = estimateProjectDecodedPcmBytes(input.project);
  const estimatedResidentPcmBytes = Math.max(metadataPcmBytes, Math.max(0, input.registryPcmBytes ?? 0));
  const activeTrackCount = countActiveRenderTracks(input.project);
  const baseBytes = input.isMobile ? 48 * MB : 64 * MB;
  const transientMultiplier = input.isMobile ? 3.2 : 2.45;
  const estimatedWorkingBytes = Math.ceil(estimatedResidentPcmBytes + estimatedPcmBytes * transientMultiplier + baseBytes);
  const memoryLimitBytes = input.isMobile ? 300 * MB : 1024 * MB;
  const reasons: string[] = [];

  if (estimatedWorkingBytes > memoryLimitBytes) reasons.push("working-memory");
  if (input.isMobile && activeTrackCount >= 6) reasons.push("multi-stem");
  if (input.isMobile && estimatedResidentPcmBytes > 180 * MB) reasons.push("decoded-audio");
  if (input.isMobile && estimatedPcmBytes > 72 * MB) reasons.push("long-render");

  const lowMemoryMode = reasons.length > 0;
  const veryHeavy = activeTrackCount >= 10 || estimatedResidentPcmBytes > 640 * MB;
  const heavy = activeTrackCount >= 8 || estimatedResidentPcmBytes > 384 * MB;
  const medium = activeTrackCount >= 6 || estimatedResidentPcmBytes > 240 * MB;
  const previewDurationSec = input.isMobile
    ? veryHeavy ? 10 : heavy ? 12 : medium ? 16 : 24
    : lowMemoryMode ? 30 : 45;
  const chunkDurationSec = input.isMobile
    ? veryHeavy ? 6 : heavy ? 7 : medium ? 8 : 10
    : 18;
  const sourceBytesPerSec = Math.max(1, activeTrackCount) * input.sampleRate * 2 * Float32Array.BYTES_PER_ELEMENT;
  const streamedSourceBudgetBytes = input.isMobile ? 28 * MB : 96 * MB;
  const rollAllowanceSec = input.isMobile ? 0.95 : 1.5;
  const minimumChunkSec = input.isMobile ? 0.25 : 1;
  const sourceBoundChunkSec = Math.max(
    minimumChunkSec,
    streamedSourceBudgetBytes / sourceBytesPerSec - rollAllowanceSec,
  );
  const adaptiveChunkDurationSec = Math.max(
    minimumChunkSec,
    Math.min(chunkDurationSec, sourceBoundChunkSec),
  );

  return {
    sampleRate: input.sampleRate,
    durationSec,
    estimatedPcmBytes,
    estimatedResidentPcmBytes,
    estimatedWorkingBytes,
    activeTrackCount,
    previewDurationSec,
    chunkDurationSec: Math.round(adaptiveChunkDurationSec * 100) / 100,
    lowMemoryMode,
    reasons,
  };
}

export function estimateProjectDecodedPcmBytes(project: Project) {
  return project.files.reduce((total, file) => {
    const durationSec = Math.max(0, file.durationSec || 0);
    const sampleRate = Math.max(1, file.sampleRate || project.sampleRate || 48000);
    const channels = Math.max(1, file.channelCount || 1);
    return total + durationSec * sampleRate * channels * Float32Array.BYTES_PER_ELEMENT;
  }, 0);
}

export function countActiveRenderTracks(project: Project) {
  const trackIdsWithClips = new Set(project.clips.map((clip) => clip.trackId));
  const renderTracks = project.tracks.filter((track) =>
    track.role !== "reference"
    && track.type !== "reference"
    && trackIdsWithClips.has(track.id),
  );
  const soloActive = renderTracks.some((track) => track.solo && !track.mute);
  return renderTracks.filter((track) => !track.mute && (!soloActive || track.solo)).length;
}
