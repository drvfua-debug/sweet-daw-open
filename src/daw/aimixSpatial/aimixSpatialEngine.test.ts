import { describe, expect, it } from "vitest";
import { applyAimixSpatialToProject, removeAimixSpatialLayersFromProject } from "./aimixSpatialEngine";
import {
  createClipHistoryItem,
  createEmptyProject,
  createId,
  createTrack,
  type AimixSpatialMetadata,
  type AudioFileRef,
  type Clip,
  type Project,
  type StemRole,
} from "../model/Project";

function buildProjectWithTracks(roles: StemRole[]): Project {
  const base = createEmptyProject();
  const files: AudioFileRef[] = [];
  const tracks = roles.map((role, index) => createTrack(`${index} ${role}`, index, role === "reference" ? "reference" : role, role));
  const clips: Clip[] = [];

  for (const track of tracks) {
    const fileId = createId("file");
    files.push({
      id: fileId,
      name: `${track.name}.wav`,
      originalName: `${track.name}.wav`,
      role: track.role,
      mimeType: "audio/wav",
      durationSec: 8,
      sampleRate: 48000,
      channelCount: 2,
      byteLength: 16,
      storageKey: `idb:audio:${fileId}`,
      peakCacheKey: `peaks:${fileId}`,
      createdAt: new Date().toISOString(),
    });
    clips.push({
      id: createId("clip"),
      trackId: track.id,
      fileId,
      role: track.role,
      intentTags: [],
      actionHistory: [],
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 8,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      reverse: false,
      stretchRatio: null,
      pitchShiftSemitones: null,
      lockedToGrid: true,
      movementLocked: true,
      insertChain: [],
    });
  }

  return {
    ...base,
    files,
    tracks,
    clips,
  };
}

function addLegacySpatialLayer(project: Project): Project {
  const sourceTrack = project.tracks.find((track) => track.role !== "reference") ?? project.tracks[0]!;
  const sourceClip = project.clips.find((clip) => clip.trackId === sourceTrack.id) ?? project.clips[0]!;
  const legacyMeta: AimixSpatialMetadata = {
    isAimixSpatialGenerated: true,
    aimixVersion: "spatial-v1",
    aimixType: "spatial-left",
    sourceTrackId: sourceTrack.id,
    sourceClipId: sourceClip.id,
    createdBy: "AIMIX Spatial",
    removable: true,
  };
  const legacyTrack = {
    ...createTrack(`${sourceTrack.name} AIMIX Spatial L`, project.tracks.length, sourceTrack.type, sourceTrack.role),
    aimixSpatial: legacyMeta,
    pan: -0.35,
    gainDb: -12,
  };
  const legacyClip: Clip = {
    ...sourceClip,
    id: createId("clip"),
    trackId: legacyTrack.id,
    createdBy: "aimixSpatial",
    aimixSpatial: legacyMeta,
  };

  return {
    ...project,
    tracks: [...project.tracks, legacyTrack],
    clips: [...project.clips, legacyClip],
  };
}

