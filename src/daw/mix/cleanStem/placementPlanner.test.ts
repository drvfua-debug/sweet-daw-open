import { describe, expect, it } from "vitest";
import { createEmptyProject, createTrack, type StemRole } from "../../model/Project";
import { buildPlacementPlan } from "./placementPlanner";
import type { EffectiveStemRole } from "./effectiveRole";

describe("Clean Stem placementPlanner", () => {
  it("keeps vocal, bass, and low-dominant roles hard centered", () => {
    const project = buildProject(["vocal", "bass", "drums"]);
    const plans = buildPlacementPlan(project, effectiveRoles(project));

    expect(plans.map((plan) => plan.panBias)).toEqual([0, 0, 0]);
    expect(plans.every((plan) => plan.centerProtection === "hard-center")).toBe(true);
    expect(plans.every((plan) => plan.widthBand === "none")).toBe(true);
  });

  it("keeps support pan inside role limits and separates pan from width intent", () => {
    const project = buildProject(["backingVocal", "guitar", "synth", "keys", "fx", "other"]);
    const plans = buildPlacementPlan(project, effectiveRoles(project));

    const backing = plans[0]!;
    const fx = plans.find((plan) => plan.effectiveRole === "fx")!;
    expect(Math.abs(backing.panBias)).toBeLessThanOrEqual(0.18);
    expect(Math.abs(fx.panBias)).toBeLessThanOrEqual(0.32);
    expect(plans.some((plan) => plan.widthIntent > 0 && plan.widthBand !== "none")).toBe(true);
    expect(plans.every((plan) => Math.abs(plan.panBias) <= 0.32)).toBe(true);
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
