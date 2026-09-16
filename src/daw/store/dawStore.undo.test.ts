import { afterEach, describe, expect, it } from "vitest";
import { createPluginInstance } from "../../audio/plugins/pluginRegistry";
import { createEmptyProject, createTrack } from "../model/Project";
import { useDawStore } from "./dawStore";

function loadProjectWithTrack() {
  const track = createTrack("0 Vocal", 0, "vocal", "vocal");
  const project = {
    ...createEmptyProject(),
    tracks: [track],
  };
  useDawStore.getState().loadProject(project);
  return track;
}

describe("DAW store undo merge", () => {
  afterEach(() => {
    useDawStore.getState().clearProject();
  });

  it("merges continuous track gain/pan edits into one undo step", () => {
    const track = loadProjectWithTrack();

    useDawStore.getState().updateTrack(track.id, { gainDb: -1 });
    useDawStore.getState().updateTrack(track.id, { gainDb: -2 });
    useDawStore.getState().updateTrack(track.id, { pan: 0.2 });

    expect(useDawStore.getState().undoStack).toHaveLength(1);
    expect(useDawStore.getState().project.tracks[0]).toMatchObject({ gainDb: -2, pan: 0.2 });

    useDawStore.getState().undoProject();

    expect(useDawStore.getState().project.tracks[0]).toMatchObject({ gainDb: 0, pan: 0 });
  });

  it("keeps discrete track edits separate from merged slider edits", () => {
    const track = loadProjectWithTrack();

    useDawStore.getState().updateTrack(track.id, { gainDb: -1 });
    useDawStore.getState().updateTrack(track.id, { name: "Lead Vocal" });

    expect(useDawStore.getState().undoStack).toHaveLength(2);
  });

  it("merges continuous plug-in parameter edits into one undo step", () => {
    const track = createTrack("1 Synth", 0, "synth", "synth");
    const plugin = createPluginInstance("sweet-filter", "track");
    useDawStore.getState().loadProject({
      ...createEmptyProject(),
      tracks: [
        {
          ...track,
          insertChain: [plugin],
        },
      ],
    });

    useDawStore.getState().updateTrackPluginParams(track.id, plugin.id, { frequency: 6000 });
    useDawStore.getState().updateTrackPluginParams(track.id, plugin.id, { frequency: 7000 });
    useDawStore.getState().updateTrackPluginParams(track.id, plugin.id, { frequency: 8000 });

    expect(useDawStore.getState().undoStack).toHaveLength(1);
    expect(useDawStore.getState().project.tracks[0]?.insertChain[0]?.params.frequency).toBe(8000);

    useDawStore.getState().undoProject();

    expect(useDawStore.getState().project.tracks[0]?.insertChain[0]?.params.frequency).toBe(12000);
  });
});
