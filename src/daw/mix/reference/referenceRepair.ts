import { estimateIntegratedLufsApproxFromRms } from "../loudnessApprox";
import type {
  BandEnergyMap,
  MixDoctorBandId,
  ReferenceProfile,
  ReferenceRepairBandDelta,
  ReferenceRepairDiagnosis,
  ReferenceRepairMetricSet,
  ReferenceRepairResidualSummary,
  ReferenceRepairSeverity,
  ReferenceRepairStatus,
  StemFeatureReport,
} from "../mixDoctorTypes";
import { clamp, getBandKeys, round1, round2 } from "../mixDoctorAnalysisUtils";

const REPAIR_CHAIN = [
  "Smart Peak Clip",
  "Bus Glue Compression",
  "Reference Match EQ",
  "Dynamic Presence Repair",
  "Side Air Rebuild",
  "Final Limiter",
];

type ReferenceRepairDiagnosisOptions = {
  residual?: Partial<ReferenceRepairResidualSummary>;
};

export function buildReferenceRepairDiagnosis(
  mixReports: StemFeatureReport[],
  referenceProfile: ReferenceProfile | null,
): ReferenceRepairDiagnosis | null {
  if (!referenceProfile) return null;
  const workReports = mixReports.filter((report) => report.role !== "reference" && report.trackId !== "rendered-mix");
  if (workReports.length === 0) return null;

  const direct = metricSetFromReference(referenceProfile);
  const stemSum = buildStemSumMetricSet(workReports);
  return buildReferenceRepairDiagnosisFromMetrics(direct, stemSum);
}

export function buildReferenceRepairDiagnosisFromMetrics(
  direct: ReferenceRepairMetricSet,
  stemSum: ReferenceRepairMetricSet,
  options: ReferenceRepairDiagnosisOptions = {},
): ReferenceRepairDiagnosis {
  const rmsDiffDb = round1(direct.rmsDb - stemSum.rmsDb);
  const peakDiffDb = round1(stemSum.peakDb - direct.peakDb);
  const crestDiffDb = round1(stemSum.crestFactorDb - direct.crestFactorDb);
  const sideMidDiffDb = round1(direct.sideMidRatioDb - stemSum.sideMidRatioDb);
  const correlationDiff = round2(stemSum.lrCorrelation - direct.lrCorrelation);
  const lowEnergyDiffDb = round1(groupEnergyDb(direct.bandEnergyDb, ["20-35", "35-60", "60-120"]) - groupEnergyDb(stemSum.bandEnergyDb, ["20-35", "35-60", "60-120"]));
  const lowMidEnergyDiffDb = round1(groupEnergyDb(direct.bandEnergyDb, ["120-250", "250-500", "500-900"]) - groupEnergyDb(stemSum.bandEnergyDb, ["120-250", "250-500", "500-900"]));
  const presenceEnergyDiffDb = round1(groupEnergyDb(direct.bandEnergyDb, ["1500-3000", "3000-5000", "5000-9000"]) - groupEnergyDb(stemSum.bandEnergyDb, ["1500-3000", "3000-5000", "5000-9000"]));
  const airEnergyDiffDb = round1(groupEnergyDb(direct.bandEnergyDb, ["9000-12000", "12000-16000", "16000-20000"]) - groupEnergyDb(stemSum.bandEnergyDb, ["9000-12000", "12000-16000", "16000-20000"]));
  const bandDeltas = buildBandDeltas(direct.bandEnergyDb, stemSum.bandEnergyDb);
  const status = pickStatus({
    rmsDiffDb,
    peakDiffDb,
    crestDiffDb,
    sideMidDiffDb,
    presenceEnergyDiffDb,
    airEnergyDiffDb,
  });
  const severity = pickSeverity(status, crestDiffDb, peakDiffDb, rmsDiffDb, sideMidDiffDb);
  const residual = {
    ...buildResidualSummary(direct, stemSum, bandDeltas, rmsDiffDb, peakDiffDb, sideMidDiffDb),
    ...(options.residual ?? {}),
  };

  return {
    direct,
    stemSum,
    rmsDiffDb,
    peakDiffDb,
    crestDiffDb,
    sideMidDiffDb,
    correlationDiff,
    lowEnergyDiffDb,
    lowMidEnergyDiffDb,
    presenceEnergyDiffDb,
    airEnergyDiffDb,
    status,
    severity,
    messages: buildMessages(status, rmsDiffDb, peakDiffDb, crestDiffDb, sideMidDiffDb),
    safetyMessages: buildSafetyMessages(status, bandDeltas, lowEnergyDiffDb, airEnergyDiffDb),
    recommendedChain: status === "ok" ? ["Reference Match EQ", "Side Air Rebuild", "Final Limiter"] : REPAIR_CHAIN,
    bandDeltas,
    residual,
  };
}

