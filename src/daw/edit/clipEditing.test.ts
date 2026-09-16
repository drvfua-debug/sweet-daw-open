import { describe, expect, it } from "vitest";
import { splitClipAtTime } from "./clipEditing";
import type { Clip } from "../model/Project";

function clip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "clip_a",
    trackId: "track_a",
    fileId: "file_a",
    role: "other",
    intentTags: [],
    actionHistory: [],
    timelineStartSec: 10,
    sourceStartSec: 0,
    durationSec: 8,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: true,
    movementLocked: true,
    insertChain: [],
    ...patch,
  };
}

describe("splitClipAtTime", () => {
  it("splits an untrimmed clip at the requested timeline position", () => {
    const result = splitClipAtTime(clip(), 14);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leftClip.timelineStartSec).toBe(10);
    expect(result.leftClip.sourceStartSec).toBe(0);
    expect(result.leftClip.durationSec).toBe(4);
    expect(result.rightClip.timelineStartSec).toBe(14);
    expect(result.rightClip.sourceStartSec).toBe(4);
    expect(result.rightClip.durationSec).toBe(4);
  });

  it("splits a trimmed clip without losing source offset", () => {
    const result = splitClipAtTime(clip({ timelineStartSec: 20, sourceStartSec: 5, durationSec: 10 }), 23);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leftClip.sourceStartSec).toBe(5);
    expect(result.leftClip.durationSec).toBe(3);
    expect(result.rightClip.timelineStartSec).toBe(23);
    expect(result.rightClip.sourceStartSec).toBe(8);
    expect(result.rightClip.durationSec).toBe(7);
  });

  it("rejects split at clip start or end instead of clamping", () => {
    expect(splitClipAtTime(clip({ timelineStartSec: 5, durationSec: 4 }), 5).ok).toBe(false);
    expect(splitClipAtTime(clip({ timelineStartSec: 5, durationSec: 4 }), 9).ok).toBe(false);
    expect(splitClipAtTime(clip({ timelineStartSec: 5, durationSec: 4 }), 11).ok).toBe(false);
  });

  it("applies snap once when requested and then validates the result", () => {
    const result = splitClipAtTime(
      clip({ timelineStartSec: 10, sourceStartSec: 2, durationSec: 8 }),
      13.96,
      {
        applySnap: true,
        snapMode: "beat",
        snapTime: () => 14,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rightClip.sourceStartSec).toBe(6);
    expect(result.debug.snappedSplitTimeSec).toBe(14);
  });

  it("keeps clip movement lock on both sides after splitting", () => {
    const result = splitClipAtTime(clip({ movementLocked: true }), 12);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leftClip.movementLocked).toBe(true);
    expect(result.rightClip.movementLocked).toBe(true);
  });
});
