import type { ReferenceProfile } from "@/daw/mix/mixDoctorTypes";
import { validateAimixReferenceCandidate, type ReferenceQualityMetrics } from "./referenceQualityGate";

export type ReferenceMatchMeter = {
  integratedLufs: number;
  truePeakDb: number;
  rmsDb: number;
  crestDb: number;
  lowMidDb: number;
  presenceDb: number;
  airDb: number;
  widthDb: number;
  low120250Db?: number;
  body250500Db?: number;
  mid5002000Db?: number;
  presence20005000Db?: number;
  air500010000Db?: number;
  ultraAir1000020000Db?: number;
};

export type ReferenceValidationRow = {
  metric: string;
  before: number;
  reference: number;
  after: number;
  beforeDistance: number;
  afterDistance: number;
  improved: boolean;
};

export type ReferenceValidationResult = {
  passed: boolean;
  warnings: string[];
  failures: string[];
  beforeDistance: number;
  afterDistance: number;
  rows: ReferenceValidationRow[];
};

export function validateReferenceMatchProgress(
  before: ReferenceMatchMeter,
  after: ReferenceMatchMeter,
  referenceProfile: ReferenceProfile | null,
): ReferenceValidationResult {
  if (!referenceProfile) {
    return { passed: true, warnings: [], failures: [], beforeDistance: 0, afterDistance: 0, rows: [] };
  }

  const reference = referenceProfileToMeter(referenceProfile);
  const rows = [
    buildRow("LUFS", before.integratedLufs, reference.integratedLufs, after.integratedLufs),
    buildRow("RMS", before.rmsDb, reference.rmsDb, after.rmsDb),
    buildRow("Crest", before.crestDb, reference.crestDb, after.crestDb),
    buildRow("TruePeak", before.truePeakDb, reference.truePeakDb, after.truePeakDb),
    buildRow("SideMid", before.widthDb, reference.widthDb, after.widthDb),
    buildRow("LowMid120250", before.low120250Db ?? before.lowMidDb, reference.low120250Db ?? reference.lowMidDb, after.low120250Db ?? after.lowMidDb),
    buildRow("Body250500", before.body250500Db ?? before.lowMidDb, reference.body250500Db ?? reference.lowMidDb, after.body250500Db ?? after.lowMidDb),
    buildRow("Mid5002000", before.mid5002000Db ?? before.presenceDb, reference.mid5002000Db ?? reference.presenceDb, after.mid5002000Db ?? after.presenceDb),
    buildRow("Presence20005000", before.presence20005000Db ?? before.presenceDb, reference.presence20005000Db ?? reference.presenceDb, after.presence20005000Db ?? after.presenceDb),
    buildRow("Air500010000", before.air500010000Db ?? before.airDb, reference.air500010000Db ?? reference.airDb, after.air500010000Db ?? after.airDb),
    buildRow("UltraAir1000020000", before.ultraAir1000020000Db ?? before.airDb, reference.ultraAir1000020000Db ?? reference.airDb, after.ultraAir1000020000Db ?? after.airDb),
  ];

  const beforeDistance = weightedDistance(rows, "beforeDistance");
  const afterDistance = weightedDistance(rows, "afterDistance");
  const qualityGate = validateAimixReferenceCandidate(
    meterToQualityMetrics(reference, referenceProfile),
    meterToQualityMetrics(after),
    meterToQualityMetrics(before),
  );
  const warnings = [...qualityGate.warnings];
  const failures = [...qualityGate.failures];
  const lufsDistance = Math.abs(after.integratedLufs - reference.integratedLufs);

  if (afterDistance > beforeDistance + 0.25) {
    warnings.push("Referenceとの差が処理前より広がっています。AIMIX Referenceの補正量を見直してください。");
  }
  if (lufsDistance > 0.75) {
    warnings.push("LUFSがReferenceから0.75dB以上ずれています。Reference Gainで再調整してください。");
  }
  if (rowWorsened(rows, "Crest")) {
    warnings.push("Crest FactorがReferenceから遠ざかっています。音圧より密度の調整を優先してください。");
  }

  return {
    passed: qualityGate.passed && afterDistance <= beforeDistance + 0.25 && lufsDistance <= 0.75,
    warnings: unique(warnings),
    failures: unique(failures),
    beforeDistance: round2(beforeDistance),
    afterDistance: round2(afterDistance),
    rows,
  };
}

