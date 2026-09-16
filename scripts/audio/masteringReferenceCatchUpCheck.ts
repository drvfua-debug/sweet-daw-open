import path from "node:path";
import {
  analyzeSingleFileMastering,
  processSingleFileMastering,
  resolveSingleFileMasteringSettings,
} from "../../src/daw/mastering/singleFileMastering.ts";
import { analyzeWavFile, calculateWavMetrics, readWavFile, writeWavPcm16, type WavMetrics } from "./wavMetrics.ts";

type Args = {
  reference: string;
  input: string;
  output: string;
  hardLimit: boolean;
};

const args = parseArgs(process.argv.slice(2));
const reference = analyzeWavFile(args.reference);
const referenceMasteringMetrics = analyzeSingleFileMastering(readWavFile(args.reference).channels, readWavFile(args.reference).sampleRate, { quality: "mobile-hq" });
const inputAudio = readWavFile(args.input);
const inputMetrics = calculateWavMetrics(inputAudio, args.input);
const settings = resolveSingleFileMasteringSettings("referenceCatchUp", {
  targetLufs: referenceMasteringMetrics.estimatedLufs,
  referenceTargetLufs: referenceMasteringMetrics.estimatedLufs,
  targetLufsSource: "reference",
  truePeakCeilingDb: args.hardLimit ? Math.max(-2, Math.min(-1, reference.truePeakApproxDb + 0.8)) : -0.1,
  ...buildReferenceClarityOverrides(reference, inputMetrics),
});
const mastered = processSingleFileMastering(inputAudio.channels, inputAudio.sampleRate, settings);
const outputPath = path.resolve(args.output);
const safetyTrimDb = applyReferencePeakSafetyTrim(mastered.channels, inputAudio.sampleRate, reference);
writeWavPcm16(outputPath, {
  sampleRate: inputAudio.sampleRate,
  channels: mastered.channels,
  durationSec: inputAudio.durationSec,
});
const outputMetrics = analyzeWavFile(outputPath);
const outputMasteringMetrics = analyzeSingleFileMastering(readWavFile(outputPath).channels, inputAudio.sampleRate, { quality: "mobile-hq" });

const summary = {
  reference: pickMetrics(reference),
  referenceMasteringMetrics,
  before: pickMetrics(inputMetrics),
  after: pickMetrics(outputMetrics),
  outputMasteringMetrics,
  mastering: {
    referenceClarityOverrides: buildReferenceClarityOverrides(reference, inputMetrics),
    before: mastered.before,
    after: mastered.after,
    limiterGainReductionDb: mastered.limiterGainReductionDb,
    glueGainReductionDb: mastered.glueGainReductionDb,
    targetReport: mastered.targetReport,
    safetyTrimDb,
    actions: mastered.actions,
    warnings: mastered.warnings,
  },
  output: outputPath,
};

console.log(JSON.stringify(summary, null, 2));

if (outputMetrics.truePeakApproxDb > settings.truePeakCeilingDb + 0.15) {
  process.exitCode = 1;
}

