import { describe, expect, it } from "vitest";
import { createPluginInstance } from "../../../audio/plugins/pluginRegistry";
import { createEmptyProject, createId, createTrack, type Clip, type Project, type StemRole } from "../../model/Project";
import { applyCleanStemRebuild } from "./cleanStemRebuild";

describe("Clean Stem Rebuild integration", () => {
  it("uses effectiveRole, avoids low-band widening, and guards master gain", () => {
    const project = buildProject(["drums", "vocal", "synth"]);
    project.tracks[0]!.character = {
      ...project.tracks[0]!.character,
      enabled: true,
      mode: "drumAir",
    };
    project.tracks[0]!.insertChain = [createPluginInstance("sweet-stereo-widener", "track")];
    project.tracks[2]!.insertChain = [createPluginInstance("sweet-reverb-lite", "track")];
    project.master.gainDb = 12;
    project.master.limiterEnabled = true;

    const result = applyCleanStemRebuild(project);
    const drums = result.project.tracks[0]!;
    const vocal = result.project.tracks[1]!;
    const synth = result.project.tracks[2]!;

    expect(result.effectiveRoles[0]?.declaredRole).toBe("drums");
    expect(result.effectiveRoles[0]?.effectiveRole).toBe("bass");
    expect(drums.role).toBe("drums");
    expect(drums.pan).toBe(0);
    expect(drums.character.enabled).toBe(false);
    expect(drums.insertChain.some((plugin) => plugin.pluginId === "sweet-support-widener")).toBe(false);
    expect(drums.insertChain.some((plugin) => plugin.pluginId === "sweet-stereo-widener")).toBe(false);
    expect(vocal.pan).toBe(0);
    expect(synth.insertChain.some((plugin) => plugin.pluginId === "sweet-support-widener")).toBe(true);
    expect(synth.insertChain.some((plugin) => plugin.pluginId === "sweet-reverb-lite")).toBe(false);
    expect(result.project.master.gainDb).toBeLessThanOrEqual(2);
    expect(result.project.master.limiterEnabled).toBe(true);
    expect(result.project.master.exportNormalizePeak).toBe(true);
  });
});

function buildProject(roles: StemRole[]): Project {
  const project = createEmptyProject();
  const tracks = roles.map((role, index) => createTrack(`${index} ${role}`, index, role, role));
  const clips: Clip[] = tracks.map((track, index) => ({
    id: createId("clip"),
    trackId: track.id,
    fileId: createId("file"),
    role: track.role,
    intentTags: index === 0 ? ["likely-bass"] : [],
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
  }));
  return { ...project, tracks, clips };
}
