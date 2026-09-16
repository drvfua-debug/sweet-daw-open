import { describe, expect, it } from "vitest";
import { createEmptyProject, migrateProject } from "@/daw/model/Project";
import { createProjectPackage, readProjectPackageFile } from "@/daw/project/ProjectSerializer";
import { createSpectralRepairRegion } from "./repairTypes";

describe("spectral repair project persistence", () => {
  it("adds default repair view state to legacy projects", () => {
    const project = migrateProject({
      id: "legacy",
      title: "Legacy",
      tracks: [],
      clips: [],
      files: [],
      master: {},
      analysis: {},
    });

    expect(project.repairRegions).toEqual([]);
    expect(project.repairViewState.viewMode).toBe("waveform");
    expect(project.repairViewState.previewMode).toBe("original");
  });

  it("sanitizes and preserves repair regions", () => {
    const region = createSpectralRepairRegion({
      id: "repair-demo",
      problemType: "sibilance",
      startSec: 1,
      endSec: 2,
      lowHz: 6000,
      highHz: 9500,
      amountDb: -2.5,
      fixed: true,
    });
    const project = migrateProject({
      id: "with-repair",
      title: "With Repair",
      tracks: [],
      clips: [],
      files: [],
      master: {},
      analysis: {},
      repairRegions: [region],
      repairViewState: { selectedRegionId: region.id, viewMode: "stft", minDb: -80, maxDb: -10, showOverlay: false, previewMode: "delta" },
    });

    expect(project.repairRegions).toHaveLength(1);
    expect(project.repairRegions[0]?.id).toBe("repair-demo");
    expect(project.repairRegions[0]?.fixed).toBe(true);
    expect(project.repairRegions[0]?.coordinateSpace).toBe("timeline");
    expect(project.repairViewState.viewMode).toBe("stft");
    expect(project.repairViewState.previewMode).toBe("delta");
  });
  it("preserves source-coordinate repair regions and migrates legacy regions to timeline", () => {
    const sourceRegion = createSpectralRepairRegion({
      id: "source-region",
      fileId: "file-1",
      coordinateSpace: "source",
      problemType: "click",
      startSec: 12,
      endSec: 12.2,
      lowHz: 1000,
      highHz: 12000,
    });
    const project = migrateProject({
      id: "with-source-repair",
      title: "With Source Repair",
      tracks: [],
      clips: [],
      files: [],
      master: {},
      analysis: {},
      repairRegions: [
        sourceRegion,
        {
          id: "legacy-region",
          problemType: "mud",
          startSec: 1,
          endSec: 2,
          lowHz: 180,
          highHz: 500,
        },
      ],
    });

    expect(project.repairRegions.find((region) => region.id === "source-region")?.coordinateSpace).toBe("source");
    expect(project.repairRegions.find((region) => region.id === "legacy-region")?.coordinateSpace).toBe("timeline");
  });
  it("keeps repair regions in SWTD packages", async () => {
    const region = createSpectralRepairRegion({
      id: "repair-swtd",
      problemType: "mud",
      startSec: 0.5,
      endSec: 1.5,
      lowHz: 180,
      highHz: 500,
      fixed: true,
    });
    const project = {
      ...createEmptyProject(),
      repairRegions: [region],
      repairViewState: { selectedRegionId: region.id, viewMode: "artifact_heatmap" as const, minDb: -72, maxDb: -12, showOverlay: true, previewMode: "removed_only" as const },
    };

    const blob = await createProjectPackage(project, async () => null);
    const restored = await readProjectPackageFile(new File([blob], "repair.swtd"));

    expect(restored.manifest.project.repairRegions[0]?.id).toBe("repair-swtd");
    expect(restored.manifest.project.repairRegions[0]?.fixed).toBe(true);
    expect(restored.manifest.project.repairViewState.previewMode).toBe("removed_only");
  });
});

