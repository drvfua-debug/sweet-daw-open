import { describe, expect, it } from "vitest";
import { createClipHistoryItem, createEmptyProject, createId, createTrack, type Clip } from "@/daw/model/Project";
import type { PluginInstance } from "@/daw/model/Plugin";
import { buildVocalActivityEnvelope, buildVocalActivityWindows, getVocalDuckTargetReductionDb, type VocalActivityAudioBuffer } from "./DynamicVocalDuck";

function createVocalDuckPlugin(): PluginInstance {
  const now = "2026-07-10T00:00:00.000Z";
  return {
    id: "duck",
    pluginId: "sweet-vocal-duck-eq",
    name: "Sweet Vocal Duck EQ",
    enabled: true,
    target: "track",
    params: {
      frequencyHz: 2500,
      q: 1.1,
      maxReductionDb: 1.6,
      threshold: 0.035,
      attackMs: 35,
      releaseMs: 180,
      mix: 1,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function createVocalClip(trackId: string, fileId = createId("file")): Clip {
  return {
    id: createId("clip"),
    trackId,
    fileId,
    role: "vocal",
    intentTags: [],
    actionHistory: [createClipHistoryItem("import", "Phase 0 vocal duck fixture", {})],
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
    insertChain: [],
  };
}

describe("Dynamic Vocal Duck Phase 0 characterization", () => {
  it("uses real vocal activity for offline duck windows and leaves silent spans unducked", () => {
    const project = createEmptyProject();
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const music = createTrack("Music", 1, "music", "music");
    music.insertChain = [createVocalDuckPlugin()];
    const fileId = createId("file");
    project.tracks = [vocal, music];
    project.clips = [createVocalClip(vocal.id, fileId)];

    const envelope = buildVocalActivityEnvelope(project, {
      getBuffer: (requestedFileId) => requestedFileId === fileId ? createActivityFixtureBuffer() : null,
    });
    const offlineWindows = envelope.windows;
    const spansSilence = offlineWindows.some((window) => window.startSec < 3.5 && window.endSec > 3.5);

    const silentLiveTargetDb = getVocalDuckTargetReductionDb(0, music.insertChain);
    const activeLiveTargetDb = getVocalDuckTargetReductionDb(0.12, music.insertChain);

    expect(envelope.source).toBe("audio-analysis");
    expect(envelope.analyzedClipCount).toBe(1);
    expect(offlineWindows.length).toBeGreaterThan(1);
    expect(spansSilence).toBe(false);
    expect(silentLiveTargetDb).toBeCloseTo(0, 8);
    expect(activeLiveTargetDb).toBeLessThan(-1);
    console.info("Phase 1 Vocal Duck audio-envelope snapshot", {
      offlineWindows: offlineWindows.length,
      firstWindow: offlineWindows[0],
      silentLiveTargetDb,
      activeLiveTargetDb,
    });
  });

  it("keeps the clip-span fallback explicit when decoded audio is unavailable", () => {
    const project = createEmptyProject();
    const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
    project.tracks = [vocal];
    project.clips = [createVocalClip(vocal.id)];

    const envelope = buildVocalActivityEnvelope(project);
    const windows = buildVocalActivityWindows(project);

    expect(envelope.source).toBe("clip-fallback");
    expect(windows).toHaveLength(1);
    expect(windows[0]?.endSec).toBeCloseTo(10.12, 4);
  });
});

function createActivityFixtureBuffer(): VocalActivityAudioBuffer {
  const sampleRate = 1000;
  const data = new Float32Array(sampleRate * 10);
  for (let index = 0; index < data.length; index += 1) {
    const time = index / sampleRate;
    const active = time < 2 || (time >= 5 && time < 7);
    data[index] = active ? Math.sin(2 * Math.PI * 180 * time) * 0.11 : 0;
  }
  return {
    sampleRate,
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}
