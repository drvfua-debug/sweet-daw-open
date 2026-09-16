import type { PluginInstance } from "@/daw/model/Plugin";
import type { Clip, Project, StemRole, Track } from "@/daw/model/Project";

export type VocalDuckWindow = {
  startSec: number;
  endSec: number;
  weight: number;
  level?: number;
  source?: "audio-analysis" | "clip-fallback";
};

export type VocalActivityEnvelope = {
  windows: VocalDuckWindow[];
  source: "audio-analysis" | "clip-fallback" | "mixed";
  frameSec: number;
  analyzedClipCount: number;
  fallbackClipCount: number;
};

export type VocalActivityAudioBuffer = {
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  getChannelData: (channel: number) => Float32Array;
};

export type VocalActivityBufferRegistry = {
  getBuffer: (fileId: string) => VocalActivityAudioBuffer | null;
};

type VocalDuckParams = {
  frequencyHz: number;
  q: number;
  maxReductionDb: number;
  threshold: number;
  attackSec: number;
  releaseSec: number;
  mix: number;
};

export type DynamicVocalDuckNode = {
  input: GainNode;
  output: GainNode;
  filter: BiquadFilterNode;
  apply: (chain: PluginInstance[], options?: { smooth?: boolean }) => void;
  updateFromLevel: (level: number, atTime?: number) => void;
  scheduleDuckWindows: (windows: VocalDuckWindow[], options?: VocalDuckScheduleOptions) => void;
  dispose: () => void;
};

export type VocalDuckScheduleOptions = {
  timelinePositionSec?: number;
  startAtContextTime?: number;
};

const PLUGIN_ID = "sweet-vocal-duck-eq";
const VOCAL_ACTIVITY_FRAME_SEC = 0.032;
const VOCAL_ACTIVITY_MIN_LEVEL = 0.01;
const VOCAL_ACTIVITY_SEGMENT_SEC = 0.32;
const BACKING_VOCAL_ACTIVITY_WEIGHT = 0.62;
const vocalActivityCache = new WeakMap<VocalActivityAudioBuffer, Float32Array>();

export function hasVocalDuckPlugin(chain: PluginInstance[]) {
  return chain.some((plugin) => plugin.enabled && plugin.pluginId === PLUGIN_ID);
}

export function shouldUseVocalDuck(track: Track) {
  return isVocalDuckTargetRole(track.role) && hasVocalDuckPlugin(track.insertChain);
}

export function isVocalDuckTargetRole(role: StemRole) {
  return role === "music" || role === "guitar" || role === "synth" || role === "keys" || role === "loop" || role === "fx" || role === "other";
}

export function isVocalDuckSourceRole(role: StemRole) {
  return role === "vocal" || role === "backingVocal";
}

export function getVocalDuckSignature(track: Track) {
  const plugin = getVocalDuckPlugin(track.insertChain);
  if (!plugin) return "vduck:off";
  const params = readVocalDuckParams(plugin);
  return [
    "vduck:on",
    params.frequencyHz,
    params.q,
    params.maxReductionDb,
    params.threshold,
    params.attackSec,
    params.releaseSec,
    params.mix,
  ].join(":");
}