export function buildReferenceRepairMarkdown(report: ReferenceRepairDiagnosis): string {
  const lines = [
    "# Sweet DAW Direct WAV Reference Repair Report",
    "",
    `Status: ${report.status}`,
    `Severity: ${report.severity}`,
    "",
    "## Direct WAV",
    `- RMS: ${formatDb(report.direct.rmsDb)}`,
    `- Peak: ${formatDb(report.direct.peakDb)}`,
    `- Crest Factor: ${report.direct.crestFactorDb.toFixed(1)} dB`,
    `- Stereo Correlation: ${report.direct.lrCorrelation.toFixed(2)}`,
    `- Side/Mid: ${formatDb(report.direct.sideMidRatioDb)}`,
    "",
    "## Stem Sum",
    `- RMS: ${formatDb(report.stemSum.rmsDb)}`,
    `- Peak: ${formatDb(report.stemSum.peakDb)}`,
    `- Crest Factor: ${report.stemSum.crestFactorDb.toFixed(1)} dB`,
    `- Stereo Correlation: ${report.stemSum.lrCorrelation.toFixed(2)}`,
    `- Side/Mid: ${formatDb(report.stemSum.sideMidRatioDb)}`,
    "",
    "## Difference",
    `- RMS diff: ${formatDelta(report.rmsDiffDb)} (positive means Direct WAV is louder in average energy)`,
    `- Peak diff: ${formatDelta(report.peakDiffDb)} (positive means Stem Sum peak is higher)`,
    `- Crest diff: ${formatDelta(report.crestDiffDb)}`,
    `- Side/Mid diff: ${formatDelta(report.sideMidDiffDb)}`,
    "",
    "## Residual",
    `- Source: ${report.residual.estimated ? "estimated from analysis" : "rendered from Direct WAV - gain matched Stem Sum"}`,
    `- Gain match: ${formatDelta(report.residual.gainMatchDb)}`,
    `- RMS: ${formatDb(report.residual.residualRmsDb)}`,
    `- Peak: ${formatDb(report.residual.residualPeakDb)}`,
    `- Residual / Direct: ${formatDelta(report.residual.residualToDirectDb)}`,
    `- Residual Side/Mid: ${formatDb(report.residual.residualSideMidRatioDb)}`,
    "",
    "## Suggested Repair Chain",
    ...report.recommendedChain.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Safety Messages",
    ...report.safetyMessages.map((message) => `- ${message}`),
  ];

  return `${lines.join("\n")}\n`;
}

function metricSetFromReference(reference: ReferenceProfile): ReferenceRepairMetricSet {
  return {
    label: reference.trackName,
    rmsDb: reference.rmsDb,
    peakDb: reference.peakDb,
    truePeakApproxDb: reference.truePeakApproxDb,
    crestFactorDb: reference.crestFactorDb,
    integratedLufsApprox: reference.integratedLufsApprox,
    lrCorrelation: reference.lrCorrelation,
    sideMidRatioDb: reference.sideMidRatioDb,
    bandEnergyDb: reference.bandEnergyDb,
  };
}

