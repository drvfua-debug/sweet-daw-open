import { existsSync } from "node:fs";
import { analyzeWavFile, type WavMetrics } from "./wavMetrics.ts";

type CliArgs = {
  before?: string;
  after?: string;
  json: boolean;
};

const args = parseArgs(process.argv.slice(2));
const beforePath = args.before ?? "test-fixtures/audio/no-reference/before.wav";
const afterPath = args.after ?? "test-fixtures/audio/no-reference/after.wav";

if (!existsSync(beforePath) || !existsSync(afterPath)) {
  const message = {
    skipped: true,
    reason: "No no-reference regression fixture was found. Pass --before and --after to analyze real exports.",
    expected: { beforePath, afterPath },
  };
  console.log(JSON.stringify(message, null, 2));
  process.exit(0);
}

const before = analyzeWavFile(beforePath);
const after = analyzeWavFile(afterPath);
const report = {
  skipped: false,
  before: compactMetrics(before),
  after: compactMetrics(after),
  diff: {
    lufs: round2(after.integratedLufsApprox - before.integratedLufsApprox),
    truePeak: round2(after.truePeakApproxDb - before.truePeakApproxDb),
    plr: round2(after.plrDb - before.plrDb),
    crest: round2(after.crestDb - before.crestDb),
    sideMid: round2(after.sideMidDb - before.sideMidDb),
    correlation: round2(after.lrCorrelation - before.lrCorrelation),
    fakeAirRisk: round2(estimateFakeAirRisk(after)),
  },
};

console.log(JSON.stringify(report, null, 2));
if (!args.json) {
  console.log("");
  console.log(`No-Reference Regression: LUFS ${formatSigned(report.diff.lufs)} / TruePeak ${formatSigned(report.diff.truePeak)} / SideMid ${formatSigned(report.diff.sideMid)} / FakeAirRisk ${report.diff.fakeAirRisk}`);
}

function compactMetrics(metrics: WavMetrics) {
  return {
    integratedLufsApprox: round2(metrics.integratedLufsApprox),
    truePeakApproxDb: round2(metrics.truePeakApproxDb),
    rmsDb: round2(metrics.rmsDb),
    plrDb: round2(metrics.plrDb),
    crestDb: round2(metrics.crestDb),
    sideMidDb: round2(metrics.sideMidDb),
    lrCorrelation: round2(metrics.lrCorrelation),
    bands: {
      sub_20_60: round2(metrics.bandEnergyDb.sub_20_60),
      body_250_500: round2(metrics.bandEnergyDb.body_250_500),
      mid_500_2000: round2(metrics.bandEnergyDb.mid_500_2000),
      presence_2000_5000: round2(metrics.bandEnergyDb.presence_2000_5000),
      air_5000_10000: round2(metrics.bandEnergyDb.air_5000_10000),
      gloss_9000_14000: round2(metrics.bandEnergyDb.gloss_9000_14000),
      ultraAir_10000_20000: round2(metrics.bandEnergyDb.ultraAir_10000_20000),
      sheen_14000_20000: round2(metrics.bandEnergyDb.sheen_14000_20000),
    },
    bandSideMidDb: {
      mid_500_2000: round2(metrics.bandSideMidDb.mid_500_2000),
      presence_2000_5000: round2(metrics.bandSideMidDb.presence_2000_5000),
      air_5000_10000: round2(metrics.bandSideMidDb.air_5000_10000),
      gloss_9000_14000: round2(metrics.bandSideMidDb.gloss_9000_14000),
      sheen_14000_20000: round2(metrics.bandSideMidDb.sheen_14000_20000),
    },
  };
}

function estimateFakeAirRisk(metrics: WavMetrics) {
  const sheenOverAir = metrics.bandEnergyDb.sheen_14000_20000 - metrics.bandEnergyDb.air_5000_10000;
  const sheenSideOverMix = metrics.bandSideMidDb.sheen_14000_20000 - metrics.sideMidDb;
  const glossWeak = metrics.bandEnergyDb.presence_2000_5000 - metrics.bandEnergyDb.gloss_9000_14000 > 5 ? 0.18 : 0;
  return clamp01((sheenOverAir - 1.5) / 7 * 0.48 + (sheenSideOverMix - 3) / 12 * 0.34 + glossWeak);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--before") parsed.before = argv[++index];
    else if (arg === "--after") parsed.after = argv[++index];
    else if (arg === "--json") parsed.json = true;
  }
  return parsed;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatSigned(value: number) {
  const rounded = round2(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(2)}`;
}
