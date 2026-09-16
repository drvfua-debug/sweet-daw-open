import { describe, expect, it } from "vitest";
import { calculateSourceWeights } from "./weighting";
import { evaluatePatchFitness } from "./fitness";
import type { SourceId, SpherePoint } from "@/types/soundSphere";

describe("Sound Sphere weighting", () => {
  it("computes weights that sum to 1.0", () => {
    const point: SpherePoint = { x: 0.1, y: -0.2, z: 0.3 };
    const weights = calculateSourceWeights(point, []);

    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("assigns exactly 0 weight to muted/CUT sources", () => {
    const point: SpherePoint = { x: 0.5, y: 0.5, z: 0.5 };
    const muted: SourceId[] = ["metal", "fire", "string"];
    const weights = calculateSourceWeights(point, muted);

    expect(weights.metal).toBe(0);
    expect(weights.fire).toBe(0);
    expect(weights.string).toBe(0);

    const activeSum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(activeSum).toBeCloseTo(1.0, 5);
  });

  it("handles all sources muted safely without NaN or Infinity", () => {
    const point: SpherePoint = { x: 0, y: 0, z: 0 };
    const allMuted: SourceId[] = [
      "metal", "fire", "water", "glass", "wood",
      "stone", "electric", "air", "string"
    ];
    const weights = calculateSourceWeights(point, allMuted);

    for (const val of Object.values(weights)) {
      expect(val).toBe(0);
      expect(Number.isNaN(val)).toBe(false);
      expect(Number.isFinite(val)).toBe(true);
    }
  });

  it("handles exact match coordinates safely due to epsilon", () => {
    // Metal is exactly at (0, 0, -1)
    const point: SpherePoint = { x: 0, y: 0, z: -1 };
    const weights = calculateSourceWeights(point, []);

    expect(weights.metal).toBeGreaterThan(0.9); // Metal should be extremely dominant
    expect(Number.isNaN(weights.metal)).toBe(false);

    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

describe("Patch Fitness engine", () => {
  it("classifies pure String weights as good harmonic fit and recommends chord lane", () => {
    const weights: Record<SourceId, number> = {
      string: 1.0,
      metal: 0, fire: 0, water: 0, glass: 0, wood: 0, stone: 0, electric: 0, air: 0
    };

    const fitness = evaluatePatchFitness(weights);
    expect(fitness.chordableScore).toBe(1.0);
    expect(fitness.recommendedLane).toBe("chord");
    expect(fitness.harmonicFit).toBe("good");
    expect(fitness.durationFit).toBe("long");
  });

  it("classifies pure Fire as poor harmonic fit and recommends FX lane", () => {
    const weights: Record<SourceId, number> = {
      fire: 1.0,
      string: 0, metal: 0, water: 0, glass: 0, wood: 0, stone: 0, electric: 0, air: 0
    };

    const fitness = evaluatePatchFitness(weights);
    expect(fitness.chordableScore).toBe(0); // Clamped to 0 from -0.6
    expect(fitness.recommendedLane).toBe("fx");
    expect(fitness.harmonicFit).toBe("poor");
    expect(fitness.harshnessRisk).toBe(1.0);
  });

  it("classifies pure Metal as high harshness and recommends FX lane", () => {
    const weights: Record<SourceId, number> = {
      metal: 1.0,
      string: 0, fire: 0, water: 0, glass: 0, wood: 0, stone: 0, electric: 0, air: 0
    };

    const fitness = evaluatePatchFitness(weights);
    expect(fitness.chordableScore).toBeLessThan(0.4);
    expect(fitness.recommendedLane).toBe("fx");
    expect(fitness.harshnessRisk).toBe(0.8);
  });

  it("classifies pure Water as long duration fit and texture lane", () => {
    const weights: Record<SourceId, number> = {
      water: 1.0,
      string: 0, fire: 0, metal: 0, glass: 0, wood: 0, stone: 0, electric: 0, air: 0
    };

    const fitness = evaluatePatchFitness(weights);
    expect(fitness.sustainScore).toBe(0.8);
    expect(fitness.durationFit).toBe("long");
    expect(fitness.recommendedLane).toBe("texture");
  });
});
