import { describe, expect, it } from "vitest";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { createEmptyProject, createTrack, type Clip } from "@/daw/model/Project";
import { suggestRepairRegionsForClip } from "./repairPlanner";

describe("spectral repair planner", () => {
  it("suggests clipping and mud candidates from lightweight peak data", () => {
    const track = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const fileId = "file-a";
    const clip: Clip = {
      id: "clip-a",
      trackId: track.id,
      fileId,
      role: "vocal",
      clipKind: "audio",
      intentTags: [],
      actionHistory: [],
      timelineStartSec: 0,
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
    };
    const project = {
      ...createEmptyProject(),
      tracks: [track],
      clips: [clip],
      files: [{
        id: fileId,
        name: "Lead Vocal.wav",
        originalName: "Lead Vocal.wav",
        role: "vocal" as const,
        mimeType: "audio/wav",
        durationSec: 8,
        sampleRate: 48000,
        channelCount: 2,
        byteLength: 1000,
        storageKey: "memory:file-a",
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    };
    const peaks: PeakSummary = {
      bins: 16,
      min: Array.from({ length: 16 }, (_, index) => (index === 4 ? -0.98 : -0.08)),
      max: Array.from({ length: 16 }, (_, index) => (index === 4 ? 0.99 : 0.08)),
      durationSec: 8,
      bandEnergyDb: {
        "20-35": -40,
        "35-60": -38,
        "60-120": -34,
        "120-250": -20,
        "250-500": -18,
        "1500-3000": -24,
        "3000-5000": -25,
        "5000-9000": -20,
        "9000-12000": -19,
      },
    };

    const result = suggestRepairRegionsForClip(project, clip.id, { [fileId]: peaks });

    expect(result.some((region) => region.problemType === "clipping")).toBe(true);
    expect(result.some((region) => region.problemType === "mud")).toBe(true);
    expect(result.every((region) => region.clipId === clip.id)).toBe(true);
  });
});
