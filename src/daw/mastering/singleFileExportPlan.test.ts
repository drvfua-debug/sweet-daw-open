import { describe, expect, it } from "vitest";
import { createEmptyProject, createId, createTrack, type AudioFileRef, type Project } from "@/daw/model/Project";
import { buildSingleFileExportPlan } from "./singleFileExportPlan";

function makeProject(trackCount: number, durationSec: number): Project {
  const project = createEmptyProject();
  const tracks = Array.from({ length: trackCount }, (_, index) => ({
    ...createTrack(`Track ${index + 1}`, index, "other", "other"),
    id: `track-${index}`,
  }));
  const files: AudioFileRef[] = tracks.map((track, index) => ({
    id: `file-${index}`,
    name: `${index} Stem.wav`,
    originalName: `${index} Stem.wav`,
    role: "other",
    mimeType: "audio/wav",
    durationSec,
    sampleRate: 48000,
    channelCount: 2,
    byteLength: 0,
    storageKey: `memory:file-${index}`,
    createdAt: new Date(0).toISOString(),
  }));
  return {
    ...project,
    tracks,
    files,
    clips: tracks.map((track, index) => ({
      id: createId("clip"),
      trackId: track.id,
      fileId: files[index]!.id,
      role: "other" as const,
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      reverse: false,
      stretchRatio: null,
      pitchShiftSemitones: null,
      lockedToGrid: true,
      movementLocked: true,
      intentTags: [],
      actionHistory: [],
      insertChain: [],
    })),
  };
}

describe("buildSingleFileExportPlan", () => {
  it("forces chunked processing for ten decoded stems on iPhone", () => {
    const plan = buildSingleFileExportPlan({
      project: makeProject(10, 240),
      sampleRate: 48000,
      durationSec: 240,
      isMobile: true,
    });

    expect(plan.lowMemoryMode).toBe(true);
    expect(plan.reasons).toContain("multi-stem");
    expect(plan.previewDurationSec).toBeLessThanOrEqual(12);
    expect(plan.chunkDurationSec).toBeLessThanOrEqual(6);
  });

  it("keeps a short desktop project on the full-buffer path", () => {
    const plan = buildSingleFileExportPlan({
      project: makeProject(2, 30),
      sampleRate: 48000,
      durationSec: 30,
      isMobile: false,
    });

    expect(plan.lowMemoryMode).toBe(false);
    expect(plan.previewDurationSec).toBe(45);
    expect(plan.chunkDurationSec).toBe(18);
  });

  it("shrinks source windows instead of rejecting very large stem counts", () => {
    const plan = buildSingleFileExportPlan({
      project: makeProject(64, 300),
      sampleRate: 48000,
      durationSec: 300,
      isMobile: true,
    });

    expect(plan.lowMemoryMode).toBe(true);
    expect(plan.activeTrackCount).toBe(64);
    expect(plan.chunkDurationSec).toBe(0.25);
  });
});
