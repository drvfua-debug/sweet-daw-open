export type ReferenceQualityMetrics = {
  integratedLufs: number;
  truePeakDb: number;
  rmsDb: number;
  crestDb: number;
  plrDb?: number;
  sideMidDb: number;
  lrCorrelation: number;
  bandEnergyDb: {
    sub_20_60?: number;
    low_60_120?: number;
    lowMid_120_250?: number;
    body_250_500?: number;
    mid_500_2000?: number;
    presence_2000_5000?: number;
    air_5000_10000?: number;
    gloss_9000_14000?: number;
    ultraAir_10000_20000?: number;
    sheen_14000_20000?: number;
  };
  bandSideMidDb?: {
    low_20_120?: number;
    lowMid_120_500?: number;
    mid_500_2000?: number;
    presence_2000_5000?: number;
    air_5000_10000?: number;
    gloss_9000_14000?: number;
    ultraAir_10000_20000?: number;
    sheen_14000_20000?: number;
  };
  bandCorrelation?: {
    low_20_120?: number;
    lowMid_120_500?: number;
    mid_500_2000?: number;
    presence_2000_5000?: number;
    air_5000_10000?: number;
    gloss_9000_14000?: number;
    ultraAir_10000_20000?: number;
    sheen_14000_20000?: number;
  };
};

export type ReferenceQualityGateRow = {
  metric: string;
  before?: number;
  reference: number;
  after: number;
  deltaToReference: number;
  improved?: boolean;
  status: "pass" | "warn" | "fail";
};

export type ReferenceQualityGateResult = {
  passed: boolean;
  warnings: string[];
  failures: string[];
  rows: ReferenceQualityGateRow[];
};