function buildReferenceClarityOverrides(reference: WavMetrics, input: WavMetrics) {
  const levelMatchDb = reference.integratedLufsApprox - input.integratedLufsApprox;
  const matchedBand = (band: keyof WavMetrics["bandEnergyDb"]) => input.bandEnergyDb[band] + levelMatchDb;
  const presenceGapDb = Math.max(0, reference.bandEnergyDb.presence_2000_5000 - matchedBand("presence_2000_5000"));
  const clarityGapDb = Math.max(0, reference.bandEnergyDb.air_5000_10000 - matchedBand("air_5000_10000"));
  const glossGapDb = Math.max(0, reference.bandEnergyDb.gloss_9000_14000 - matchedBand("gloss_9000_14000"));
  const midGapDb = Math.max(0, reference.bandEnergyDb.mid_500_2000 - matchedBand("mid_500_2000"));
  const ultraAirGapDb = Math.max(0, reference.bandEnergyDb.ultraAir_10000_20000 - matchedBand("ultraAir_10000_20000"));
  const topSheenGapDb = Math.max(0, reference.bandEnergyDb.sheen_14000_20000 - matchedBand("sheen_14000_20000"));
  const subExcessDb = Math.max(0, matchedBand("sub_20_60") - reference.bandEnergyDb.sub_20_60);
  const presenceOverDb = Math.max(0, matchedBand("presence_2000_5000") - reference.bandEnergyDb.presence_2000_5000);
  const clarityOverDb = Math.max(0, matchedBand("air_5000_10000") - reference.bandEnergyDb.air_5000_10000);
  const upperMidOverGuard = presenceOverDb > 1.2 || clarityOverDb > 1.2;
  const loudnessShortfallDb = Math.max(0, reference.integratedLufsApprox - input.integratedLufsApprox);
  const crestExcessDb = Math.max(0, input.crestDb - reference.crestDb);
  const plrExcessDb = Math.max(0, (input.truePeakApproxDb - input.integratedLufsApprox) - (reference.truePeakApproxDb - reference.integratedLufsApprox));
  const falseAirRisk = ultraAirGapDb <= 0.5 && (presenceGapDb > 1.2 || clarityGapDb > 1.5 || midGapDb > 1.2);
  const sideShortfallDb = Math.max(0, reference.sideMidDb - input.sideMidDb);
  const ultraSideExcessDb = input.bandSideMidDb.ultraAir_10000_20000 - reference.bandSideMidDb.ultraAir_10000_20000;
  const airNoiseSideExcessDb = input.bandSideMidDb.sheen_14000_20000 - reference.bandSideMidDb.sheen_14000_20000;
  const sideHighClampPriority = ultraSideExcessDb >= 3 || airNoiseSideExcessDb >= 8;
  const guardedAirRisk = falseAirRisk || sideHighClampPriority;
  const topOnlyHighSideRisk = sideHighClampPriority && glossGapDb <= 0.8 && clarityGapDb <= 0.8 && presenceGapDb <= 1.0;
  const presenceAllowed = presenceGapDb > 1.2 || midGapDb > 1.6;
  const clarityAllowed = clarityGapDb > 1.0;
  const sheenAllowed = !guardedAirRisk && !upperMidOverGuard && ultraAirGapDb > 0.8 && topSheenGapDb > 0.8;
  const midOnlySheenAllowed = guardedAirRisk && !upperMidOverGuard && ultraAirGapDb > 2.0 && topSheenGapDb > 0.8;
  const imageTargets = {
    referenceSideMidDb: reference.sideMidDb,
    referenceCorrelation: reference.lrCorrelation,
    referenceUltraAirSideMidDb: reference.bandSideMidDb.ultraAir_10000_20000,
    referenceGlossSideMidDb: reference.bandSideMidDb.gloss_9000_14000,
    referenceAirNoiseSideMidDb: reference.bandSideMidDb.sheen_14000_20000,
    referencePresenceDb: reference.bandEnergyDb.presence_2000_5000,
    referenceAirDb: reference.bandEnergyDb.air_5000_10000,
    referenceGlossDb: reference.bandEnergyDb.gloss_9000_14000,
    referenceUltraAirDb: reference.bandEnergyDb.ultraAir_10000_20000,
    referenceSheenDb: reference.bandEnergyDb.sheen_14000_20000,
    referencePlrDb: reference.plrDb,
    imageCatchUpAmount: 0.85,
    sideHighClampAmount: 0.9,
  };
  const transparentTargets = {
    ...imageTargets,
    referenceClarityMode: "off" as const,
    presenceCatchUpDb: 0,
    clarityCatchUpDb: 0,
    airCatchUpDb: 0,
    sheenCatchUpDb: 0,
    referenceDensityGateAmount: 0,
    referenceSubTrimDb: 0,
    referenceMidGlossShiftDb: 0,
    referenceMidSideRecoveryDb: 0,
    referenceTransparentCheck: true,
  };
  const glossShortageDb = Math.max(0, glossGapDb);
  const densityNeedDb = Math.max(crestExcessDb - 1.75, plrExcessDb - 1.75);
  const transparentDensityAmount = densityNeedDb > 0.35
    ? clamp(0.22 + densityNeedDb * 0.22 + Math.max(0, loudnessShortfallDb - 1) * 0.035, 0.22, 0.78)
    : 0;
  const densityGateAmount = loudnessShortfallDb > 2.5 && densityNeedDb > 0.4
    ? clamp(0.3 + densityNeedDb * 0.28 + Math.max(0, loudnessShortfallDb - 3) * 0.06, 0.3, 0.92)
    : transparentDensityAmount;
  const subTrimDb = subExcessDb > 1.5 ? clamp((subExcessDb - 1.0) * 0.5, 0.25, 1.6) : 0;
  const midGlossFromGloss = glossShortageDb > 1.0 && !upperMidOverGuard
    ? clamp((glossShortageDb - 0.8) * 0.26, 0.15, guardedAirRisk ? 1.25 : 0.9)
    : 0;
  const midGlossFromSheenScale = topOnlyHighSideRisk ? 0.12 : guardedAirRisk ? 0.24 : 0.18;
  const midGlossFromSheenCeiling = topOnlyHighSideRisk ? 0.65 : guardedAirRisk ? 1.45 : 1.1;
  const midGlossFromSheen = ultraAirGapDb > 1.4 && !upperMidOverGuard
    ? clamp((ultraAirGapDb - 1.05) * midGlossFromSheenScale, 0.12, midGlossFromSheenCeiling)
    : 0;
  const midGlossFromUltra = !guardedAirRisk && ultraAirGapDb > 2.5 && !upperMidOverGuard
    ? clamp((ultraAirGapDb - 2.2) * 0.08, 0.12, 0.28)
    : 0;
  const midGlossShiftDb = Math.max(midGlossFromGloss, midGlossFromSheen, midGlossFromUltra);
  const midSideRecoveryDb = sideShortfallDb > 1.2
    ? clamp((sideShortfallDb - 0.8) * (sideHighClampPriority ? 0.32 : 0.18), 0.15, sideHighClampPriority ? 0.85 : 0.45)
    : 0;
  const measuredCorrections = {
    referenceDensityGateAmount: round2(densityGateAmount),
    referenceSubTrimDb: round2(subTrimDb),
    referenceMidGlossShiftDb: round2(midGlossShiftDb),
    referenceMidSideRecoveryDb: round2(midSideRecoveryDb),
  };
  const hasMeasuredCorrection = Object.values(measuredCorrections).some((value) => value > 0);
  const presenceCeilingDb = guardedAirRisk ? 1.5 : 1.35;
  const clarityCeilingDb = guardedAirRisk ? 0.55 : 0.5;
  const rawPresenceDb = presenceAllowed
    ? clamp(Math.max(0, presenceGapDb - 0.75) * 0.72 + Math.max(0, midGapDb - 0.5) * 0.12, 0, presenceCeilingDb)
    : 0;
  const rawClarityDb = clarityAllowed ? clamp((clarityGapDb - 0.9) * 0.075 - Math.max(0, presenceGapDb - clarityGapDb) * 0.012, 0, clarityCeilingDb) : 0;
  const midOnlySheenFromUltra = midOnlySheenAllowed
    ? clamp((ultraAirGapDb - 1.0) * (topOnlyHighSideRisk ? 1.0 : 0.42), 0.55, topOnlyHighSideRisk ? 4.1 : 2.2)
    : 0;
  const midOnlySheenFromTop = guardedAirRisk && !upperMidOverGuard && topSheenGapDb > 1.2
    ? clamp((topSheenGapDb - 1.0) * (topOnlyHighSideRisk ? 0.72 : 0.48), 0.55, topOnlyHighSideRisk ? 4.1 : 2.8)
    : 0;
  const midOnlySheenCatchUpDb = Math.max(midOnlySheenFromUltra, midOnlySheenFromTop);
  if (!presenceAllowed && !clarityAllowed && !sheenAllowed && !midOnlySheenAllowed && !hasMeasuredCorrection) {
    return transparentTargets;
  }
  return {
    referenceClarityMode: "catchUp" as const,
    presenceCatchUpDb: round2(rawPresenceDb),
    clarityCatchUpDb: round2(rawClarityDb),
    airCatchUpDb: clarityAllowed ? round2(clamp(0.02 + (clarityGapDb - 1.0) * 0.012, 0.02, 0.12)) : 0,
    sheenCatchUpDb: sheenAllowed
      ? round2(clamp(0.2 + ultraAirGapDb * 0.65, 0.4, 4.8))
      : round2(midOnlySheenCatchUpDb),
    ...imageTargets,
    ...measuredCorrections,
    falseAirRisk: guardedAirRisk,
  };
}