function buildStemSumMetricSet(reports: StemFeatureReport[]): ReferenceRepairMetricSet {
  const rmsDb = round1(energySumDb(reports.map((report) => report.rmsDb)));
  const peakDb = round1(ampToDb(Math.sqrt(reports.reduce((sum, report) => sum + dbToAmp(report.peakDb) ** 2, 0))));
  const crestFactorDb = round1(Math.max(0, peakDb - rmsDb));
  const bandEnergyDb = getBandKeys().reduce((acc, bandId) => {
    acc[bandId] = round1(energySumDb(reports.map((report) => report.bandEnergyDb[bandId])));
    return acc;
  }, {} as BandEnergyMap);
  const weights = reports.map((report) => Math.max(0.000001, dbToPower(report.rmsDb)));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1;
  const lrCorrelation = round2(
    clamp(
      reports.reduce((sum, report, index) => sum + report.lrCorrelation * (weights[index] ?? 0), 0) / weightTotal,
      -1,
      1,
    ),
  );
  const sideMidRatioDb = round1(
    reports.reduce((sum, report, index) => sum + report.sideMidRatioDb * (weights[index] ?? 0), 0) / weightTotal,
  );

  return {
    label: "Stem Sum",
    rmsDb,
    peakDb,
    truePeakApproxDb: round1(peakDb + 0.2),
    crestFactorDb,
    integratedLufsApprox: round1(estimateIntegratedLufsApproxFromRms(rmsDb)),
    lrCorrelation,
    sideMidRatioDb,
    bandEnergyDb,
  };
}

function buildBandDeltas(reference: BandEnergyMap, stemSum: BandEnergyMap): ReferenceRepairBandDelta[] {
  return getBandKeys().map((bandId) => {
    const diffDb = round1(reference[bandId] - stemSum[bandId]);
    return {
      bandId,
      referenceDb: reference[bandId],
      stemSumDb: stemSum[bandId],
      diffDb,
      cappedEqDb: round1(clamp(diffDb, -getEqCapForBand(bandId), getEqCapForBand(bandId))),
      dynamicOnly: bandId === "1500-3000" || bandId === "3000-5000" || bandId === "5000-9000",
    };
  });
}

function buildResidualSummary(
  direct: ReferenceRepairMetricSet,
  stemSum: ReferenceRepairMetricSet,
  bandDeltas: ReferenceRepairBandDelta[],
  rmsDiffDb: number,
  peakDiffDb: number,
  sideMidDiffDb: number,
) {
  const avgBandDiff = bandDeltas.reduce((sum, delta) => sum + Math.abs(delta.diffDb), 0) / Math.max(1, bandDeltas.length);
  const residualToDirectDb = round1(-clamp(8 - avgBandDiff * 0.8 - Math.max(0, peakDiffDb) * 0.35 - Math.abs(sideMidDiffDb) * 0.4, 2, 18));
  const residualRmsDb = round1(direct.rmsDb + residualToDirectDb);
  const residualPeakDb = round1(Math.min(direct.peakDb + 2, stemSum.peakDb - Math.max(0, rmsDiffDb) * 0.25));
  const topDifferenceBands = [...bandDeltas].sort((a, b) => Math.abs(b.diffDb) - Math.abs(a.diffDb)).slice(0, 5);

  return {
    estimated: true,
    gainMatchDb: round1(clamp(rmsDiffDb, -6, 6)),
    residualRmsDb,
    residualPeakDb,
    residualToDirectDb,
    residualSideMidRatioDb: round1(direct.sideMidRatioDb + Math.max(0.8, sideMidDiffDb)),
    topDifferenceBands,
  };
}

function pickStatus(values: {
  rmsDiffDb: number;
  peakDiffDb: number;
  crestDiffDb: number;
  sideMidDiffDb: number;
  presenceEnergyDiffDb: number;
  airEnergyDiffDb: number;
}): ReferenceRepairStatus {
  if (values.rmsDiffDb > 0.5 && values.peakDiffDb > 0.5) return "low_rms_high_peak";
  if (values.crestDiffDb >= 4 && values.peakDiffDb > 0.5) return "artifact_risk";
  if (values.sideMidDiffDb > 0.7) return "side_missing";
  if (values.presenceEnergyDiffDb > 1.2 || values.airEnergyDiffDb > 1.4) return "too_dark";
  if (values.presenceEnergyDiffDb < -1.4 || values.airEnergyDiffDb < -1.6) return "too_bright";
  return "ok";
}