export function createDynamicVocalDuckNode(context: BaseAudioContext, chain: PluginInstance[]): DynamicVocalDuckNode {
  const input = context.createGain();
  const filter = context.createBiquadFilter();
  const output = context.createGain();
  let params = getVocalDuckParams(chain);
  let currentReductionDb = 0;

  filter.type = "peaking";
  filter.frequency.value = params.frequencyHz;
  filter.Q.value = params.q;
  filter.gain.value = 0;

  input.connect(filter);
  filter.connect(output);

  const apply = (nextChain: PluginInstance[], options: { smooth?: boolean } = {}) => {
    params = getVocalDuckParams(nextChain);
    const now = context.currentTime;
    if (options.smooth) {
      filter.frequency.setTargetAtTime(params.frequencyHz, now, 0.02);
      filter.Q.setTargetAtTime(params.q, now, 0.02);
    } else {
      filter.frequency.setValueAtTime(params.frequencyHz, now);
      filter.Q.setValueAtTime(params.q, now);
    }
  };

  const updateFromLevel = (level: number, atTime = context.currentTime) => {
    const targetReductionDb = calculateVocalDuckTargetReductionDb(level, params);
    const timeConstant = targetReductionDb < currentReductionDb ? params.attackSec : params.releaseSec;
    filter.gain.setTargetAtTime(targetReductionDb, atTime, Math.max(0.003, timeConstant));
    currentReductionDb = targetReductionDb;
  };

  const scheduleDuckWindows = (windows: VocalDuckWindow[], options: VocalDuckScheduleOptions = {}) => {
    const timelinePositionSec = Math.max(0, options.timelinePositionSec ?? 0);
    const startAtContextTime = Math.max(context.currentTime, options.startAtContextTime ?? 0);
    filter.gain.cancelScheduledValues(startAtContextTime);
    filter.gain.setValueAtTime(0, startAtContextTime);

    for (const window of windows) {
      const timelineStart = Math.max(0, window.startSec);
      const timelineEnd = Math.max(timelineStart + 0.01, window.endSec);
      if (timelineEnd <= timelinePositionSec) continue;
      const reduction = getWindowReductionDb(window, params);
      if (reduction >= -0.005) continue;

      const start = startAtContextTime + Math.max(0, timelineStart - timelinePositionSec);
      const end = startAtContextTime + Math.max(0, timelineEnd - timelinePositionSec);
      if (timelineStart <= timelinePositionSec) {
        filter.gain.setTargetAtTime(reduction, startAtContextTime, Math.max(0.003, params.attackSec));
      } else {
        filter.gain.setTargetAtTime(reduction, start, Math.max(0.003, params.attackSec));
      }
      filter.gain.setTargetAtTime(0, end, Math.max(0.003, params.releaseSec));
    }
  };

  return {
    input,
    output,
    filter,
    apply,
    updateFromLevel,
    scheduleDuckWindows,
    dispose: () => {
      input.disconnect();
      filter.disconnect();
      output.disconnect();
    },
  };
}

export function buildVocalActivityWindows(project: Project, registry?: VocalActivityBufferRegistry): VocalDuckWindow[] {
  return buildVocalActivityEnvelope(project, registry).windows;
}

export function buildVocalActivityEnvelope(project: Project, registry?: VocalActivityBufferRegistry): VocalActivityEnvelope {
  const soloActive = project.tracks.some((track) => track.solo && track.role !== "reference");
  const vocalTrackIds = new Set(
    project.tracks
      .filter((track) => isVocalDuckSourceRole(track.role) && !track.mute && (!soloActive || track.solo))
      .map((track) => track.id),
  );

  if (vocalTrackIds.size === 0) {
    return {
      windows: [],
      source: "clip-fallback",
      frameSec: VOCAL_ACTIVITY_FRAME_SEC,
      analyzedClipCount: 0,
      fallbackClipCount: 0,
    };
  }

  const vocalClips = project.clips
    .filter((clip) => vocalTrackIds.has(clip.trackId) && clip.durationSec > 0)
    .sort((a, b) => a.timelineStartSec - b.timelineStartSec);

  if (!registry) {
    const windows = buildFallbackVocalActivityWindows(project, vocalClips);
    return {
      windows,
      source: "clip-fallback",
      frameSec: VOCAL_ACTIVITY_FRAME_SEC,
      analyzedClipCount: 0,
      fallbackClipCount: vocalClips.length,
    };
  }

  const powerByFrame = new Map<number, number>();
  const fallbackClips: Clip[] = [];
  let analyzedClipCount = 0;

  for (const clip of vocalClips) {
    const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
    if (!track) continue;
    const fileId = clip.isFrozen && clip.frozenRenderFileId ? clip.frozenRenderFileId : clip.fileId;
    const buffer = registry.getBuffer(fileId);
    if (!buffer) {
      fallbackClips.push(clip);
      continue;
    }

    addClipActivityToTimeline(powerByFrame, clip, track, getBufferActivityFrames(buffer));
    analyzedClipCount += 1;
  }

  const audioWindows = buildAudioActivityWindows(powerByFrame);
  const fallbackWindows = buildFallbackVocalActivityWindows(project, fallbackClips);
  const source = analyzedClipCount > 0
    ? fallbackWindows.length > 0 ? "mixed" : "audio-analysis"
    : "clip-fallback";

  return {
    windows: [...audioWindows, ...fallbackWindows].sort((a, b) => a.startSec - b.startSec),
    source,
    frameSec: VOCAL_ACTIVITY_FRAME_SEC,
    analyzedClipCount,
    fallbackClipCount: fallbackClips.length,
  };
}

