import { describe, expect, it } from "vitest";
import { assessSpatialEffectiveness } from "./spatialEffectiveness";

describe("AIMIX Spatial Phase 0 effectiveness characterization", () => {
  it("classifies the measured no-op profile as bypassed_no_effect", () => {
    // Measured in the current real-STEM report before Phase 5 wiring.
    const assessment = assessSpatialEffectiveness(
      { sideMidDb: -12.12, correlation: 0.884, monoFoldLossDb: 0.3 },
      { sideMidDb: -12.13, correlation: 0.885, monoFoldLossDb: 0.3 },
    );

    expect(assessment.status).toBe("bypassed_no_effect");
    console.info("Phase 0 Spatial no-op snapshot", assessment);
  });

  it("keeps a measurable, mono-safe image move distinct from no-op and unsafe moves", () => {
    const effective = assessSpatialEffectiveness(
      { sideMidDb: -11.8, correlation: 0.84, monoFoldLossDb: 0.22 },
      { sideMidDb: -11.35, correlation: 0.79, monoFoldLossDb: 0.34 },
    );
    const unsafe = assessSpatialEffectiveness(
      { sideMidDb: -11.8, correlation: 0.84, monoFoldLossDb: 0.22 },
      { sideMidDb: -9.8, correlation: 0.61, monoFoldLossDb: 0.8 },
    );

    expect(effective.status).toBe("effective");
    expect(unsafe.status).toBe("unsafe");
  });
});