export function referenceProfileToMeter(profile: ReferenceProfile): ReferenceMatchMeter {
  return {
    integratedLufs: finite(profile.integratedLufsApprox, -14),
    truePeakDb: finite(profile.truePeakApproxDb, -1),
    rmsDb: finite(profile.rmsDb, -16),
    crestDb: finite(profile.crestFactorDb, 10),
    lowMidDb: averageBands(profile, ["250-500", "500-900"]),
    presenceDb: averageBands(profile, ["1500-3000", "3000-5000"]),
    airDb: averageBands(profile, ["9000-12000", "12000-16000"]),
    widthDb: finite(profile.sideMidRatioDb, -18),
    low120250Db: averageBands(profile, ["120-250"]),
    body250500Db: averageBands(profile, ["250-500"]),
    mid5002000Db: averageBands(profile, ["500-900", "900-1500", "1500-3000"]),
    presence20005000Db: averageBands(profile, ["1500-3000", "3000-5000"]),
    air500010000Db: averageBands(profile, ["5000-9000", "9000-12000"]),
    ultraAir1000020000Db: averageBands(profile, ["9000-12000", "12000-16000", "16000-20000"]),
  };
}

function meterToQualityMetrics(meter: ReferenceMatchMeter, profile?: ReferenceProfile): ReferenceQualityMetrics {
  return {
    integratedLufs: meter.integratedLufs,
    truePeakDb: meter.truePeakDb,
    rmsDb: meter.rmsDb,
    crestDb: meter.crestDb,
    plrDb: meter.truePeakDb - meter.integratedLufs,
    sideMidDb: meter.widthDb,
    lrCorrelation: finite(profile?.lrCorrelation, 0.85),
    bandEnergyDb: {
      sub_20_60: profile ? averageBands(profile, ["20-35", "35-60"]) : undefined,
      lowMid_120_250: meter.low120250Db ?? meter.lowMidDb,
      body_250_500: meter.body250500Db ?? meter.lowMidDb,
      mid_500_2000: meter.mid5002000Db ?? meter.presenceDb,
      presence_2000_5000: meter.presence20005000Db ?? meter.presenceDb,
      air_5000_10000: meter.air500010000Db ?? meter.airDb,
      ultraAir_10000_20000: meter.ultraAir1000020000Db ?? meter.airDb,
    },
  };
}

function buildRow(metric: string, before: number, reference: number, after: number): ReferenceValidationRow {
  const beforeDistance = Math.abs(before - reference);
  const afterDistance = Math.abs(after - reference);
  return {
    metric,
    before: round2(before),
    reference: round2(reference),
    after: round2(after),
    beforeDistance: round2(beforeDistance),
    afterDistance: round2(afterDistance),
    improved: afterDistance <= beforeDistance,
  };
}

function weightedDistance(rows: ReferenceValidationRow[], key: "beforeDistance" | "afterDistance") {
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, row) => {
    const weight = row.metric === "LUFS" ? 1.8 : row.metric === "TruePeak" ? 0.5 : 1;
    return sum + row[key] * weight;
  }, 0);
  return total / rows.length;
}

function averageBands(profile: ReferenceProfile, keys: string[]) {
  const values = keys
    .map((key) => profile.bandEnergyDb?.[key as keyof typeof profile.bandEnergyDb])
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return -18;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finite(value: number | undefined | null, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function rowWorsened(rows: ReferenceValidationRow[], metric: string) {
  const row = rows.find((candidate) => candidate.metric === metric);
  if (!row) return false;
  return row.afterDistance > row.beforeDistance + 0.05;
}
