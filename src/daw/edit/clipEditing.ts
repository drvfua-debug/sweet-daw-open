import { createId, type Clip } from "../model/Project";
import type { PluginInstance, PluginTargetKind } from "../model/Plugin";

const EPSILON = 0.000001;

export type SplitClipDebug = {
  clipId: string;
  requestedSplitTimeSec: number;
  snapMode: "off" | "beat" | "bar" | "manual";
  snappedSplitTimeSec: number | null;
  finalSplitTimeSec: number | null;
  clipTimelineStartSec: number;
  clipSourceStartSec: number;
  clipDurationSec: number;
  relativeSplitSec: number | null;
  leftDurationSec: number | null;
  rightSourceStartSec: number | null;
  rightDurationSec: number | null;
  rejectedReason?: string;
};

export type SplitClipResult =
  | {
      ok: true;
      leftClip: Clip;
      rightClip: Clip;
      debug: SplitClipDebug;
    }
  | {
      ok: false;
      debug: SplitClipDebug;
    };

export function clonePluginChainForTarget(chain: PluginInstance[] = [], target: PluginTargetKind) {
  return chain.map((plugin) => ({
    ...plugin,
    id: createId("plugin"),
    target,
    params: { ...plugin.params },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

export function splitClipAtTime(
  clip: Clip,
  requestedSplitTimeSec: number,
  options: {
    applySnap?: boolean;
    snapMode?: "off" | "beat" | "bar" | "manual";
    snapTime?: (seconds: number) => number;
  } = {},
): SplitClipResult {
  const snapMode = options.snapMode ?? "manual";
  const snappedSplitTimeSec = options.applySnap && options.snapTime ? options.snapTime(requestedSplitTimeSec) : null;
  const finalSplitTimeSec = snappedSplitTimeSec ?? requestedSplitTimeSec;
  const relativeSplitSec = finalSplitTimeSec - clip.timelineStartSec;
  const baseDebug: SplitClipDebug = {
    clipId: clip.id,
    requestedSplitTimeSec,
    snapMode,
    snappedSplitTimeSec,
    finalSplitTimeSec,
    clipTimelineStartSec: clip.timelineStartSec,
    clipSourceStartSec: clip.sourceStartSec,
    clipDurationSec: clip.durationSec,
    relativeSplitSec,
    leftDurationSec: null,
    rightSourceStartSec: null,
    rightDurationSec: null,
  };

  if (clip.reverse) {
    return reject(baseDebug, "reverse clip split rejected");
  }

  if (!Number.isFinite(requestedSplitTimeSec) || !Number.isFinite(finalSplitTimeSec)) {
    return reject(baseDebug, "invalid split time");
  }

  if (relativeSplitSec <= EPSILON) {
    return reject(baseDebug, "split is at or before clip start");
  }

  if (relativeSplitSec >= clip.durationSec - EPSILON) {
    return reject(baseDebug, "split is at or after clip end");
  }

  const leftClip: Clip = {
    ...clip,
    durationSec: relativeSplitSec,
  };
  const rightClip: Clip = {
    ...clip,
    id: createId("clip"),
    timelineStartSec: finalSplitTimeSec,
    sourceStartSec: clip.sourceStartSec + relativeSplitSec,
    durationSec: clip.durationSec - relativeSplitSec,
    insertChain: clonePluginChainForTarget(clip.insertChain, "clip"),
    createdBy: "split",
  };

  return {
    ok: true,
    leftClip,
    rightClip,
    debug: {
      ...baseDebug,
      leftDurationSec: leftClip.durationSec,
      rightSourceStartSec: rightClip.sourceStartSec,
      rightDurationSec: rightClip.durationSec,
    },
  };
}

function reject(debug: SplitClipDebug, rejectedReason: string): SplitClipResult {
  return {
    ok: false,
    debug: {
      ...debug,
      finalSplitTimeSec: debug.finalSplitTimeSec,
      rejectedReason,
    },
  };
}