function buildFallbackVocalActivityWindows(project: Project, clips: Clip[]) {
  const rawWindows = clips
    .map((clip) => {
      const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
      return {
        startSec: Math.max(0, clip.timelineStartSec - 0.02),
        endSec: clip.timelineStartSec + clip.durationSec + 0.12,
        weight: track?.role === "backingVocal" ? 0.65 : 1,
        source: "clip-fallback" as const,
      };
    })
    .sort((a, b) => a.startSec - b.startSec);

  const merged: VocalDuckWindow[] = [];
  for (const window of rawWindows) {
    const previous = merged[merged.length - 1];
    if (previous && window.startSec <= previous.endSec + 0.16) {
      previous.endSec = Math.max(previous.endSec, window.endSec);
      previous.weight = Math.max(previous.weight, window.weight);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function addClipActivityToTimeline(
  powerByFrame: Map<number, number>,
  clip: Clip,
  track: Track,
  activityFrames: Float32Array,
) {
  const sourceStartFrame = Math.max(0, Math.floor(clip.sourceStartSec / VOCAL_ACTIVITY_FRAME_SEC));
  const sourceEndFrame = Math.min(
    activityFrames.length,
    Math.ceil((clip.sourceStartSec + clip.durationSec) / VOCAL_ACTIVITY_FRAME_SEC),
  );
  const roleWeight = track.role === "backingVocal" ? BACKING_VOCAL_ACTIVITY_WEIGHT : 1;
  const gain = dbToGain((track.gainDb ?? 0) + (clip.gainDb ?? 0)) * roleWeight;

  for (let sourceFrame = sourceStartFrame; sourceFrame < sourceEndFrame; sourceFrame += 1) {
    const sourceTimeSec = sourceFrame * VOCAL_ACTIVITY_FRAME_SEC;
    const localTimeSec = sourceTimeSec - clip.sourceStartSec;
    if (localTimeSec < 0 || localTimeSec >= clip.durationSec) continue;
    const fade = getClipFadeGain(clip, localTimeSec);
    const level = (activityFrames[sourceFrame] ?? 0) * gain * fade;
    if (level < VOCAL_ACTIVITY_MIN_LEVEL) continue;
    const timelineFrame = Math.max(0, Math.floor((clip.timelineStartSec + localTimeSec) / VOCAL_ACTIVITY_FRAME_SEC));
    powerByFrame.set(timelineFrame, (powerByFrame.get(timelineFrame) ?? 0) + level * level);
  }
}

function getBufferActivityFrames(buffer: VocalActivityAudioBuffer) {
  const cached = vocalActivityCache.get(buffer);
  if (cached) return cached;

  const frameSamples = Math.max(1, Math.round(buffer.sampleRate * VOCAL_ACTIVITY_FRAME_SEC));
  const frameCount = Math.ceil(buffer.length / frameSamples);
  const frames = new Float32Array(frameCount);
  const channels = Math.max(1, buffer.numberOfChannels);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSamples;
    const end = Math.min(buffer.length, start + frameSamples);
    let sumSquares = 0;
    let samples = 0;
    for (let index = start; index < end; index += 1) {
      let mono = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        mono += buffer.getChannelData(channel)[index] ?? 0;
      }
      mono /= channels;
      sumSquares += mono * mono;
      samples += 1;
    }
    frames[frame] = Math.sqrt(sumSquares / Math.max(1, samples));
  }

  vocalActivityCache.set(buffer, frames);
  return frames;
}

function buildAudioActivityWindows(powerByFrame: Map<number, number>) {
  const indices = Array.from(powerByFrame.keys()).sort((a, b) => a - b);
  if (indices.length === 0) return [];

  const windows: VocalDuckWindow[] = [];
  let startFrame = -1;
  let endFrame = -1;
  let levelSum = 0;
  let levelCount = 0;
  let quantizedLevel = 0;

  const pushWindow = () => {
    if (startFrame < 0 || levelCount === 0) return;
    const level = levelSum / levelCount;
    windows.push({
      startSec: round3(startFrame * VOCAL_ACTIVITY_FRAME_SEC),
      endSec: round3((endFrame + 1) * VOCAL_ACTIVITY_FRAME_SEC),
      weight: clamp01(level / 0.1),
      level,
      source: "audio-analysis",
    });
    startFrame = -1;
    endFrame = -1;
    levelSum = 0;
    levelCount = 0;
    quantizedLevel = 0;
  };

  for (const frame of indices) {
    const level = Math.sqrt(powerByFrame.get(frame) ?? 0);
    if (level < VOCAL_ACTIVITY_MIN_LEVEL) {
      pushWindow();
      continue;
    }
    const nextQuantizedLevel = Math.round(level / 0.012) * 0.012;
    const contiguous = startFrame >= 0 && frame === endFrame + 1;
    const withinSegment = startFrame >= 0 && (frame - startFrame + 1) * VOCAL_ACTIVITY_FRAME_SEC <= VOCAL_ACTIVITY_SEGMENT_SEC;
    if (!contiguous || !withinSegment || Math.abs(nextQuantizedLevel - quantizedLevel) > 0.012) {
      pushWindow();
      startFrame = frame;
      quantizedLevel = nextQuantizedLevel;
    }
    endFrame = frame;
    levelSum += level;
    levelCount += 1;
  }
  pushWindow();
  return windows;
}

function getClipFadeGain(clip: Clip, localTimeSec: number) {
  const fadeIn = clip.fadeInSec > 0 ? clamp01(localTimeSec / clip.fadeInSec) : 1;
  const remaining = Math.max(0, clip.durationSec - localTimeSec);
  const fadeOut = clip.fadeOutSec > 0 ? clamp01(remaining / clip.fadeOutSec) : 1;
  return Math.min(fadeIn, fadeOut);
}

/**
 * Mirrors the live detector target. Phase 0 uses this to characterize the
 * difference between live level-following and offline clip-span scheduling.
 */
export function getVocalDuckTargetReductionDb(level: number, chain: PluginInstance[]) {
  return calculateVocalDuckTargetReductionDb(level, getVocalDuckParams(chain));
}

function getVocalDuckParams(chain: PluginInstance[]): VocalDuckParams {
  return readVocalDuckParams(getVocalDuckPlugin(chain));
}

function getVocalDuckPlugin(chain: PluginInstance[]) {
  return chain.find((plugin) => plugin.enabled && plugin.pluginId === PLUGIN_ID) ?? null;
}

function readVocalDuckParams(plugin: PluginInstance | null): VocalDuckParams {
  const params = plugin?.params ?? {};
  return {
    frequencyHz: clamp(readNumber(params.frequencyHz, 2500), 1200, 4800),
    q: clamp(readNumber(params.q, 1.1), 0.4, 3.5),
    maxReductionDb: clamp(readNumber(params.maxReductionDb, 1.6), 0, 4),
    threshold: clamp(readNumber(params.threshold, 0.035), 0.005, 0.16),
    attackSec: clamp(readNumber(params.attackMs, 35), 5, 120) / 1000,
    releaseSec: clamp(readNumber(params.releaseMs, 180), 60, 500) / 1000,
    mix: clamp01(readNumber(params.mix, 1)),
  };
}

function calculateVocalDuckTargetReductionDb(level: number, params: VocalDuckParams) {
  const over = clamp01((level - params.threshold) / Math.max(params.threshold, 0.001));
  return -params.maxReductionDb * params.mix * over;
}

function getWindowReductionDb(window: VocalDuckWindow, params: VocalDuckParams) {
  if (typeof window.level === "number" && Number.isFinite(window.level)) {
    return calculateVocalDuckTargetReductionDb(window.level, params);
  }
  return -params.maxReductionDb * params.mix * clamp01(window.weight);
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
