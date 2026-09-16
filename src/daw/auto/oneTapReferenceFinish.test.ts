import { describe, expect, it } from "vitest";
import { createEmptyProject, createTrack, type Clip } from "@/daw/model/Project";
import { DEFAULT_AUTO_REFERENCE_MIX_RUNTIME, DEFAULT_AUTO_REFERENCE_MIX_SETTINGS } from "./autoReferenceMixTypes";
import { buildOneTapReferenceFinishState } from "./oneTapReferenceFinish";

describe("buildOneTapReferenceFinishState", () => {
  it("asks for stems before One-Tap can run", () => {
    const project = createEmptyProject();
    project.tracks = [createTrack("Reference", 0, "reference", "reference")];

    const state = buildOneTapReferenceFinishState(project, DEFAULT_AUTO_REFERENCE_MIX_RUNTIME, DEFAULT_AUTO_REFERENCE_MIX_SETTINGS);

    expect(state.status).toBe("missing-stems");
    expect(state.canRun).toBe(false);
    expect(state.disabled).toBe(true);
  });

  it("allows Sweet No-Reference Finish when work stems are present", () => {
    const project = createEmptyProject();
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    project.tracks = [vocal];
    project.clips = [clip(vocal.id, "file-vocal")];

    const state = buildOneTapReferenceFinishState(project, DEFAULT_AUTO_REFERENCE_MIX_RUNTIME, DEFAULT_AUTO_REFERENCE_MIX_SETTINGS);

    expect(state.status).toBe("ready");
    expect(state.workTrackCount).toBe(1);
    expect(state.workClipCount).toBe(1);
    expect(state.primaryLabel).toBe("Run No-Reference Finish");
    expect(state.canRun).toBe(true);
  });

  it("asks for a reference when Require Reference is enabled", () => {
    const project = createEmptyProject();
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    project.tracks = [vocal];
    project.clips = [clip(vocal.id, "file-vocal")];

    const state = buildOneTapReferenceFinishState(project, DEFAULT_AUTO_REFERENCE_MIX_RUNTIME, {
      ...DEFAULT_AUTO_REFERENCE_MIX_SETTINGS,
      requireReference: true,
    });

    expect(state.status).toBe("missing-reference");
    expect(state.canRun).toBe(false);
  });

  it("becomes Reference-ready when both reference and work clips exist", () => {
    const project = createEmptyProject();
    const reference = createTrack("Reference", 0, "reference", "reference");
    const vocal = createTrack("Lead Vocal", 1, "vocal", "vocal");
    project.tracks = [reference, vocal];
    project.clips = [clip(reference.id, "file-ref"), clip(vocal.id, "file-vocal")];

    const state = buildOneTapReferenceFinishState(project, DEFAULT_AUTO_REFERENCE_MIX_RUNTIME, DEFAULT_AUTO_REFERENCE_MIX_SETTINGS);

    expect(state.status).toBe("ready");
    expect(state.primaryLabel).toBe("Run Reference Finish");
    expect(state.canRun).toBe(true);
    expect(state.disabled).toBe(false);
  });
});

function clip(trackId: string, fileId: string): Clip {
  return {
    id: `clip-${fileId}`,
    trackId,
    fileId,
    role: "vocal",
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: 10,
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
    createdBy: "import",
  };
}
