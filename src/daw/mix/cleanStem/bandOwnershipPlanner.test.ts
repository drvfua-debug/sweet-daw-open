import { describe, expect, it } from "vitest";
import { createEmptyProject, createTrack, type StemRole } from "../../model/Project";
import { buildBandOwnershipPlan } from "./bandOwnershipPlanner";
import type { EffectiveStemRole } from "./effectiveRole";

describe("Clean Stem bandOwnershipPlanner", () => {
  it("does not spread 60-120Hz ownership across support tracks", () => {
    const project = buildProject(["bass", "guitar", "synth", "keys"]);
    const roles = effectiveRoles(project);
    const plans = buildBandOwnershipPlan(project, roles);
    const low = plans.find((plan) => plan.bandId === "60-120");

    expect(low?.primaryTrackId).toBe(project.tracks[0]?.id);
    expect(low?.secondaryTrackIds.length).toBeLessThanOrEqual(1);
    expect(low?.cuts.some((cut) => cut.trackId === project.tracks[1]?.id)).toBe(true);
    expect(low?.cuts.some((cut) => cut.trackId === project.tracks[2]?.id)).toBe(true);
  });

  it("adds small body cuts to support tracks when 250-500Hz has many contenders", () => {
    const project = buildProject(["vocal", "guitar", "synth", "keys"]);
    const roles = effectiveRoles(project);
    const body = buildBandOwnershipPlan(project, roles).find((plan) => plan.bandId === "250-500");

    expect(body?.primaryTrackId).toBeTruthy();
    expect(body?.cuts.length).toBeGreaterThan(0);
    expect(body?.cuts.every((cut) => Math.abs(cut.gainDb) <= 1.5)).toBe(true);
    expect(body?.cuts.every((cut) => cut.gainDb <= 0)).toBe(true);
  });
});

function buildProject(roles: StemRole[]) {
  const project = createEmptyProject();
  return {
    ...project,
    tracks: roles.map((role, index) => createTrack(`${index} ${role}`, index, role, role)),
  };
}

function effectiveRoles(project: ReturnType<typeof buildProject>): EffectiveStemRole[] {
  return project.tracks.map((track) => ({
    trackId: track.id,
    declaredRole: track.role,
    effectiveRole: track.role,
    confidence: 0.9,
    source: "declared",
    reason: "test",
  }));
}
