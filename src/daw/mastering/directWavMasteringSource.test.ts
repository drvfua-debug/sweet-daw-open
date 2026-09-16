import { describe, expect, it } from "vitest";
import { createEmptyProject, createId, createTrack, type AudioFileRef, type Clip } from "../model/Project";
import { createDirectWavMasteringSource, hasDirectWavMasteringSource } from "./directWavMasteringSource";

describe("directWavMasteringSource", () => {
  it("renders one Reference as a neutral music source without mutating the project", () => {
    const project = createEmptyProject();
    const reference = createTrack("Reference Mix", 0, "reference", "reference");
    const stem = createTrack("1 Vocal", 1, "vocal", "vocal");
    reference.gainDb = -3;
    reference.pan = 0.2;
    reference.compressor.enabled = true;
    reference.insertChain.push({
      id: "ref-fx",
      pluginId: "sweet-saturator",
      name: "Ref FX",
      target: "track",
      enabled: true,
      params: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const referenceFile = makeFile("reference", "song.wav", 180);
    const stemFile = makeFile("vocal", "1 Vocal.wav", 180);
    const referenceClip = makeClip(reference.id, referenceFile.id, "reference", 180);
    const stemClip = makeClip(stem.id, stemFile.id, "vocal", 180);
    project.tracks = [reference, stem];
    project.files = [referenceFile, stemFile];
    project.clips = [referenceClip, stemClip];

    const result = createDirectWavMasteringSource(project);

    expect(hasDirectWavMasteringSource(project)).toBe(true);
    expect(result).not.toBeNull();
    expect(result?.tracks).toHaveLength(1);
    expect(result?.clips).toHaveLength(1);
    expect(result?.tracks[0]?.role).toBe("music");
    expect(result?.tracks[0]?.type).toBe("music");
    expect(result?.tracks[0]?.gainDb).toBe(0);
    expect(result?.tracks[0]?.pan).toBe(0);
    expect(result?.tracks[0]?.compressor.enabled).toBe(false);
    expect(result?.tracks[0]?.insertChain).toEqual([]);
    expect(result?.master.gainDb).toBe(0);
    expect(result?.master.insertChain).toEqual([]);
    expect(project.tracks[0]?.role).toBe("reference");
    expect(project.tracks[0]?.gainDb).toBe(-3);
    expect(project.tracks).toHaveLength(2);
  });

  it("returns null when no Reference clip exists", () => {
    const project = createEmptyProject();
    project.tracks = [createTrack("1 Vocal", 0, "vocal", "vocal")];

    expect(hasDirectWavMasteringSource(project)).toBe(false);
    expect(createDirectWavMasteringSource(project)).toBeNull();
  });
});

function makeFile(role: "reference" | "vocal", name: string, durationSec: number): AudioFileRef {
  const id = createId("file");
  return {
    id,
    name,
    originalName: name,
    role,
    mimeType: "audio/wav",
    durationSec,
    sampleRate: 48000,
    channelCount: 2,
    byteLength: 1024,
    storageKey: `idb:audio:${id}`,
    createdAt: new Date().toISOString(),
  };
}

function makeClip(trackId: string, fileId: string, role: "reference" | "vocal", durationSec: number): Clip {
  return {
    id: createId("clip"),
    trackId,
    fileId,
    role,
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
  };
}
