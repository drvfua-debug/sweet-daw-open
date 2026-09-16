import { describe, expect, it } from "vitest";
import { createClipHistoryItem, createEmptyProject, createId, createTrack, type Clip, type Project, type StemRole } from "../../model/Project";
import { resolveEffectiveStemRoles } from "./effectiveRole";
import type { StemFeatureReport } from "../mixDoctorTypes";

describe("Clean Stem effectiveRole", () => {
  it("treats a drums clip with likely-bass tag as effective bass", () => {
    const project = buildProject([{ role: "drums", tags: ["likely-bass"] }]);
    const roles = resolveEffectiveStemRoles(project);

    expect(roles[0]?.declaredRole).toBe("drums");
    expect(roles[0]?.effectiveRole).toBe("bass");
    expect(roles[0]?.source).toBe("intentTags");
  });

  it("uses actionHistory likelyRole for drums/percussion that is really guitar", () => {
    const project = buildProject([{ role: "drums", likelyRole: "guitar" }]);
    const roles = resolveEffectiveStemRoles(project);

    expect(roles[0]?.effectiveRole).toBe("guitar");
    expect(roles[0]?.source).toBe("actionHistory");
  });

  it("keeps declared role when feature confidence is low", () => {
    const project = buildProject([{ role: "drums" }]);
    const trackId = project.tracks[0]!.id;
    const roles = resolveEffectiveStemRoles(project, {
      stemFeatureReports: [makeFeature(trackId, "drums", { centroid: 1800, presence: -12, body: -20 })],
    });

    expect(roles[0]?.effectiveRole).toBe("drums");
    expect(roles[0]?.source).toBe("declared");
  });
});

function buildProject(entries: Array<{ role: StemRole; tags?: string[]; likelyRole?: StemRole }>): Project {
  const project = createEmptyProject();
  const tracks = entries.map((entry, index) => createTrack(`${index} ${entry.role}`, index, entry.role, entry.role));
  const clips: Clip[] = tracks.map((track, index) => ({
    id: createId("clip"),
    trackId: track.id,
    fileId: createId("file"),
    role: track.role,
    intentTags: entries[index]?.tags ?? [],
    actionHistory: entries[index]?.likelyRole
      ? [createClipHistoryItem("aimixRoleMismatch", "Role mismatch", { likelyRole: entries[index]!.likelyRole })]
      : [],
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

function makeFeature(trackId: string, role: StemRole, values: { centroid: number; presence: number; body: number }): StemFeatureReport {
  const bandEnergyDb = {
    "20-35": -50,
    "35-60": -44,
    "60-120": -42,
    "120-250": -34,
    "250-500": values.body,
    "500-900": values.body,
    "900-1500": -16,
    "1500-3000": values.presence,
    "3000-5000": values.presence,
    "5000-9000": -18,
    "9000-12000": -22,
    "12000-16000": -28,
    "16000-20000": -34,
  };
  return {
    stemId: trackId,
    trackId,
    trackName: "feature",
    role,
    rmsDb: -18,
    peakDb: -6,
    truePeakApproxDb: -5.8,
    crestFactorDb: 12,
    integratedLufsApprox: -19,
    lrCorrelation: 0.9,
    sideMidRatioDb: -18,
    stereoWidthScore: 20,
    spectralCentroidHz: values.centroid,
    spectralFlatness: 0.2,
    bandEnergyDb,
    notes: [],
  };
}
