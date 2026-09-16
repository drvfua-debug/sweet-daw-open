import { describe, expect, it } from "vitest";
import type { Clip } from "@/daw/model/Project";
import { createSpectralRepairRegion } from "@/daw/repair/repairTypes";
import { buildClipRepairPreview, getClipRepairSegments } from "./repairPreview";

describe("repair preview", () => {
  it("applies non-destructive time-range attenuation and removed-only delta", () => {
    const buffer = fakeAudioBuffer([1, 1, 1, 1, 1, 1, 1, 1], 4);
    const clip = makeClip({ durationSec: 2 });
    const region = createSpectralRepairRegion({
      id: "r1",
      clipId: clip.id,
      problemType: "mud",
      startSec: 0.5,
      endSec: 1.5,
      lowHz: 180,
      highHz: 500,
      amountDb: -12,
      strength: 1,
      featherTimeMs: 0,
    });

    const result = buildClipRepairPreview(buffer, clip, [region], { previewMode: "removed_only" });

    expect(result.original[0]?.[2]).toBeCloseTo(1, 5);
    expect(result.processed[0]?.[2]).toBeLessThan(0.27);
    expect(result.removed[0]?.[2]).toBeGreaterThan(0.7);
    expect(result.preview[0]?.[2]).toBeLessThan(result.removed[0]?.[2] ?? 0);
    expect(result.appliedRegionIds).toEqual(["r1"]);
  });

  it("uses only fixed regions when requested", () => {
    const clip = makeClip({ durationSec: 2 });
    const fixed = createSpectralRepairRegion({ id: "fixed", clipId: clip.id, problemType: "click", startSec: 0, endSec: 0.5, lowHz: 1000, highHz: 12000, fixed: true });
    const draft = createSpectralRepairRegion({ id: "draft", clipId: clip.id, problemType: "mud", startSec: 0.5, endSec: 1, lowHz: 180, highHz: 500, fixed: false });

    expect(getClipRepairSegments(clip, [fixed, draft], { fixedOnly: true }).map((segment) => segment.regionId)).toEqual(["fixed"]);
  });

  it("maps timeline and source coordinate repair regions to clip-local time", () => {
    const clip = makeClip({ timelineStartSec: 5, sourceStartSec: 20, durationSec: 4 });
    const timeline = createSpectralRepairRegion({
      id: "timeline",
      clipId: clip.id,
      coordinateSpace: "timeline",
      problemType: "mud",
      startSec: 5.5,
      endSec: 6.25,
      lowHz: 180,
      highHz: 500,
    });
    const source = createSpectralRepairRegion({
      id: "source",
      fileId: clip.fileId,
      coordinateSpace: "source",
      problemType: "mud",
      startSec: 21,
      endSec: 22,
      lowHz: 180,
      highHz: 500,
    });

    const segments = getClipRepairSegments(clip, [timeline, source]);

    expect(segments.find((segment) => segment.regionId === "timeline")?.startLocalSec).toBeCloseTo(0.5, 5);
    expect(segments.find((segment) => segment.regionId === "timeline")?.endLocalSec).toBeCloseTo(1.25, 5);
    expect(segments.find((segment) => segment.regionId === "source")?.startLocalSec).toBeCloseTo(1, 5);
    expect(segments.find((segment) => segment.regionId === "source")?.endLocalSec).toBeCloseTo(2, 5);
  });

  it("keeps loudness match gain bounded", () => {
    const buffer = fakeAudioBuffer([0.8, 0.8, 0.8, 0.8], 4);
    const clip = makeClip({ durationSec: 1 });
    const region = createSpectralRepairRegion({ id: "deep", clipId: clip.id, problemType: "clipping", startSec: 0, endSec: 1, lowHz: 20, highHz: 20000, amountDb: -24, strength: 1, featherTimeMs: 0 });

    const result = buildClipRepairPreview(buffer, clip, [region], { matchLoudness: true });

    expect(result.metrics.matchGainDb).toBeLessThanOrEqual(6);
    expect(Number.isFinite(result.metrics.processedRmsDb)).toBe(true);
  });
});

function makeClip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    trackId: "track-1",
    fileId: "file-1",
    role: "other",
    clipKind: "audio",
    intentTags: [],
    actionHistory: [],
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: 1,
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

function fakeAudioBuffer(samples: number[], sampleRate: number): AudioBuffer {
  const channel = new Float32Array(samples);
  return {
    duration: samples.length / sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate,
    getChannelData: () => channel,
  } as unknown as AudioBuffer;
}