export function validateAimixReferenceCandidate(
  reference: ReferenceQualityMetrics,
  candidate: ReferenceQualityMetrics,
  before?: ReferenceQualityMetrics,
): ReferenceQualityGateResult {
  const rows: ReferenceQualityGateRow[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];

  const lufsDelta = candidate.integratedLufs - reference.integratedLufs;
  rows.push(row("LUFS", reference.integratedLufs, candidate.integratedLufs, before?.integratedLufs, Math.abs(lufsDelta) <= 0.5 ? "pass" : lufsDelta > 0.5 ? "fail" : "warn"));
  if (lufsDelta > 1.0) {
    const message = `Reference Match failed: LUFS is ${formatDelta(lufsDelta)} above reference.`;
    failures.push(message);
    warnings.push(message);
  } else if (lufsDelta > 0.5) {
    warnings.push(`Reference Match failed: LUFS is ${formatDelta(lufsDelta)} above reference.`);
  } else if (Math.abs(lufsDelta) > 0.5) {
    warnings.push(`Reference Match warning: LUFS is ${formatDelta(lufsDelta)} from reference.`);
    if (lufsDelta < -0.5 && candidate.truePeakDb > -1.5) {
      warnings.push("Reference Match warning: loudness is below reference but true peak is already near the ceiling; keep AIMIX safe, then use Mastering > Reference Catch-Up for final loudness.");
    }
  }

  rows.push(row("True Peak", -1, candidate.truePeakDb, before?.truePeakDb, candidate.truePeakDb > -1 ? "fail" : "pass"));
  if (candidate.truePeakDb > -1) {
    const message = `Reference Match failed: True Peak exceeds -1.0dBTP (${candidate.truePeakDb.toFixed(1)}dBTP).`;
    failures.push(message);
    warnings.push(message);
  }

  const referencePeakDelta = candidate.truePeakDb - reference.truePeakDb;
  rows.push(row("Reference True Peak", reference.truePeakDb, candidate.truePeakDb, before?.truePeakDb, referencePeakDelta > 2 ? "warn" : "pass"));
  if (referencePeakDelta > 2) {
    warnings.push(`Reference Match warning: true peak is ${formatDelta(referencePeakDelta)} above reference; use Mastering > Reference Catch-Up with Hard Limit if the result sounds spiky.`);
  }

  const crestDelta = candidate.crestDb - reference.crestDb;
  rows.push(row("Crest", reference.crestDb, candidate.crestDb, before?.crestDb, crestDelta > 1.5 ? "warn" : "pass"));
  if (crestDelta > 1.5) {
    warnings.push(`Reference Match warning: crest factor is ${formatDelta(crestDelta)} above reference density.`);
  }

  const referencePlr = finite(reference.plrDb, reference.truePeakDb - reference.integratedLufs);
  const candidatePlr = finite(candidate.plrDb, candidate.truePeakDb - candidate.integratedLufs);
  const plrDelta = candidatePlr - referencePlr;
  rows.push(row("PLR", referencePlr, candidatePlr, before ? finite(before.plrDb, before.truePeakDb - before.integratedLufs) : undefined, plrDelta < -1.5 ? "fail" : plrDelta < -1 ? "warn" : "pass"));
  if (plrDelta < -1.5) {
    const message = `Reference Match failed: PLR is ${formatDelta(plrDelta)} below reference, which can mean over-dense or flattened output.`;
    failures.push(message);
    warnings.push(message);
  } else if (plrDelta < -1) {
    warnings.push(`Reference Match warning: PLR is ${formatDelta(plrDelta)} below reference.`);
  }

  const subExcess = (candidate.bandEnergyDb.sub_20_60 ?? -60) - (reference.bandEnergyDb.sub_20_60 ?? -60);
  if (Number.isFinite(subExcess)) {
    rows.push(row("Sub 20-60", reference.bandEnergyDb.sub_20_60 ?? -60, candidate.bandEnergyDb.sub_20_60 ?? -60, before?.bandEnergyDb.sub_20_60, subExcess > 2 ? "warn" : "pass"));
    if (subExcess > 2) {
      warnings.push(`Vocal Clarity warning: 20-60Hz is ${subExcess.toFixed(1)}dB above reference and can mask clarity.`);
    }
  }

  const midShortage = (reference.bandEnergyDb.mid_500_2000 ?? -60) - (candidate.bandEnergyDb.mid_500_2000 ?? -60);
  const presenceShortage = (reference.bandEnergyDb.presence_2000_5000 ?? -60) - (candidate.bandEnergyDb.presence_2000_5000 ?? -60);
  const airShortage = (reference.bandEnergyDb.air_5000_10000 ?? -60) - (candidate.bandEnergyDb.air_5000_10000 ?? -60);
  const ultraAirExcess = (candidate.bandEnergyDb.ultraAir_10000_20000 ?? -60) - (reference.bandEnergyDb.ultraAir_10000_20000 ?? -60);
  if (midShortage > 1.2) {
    rows.push(row("Vocal Mid 500-2k Gate", reference.bandEnergyDb.mid_500_2000 ?? -60, candidate.bandEnergyDb.mid_500_2000 ?? -60, before?.bandEnergyDb.mid_500_2000, "fail"));
    warnings.push(`Vocal Clarity failed: 500Hz-2kHz is ${midShortage.toFixed(1)}dB below reference.`);
  }
  if (presenceShortage > 1.0) {
    rows.push(row("Vocal Presence 2-5k Gate", reference.bandEnergyDb.presence_2000_5000 ?? -60, candidate.bandEnergyDb.presence_2000_5000 ?? -60, before?.bandEnergyDb.presence_2000_5000, "fail"));
    warnings.push(`Vocal Clarity failed: 2-5kHz is ${presenceShortage.toFixed(1)}dB below reference.`);
  }
  if (airShortage > 1.0) {
    rows.push(row("Vocal Air 5-10k Gate", reference.bandEnergyDb.air_5000_10000 ?? -60, candidate.bandEnergyDb.air_5000_10000 ?? -60, before?.bandEnergyDb.air_5000_10000, "warn"));
    warnings.push(`Vocal Clarity warning: 5-10kHz is ${airShortage.toFixed(1)}dB below reference.`);
  }
  if (ultraAirExcess > 0.5 && (presenceShortage > 1.0 || airShortage > 1.0)) {
    rows.push(row("False Air Success", reference.bandEnergyDb.ultraAir_10000_20000 ?? -60, candidate.bandEnergyDb.ultraAir_10000_20000 ?? -60, before?.bandEnergyDb.ultraAir_10000_20000, "warn"));
    warnings.push("Vocal Clarity warning: 10-20kHz is up, but 2-10kHz remains weak, so Air is not counted as clarity.");
    warnings.push("Stem Air Layer is held until Vocal Clarity Gate passes 500Hz-10kHz.");
  }

  const hasCandidateUltraSide = Number.isFinite(candidate.bandSideMidDb?.ultraAir_10000_20000);
  const hasCandidateGlossSide = Number.isFinite(candidate.bandSideMidDb?.gloss_9000_14000);
  const hasCandidateSheenSide = Number.isFinite(candidate.bandSideMidDb?.sheen_14000_20000);
  const referenceUltraSide = hasCandidateUltraSide ? reference.bandSideMidDb?.ultraAir_10000_20000 ?? reference.sideMidDb : reference.sideMidDb;
  const candidateUltraSide = hasCandidateUltraSide ? candidate.bandSideMidDb?.ultraAir_10000_20000 ?? candidate.sideMidDb : candidate.sideMidDb;
  const referenceGlossSide = hasCandidateGlossSide ? reference.bandSideMidDb?.gloss_9000_14000 ?? referenceUltraSide : reference.sideMidDb;
  const candidateGlossSide = hasCandidateGlossSide ? candidate.bandSideMidDb?.gloss_9000_14000 ?? candidateUltraSide : candidate.sideMidDb;
  const referenceSheenSide = hasCandidateSheenSide ? reference.bandSideMidDb?.sheen_14000_20000 ?? referenceUltraSide : reference.sideMidDb;
  const candidateSheenSide = hasCandidateSheenSide ? candidate.bandSideMidDb?.sheen_14000_20000 ?? candidateUltraSide : candidate.sideMidDb;
  const referenceMidSide = averageFinite([reference.bandSideMidDb?.mid_500_2000, reference.bandSideMidDb?.presence_2000_5000], reference.sideMidDb);
  const candidateMidSide = averageFinite([candidate.bandSideMidDb?.mid_500_2000, candidate.bandSideMidDb?.presence_2000_5000], candidate.sideMidDb);
  const airBedRisk = candidateUltraSide > referenceUltraSide + 3 && (presenceShortage > 1 || airShortage > 1);
  rows.push(row("Air Bed Risk", referenceUltraSide, candidateUltraSide, before?.bandSideMidDb?.ultraAir_10000_20000, airBedRisk ? "fail" : candidateUltraSide > referenceUltraSide + 2 ? "warn" : "pass"));
  if (airBedRisk) {
    const message = "Air Bed Risk failed: 10-20kHz side energy is high while 2-10kHz vocal clarity is still below reference.";
    failures.push(message);
    warnings.push(message);
  } else if (candidateUltraSide > referenceUltraSide + 2) {
    warnings.push("Air Bed Risk warning: 10-20kHz side energy is higher than reference.");
  }

  rows.push(row("Gloss Side 9-14k", referenceGlossSide, candidateGlossSide, before?.bandSideMidDb?.gloss_9000_14000, candidateGlossSide > referenceGlossSide + 3 ? "warn" : "pass"));
  if (candidateGlossSide > referenceGlossSide + 3) {
    warnings.push("Reference Match warning: 9-14kHz gloss side is wider than reference; avoid adding more high-side gloss.");
  }

  const sideHighClampNeeded = hasCandidateSheenSide && candidateSheenSide > referenceSheenSide + 8;
  rows.push(row("Air/Noise Side 14-20k", referenceSheenSide, candidateSheenSide, before?.bandSideMidDb?.sheen_14000_20000, sideHighClampNeeded ? "fail" : candidateSheenSide > referenceSheenSide + 3 ? "warn" : "pass"));
  if (sideHighClampNeeded) {
    const message = "Air/Noise Side failed: 14-20kHz side energy is far wider than reference. Use side high clamp instead of high-shelf boost.";
    failures.push(message);
    warnings.push(message);
  } else if (candidateSheenSide > referenceSheenSide + 3) {
    warnings.push("Air/Noise Side warning: 14-20kHz side energy is wider than reference; do not use simple high-shelf boost.");
  }

  const imageBalanceFail = candidateMidSide < referenceMidSide - 1.5 && candidateUltraSide > referenceUltraSide + 1;
  rows.push(row("Image Balance", referenceMidSide, candidateMidSide, before ? averageFinite([before.bandSideMidDb?.mid_500_2000, before.bandSideMidDb?.presence_2000_5000], before.sideMidDb) : undefined, imageBalanceFail ? "fail" : candidateMidSide < referenceMidSide - 1 ? "warn" : "pass"));
  if (imageBalanceFail) {
    const message = "Image Balance failed: 500Hz-5kHz image is too narrow while the 10-20kHz side bed is wider than reference.";
    failures.push(message);
    warnings.push(message);
  } else if (candidateMidSide < referenceMidSide - 1) {
    warnings.push("Image Balance warning: 500Hz-5kHz image is narrower than reference.");
  }

  for (const [label, key] of [
    ["Low-Mid 120-250", "lowMid_120_250"],
    ["Body 250-500", "body_250_500"],
    ["Mid 500-2000", "mid_500_2000"],
    ["Presence 2-5k", "presence_2000_5000"],
    ["Air 5-10k", "air_5000_10000"],
  ] as const) {
    const referenceValue = reference.bandEnergyDb[key];
    const candidateValue = candidate.bandEnergyDb[key];
    if (!Number.isFinite(referenceValue) || !Number.isFinite(candidateValue)) continue;
    const beforeValue = before?.bandEnergyDb[key];
    const beforeDistance = Number.isFinite(beforeValue) ? Math.abs(Number(beforeValue) - Number(referenceValue)) : undefined;
    const afterDistance = Math.abs(Number(candidateValue) - Number(referenceValue));
    const improved = beforeDistance == null ? undefined : afterDistance <= beforeDistance + 0.1;
    const status = beforeDistance == null || improved ? "pass" : afterDistance > beforeDistance + 1 ? "warn" : "pass";
    rows.push(row(label, Number(referenceValue), Number(candidateValue), beforeValue, status));
    if (status === "warn") {
      warnings.push(`Reference Match warning: ${label} moved away from reference.`);
    }
  }

  const ultraAirShortage = (reference.bandEnergyDb.ultraAir_10000_20000 ?? -60) - (candidate.bandEnergyDb.ultraAir_10000_20000 ?? -60);
  rows.push(row("Ultra Air 10-20k", reference.bandEnergyDb.ultraAir_10000_20000 ?? -60, candidate.bandEnergyDb.ultraAir_10000_20000 ?? -60, before?.bandEnergyDb.ultraAir_10000_20000, ultraAirShortage > 1.5 ? "warn" : "pass"));
  if (ultraAirShortage > 1.5) {
    warnings.push(`Reference Match warning: 10-20kHz air is ${ultraAirShortage.toFixed(1)}dB below reference.`);
  }

  return finish(rows, warnings, failures);
}

