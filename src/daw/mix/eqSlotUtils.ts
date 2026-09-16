import type { AimixEqSlotOwner, EQBand, EQBandType, ParametricEQState } from "@/daw/model/Project";

type EqSlotApplyOptions = {
  minGainDb?: number;
  maxGainDb?: number;
  minAbsGainDb?: number;
};

const DEFAULT_MIN_ABS_GAIN_DB = 0.03;
const PEAKING_MIN_GAIN_DB = -3;
const PEAKING_MAX_GAIN_DB = 2;
const SHELF_MIN_GAIN_DB = -2;
const SHELF_MAX_GAIN_DB = 1.2;

export const AIMIX_EQ_SLOT_OWNERS: AimixEqSlotOwner[] = [
  "role_enhancement",
  "shared_magic_policy",
  "manual_adjustment",
  "spectral_restore",
  "dynamic_vocal_duck",
  "reference_match",
  "sweet_no_reference",
  "final_polish",
  "safety",
  "legacy",
];

export function isAimixEqSlotOwner(value: unknown): value is AimixEqSlotOwner {
  return typeof value === "string" && AIMIX_EQ_SLOT_OWNERS.includes(value as AimixEqSlotOwner);
}

export function applyPeakingToSlot(
  eq: ParametricEQState,
  owner: AimixEqSlotOwner,
  slotId: string,
  frequency: number,
  gainDb: number,
  q: number,
  options: EqSlotApplyOptions = {},
): boolean {
  const minAbsGainDb = options.minAbsGainDb ?? DEFAULT_MIN_ABS_GAIN_DB;
  if (Math.abs(gainDb) < minAbsGainDb) return false;
  const band = findSlotBand(eq, "peaking", owner, slotId);
  if (!band) return false;
  writeBand(band, "peaking", owner, slotId, frequency, gainDb, q, {
    minGainDb: options.minGainDb ?? PEAKING_MIN_GAIN_DB,
    maxGainDb: options.maxGainDb ?? PEAKING_MAX_GAIN_DB,
  });
  return true;
}

export function applyShelfGainToSlot(
  eq: ParametricEQState,
  type: "lowshelf" | "highshelf",
  owner: AimixEqSlotOwner,
  slotId: string,
  frequency: number,
  gainDb: number,
  q: number,
  options: EqSlotApplyOptions = {},
): boolean {
  const minAbsGainDb = options.minAbsGainDb ?? DEFAULT_MIN_ABS_GAIN_DB;
  if (Math.abs(gainDb) < minAbsGainDb) return false;
  const band = findSlotBand(eq, type, owner, slotId);
  if (!band) return false;
  writeBand(band, type, owner, slotId, frequency, gainDb, q, {
    minGainDb: options.minGainDb ?? SHELF_MIN_GAIN_DB,
    maxGainDb: options.maxGainDb ?? SHELF_MAX_GAIN_DB,
  });
  return true;
}

function findSlotBand(
  eq: ParametricEQState,
  type: EQBandType,
  owner: AimixEqSlotOwner,
  slotId: string,
): EQBand | null {
  const exact = eq.bands.find((band) => band.aimixOwner === owner && band.aimixSlotId === slotId);
  if (exact) return exact;

  const freeSameType = eq.bands.find((band) => band.type === type && !band.aimixOwner && !band.aimixSlotId && Math.abs(band.gainDb) < 0.05);
  if (freeSameType) return freeSameType;

  const reusableOwned = eq.bands.find(
    (band) => band.type === type && band.aimixOwner === owner && !band.aimixSlotId && Math.abs(band.gainDb) < 0.08,
  );
  return reusableOwned ?? null;
}

function writeBand(
  band: EQBand,
  type: EQBandType,
  owner: AimixEqSlotOwner,
  slotId: string,
  frequency: number,
  gainDb: number,
  q: number,
  limits: { minGainDb: number; maxGainDb: number },
) {
  band.enabled = true;
  band.type = type;
  band.frequency = round1(clamp(frequency, 20, 20000));
  band.gainDb = round1(clamp(gainDb, limits.minGainDb, limits.maxGainDb));
  band.q = round2(clamp(q, 0.2, 12));
  band.aimixOwner = owner;
  band.aimixSlotId = slotId;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
