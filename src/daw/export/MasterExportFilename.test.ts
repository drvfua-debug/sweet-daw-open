import { describe, expect, it } from "vitest";
import { createEmptyProject, createId, createTrack, type AudioFileRef, type Clip } from "@/daw/model/Project";
import { reserveMasterExportFilename, type MasterExportRevisionStore } from "./MasterExportFilename";

describe("MasterExportFilename", () => {
  it("uses the Reference filename and numbers later successful exports", () => {
    const project = makeProject("まだまだ.wav");
    const store = memoryStore();

    expect(reserveMasterExportFilename(project, store)).toBe("まだまだ_sw_master.wav");
    expect(reserveMasterExportFilename(project, store)).toBe("まだまだ_sw_master_02.wav");
    expect(reserveMasterExportFilename(project, store)).toBe("まだまだ_sw_master_03.wav");
  });

  it("uses the longest Reference clip when more than one Reference exists", () => {
    const project = makeProject("short.wav");
    const secondFile = makeFile("long.wav", 180);
    const secondTrack = createTrack("Long Reference", 1, "reference", "reference");
    project.files.push(secondFile);
    project.tracks.push(secondTrack);
    project.clips.push(makeClip(secondTrack.id, secondFile.id, 180));

    expect(reserveMasterExportFilename(project, memoryStore())).toBe("long_sw_master.wav");
  });

  it("does not stack the generated suffix when a previous master is used as Reference", () => {
    const project = makeProject("Song_sw_master_04.wav");

    expect(reserveMasterExportFilename(project, memoryStore())).toBe("Song_sw_master.wav");
  });

  it("falls back to the project title when no Reference exists", () => {
    const project = createEmptyProject();
    project.title = "My Project";

    expect(reserveMasterExportFilename(project, memoryStore())).toBe("My Project_sw_master.wav");
  });
});

function makeProject(referenceName: string) {
  const project = createEmptyProject();
  project.title = "Untitled";
  const file = makeFile(referenceName, 120);
  const track = createTrack("Reference", 0, "reference", "reference");
  project.files = [file];
  project.tracks = [track];
  project.clips = [makeClip(track.id, file.id, 120)];
  return project;
}

function makeFile(name: string, durationSec: number): AudioFileRef {
  return {
    id: createId("file"),
    name,
    originalName: name,
    role: "reference",
    mimeType: "audio/wav",
    durationSec,
    sampleRate: 48000,
    channelCount: 2,
    byteLength: 1024,
    storageKey: createId("asset"),
    createdAt: new Date(0).toISOString(),
  };
}

function makeClip(trackId: string, fileId: string, durationSec: number): Clip {
  return {
    id: createId("clip"),
    trackId,
    fileId,
    role: "reference",
    intentTags: [],
    actionHistory: [],
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
    insertChain: [],
    createdBy: "import",
  };
}

function memoryStore(): MasterExportRevisionStore {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
