import { afterEach, describe, expect, it } from "vitest";
import { useDawStore } from "./dawStore";

describe("dawStore Reference One-Tap Finish", () => {
  afterEach(() => {
    useDawStore.getState().clearProject();
  });

  it("does not mutate the project when One-Tap is run without required files", () => {
    const beforeId = useDawStore.getState().project.id;

    useDawStore.getState().runOneTapReferenceFinish();

    const state = useDawStore.getState();
    expect(state.project.id).toBe(beforeId);
    expect(state.autoReferenceMix.pending).toBe(false);
    expect(state.autoReferenceMix.status).toBe("waiting-for-files");
    expect(state.autoReferenceMix.message).toContain("Import at least one work stem");
  });

  it("keeps auto-run disabled by default while One-Tap remains enabled", () => {
    const state = useDawStore.getState();

    expect(state.autoReferenceMixSettings.oneTapPrimary).toBe(true);
    expect(state.autoReferenceMixSettings.autoRunOnReferenceReady).toBe(false);
    expect(state.autoReferenceMixSettings.showAdvancedByDefault).toBe(false);
    expect(state.autoReferenceMixSettings.requireReference).toBe(false);
  });
});