describe("AIMIX Spatial", () => {
  it("uses placement-only track pan as the orthodox default", () => {
    const project = buildProjectWithTracks(["vocal", "bass", "synth", "keys"]);
    const beforeEq = JSON.stringify(project.tracks.map((track) => track.eq));

    const result = applyAimixSpatialToProject(project);

    expect(result.report.mode).toBe("spatial");
    expect(result.report.cleanedTracks).toBe(0);
    expect(result.report.pannedTracks).toBeGreaterThan(0);
    expect(result.report.pannedClips).toBe(0);
    expect(JSON.stringify(result.project.tracks.map((track) => track.eq))).toBe(beforeEq);
  });

  it("keeps source tracks and does not create new spatial audio layers", () => {
    const project = buildProjectWithTracks(["vocal", "bass", "synth", "fx"]);
    const result = applyAimixSpatialToProject(project, { mode: "clean-spatial" });

    expect(result.report.ok).toBe(true);
    expect(result.report.cleanedTracks).toBe(4);
    expect(result.report.generatedTracks).toBe(0);
    expect(result.report.generatedClips).toBe(0);
    expect(result.project.tracks).toHaveLength(project.tracks.length);
    expect(result.project.clips).toHaveLength(project.clips.length);
    expect(result.project.tracks.some((track) => track.aimixSpatial?.isAimixSpatialGenerated)).toBe(false);
    expect(result.report.actions.some((action) => action.includes("Spatial v2"))).toBe(true);
  });

  it("can apply placement-only Spatial without changing track or clip counts", () => {
    const project = buildProjectWithTracks(["synth", "keys", "fx"]);
    const result = applyAimixSpatialToProject(project, { mode: "spatial", panMode: "track-clip" });

    expect(result.report.cleanedTracks).toBe(0);
    expect(result.report.generatedTracks).toBe(0);
    expect(result.report.generatedClips).toBe(0);
    expect(result.report.pannedTracks).toBeGreaterThan(0);
    expect(result.report.pannedClips).toBeGreaterThan(0);
    expect(result.project.tracks).toHaveLength(project.tracks.length);
    expect(result.project.clips).toHaveLength(project.clips.length);
  });

  it("removes only legacy AIMIX Spatial generated layers", () => {
    const project = addLegacySpatialLayer(buildProjectWithTracks(["vocal", "synth", "keys"]));
    const removed = removeAimixSpatialLayersFromProject(project);

    expect(removed.removedTracks).toBe(1);
    expect(removed.removedClips).toBe(1);
    expect(removed.project.tracks.map((track) => track.id)).toEqual(project.tracks.slice(0, 3).map((track) => track.id));
    expect(removed.project.clips.map((clip) => clip.id)).toEqual(project.clips.slice(0, 3).map((clip) => clip.id));
  });

  it("keeps legacy spatial layers when cleanup is disabled but does not add more", () => {
    const project = addLegacySpatialLayer(buildProjectWithTracks(["synth"]));
    const result = applyAimixSpatialToProject(project, { mode: "spatial", removePreviousAimixLayers: false });

    expect(result.report.removedTracks).toBe(0);
    expect(result.report.generatedTracks).toBe(0);
    expect(result.project.tracks.filter((track) => track.aimixSpatial?.isAimixSpatialGenerated)).toHaveLength(1);
  });

  it("keeps existing pan values during clean mode when pan mode is off", () => {
    const project = buildProjectWithTracks(["vocal", "bass", "drums", "synth"]);
    project.tracks[0]!.pan = -0.34;
    project.tracks[1]!.pan = 0.28;
    project.tracks[2]!.pan = -0.18;
    project.tracks[3]!.pan = 0;

    const result = applyAimixSpatialToProject(project, { mode: "clean", centerProtect: 100, panMode: "off" });

    expect(result.report.generatedTracks).toBe(0);
    expect(result.project.tracks[0]?.pan).toBe(-0.34);
    expect(result.project.tracks[1]?.pan).toBe(0.28);
    expect(result.project.tracks[2]?.pan).toBe(-0.18);
    expect(result.project.tracks[3]?.pan).toBe(0);
  });

  it("can run pan mix in clean mode without creating spatial layers", () => {
    const project = buildProjectWithTracks(["synth"]);

    const result = applyAimixSpatialToProject(project, { mode: "clean", panMode: "track-clip" });

    expect(result.report.generatedTracks).toBe(0);
    expect(result.report.pannedTracks).toBeGreaterThan(0);
    expect(result.report.pannedClips).toBeGreaterThan(0);
    expect(result.project.tracks[0]?.aimixSpatialPan?.isAimixSpatialPanApplied).toBe(true);
    expect(result.project.clips[0]?.aimixSpatialPan?.isAimixSpatialPanApplied).toBe(true);
  });

  it("does not clean muted tracks and reports only actual clean targets", () => {
    const project = buildProjectWithTracks(["vocal", "synth"]);
    project.tracks[1]!.mute = true;
    project.tracks[1]!.gainDb = -3;

    const result = applyAimixSpatialToProject(project, { mode: "clean" });

    expect(result.report.cleanedTracks).toBe(1);
    expect(result.project.tracks[1]?.gainDb).toBe(-3);
  });

  it("migrates legacy AIMIX clip pan into Spatial pan without restoring it as user pan", () => {
    const project = buildProjectWithTracks(["synth"]);
    project.clips[0]!.intentTags = ["aimix-auto-pan"];
    project.clips[0]!.panAutomation = {
      enabled: true,
      depth: 0.9,
      smoothingMs: 50,
      bypassed: false,
      anchorPoints: [{ id: "legacy", time: 0, pan: 0.7, curve: "smooth" }],
    };
    project.clips[0]!.actionHistory = [createClipHistoryItem("aimixClipPan", "Legacy AIMIX clip pan", {})];

    const result = applyAimixSpatialToProject(project, { mode: "clean", panMode: "clip" });
    const migrated = result.project.clips[0]!;

    expect(migrated.intentTags).not.toContain("aimix-auto-pan");
    expect(migrated.intentTags).toContain("aimix-spatial-pan");
    expect(migrated.actionHistory.some((item) => item.type === "aimixSpatialPanMigration")).toBe(true);
    expect(removeAimixSpatialLayersFromProject(result.project).project.clips[0]?.panAutomation).toBeUndefined();
  });

  it("does not add clean-mode boosts in 250Hz to 2kHz or reduce bass/drum gain", () => {
    const project = buildProjectWithTracks(["bass", "drums", "synth", "vocal"]);
    project.tracks[0]!.gainDb = -1.5;
    project.tracks[1]!.gainDb = -2;

    const result = applyAimixSpatialToProject(project, { mode: "clean", clarity: 100 });
    expect(result.project.tracks[0]?.gainDb).toBe(-1.5);
    expect(result.project.tracks[1]?.gainDb).toBe(-2);

    const synth = result.project.tracks[2]!;
    const midBands = synth.eq.bands.filter((band) => band.enabled && band.frequency >= 250 && band.frequency <= 2000);
    expect(midBands.every((band) => band.gainDb <= 0)).toBe(true);
    expect(midBands.some((band) => band.frequency >= 250 && band.frequency <= 500 && band.gainDb >= -1 && band.gainDb <= -0.3)).toBe(true);
    expect(midBands.some((band) => band.frequency >= 500 && band.frequency <= 1000 && band.gainDb >= -0.8 && band.gainDb <= -0.2)).toBe(true);

    const vocal = result.project.tracks[3]!;
    const vocalLowMidBands = vocal.eq.bands.filter((band) => band.enabled && band.frequency >= 250 && band.frequency <= 1000);
    expect(vocalLowMidBands.every((band) => band.gainDb <= 0)).toBe(true);
    expect(vocal.eq.bands.filter((band) => band.enabled && band.frequency >= 1000 && band.frequency <= 5000).every((band) => band.gainDb >= -0.5)).toBe(true);
  });
});
