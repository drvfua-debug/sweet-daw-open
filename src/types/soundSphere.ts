export type SourceId =
  | "metal"
  | "fire"
  | "water"
  | "glass"
  | "wood"
  | "stone"
  | "electric"
  | "air"
  | "string";

export interface RawSource {
  id: SourceId;
  name: string;
  x: number;
  y: number;
  z: number;
  defaultEnabled: boolean;
}

export interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

export interface SoundSpherePatch {
  id: string;
  name: string;
  enabledSources: SourceId[];
  mutedSources: SourceId[]; // CUT sources
  spherePoint: SpherePoint;
  sourceWeights: Record<SourceId, number>;
  mode: "chord" | "pluck" | "pad" | "bass" | "fx" | "texture";
  chordableScore: number;
  fxScore: number;
  sustainScore: number;
  transientScore: number;
  harshnessRisk: number;
  durationFit: "short" | "medium" | "long";
  harmonicFit: "poor" | "usable" | "good";
  recommendedLane: "chord" | "bass" | "texture" | "fx";
}

export interface SoundBlock {
  id: string;
  startBeat: number;
  durationBeats: number;
  patchId: string;
  blockType: "chord" | "bass" | "texture" | "fx";
  chord?: {
    root: string;     // e.g. "C", "F", "G"
    quality: string;  // e.g. "Maj", "Min", "7", "maj7", "min7", "dim", "aug"
  };
  movement?: "hold" | "arp" | "pulse" | "strum" | "swell";
  velocity: number;
}

export interface SoundSphereProject {
  id: string;
  title: string;
  bpm: number;
  key: string;      // e.g. "C", "D"
  scale: string;    // e.g. "Major", "Minor"
  savedPatches: SoundSpherePatch[];
  blocks: SoundBlock[];
  updatedAt: string;
}