function pickSeverity(
  status: ReferenceRepairStatus,
  crestDiffDb: number,
  peakDiffDb: number,
  rmsDiffDb: number,
  sideMidDiffDb: number,
): ReferenceRepairSeverity {
  if (status === "low_rms_high_peak" && (crestDiffDb >= 5 || peakDiffDb >= 3)) return "critical";
  if (crestDiffDb >= 5 || peakDiffDb >= 4) return "critical";
  if (status !== "ok" || crestDiffDb >= 3 || rmsDiffDb > 1 || sideMidDiffDb > 0.7) return "warning";
  return "info";
}

function buildMessages(status: ReferenceRepairStatus, rmsDiffDb: number, peakDiffDb: number, crestDiffDb: number, sideMidDiffDb: number) {
  if (status === "low_rms_high_peak") {
    return [
      `Direct WAV is ${formatDelta(rmsDiffDb)} louder in RMS, but Stem Sum peak is ${formatDelta(peakDiffDb)} higher.`,
      `Stem Sum crest factor is ${formatDelta(crestDiffDb)} higher, so simple gain boost will clip before it reaches the reference density.`,
      "Repair peaks first, then match body, presence, side air, and final loudness.",
    ];
  }
  if (status === "side_missing") {
    return [
      `Reference side/mid is ${formatDelta(sideMidDiffDb)} wider than Stem Sum.`,
      "Use side-only air and ambience rebuild; avoid full-band widening.",
    ];
  }
  if (status === "too_dark") {
    return [
      "Stem Sum is darker than Direct WAV.",
      "Use capped Reference Match EQ and Dynamic Presence Repair instead of broad high-shelf boosting.",
    ];
  }
  if (status === "too_bright") {
    return [
      "Stem Sum is brighter than Direct WAV.",
      "Use de-ess / harshness guard before any density or limiter push.",
    ];
  }
  if (status === "artifact_risk") {
    return [
      "Stem Sum has excessive peak-to-average distance.",
      "Run Smart Peak Clip and Bus Glue before loudness matching.",
    ];
  }
  return ["Direct WAV and Stem Sum are close enough for light Reference Match EQ and final limiter only."];
}

function buildSafetyMessages(status: ReferenceRepairStatus, bandDeltas: ReferenceRepairBandDelta[], lowEnergyDiffDb: number, airEnergyDiffDb: number) {
  const messages: string[] = [];
  if (status === "low_rms_high_peak") {
    messages.push("単純なGain Boostは禁止: 先にSmart Peak Clip / Bus Glueでピークだけを整えます。");
  }
  if (lowEnergyDiffDb > 2) {
    messages.push("低域は最大+2dBまで: 20-35Hzを強く持ち上げず、60-120Hzの芯を優先します。");
  }
  if (airEnergyDiffDb > 3 || bandDeltas.some((delta) => delta.bandId === "12000-16000" && delta.diffDb > 3)) {
    messages.push("Air差分は強くても12kHz以上は最大+3dBまで。AIのザラつきはHarshness Guardで抑えます。");
  }
  if (bandDeltas.some((delta) => delta.dynamicOnly && delta.diffDb > 1.2)) {
    messages.push("2-8kHzは固定ブーストではなくDynamic Presence Repairで必要な瞬間だけ補正します。");
  }
  messages.push("Referenceトラック自体は加工せず、stem側とmaster側の非破壊設定だけを提案します。");
  return messages;
}

function getEqCapForBand(bandId: MixDoctorBandId) {
  if (bandId === "20-35" || bandId === "35-60" || bandId === "60-120") return 2;
  if (bandId === "120-250" || bandId === "250-500") return 2;
  if (bandId === "500-900" || bandId === "900-1500") return 1.5;
  if (bandId === "1500-3000" || bandId === "3000-5000" || bandId === "5000-9000") return 1.5;
  if (bandId === "9000-12000") return 2;
  return 3;
}

function groupEnergyDb(bands: BandEnergyMap, ids: MixDoctorBandId[]) {
  return energySumDb(ids.map((id) => bands[id]));
}

function energySumDb(values: number[]) {
  const power = values.reduce((sum, value) => sum + dbToPower(value), 0);
  return 10 * Math.log10(Math.max(1e-12, power));
}

function dbToPower(value: number) {
  return 10 ** (value / 10);
}

function dbToAmp(value: number) {
  return 10 ** (value / 20);
}

function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(0.000001, value));
}

function formatDb(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function formatDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}
