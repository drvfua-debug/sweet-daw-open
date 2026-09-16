import type { EQBand, EQBandType, ParametricEQState, StemRole } from "@/daw/model/Project";
import { sanitizeEqBand, sanitizeParametricEQState } from "../fx/ParametricEQ";

export type EQPresetPoint = {
  type: EQBandType;
  frequency: number;
  gainDb: number;
  q: number;
  enabled?: boolean;
};

export type EQPreset = {
  id: string;
  name: string;
  description: string;
  points: EQPresetPoint[];
};

export const EQ_PRESETS: EQPreset[] = [
  {
    id: "master-clean-balance",
    name: "Master clean balance",
    description: "Sub-safe polish for a full mix.",
    points: [
      { type: "highpass", frequency: 28, gainDb: 0, q: 0.7 },
      { type: "peaking", frequency: 230, gainDb: -0.8, q: 1.0 },
      { type: "peaking", frequency: 3600, gainDb: 0.4, q: 1.0 },
      { type: "highshelf", frequency: 11000, gainDb: 0.5, q: 0.7 },
    ],
  },
  {
    id: "vocal-clear-natural",
    name: "Vocal clear natural",
    description: "Clearer lead without sharp air hype.",
    points: [
      { type: "highpass", frequency: 75, gainDb: 0, q: 0.7 },
      { type: "peaking", frequency: 250, gainDb: -1.0, q: 1.1 },
      { type: "peaking", frequency: 4200, gainDb: 0.6, q: 1.0 },
      { type: "peaking", frequency: 7200, gainDb: -0.8, q: 2.0 },
    ],
  },
  {
    id: "drum-punch-air",
    name: "Drum punch and air",
    description: "Tighter body with modest snap.",
    points: [
      { type: "highpass", frequency: 25, gainDb: 0, q: 0.7 },
      { type: "lowshelf", frequency: 70, gainDb: 0.05, q: 0.7 },
      { type: "peaking", frequency: 250, gainDb: -0.8, q: 1.0 },
      { type: "peaking", frequency: 4500, gainDb: 0.8, q: 1.1 },
      { type: "highshelf", frequency: 10000, gainDb: 0.5, q: 0.7 },
    ],
  },
  {
    id: "bass-tight-foundation",
    name: "Bass tight foundation",
    description: "Firm low end without sub blur.",
    points: [
      { type: "highpass", frequency: 28, gainDb: 0, q: 0.7 },
      { type: "lowshelf", frequency: 65, gainDb: 0.05, q: 0.7 },
      { type: "peaking", frequency: 180, gainDb: -1.0, q: 1.1 },
      { type: "peaking", frequency: 900, gainDb: 0.25, q: 1.0 },
    ],
  },
  {
    id: "guitar-presence-fit",
    name: "Guitar presence fit",
    description: "Places guitars forward without fizz.",
    points: [
      { type: "highpass", frequency: 75, gainDb: 0, q: 0.7 },
      { type: "peaking", frequency: 240, gainDb: -0.8, q: 1.0 },
      { type: "peaking", frequency: 2200, gainDb: 0.7, q: 1.0 },
      { type: "highshelf", frequency: 9000, gainDb: -0.4, q: 0.8 },
    ],
  },
  {
    id: "synth-space-carve",
    name: "Synth space carve",
    description: "Opens synths while clearing mix room.",
    points: [
      { type: "highpass", frequency: 70, gainDb: 0, q: 0.7 },
      { type: "peaking", frequency: 320, gainDb: -0.7, q: 1.0 },
      { type: "peaking", frequency: 1800, gainDb: 0.35, q: 1.0 },
      { type: "highshelf", frequency: 12000, gainDb: 0.4, q: 0.7 },
    ],
  },
  {
    id: "fx-clean-space",
    name: "FX clean space",
    description: "Keeps sweeps and impacts clear of the mix core.",
    points: [
      { type: "highpass", frequency: 120, gainDb: 0, q: 0.7 },
      { type: "peaking", frequency: 300, gainDb: -0.9, q: 1.0 },
      { type: "peaking", frequency: 2800, gainDb: 0.4, q: 1.0 },
      { type: "highshelf", frequency: 10000, gainDb: 0.3, q: 0.7 },
    ],
  },
  {
    id: "mud-control",
    name: "Mud control",
    description: "General low-mid cleanup for stems.",
    points: [
      { type: "highpass", frequency: 30, gainDb: 0, q: 0.7 },
      { type: "peaking", frequency: 180, gainDb: -1.6, q: 1.1 },
      { type: "peaking", frequency: 320, gainDb: -1.1, q: 1.2 },
    ],
  },
  {
    id: "sub-safety",
    name: "Sub safety",
    description: "Blocks rumble and keeps lows usable.",
    points: [
      { type: "highpass", frequency: 28, gainDb: 0, q: 0.8 },
      { type: "peaking", frequency: 45, gainDb: -0.6, q: 1.1 },
      { type: "peaking", frequency: 120, gainDb: 0.4, q: 0.9 },
    ],
  },
];

