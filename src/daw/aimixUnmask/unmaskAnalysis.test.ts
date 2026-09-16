import { describe, expect, it } from "vitest";
import { createEmptyProject, createTrack, type Clip } from "@/daw/model/Project";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { analyzeAimixUnmask } from "./unmaskAnalysis";

function clip(trackId: string, fileId: string, start = 0): Clip {
  return {
    id: `clip-${trackId}`,
    trackId,
    fileId,
    role: "other",
    intentTags: [],
    actionHistory: [],
    timelineStartSec: start,
    sourceStartSec: 0,
    durationSec: 4,
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
}

function peaks(boost: Partial<Record<string, number>> = {}): PeakSummary {
  return {
    bins: 16,
    min: new Array(16).fill(-0.45),
    max: new Array(16).fill(0.45),
    durationSec: 4,
    bandEnergyDb: {
      "120-250": -22,
      "250-500": -21,
      "1500-3000": -20,
      "3000-5000": -19,
      "5000-9000": -23,
      ...boost,
    },
    bandSideMidDb: { low_20_120: -18 },
  };
}

describe("AIMIX Unmask Matrix analysis", () => {
  it("creates target-band ducking from support tracks behind a lead vocal", () => {
    const project = createEmptyProject();
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const synth = createTrack("Pad Synth", 1, "synth", "synth");
    project.tracks = [vocal, synth];
    project.clips = [clip(vocal.id, "vocal-file"), clip(synth.id, "synth-file")];

    const state = analyzeAimixUnmask(project, {
      "vocal-file": peaks({ "3000-5000": -14 }),
      "synth-file": peaks({ "3000-5000": -15 }),
    }, { mode: "balanced" });

    expect(state.operations.length).toBeGreaterThan(0);
    expect(state.operations.some((operation) => operation.winnerTrackId === vocal.id && operation.targetTrackId === synth.id)).toBe(true);
    expect(state.operations.every((operation) => operation.reductionDb <= 0 && operation.reductionDb >= -3.5)).toBe(true);
  });

  it("uses Reference Delta Assist without creating extreme reductions", () => {
    const project = createEmptyProject();
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const guitar = createTrack("Guitar", 1, "guitar", "guitar");
    project.tracks = [vocal, guitar];
    project.clips = [clip(vocal.id, "vocal-file"), clip(guitar.id, "guitar-file")];

    const state = analyzeAimixUnmask(project, {
      "vocal-file": peaks({ "1500-3000": -14, "3000-5000": -14 }),
      "guitar-file": peaks({ "1500-3000": -15, "3000-5000": -15 }),
    }, {
      mode: "strong",
      referenceDelta: { available: true, source: "mix_doctor", confidence: 0.8, vocalPresenceDeltaDb: -2, warnings: [] },
    });

    expect(state.operations.length).toBeGreaterThan(0);
    expect(Math.min(...state.operations.map((operation) => operation.reductionDb))).toBeGreaterThanOrEqual(-3.5);
    expect(state.referenceDelta?.available).toBe(true);
  });
});