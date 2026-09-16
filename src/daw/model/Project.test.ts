import { describe, expect, it } from "vitest";
import { createEmptyProject, createId, createTrack, inferStemRole, migrateProject, migrateProjectWithReport, type AudioFileRef, type Clip } from "./Project";

describe("stem role inference", () => {
  it("treats lead vocal names as vocal instead of synth lead", () => {
    expect(inferStemRole("Lead Vocal.wav")).toBe("vocal");
    expect(inferStemRole("lead_vocals_stem.wav")).toBe("vocal");
    expect(inferStemRole("main-vox.aiff")).toBe("vocal");
  });

  it("still treats synth lead names as synth", () => {
    expect(inferStemRole("synth lead.wav")).toBe("synth");
    expect(inferStemRole("lead synth.wav")).toBe("synth");
  });
});

describe("project migration", () => {
  it("initializes Master Target and mix bus trim for new projects", () => {
    const project = createEmptyProject();

    expect(project.schemaVersion).toBe(4);
    expect(project.master.mixBusTrimDb).toBe(0);
    expect(project.master.target).toMatchObject({
      enabled: true,
      profileId: "balanced-master",
      targetIntegratedLufs: -12,
      truePeakCeilingDbtp: -1,
      preMasterPeakCeilingDbfs: -6,
      headroomMode: "analysis",
    });
  });

  it("migrates legacy projects with safe Master Target defaults", () => {
    const legacy = createEmptyProject();
    const migrated = migrateProject({
      ...legacy,
      schemaVersion: 3,
      master: {
        ...legacy.master,
        target: undefined,
        mixBusTrimDb: 99,
      },
    });

    expect(migrated.schemaVersion).toBe(4);
    expect(migrated.master.mixBusTrimDb).toBe(0);
    expect(migrated.master.target.profileId).toBe("balanced-master");
    expect(migrated.master.target.targetIntegratedLufs).toBe(-12);
  });

  it("defaults Vocal Image Layer to fully off for new and restored projects", () => {
    const project = createEmptyProject();
    const track = createTrack("Lead Vocal", 0, "vocal", "vocal");

    expect(project.master.vocalImageLayer.enabled).toBe(false);
    expect(track.vocalImage).toEqual({
      enabled: false,
      amount: 20,
      distance: "natural",
      monoSafety: true,
    });

    const migrated = migrateProject({
      ...project,
      tracks: [
        {
          ...track,
          vocalImage: {
            enabled: true,
            amount: 160,
            distance: "huge",
            monoSafety: false,
          },
        },
      ],
      master: {
        ...project.master,
        vocalImageLayer: {
          enabled: true,
        },
      },
    });

    expect(migrated.master.vocalImageLayer.enabled).toBe(true);
    expect(migrated.tracks[0]?.vocalImage).toEqual({
      enabled: true,
      amount: 100,
      distance: "natural",
      monoSafety: false,
    });
  });

  it("keeps track and clip roles aligned after restore", () => {
    const project = createEmptyProject();
    const fileId = createId("file");
    const track = createTrack("0 Vocal", 0, "vocal", "vocal");
    const fileRef: AudioFileRef = {
      id: fileId,
      name: "0_vocal.wav",
      originalName: "0_vocal.wav",
      role: "vocal",
      mimeType: "audio/wav",
      durationSec: 1,
      sampleRate: 48000,
      channelCount: 2,
      byteLength: 4,
      storageKey: `idb:audio:${fileId}`,
      peakCacheKey: `peaks:${fileId}`,
      createdAt: new Date().toISOString(),
    };
    const clip: Clip = {
      id: createId("clip"),
      trackId: track.id,
      fileId,
      role: "bass",
      intentTags: [],
      actionHistory: [],
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 1,
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

    const migrated = migrateProject({
      ...project,
      files: [fileRef],
      tracks: [track],
      clips: [clip],
    });

    expect(migrated.tracks[0]?.role).toBe("vocal");
    expect(migrated.clips[0]?.role).toBe("vocal");
  });

  it("drops unknown plug-ins and reports migration warnings", () => {
    const project = createEmptyProject();
    const track = createTrack("0 Vocal", 0, "vocal", "vocal");

    const migrated = migrateProjectWithReport({
      ...project,
      tracks: [
        {
          ...track,
          insertChain: [
            {
              id: "bad-plugin",
              pluginId: "third-party-chaos",
              name: "Third Party Chaos",
              enabled: true,
              target: "track",
              params: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: "good-plugin",
              pluginId: "sweet-filter",
              name: "Sweet Filter",
              enabled: true,
              target: "track",
              params: { mix: 5, frequency: -10, q: 50 },
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      ],
    });

    expect(migrated.project.tracks[0]?.insertChain).toHaveLength(1);
    expect(migrated.project.tracks[0]?.insertChain[0]?.pluginId).toBe("sweet-filter");
    expect(migrated.project.tracks[0]?.insertChain[0]?.params).toMatchObject({
      mix: 1,
      frequency: 20,
      q: 24,
    });
    expect(migrated.issues.some((issue) => issue.message.includes("Unknown plug-in removed"))).toBe(true);
    expect(migrated.issues.some((issue) => issue.message.includes("clamped"))).toBe(true);
    expect(migrated.project.analysis.notes.some((note) => note.includes("Migration"))).toBe(true);
  });

  it("drops clips that point to missing tracks or files", () => {
    const project = createEmptyProject();
    const fileId = createId("file");
    const track = createTrack("1 Bass", 0, "bass", "bass");
    const fileRef: AudioFileRef = {
      id: fileId,
      name: "1_bass.wav",
      originalName: "1_bass.wav",
      role: "bass",
      mimeType: "audio/wav",
      durationSec: 1,
      sampleRate: 48000,
      channelCount: 2,
      byteLength: 4,
      storageKey: `idb:audio:${fileId}`,
      peakCacheKey: `peaks:${fileId}`,
      createdAt: new Date().toISOString(),
    };
    const validClip: Clip = {
      id: createId("clip"),
      trackId: track.id,
      fileId,
      role: "bass",
      intentTags: [],
      actionHistory: [],
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 1,
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

    const migrated = migrateProjectWithReport({
      ...project,
      files: [fileRef],
      tracks: [track],
      clips: [
        validClip,
        { ...validClip, id: createId("clip"), trackId: "missing-track" },
        { ...validClip, id: createId("clip"), fileId: "missing-file" },
      ],
    });

    expect(migrated.project.clips).toHaveLength(1);
    expect(migrated.project.clips[0]?.id).toBe(validClip.id);
    expect(migrated.issues.filter((issue) => issue.path.startsWith("clips["))).toHaveLength(2);
  });
});
