import type { SourceId, SoundSpherePatch } from "@/types/soundSphere";

export const SOURCE_FITNESS_COEFFICIENTS = {
  chordable: {
    string: 1.0,
    glass: 0.8,
    wood: 0.5,
    water: 0.4,
    air: 0.3,
    electric: 0.2,
    metal: 0.1,
    stone: 0.0,
    fire: -0.6,
  },
  fx: {
    fire: 1.0,
    metal: 0.8,
    electric: 0.6,
    stone: 0.4,
    air: 0.2,
    wood: 0.1,
    water: 0.0,
    glass: 0.0,
    string: 0.0,
  },
  sustain: {
    string: 0.9,
    water: 0.8,
    air: 0.8,
    electric: 0.5,
    metal: 0.2,
    glass: 0.1,
    wood: 0.0,
    stone: 0.0,
    fire: 0.0,
  },
  transient: {
    metal: 0.8,
    glass: 0.8,
    wood: 0.8,
    fire: 0.7,
    stone: 0.6,
    electric: 0.4,
    water: 0.1,
    string: 0.1,
    air: 0.0,
  },
  harshness: {
    fire: 1.0,
    metal: 0.8,
    electric: 0.6,
    stone: 0.3,
    wood: 0.1,
    glass: 0.1,
    string: 0.0,
    water: 0.0,
    air: 0.0,
  },
};

export function evaluatePatchFitness(weights: Record<SourceId, number>): {
  chordableScore: number;
  fxScore: number;
  sustainScore: number;
  transientScore: number;
  harshnessRisk: number;
  durationFit: SoundSpherePatch["durationFit"];
  harmonicFit: SoundSpherePatch["harmonicFit"];
  recommendedLane: SoundSpherePatch["recommendedLane"];
} {
  let chordableScore = 0;
  let fxScore = 0;
  let sustainScore = 0;
  let transientScore = 0;
  let harshnessRisk = 0;

  const sourceIds = Object.keys(weights) as SourceId[];

  for (const id of sourceIds) {
    const w = weights[id] ?? 0;
    chordableScore += w * SOURCE_FITNESS_COEFFICIENTS.chordable[id];
    fxScore += w * SOURCE_FITNESS_COEFFICIENTS.fx[id];
    sustainScore += w * SOURCE_FITNESS_COEFFICIENTS.sustain[id];
    transientScore += w * SOURCE_FITNESS_COEFFICIENTS.transient[id];
    harshnessRisk += w * SOURCE_FITNESS_COEFFICIENTS.harshness[id];
  }

  // Clamp to [0, 1]
  chordableScore = Math.max(0, Math.min(1, chordableScore));
  fxScore = Math.max(0, Math.min(1, fxScore));
  sustainScore = Math.max(0, Math.min(1, sustainScore));
  transientScore = Math.max(0, Math.min(1, transientScore));
  harshnessRisk = Math.max(0, Math.min(1, harshnessRisk));

  let durationFit: SoundSpherePatch["durationFit"] = "medium";
  if (sustainScore > 0.6) {
    durationFit = "long";
  } else if (sustainScore < 0.3) {
    durationFit = "short";
  }

  let harmonicFit: SoundSpherePatch["harmonicFit"] = "usable";
  if (chordableScore > 0.65) {
    harmonicFit = "good";
  } else if (chordableScore < 0.4) {
    harmonicFit = "poor";
  }

  let recommendedLane: SoundSpherePatch["recommendedLane"] = "bass";
  if (chordableScore >= 0.45) {
    recommendedLane = "chord";
  } else if (fxScore >= 0.5) {
    recommendedLane = "fx";
  } else if (sustainScore >= 0.4) {
    recommendedLane = "texture";
  }

  return {
    chordableScore,
    fxScore,
    sustainScore,
    transientScore,
    harshnessRisk,
    durationFit,
    harmonicFit,
    recommendedLane,
  };
}
