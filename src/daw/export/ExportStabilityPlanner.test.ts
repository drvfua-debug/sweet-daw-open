import { describe, expect, it } from "vitest";
import { createEmptyProject, createTrack, type Project } from "@/daw/model/Project";
import { buildExportStabilityPlan } from "./ExportStabilityPlanner";

describe("buildExportStabilityPlan", () => {
  it("keeps a small four-stem project on exact full render", () => {
    const project = makeProject({ stems: 4, durationSec: 180 });
    const plan = buildExportStabilityPlan(project, { deviceMemoryGb: 8, userAgent: "Desktop Chrome" });

    expect(plan.strategy).toBe("exact-full-render");
    expect(plan.allowFullOfflineRender).toBe(true);
    expect(plan.risk).toBe("low");
  });

  it("uses chunked render for a 24-stem project with repair and unmask work", () => {
    const project = makeProject({ stems: 24, durationSec: 240, repairRegions: 24, unmaskOperations: 24 });
    const plan = buildExportStabilityPlan(project, { deviceMemoryGb: 8, userAgent: "Desktop Chrome" });

    expect(plan.strategy).toBe("chunked-project-render");
    expect(plan.allowFullOfflineRender).toBe(false);
    expect(plan.repairRegionCount).toBe(24);
    expect(plan.unmaskOperationCount).toBe(24);
  });

  it("still attempts chunked master WAV export for 64 stems instead of stopping early", () => {
    const project = makeProject({ stems: 64, durationSec: 300 });
    const plan = buildExportStabilityPlan(project, { deviceMemoryGb: 8, userAgent: "Desktop Chrome" });

    expect(plan.strategy).toBe("chunked-project-render");
    expect(plan.trackBatchSize).toBeGreaterThan(1);
    expect(plan.warnings.join(" ")).toContain("try stable chunked rendering first");
  });

  it("forceStable for master WAV does not downgrade directly to stem package", () => {
    const project = makeProject({ stems: 48, durationSec: 300 });
    const plan = buildExportStabilityPlan(project, { forceStable: true, deviceMemoryGb: 8, userAgent: "Desktop Chrome" });

    expect(plan.strategy).toBe("chunked-project-render");
    expect(plan.warnings.join(" ")).toContain("try stable chunked rendering first");
  });

  it("counts actual heavy plugin ids when selecting a stable render path", () => {
    const project = makeProject({ stems: 10, durationSec: 240 });
    project.tracks.forEach((track, index) => {
      track.insertChain = [{
        id: `heavy-${index}`,
        pluginId: index % 2 === 0 ? "sweet-aimix-glow" : "sweet-ir-space",
        name: "Heavy",
        target: "track",
        enabled: true,
        params: {},
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }];
    });

    const plan = buildExportStabilityPlan(project, { deviceMemoryGb: 8, userAgent: "Desktop Chrome" });

    expect(plan.heavyPluginCount).toBe(10);
    expect(plan.strategy).not.toBe("exact-full-render");
  });

  it("still attempts critical mobile master WAV with smallest chunk retries", () => {
    const project = makeProject({ stems: 96, durationSec: 300 });
    const plan = buildExportStabilityPlan(project, { deviceMemoryGb: 2, userAgent: "iPhone" });

    expect(plan.strategy).toBe("chunked-project-render");
    expect(plan.risk).toBe("critical");
    expect(plan.retryPlan.at(-1)?.chunkSec).toBeLessThanOrEqual(0.5);
    expect(plan.warnings.join(" ")).toContain("try stable chunked rendering first");
  });

  it("uses individual stem downloads for a critical mobile processed stem package", () => {
    const project = makeProject({ stems: 96, durationSec: 300 });
    const plan = buildExportStabilityPlan(project, {
      purpose: "processed-stem-package",
      deviceMemoryGb: 2,
      userAgent: "iPhone",
    });

    expect(plan.strategy).toBe("individual-stem-download");
    expect(plan.risk).toBe("critical");
  });

  it("disables single ZIP when the processed stem package estimate is large", () => {
    const project = makeProject({ stems: 32, durationSec: 300 });
    const plan = buildExportStabilityPlan(project, {
      purpose: "processed-stem-package",
      deviceMemoryGb: 2,
      userAgent: "iPhone",
    });

    expect(plan.allowSingleZip).toBe(false);
    expect(plan.strategy).toBe("split-stem-package");
  });
});

function makeProject(input: { stems: number; durationSec: number; repairRegions?: number; unmaskOperations?: number }): Project {
  const project = createEmptyProject();
  project.tracks = Array.from({ length: input.stems }, (_, index) => createTrack(`Track ${index + 1}`, index, index % 5 === 0 ? "bass" : "music"));
  project.clips = project.tracks.map((track, index) => ({
    id: `clip-${index}`,
    trackId: track.id,
    fileId: `file-${index}`,
    role: track.role,
    intentTags: [],
    actionHistory: [],
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: input.durationSec,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: true,
    movementLocked: true,
    insertChain: [],
  }));
  project.repairRegions = Array.from({ length: input.repairRegions ?? 0 }, (_, index) => ({
    id: `repair-${index}`,
    trackId: project.tracks[index % project.tracks.length]?.id,
    coordinateSpace: "timeline",
    targetLayer: "mix",
    transformHint: "artifact_heatmap",
    problemType: "mud",
    startSec: 1,
    endSec: 2,
    lowHz: 180,
    highHz: 600,
    operation: "attenuate",
    amountDb: -1,
    strength: 0.4,
    confidence: 0.7,
    featherTimeMs: 30,
    featherFreqHz: 120,
    enabled: true,
    fixed: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }));
  project.aimixUnmaskState.operations = Array.from({ length: input.unmaskOperations ?? 0 }, (_, index) => ({
    id: `unmask-${index}`,
    kind: "aimix_unmask",
    enabled: true,
    fixed: true,
    source: "proposal",
    winnerTrackId: project.tracks[0]?.id ?? "winner",
    targetTrackId: project.tracks[index % project.tracks.length]?.id ?? "target",
    bandId: "presence",
    startSec: 0,
    endSec: input.durationSec,
    reductionDb: -0.8,
    maxReductionDb: 2,
    attackMs: 12,
    releaseMs: 120,
    description: "test",
    warnings: [],
    createdAt: 0,
    updatedAt: 0,
  }));
  return project;
}