export const EQ_ROLE_PRESET_IDS: Record<StemRole | "master", string> = {
  vocal: "vocal-clear-natural",
  backingVocal: "vocal-clear-natural",
  drums: "drum-punch-air",
  bass: "bass-tight-foundation",
  guitar: "guitar-presence-fit",
  synth: "synth-space-carve",
  keys: "synth-space-carve",
  fx: "fx-clean-space",
  music: "synth-space-carve",
  loop: "synth-space-carve",
  other: "mud-control",
  reference: "master-clean-balance",
  master: "master-clean-balance",
};

export function getEQPresetById(presetId: string): EQPreset | null {
  return EQ_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

export function getEQPresetForRole(role: StemRole | "master"): EQPreset {
  return getEQPresetById(EQ_ROLE_PRESET_IDS[role]) ?? EQ_PRESETS[0];
}

export function applyEQPreset(state: ParametricEQState, preset: EQPreset): ParametricEQState {
  return applyEQPresetWithAmount(state, preset, 1);
}

export function applyEQPresetWithAmount(state: ParametricEQState, preset: EQPreset, amount: number): ParametricEQState {
  const safeAmount = clamp(amount, 0, 1);
  const usedIndexes = new Set<number>();
  const bands = resetBands(state.bands);

  for (const point of preset.points) {
    const safePoint = sanitizePresetPoint({
      ...point,
      gainDb: point.gainDb * safeAmount,
    });
    const index = choosePresetBandIndex(safePoint, bands, usedIndexes);
    if (index < 0) continue;
    usedIndexes.add(index);
    bands[index] = {
      ...bands[index],
      type: safePoint.type,
      frequency: safePoint.frequency,
      gainDb: safePoint.gainDb,
      q: safePoint.q,
      enabled: safePoint.enabled ?? true,
    };
  }

  return sanitizeParametricEQState({
    ...state,
    enabled: true,
    bands,
  });
}

function resetBands(bands: EQBand[]) {
  return bands.map((band) => sanitizeEqBand({
    ...band,
    gainDb: 0,
    enabled: true,
    solo: false,
  }));
}

function sanitizePresetPoint(point: EQPresetPoint): EQPresetPoint {
  const safeBand = sanitizeEqBand({
    id: "preset",
    type: point.type,
    frequency: point.frequency,
    gainDb: point.gainDb,
    q: point.q,
    enabled: point.enabled ?? true,
    solo: false,
  });
  return {
    type: safeBand.type,
    frequency: safeBand.frequency,
    gainDb: safeBand.gainDb,
    q: safeBand.q,
    enabled: safeBand.enabled,
  };
}

function choosePresetBandIndex(point: EQPresetPoint, bands: EQBand[], usedIndexes: Set<number>) {
  const exactTypeIndex = bands.findIndex((band, index) => !usedIndexes.has(index) && band.type === point.type);
  if (exactTypeIndex >= 0 && point.type !== "peaking" && point.type !== "notch") {
    return exactTypeIndex;
  }

  const candidates = bands
    .map((band, index) => ({ band, index }))
    .filter(({ band, index }) => !usedIndexes.has(index) && (band.type === "peaking" || band.type === "notch"));

  if (candidates.length > 0) {
    return candidates.reduce((best, current) => {
      const bestDistance = Math.abs(Math.log2(best.band.frequency / point.frequency));
      const currentDistance = Math.abs(Math.log2(current.band.frequency / point.frequency));
      return currentDistance < bestDistance ? current : best;
    }).index;
  }

  return bands.findIndex((_, index) => !usedIndexes.has(index));
}

function clamp(value: number, min: number, max: number) {
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safeValue));
}
