import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject, migrateProject } from "@/daw/model/Project";
import { createSpectralRepairRegion } from "@/daw/repair/repairTypes";
import { createDefaultSweetMasterPolish2Params } from "@/lib/audio/masterPolishTypes";
import { SweetProcessingQueue } from "@/lib/audio/processingJobs";
import { useDawStore } from "./dawStore";

describe("Sweet DAW final heavy UI/state QA", () => {
  afterEach(() => {
    useDawStore.getState().clearProject();
  });

  it("adds, duplicates, fixes, bypasses, and deletes repair regions in project state", () => {
    const region = createSpectralRepairRegion({
      id: "repair-a",
      problemType: "hiss",
      operation: "dechirp_lite",
      startSec: 0,
      endSec: 1,
      lowHz: 7000,
      highHz: 12000,
    });
    const duplicate = createSpectralRepairRegion({
      ...region,
      id: "repair-b",
      startSec: 1,
      endSec: 2,
    });

    useDawStore.getState().upsertRepairRegion(region);
    useDawStore.getState().upsertRepairRegion(duplicate);
    expect(useDawStore.getState().project.repairRegions.map((item) => item.id)).toEqual(["repair-a", "repair-b"]);

    useDawStore.getState().fixRepairRegion("repair-a", true);
    useDawStore.getState().toggleRepairRegion("repair-b", false);
    expect(useDawStore.getState().project.repairRegions.find((item) => item.id === "repair-a")?.fixed).toBe(true);
    expect(useDawStore.getState().project.repairRegions.find((item) => item.id === "repair-b")?.enabled).toBe(false);

    useDawStore.getState().deleteRepairRegion("repair-b");
    expect(useDawStore.getState().project.repairRegions.map((item) => item.id)).toEqual(["repair-a"]);
  });

  it("loads old project shapes without losing final-heavy default fields", () => {
    const migrated = migrateProject({
      id: "old-project",
      title: "Old project",
      schemaVersion: 1,
      master: {},
      tracks: [],
      clips: [],
      files: [],
    });

    useDawStore.getState().loadProject(migrated);
    const project = useDawStore.getState().project;
    expect(project.title).toBe("Old project");
    expect(project.repairRegions).toEqual([]);
    expect(project.aimixUnmaskState.operations).toEqual([]);
    expect(project.exportReports).toEqual([]);
    expect(project.analysisCacheSummary).toBeNull();
    expect(project.master.masterPolish2.profileId).toBe("balanced-ai-master");
  });

  it("keeps target profile defaults aligned with Master Polish 2 settings", () => {
    const safe = createDefaultSweetMasterPolish2Params("safe-streaming-ish");
    const loud = createDefaultSweetMasterPolish2Params("loud-modern");

    expect(safe.profileId).toBe("safe-streaming-ish");
    expect(safe.targetLufsApprox).toBeLessThan(loud.targetLufsApprox);
    expect(safe.ceilingDbTpEstimate).toBeLessThanOrEqual(-1);
    expect(loud.limiterDrive).toBeGreaterThanOrEqual(safe.limiterDrive);
  });

  it("cancels queued work and exposes summary state", () => {
    const queue = new SweetProcessingQueue();
    const id = queue.enqueue({ id: "qa-job", kind: "export-render", priority: 1, params: { label: "QA export" } });
    queue.updateStatus(id, "running", { progress: { completedChunks: 1, totalChunks: 4, percent: 25 } });
    expect(queue.getSummary()).toMatchObject({ runningJobs: 1, currentPercent: 25 });
    queue.cancel(id);
    expect(queue.getJob(id)?.status).toBe("cancelled");
    expect(queue.getSummary().cancelledJobs).toBe(1);
  });
});
