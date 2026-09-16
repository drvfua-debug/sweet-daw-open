import type { Project } from "@/daw/model/Project";
import type { WavBitDepth } from "./WavEncoder";
import { getPluginRenderWeight, isHeavyRenderPlugin } from "@/audio/plugins/pluginCost";

export type RenderBudgetRisk = "ok" | "warn" | "danger";

export type RenderBudgetReport = {
  risk: RenderBudgetRisk;
  estimatedBytes: number;
  estimatedMb: number;
  sourceDecodedBytes: number;
  offlineOutputBytes: number;
  wavBodyBytes: number;
  pluginWeight: number;
  stemCount: number;
  durationSec: number;
  sampleRate: number;
  bitDepth: WavBitDepth;
  reasons: string[];
};

export type RenderBudgetOptions = {
  durationSec?: number;
  sampleRate: number;
  bitDepth: WavBitDepth;
  memoryBudgetBytes?: number;
};

export function estimateRenderBudget(project: Project, options: RenderBudgetOptions): RenderBudgetReport {
  const durationSec = Math.max(0, options.durationSec ?? estimateProjectDurationSec(project));
  const sampleRate = Math.max(1, Math.round(options.sampleRate));
  const bitDepth = options.bitDepth;
  const bytesPerSample = bitDepth === "pcm24" ? 3 : bitDepth === "float32" ? 4 : 2;
  const audibleTrackIds = new Set(project.tracks
    .filter((track) => track.type !== "reference" && track.role !== "reference" && !track.mute)
    .map((track) => track.id));
  const audibleFileIds = new Set(project.clips
    .filter((clip) => audibleTrackIds.has(clip.trackId))
    .map((clip) => clip.fileId));
  const sourceDecodedBytes = project.files
    .filter((file) => audibleFileIds.has(file.id))
    .reduce((sum, file) => sum + Math.max(0, file.durationSec) * Math.max(1, file.sampleRate) * Math.max(1, file.channelCount) * 4, 0);
  const offlineOutputBytes = durationSec * sampleRate * 2 * 4;
  const wavBodyBytes = durationSec * sampleRate * 2 * bytesPerSample;
  const pluginWeight = estimatePluginWeight(project, audibleTrackIds);
  const estimatedBytes = sourceDecodedBytes + offlineOutputBytes + wavBodyBytes + pluginWeight * 8 * 1024 * 1024;
  const memoryBudgetBytes = Math.max(128 * 1024 * 1024, options.memoryBudgetBytes ?? 768 * 1024 * 1024);
  const reasons: string[] = [];

  if (durationSec > 360) reasons.push("Long project duration.");
  if (audibleTrackIds.size >= 10) reasons.push("Many audible stems/tracks.");
  if (pluginWeight >= 18 || hasHeavyRenderPlugin(project, audibleTrackIds)) reasons.push("Heavy plugin load.");
  if (estimatedBytes > memoryBudgetBytes * 0.72) reasons.push("Estimated render memory is close to the browser budget.");
  if (estimatedBytes > memoryBudgetBytes) reasons.push("Estimated render memory exceeds the browser budget.");
  if (wavBodyBytes > 1.6 * 1024 * 1024 * 1024) reasons.push("WAV body is close to browser Blob limits.");

  const risk: RenderBudgetRisk =
    estimatedBytes > memoryBudgetBytes || wavBodyBytes > 1.9 * 1024 * 1024 * 1024
      ? "danger"
      : reasons.length > 0
        ? "warn"
        : "ok";

  return {
    risk,
    estimatedBytes: Math.round(estimatedBytes),
    estimatedMb: Math.round((estimatedBytes / (1024 * 1024)) * 10) / 10,
    sourceDecodedBytes: Math.round(sourceDecodedBytes),
    offlineOutputBytes: Math.round(offlineOutputBytes),
    wavBodyBytes: Math.round(wavBodyBytes),
    pluginWeight,
    stemCount: audibleTrackIds.size,
    durationSec: Math.round(durationSec * 100) / 100,
    sampleRate,
    bitDepth,
    reasons,
  };
}

function estimateProjectDurationSec(project: Project) {
  return project.clips.reduce((max, clip) => Math.max(max, clip.timelineStartSec + clip.durationSec), 0);
}

function estimatePluginWeight(project: Project, audibleTrackIds: Set<string>) {
  let weight = 0;
  for (const track of project.tracks) {
    if (!audibleTrackIds.has(track.id)) continue;
    weight += track.insertChain.filter((plugin) => plugin.enabled).reduce((sum, plugin) => sum + getPluginRenderWeight(plugin.pluginId), 0);
  }
  weight += project.master.insertChain.filter((plugin) => plugin.enabled).reduce((sum, plugin) => sum + getPluginRenderWeight(plugin.pluginId), 0);
  return Math.round(weight * 10) / 10;
}

function hasHeavyRenderPlugin(project: Project, audibleTrackIds: Set<string>) {
  const trackHeavy = project.tracks.some((track) =>
    audibleTrackIds.has(track.id) && track.insertChain.some((plugin) => plugin.enabled && isHeavyRenderPlugin(plugin.pluginId)),
  );
  const masterHeavy = project.master.insertChain.some((plugin) => plugin.enabled && isHeavyRenderPlugin(plugin.pluginId));
  return trackHeavy || masterHeavy;
}
