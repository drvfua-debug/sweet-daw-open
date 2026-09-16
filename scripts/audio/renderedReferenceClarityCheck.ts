import { analyzeWavFile, type WavMetrics } from "./wavMetrics.ts";

type Args = {
  reference: string;
  output: string;
};

const args = parseArgs(process.argv.slice(2));
const reference = analyzeWavFile(args.reference);
const output = analyzeWavFile(args.output);
const report = buildReport(reference, output);

console.log(JSON.stringify(report, null, 2));
if (report.status === "fail") process.exitCode = 1;

function buildReport(reference: WavMetrics, output: WavMetrics) {
  const presenceGapDb = round2(reference.bandEnergyDb.presence_2000_5000 - output.bandEnergyDb.presence_2000_5000);
  const clarityGapDb = round2(reference.bandEnergyDb.air_5000_10000 - output.bandEnergyDb.air_5000_10000);
  const ultraAirGapDb = round2(reference.bandEnergyDb.ultraAir_10000_20000 - output.bandEnergyDb.ultraAir_10000_20000);
  const glossGapDb = round2(reference.bandEnergyDb.gloss_9000_14000 - output.bandEnergyDb.gloss_9000_14000);
  const topSheenGapDb = round2(reference.bandEnergyDb.sheen_14000_20000 - output.bandEnergyDb.sheen_14000_20000);
  const bodyDeltaDb = round2(output.bandEnergyDb.body_250_500 - reference.bandEnergyDb.body_250_500);
  const midDeltaDb = round2(output.bandEnergyDb.mid_500_2000 - reference.bandEnergyDb.mid_500_2000);
  const broadUltraOnlyGap = ultraAirGapDb > 2.0 && glossGapDb <= 1.0 && topSheenGapDb <= 0.8;
  const fakeAirRisk = ultraAirGapDb <= 0.5 && (presenceGapDb > 1.2 || clarityGapDb > 1.5);
  const lufsDeltaDb = round2(output.integratedLufsApprox - reference.integratedLufsApprox);
  const truePeakDeltaDb = round2(output.truePeakApproxDb - reference.truePeakApproxDb);
  const inefficientLevelRisk = lufsDeltaDb < -1.2 && truePeakDeltaDb > 0;
  const warnings: string[] = [];
  if (presenceGapDb > 1.2) warnings.push(`Muffle: presence deficit ${presenceGapDb.toFixed(1)}dB`);
  if (clarityGapDb > 1.0) warnings.push(`Muffle: clarity 5-10kHz deficit ${clarityGapDb.toFixed(1)}dB`);
  if (ultraAirGapDb > 2.0) {
    warnings.push(broadUltraOnlyGap
      ? `Sheen watch: broad 10-20kHz is ${ultraAirGapDb.toFixed(1)}dB below, but gloss/top sheen are already safe`
      : `Sheen: 10-20kHz deficit ${ultraAirGapDb.toFixed(1)}dB`);
  }
  if (fakeAirRisk) warnings.push("Fake air risk: 10-20kHz is close enough but 2-10kHz is still behind.");
  if (inefficientLevelRisk) warnings.push(`Level efficiency fail: LUFS is ${Math.abs(lufsDeltaDb).toFixed(1)}dB below Reference while true peak is ${truePeakDeltaDb.toFixed(1)}dB higher.`);
  const status = presenceGapDb > 1.8 || clarityGapDb > 1.0 || (ultraAirGapDb > 2.0 && !broadUltraOnlyGap) || fakeAirRisk || inefficientLevelRisk ? "fail" : warnings.length > 0 ? "warn" : "pass";
  return {
    status,
    warnings,
    reference: pickMetrics(reference),
    output: pickMetrics(output),
    delta: {
      lufsDb: lufsDeltaDb,
      truePeakDb: truePeakDeltaDb,
      crestDb: round2(output.crestDb - reference.crestDb),
      bodyDeltaDb,
      midDeltaDb,
      presenceGapDb,
      clarityGapDb,
      ultraAirGapDb,
      glossGapDb,
      topSheenGapDb,
      sideMidDb: round2(output.sideMidDb - reference.sideMidDb),
      correlation: round2(output.lrCorrelation - reference.lrCorrelation),
    },
  };
}

function pickMetrics(metrics: WavMetrics) {
  return {
    integratedLufsApprox: metrics.integratedLufsApprox,
    truePeakApproxDb: metrics.truePeakApproxDb,
    crestDb: metrics.crestDb,
    body_250_500: metrics.bandEnergyDb.body_250_500,
    mid_500_2000: metrics.bandEnergyDb.mid_500_2000,
    presence_2000_5000: metrics.bandEnergyDb.presence_2000_5000,
    air_5000_10000: metrics.bandEnergyDb.air_5000_10000,
    gloss_9000_14000: metrics.bandEnergyDb.gloss_9000_14000,
    ultraAir_10000_20000: metrics.bandEnergyDb.ultraAir_10000_20000,
    sheen_14000_20000: metrics.bandEnergyDb.sheen_14000_20000,
    sideMidDb: metrics.sideMidDb,
    lrCorrelation: metrics.lrCorrelation,
  };
}

function parseArgs(argv: string[]): Args {
  const args: Args = { reference: "", output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--reference" && value) {
      args.reference = value;
      index += 1;
    } else if ((key === "--output" || key === "--candidate") && value) {
      args.output = value;
      index += 1;
    }
  }
  if (!args.reference || !args.output) {
    throw new Error("Usage: node --experimental-strip-types scripts/audio/renderedReferenceClarityCheck.ts --reference reference.wav --output output.wav");
  }
  return args;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