export function validateSpatialAutoCandidate(
  reference: ReferenceQualityMetrics,
  beforeSpatial: ReferenceQualityMetrics,
  afterSpatial: ReferenceQualityMetrics,
): ReferenceQualityGateResult {
  const rows: ReferenceQualityGateRow[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];

  const lufsDrop = beforeSpatial.integratedLufs - afterSpatial.integratedLufs;
  rows.push(row("Spatial LUFS drop", beforeSpatial.integratedLufs, afterSpatial.integratedLufs, beforeSpatial.integratedLufs, lufsDrop > 0.8 ? "fail" : "pass"));
  if (lufsDrop > 0.8) {
    const message = `Spatial Auto failed: LUFS dropped ${lufsDrop.toFixed(1)}LU.`;
    failures.push(message);
    warnings.push(message);
  }

  rows.push(row("True Peak", -1, afterSpatial.truePeakDb, beforeSpatial.truePeakDb, afterSpatial.truePeakDb > -1 ? "fail" : "pass"));
  if (afterSpatial.truePeakDb > -1) {
    const message = `Spatial Auto failed: True Peak exceeds -1.0dBTP (${afterSpatial.truePeakDb.toFixed(1)}dBTP).`;
    failures.push(message);
    warnings.push(message);
  }

  const beforeSideDistance = Math.abs(beforeSpatial.sideMidDb - reference.sideMidDb);
  const afterSideDistance = Math.abs(afterSpatial.sideMidDb - reference.sideMidDb);
  const sideIsReferencePlusSafe = afterSpatial.sideMidDb >= reference.sideMidDb && afterSpatial.sideMidDb <= reference.sideMidDb + 0.7;
  const tooNarrowAgainstReference = afterSpatial.sideMidDb < reference.sideMidDb - 1.5;
  const sideStatus = tooNarrowAgainstReference || afterSideDistance > beforeSideDistance + 1 || afterSpatial.sideMidDb < beforeSpatial.sideMidDb - 0.5
    ? "fail"
    : afterSideDistance <= beforeSideDistance + 0.1 || sideIsReferencePlusSafe
      ? "pass"
      : "warn";
  rows.push(row("Side/Mid", reference.sideMidDb, afterSpatial.sideMidDb, beforeSpatial.sideMidDb, sideStatus));
  if (sideStatus === "fail") {
    const message = tooNarrowAgainstReference
      ? "Spatial Auto failed: Side/Mid is still more than 1.5dB narrower than reference."
      : "Spatial Auto failed: Side/Mid moved away from reference or collapsed.";
    failures.push(message);
    warnings.push(message);
  } else if (sideStatus === "warn") {
    warnings.push("Spatial Auto warning: Side/Mid did not clearly improve toward reference.");
  }

  const airDrop = (beforeSpatial.bandEnergyDb.ultraAir_10000_20000 ?? -60) - (afterSpatial.bandEnergyDb.ultraAir_10000_20000 ?? -60);
  rows.push(row("Ultra Air drop", beforeSpatial.bandEnergyDb.ultraAir_10000_20000 ?? -60, afterSpatial.bandEnergyDb.ultraAir_10000_20000 ?? -60, beforeSpatial.bandEnergyDb.ultraAir_10000_20000, airDrop > 2 ? "fail" : "pass"));
  if (airDrop > 2) {
    const message = `Spatial Auto failed: 10-20kHz air dropped ${airDrop.toFixed(1)}dB.`;
    failures.push(message);
    warnings.push(message);
  }

  const minCorrelation = Math.max(0.5, Math.min(0.65, reference.lrCorrelation - 0.08));
  rows.push(row("Correlation", reference.lrCorrelation, afterSpatial.lrCorrelation, beforeSpatial.lrCorrelation, afterSpatial.lrCorrelation < minCorrelation ? "fail" : "pass"));
  if (afterSpatial.lrCorrelation < minCorrelation) {
    const message = `Spatial Auto failed: L/R correlation fell below the reference-safe floor (${afterSpatial.lrCorrelation.toFixed(2)} < ${minCorrelation.toFixed(2)}).`;
    failures.push(message);
    warnings.push(message);
  }

  return finish(rows, warnings, failures);
}

function row(
  metric: string,
  reference: number,
  after: number,
  before: number | undefined,
  status: ReferenceQualityGateRow["status"],
): ReferenceQualityGateRow {
  const beforeDistance = Number.isFinite(before) ? Math.abs(Number(before) - reference) : undefined;
  const afterDistance = Math.abs(after - reference);
  return {
    metric,
    before: Number.isFinite(before) ? round2(Number(before)) : undefined,
    reference: round2(reference),
    after: round2(after),
    deltaToReference: round2(after - reference),
    improved: beforeDistance == null ? undefined : afterDistance <= beforeDistance,
    status,
  };
}

function finish(rows: ReferenceQualityGateRow[], warnings: string[], failures: string[] = []): ReferenceQualityGateResult {
  return {
    passed: failures.length === 0 && rows.every((entry) => entry.status !== "fail"),
    warnings,
    failures,
    rows,
  };
}

function finite(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function averageFinite(values: Array<number | undefined>, fallback: number) {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value));
  if (finiteValues.length === 0) return fallback;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function formatDelta(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}dB`;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
