export const LUFS_FROM_RMS_OFFSET_DB = -1.2;

export function estimateIntegratedLufsApproxFromRms(rmsDb: number): number {
  return Number.isFinite(rmsDb) ? rmsDb + LUFS_FROM_RMS_OFFSET_DB : -60;
}

export function dbToPower(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return 10 ** (db / 10);
}

export function powerToDb(power: number): number {
  if (!Number.isFinite(power) || power <= 0) return -60;
  return 10 * Math.log10(power);
}

export function sumDbAsPower(values: number[]): number {
  const sum = values.reduce((total, value) => total + dbToPower(value), 0);
  return powerToDb(sum);
}

export function averageDbAsPower(values: number[]): number {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return -60;
  const sum = finiteValues.reduce((total, value) => total + dbToPower(value), 0);
  return powerToDb(sum / finiteValues.length);
}
