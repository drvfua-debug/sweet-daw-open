import { describe, expect, it } from "vitest";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Project } from "@/daw/model/Project";
import type { ArtifactProblem } from "../mixDoctorTypes";
import { buildRepairHeatmap, cellToSpectralEditOp } from "./repairHeatmapBuilder";

function problem(patch: Partial<ArtifactProblem> & Pick<ArtifactProblem, "id" | "type" | "role" | "score">): ArtifactProblem {
  return {
    stemId: "track-a",
    confidence: 0.72,
    reason: "test problem",
    suggestedFix: "repair carefully",
    ...patch,
  };
}

describe("repair heatmap builder", () => {
  it("creates heatmap cells from artifact problems with predicted improvement", () => {
    const result = buildRepairHeatmap({
      mode: "balanced",
      problems: [
        problem({ id: "mud", type: "mud", role: "music", score: 76, lowFreq: 250, highFreq: 500 }),
      ],
    });

    expect(result.cells.length).toBeGreaterThan(0);
    expect(result.beforeSummary.hotCells).toBeGreaterThan(0);
    expect(result.cells[0]?.lowFreq).toBe(250);
    expect(result.cells[0]?.suggestedOperation).toBe("reduce");
    expect(result.cells[0]?.afterScore).toBeLessThan(result.cells[0]?.beforeScore ?? 0);
    expect(result.cells[0]?.differenceScore).toBeGreaterThan(0);
  });

  it("maps rumble to derumble and sibilance to deess/deharsh safe ranges", () => {
    const result = buildRepairHeatmap({
      mode: "light",
      problems: [
        problem({ id: "rumble", type: "rumble", role: "drums", score: 82 }),
        problem({ id: "sibilance", type: "sibilance", role: "vocal", score: 80 }),
      ],
    });

    expect(result.cells.some((cell) => cell.lowFreq === 20 && cell.highFreq === 35 && cell.suggestedOperation === "derumble")).toBe(true);
    expect(result.cells.some((cell) => cell.lowFreq >= 5000 && cell.highFreq <= 9000 && cell.suggestedOperation === "deess")).toBe(true);
  });

  it("protects vocal presence instead of blindly cutting it", () => {
    const result = buildRepairHeatmap({
      mode: "strong",
      problems: [
        problem({ id: "vocal-mask", type: "masking", role: "vocal", score: 84, lowFreq: 1500, highFreq: 3000 }),
      ],
    });

    const protectedCell = result.cells.find((cell) => cell.lowFreq === 1500 && cell.highFreq === 3000);
    expect(protectedCell?.protectMain).toBe(true);
    expect(protectedCell?.suggestedOperation).toBe("protect");
    expect(protectedCell?.suggestedGainDb).toBe(0);
  });

  it("converts a selected cell to a SpectralEditOp without exceeding safe gain caps", () => {
    const result = buildRepairHeatmap({
      mode: "balanced",
      problems: [
        problem({ id: "harsh", type: "harshness", role: "guitar", score: 90, lowFreq: 3000, highFreq: 5000 }),
      ],
    });
    const op = cellToSpectralEditOp(result.cells[0]!);

    expect(op.stemId).toBe("track-a");
    expect(op.lowFreq).toBeGreaterThanOrEqual(3000);
    expect(op.highFreq).toBeLessThanOrEqual(5000);
    expect(op.gainDb).toBeGreaterThanOrEqual(-6);
    expect(op.strength).toBeLessThanOrEqual(1);
    expect(op.createdBy).toBe("manual");
  });

  it("places untimed problems near peak cache windows instead of pinning them to zero", () => {
    const project = minimalProject();
    const peaksByFileId: Record<string, PeakSummary> = {
      "file-a": {
        bins: 8,
        min: [0, 0, 0, 0, -0.1, -0.9, -0.2, 0],
        max: [0, 0, 0, 0, 0.1, 0.95, 0.2, 0],
        durationSec: 8,
      },
    };
    const result = buildRepairHeatmap({
      project,
      peaksByFileId,
      mode: "balanced",
      problems: [
        problem({ id: "late-harsh", type: "harshness", role: "music", score: 78, lowFreq: 3000, highFreq: 5000 }),
      ],
    });

    expect(result.cells[0]?.startTime).toBeGreaterThanOrEqual(13);
    expect(result.cells[0]?.reason).toContain("peak cache");
    expect(result.cells[0]?.confidence).toBeLessThan(0.96);
  });
});

function minimalProject(): Project {
  return {
    id: "project",
    title: "Test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sampleRate: 44100,
    bpm: 120,
    timeSignature: [4, 4],
    master: {} as Project["master"],
    tracks: [{ id: "track-a", name: "Music", role: "music", type: "music" } as Project["tracks"][number]],
    clips: [{ id: "clip-a", trackId: "track-a", fileId: "file-a", timelineStartSec: 10, sourceStartSec: 0, durationSec: 8 } as Project["clips"][number]],
    files: [{ id: "file-a", name: "music.wav", durationSec: 8 } as Project["files"][number]],
    markers: [],
    regions: [],
    analysis: {} as Project["analysis"],
    repairRegions: [],
    repairViewState: {} as Project["repairViewState"],
  } as unknown as Project;
}
