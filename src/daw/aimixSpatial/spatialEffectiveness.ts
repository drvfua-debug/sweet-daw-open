export type SpatialEffectivenessMetrics = {
  sideMidDb: number;
  correlation: number;
  monoFoldLossDb: number;
};

export type SpatialEffectivenessAssessment = {
  status: "effective" | "bypassed_no_effect" | "unsafe";
  sideMidDeltaDb: number;
  correlationDelta: number;
  monoFoldLossDeltaDb: number;
  reason: string;
};

/**
 * Phase 0 helper. It is intentionally not wired into Spatial yet; Phase 5
 * will use the same criteria to avoid reporting inaudible placement as success.
 */
export function assessSpatialEffectiveness(
  before: SpatialEffectivenessMetrics,
  after: SpatialEffectivenessMetrics,
): SpatialEffectivenessAssessment {
  const sideMidDeltaDb = round2(after.sideMidDb - before.sideMidDb);
  const correlationDelta = round3(after.correlation - before.correlation);
  const monoFoldLossDeltaDb = round2(after.monoFoldLossDb - before.monoFoldLossDb);

  if (after.correlation < 0.65 || monoFoldLossDeltaDb > 0.5) {
    return {
      status: "unsafe",
      sideMidDeltaDb,
      correlationDelta,
      monoFoldLossDeltaDb,
      reason: "Spatial changed mono compatibility or correlation beyond the safe boundary.",
    };
  }

  if (Math.abs(sideMidDeltaDb) < 0.1 && Math.abs(correlationDelta) < 0.01) {
    return {
      status: "bypassed_no_effect",
      sideMidDeltaDb,
      correlationDelta,
      monoFoldLossDeltaDb,
      reason: "Spatial movement is below the Phase 0 audibility threshold.",
    };
  }

  return {
    status: "effective",
    sideMidDeltaDb,
    correlationDelta,
    monoFoldLossDeltaDb,
    reason: "Spatial produced a measurable, safe image change.",
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
