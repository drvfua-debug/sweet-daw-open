import { describe, expect, it } from "vitest";
import { createEmptyProject, createTrack, type Project, type StemRole } from "../../model/Project";
import type { BandEnergyMap, ReferenceDelta, ReferenceProfile } from "../mixDoctorTypes";
import { applyReferenceAmbienceFollowToProject } from "./referenceAmbience";

function projectWithRoles(roles: StemRole[]): Project {
  const base = createEmptyProject();
  return {
    ...base,
    tracks: roles.map((role, index) => createTrack(`${index} ${role}`, index, role === "reference" ? "reference" : role, role)),
  };
}

function referenceProfile(): ReferenceProfile {
  const bandEnergyDb: BandEnergyMap = {
    "20-35": -34,
    "35-60": -24,
    "60-120": -18,
    "120-250": -17,
    "250-500": -18,
    "500-900": -20,
    "900-1500": -22,
    "1500-3000": -21,
    "3000-5000": -23,
    "5000-9000": -24,
    "9000-12000": -22,
    "12000-16000": -23,
    "16000-20000": -31,
  };

  return {
    stemId: "ref",
    trackId: "ref",
    trackName: "Reference",
    role: "reference",
    sourceRole: "reference",
    rmsDb: -15,
    peakDb: -2,
    truePeakApproxDb: -1.8,
    crestFactorDb: 13,
    integratedLufsApprox: -12,
    lrCorrelation: 0.72,
    sideMidRatioDb: -11,
    stereoWidthScore: 74,
    spectralCentroidHz: 3200,
    spectralFlatness: 0.18,
    bandEnergyDb,
    targetRanges: {},
    loudnessTargetLabel: "reference-range",
    notes: [],
  };
}

function referenceDelta(): ReferenceDelta {
  return {
    loudnessDeltaDb: 0,
    peakDeltaDb: 0,
    crestFactorDeltaDb: 0,
    lowEndDeltaDb: 0,
    bodyDeltaDb: 0,
    presenceDeltaDb: 0,
    airDeltaDb: 0.4,
    stereoWidthDelta: 12,
    correlationDelta: -0.1,
    advisory: [],
  };
}

describe("Reference ambience follow", () => {
  it("adds conservative ambience sends to vocal and music roles, not bass/drums/reference", () => {
    const project = projectWithRoles(["vocal", "music", "bass", "drums", "reference"]);
    const result = applyReferenceAmbienceFollowToProject(project, referenceProfile(), referenceDelta(), "referenceMatch");

    const vocal = result.project.tracks.find((track) => track.role === "vocal");
    const music = result.project.tracks.find((track) => track.role === "music");
    const bass = result.project.tracks.find((track) => track.role === "bass");
    const drums = result.project.tracks.find((track) => track.role === "drums");
    const reference = result.project.tracks.find((track) => track.role === "reference");

    expect(result.affectedTracks).toBe(2);
    expect(vocal?.sends.some((send) => send.targetBusId === "bus-ambience" && send.enabled)).toBe(true);
    expect(music?.sends.some((send) => send.targetBusId === "bus-ambience" && send.enabled)).toBe(true);
    expect(bass?.sends).toHaveLength(0);
    expect(drums?.sends).toHaveLength(0);
    expect(reference?.sends).toHaveLength(0);
  });

  it("replaces its own ambience send instead of duplicating it", () => {
    const project = projectWithRoles(["vocal", "synth"]);
    const first = applyReferenceAmbienceFollowToProject(project, referenceProfile(), referenceDelta(), "balanced").project;
    const second = applyReferenceAmbienceFollowToProject(first, referenceProfile(), referenceDelta(), "balanced").project;

    for (const track of second.tracks) {
      expect(track.sends.filter((send) => send.targetBusId === "bus-ambience")).toHaveLength(1);
    }
  });
});
