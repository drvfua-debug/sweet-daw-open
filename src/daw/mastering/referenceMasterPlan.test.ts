import { describe, expect, it } from "vitest";
import { buildReferenceMasterPlan, capReferenceMasterPlan } from "./referenceMasterPlan";
import { resolveSingleFileMasteringSettings } from "./singleFileMastering";

describe("ReferenceMasterPlan", () => {
  it("freezes measured tonal moves within the reference safety budget", () => {
    const settings = resolveSingleFileMasteringSettings("referenceCatchUp", {
      referenceClarityMode: "catchUp",
      referencePresenceDb: -18,
      referenceAirDb: -26,
      referenceGlossDb: -34,
      referenceUltraAirDb: -46,
      referenceSheenDb: -52,
    });
    const plan = buildReferenceMasterPlan(settings, {
      presence: -24,
      air: -34,
      gloss: -42,
      ultra: -56,
      sheen: -64,
    }, {
      blockHighShelfBoost: true,
      preferMidOnlySheen: true,
    });

    expect(plan).not.toBeNull();
    expect(plan?.presenceDb).toBeGreaterThan(0);
    expect(plan?.glossMidOnly).toBe(true);
    expect(plan?.sheenMidOnly).toBe(true);
    expect(plan?.tonalMoveBudgetDb).toBeLessThanOrEqual(3.4);

    const residual = capReferenceMasterPlan(plan!, 0.25);
    expect(Math.abs(residual.presenceDb)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(residual.presenceFocusDb)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(residual.airDb)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(residual.glossDb)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(residual.sheenDb)).toBeLessThanOrEqual(0.25);
  });

  it("does not create a tonal plan without measured reference targets", () => {
    const settings = resolveSingleFileMasteringSettings("referenceCatchUp", {
      referenceClarityMode: "catchUp",
    });
    expect(buildReferenceMasterPlan(settings, {
      presence: -24,
      air: -34,
      gloss: -42,
      ultra: -56,
      sheen: -64,
    }, {
      blockHighShelfBoost: false,
      preferMidOnlySheen: false,
    })).toBeNull();
  });
});