function applyReferencePeakSafetyTrim(channels: Float32Array[], sampleRate: number, reference: WavMetrics) {
  const current = calculateWavMetrics({ sampleRate, channels, durationSec: (channels[0]?.length ?? 0) / sampleRate }, "<mastering-preview>");
  const truePeakOverReferenceDb = current.truePeakApproxDb - reference.truePeakApproxDb;
  if (truePeakOverReferenceDb < 0.8) return 0;
  const trimDb = -round2(clamp(truePeakOverReferenceDb - 0.6, 0.2, 0.8));
  const gain = 10 ** (trimDb / 20);
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = (channel[index] ?? 0) * gain;
    }
  }
  return trimDb;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function pickMetrics(metrics: ReturnType<typeof analyzeWavFile>) {
  return {
    integratedLufsApprox: metrics.integratedLufsApprox,
    truePeakApproxDb: metrics.truePeakApproxDb,
    samplePeakDb: metrics.samplePeakDb,
    crestDb: metrics.crestDb,
    sideMidDb: metrics.sideMidDb,
    lrCorrelation: metrics.lrCorrelation,
    bandEnergyDb: metrics.bandEnergyDb,
    bandSideMidDb: metrics.bandSideMidDb,
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    reference: "",
    input: "",
    output: "",
    hardLimit: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--reference" && value) {
      args.reference = value;
      index += 1;
    } else if (key === "--input" && value) {
      args.input = value;
      index += 1;
    } else if (key === "--output" && value) {
      args.output = value;
      index += 1;
    } else if (key === "--soft-limit") {
      args.hardLimit = false;
    }
  }
  if (!args.reference || !args.input || !args.output) {
    throw new Error("Usage: vite-node scripts/audio/masteringReferenceCatchUpCheck.ts --reference ref.wav --input mix.wav --output out.wav [--soft-limit]");
  }
  return args;
}
