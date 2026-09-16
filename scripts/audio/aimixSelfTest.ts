import { analyzeWavFile, type WavMetrics } from "./wavMetrics.ts";
import { createSyntheticReferenceFixture } from "./syntheticReferenceFixture.ts";
import {
  validateAimixReferenceCandidate,
  validateSpatialAutoCandidate,
  type ReferenceQualityMetrics,
} from "../../src/daw/mix/reference/referenceQualityGate.ts";

type CliArgs = {
  reference?: string;
  candidate?: string;
  spatial?: string;
  strict: boolean;
  json: boolean;
};

const args = parseArgs(process.argv.slice(2));
const fixture = !args.reference || !args.candidate ? createSyntheticReferenceFixture() : null;
const referencePath = args.reference ?? fixture!.referencePath;
const candidatePath = args.candidate ?? fixture!.candidatePath;
const spatialPath = args.spatial ?? fixture?.spatialPath;

const reference = analyzeWavFile(referencePath);
const candidate = analyzeWavFile(candidatePath);
const spatial = spatialPath ? analyzeWavFile(spatialPath) : null;
const aimixReference = validateAimixReferenceCandidate(toQuality(reference), toQuality(candidate));
const spatialAuto = spatial
  ? validateSpatialAutoCandidate(toQuality(reference), toQuality(candidate), toQuality(spatial))
  : null;

const output = {
  generatedFixture: fixture?.directory ?? null,
  reference,
  candidate,
  spatial,
  validation: {
    aimixReference,
    spatialAuto,
  },
};

if (args.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(JSON.stringify(output, null, 2));
  console.log("");
  console.log(`AIMIX Reference: ${aimixReference.passed ? "PASS" : "FAIL"} (${aimixReference.warnings.length} warning(s), ${aimixReference.failures.length} failure(s))`);
  console.log(`AIMIX Detail: PLR ${candidate.plrDb.toFixed(1)}dB / AirBed ${rowStatus(aimixReference, "Air Bed Risk")} / Image ${rowStatus(aimixReference, "Image Balance")}`);
  if (spatialAuto) {
    console.log(`Spatial Auto: ${spatialAuto.passed ? "PASS" : "FAIL"} (${spatialAuto.warnings.length} warning(s), ${spatialAuto.failures.length} failure(s))`);
  }
}

if (args.strict && (!aimixReference.passed || aimixReference.failures.length > 0 || spatialAuto?.passed === false || (spatialAuto?.failures.length ?? 0) > 0)) {
  process.exitCode = 1;
}

function toQuality(metrics: WavMetrics): ReferenceQualityMetrics {
  return {
    integratedLufs: metrics.integratedLufsApprox,
    truePeakDb: metrics.truePeakApproxDb,
    rmsDb: metrics.rmsDb,
    crestDb: metrics.crestDb,
    plrDb: metrics.plrDb,
    sideMidDb: metrics.sideMidDb,
    lrCorrelation: metrics.lrCorrelation,
    bandEnergyDb: {
      sub_20_60: metrics.bandEnergyDb.sub_20_60,
      low_60_120: metrics.bandEnergyDb.low_60_120,
      lowMid_120_250: metrics.bandEnergyDb.lowMid_120_250,
      body_250_500: metrics.bandEnergyDb.body_250_500,
      mid_500_2000: metrics.bandEnergyDb.mid_500_2000,
      presence_2000_5000: metrics.bandEnergyDb.presence_2000_5000,
      air_5000_10000: metrics.bandEnergyDb.air_5000_10000,
      gloss_9000_14000: metrics.bandEnergyDb.gloss_9000_14000,
      ultraAir_10000_20000: metrics.bandEnergyDb.ultraAir_10000_20000,
      sheen_14000_20000: metrics.bandEnergyDb.sheen_14000_20000,
    },
    bandSideMidDb: metrics.bandSideMidDb,
    bandCorrelation: metrics.bandCorrelation,
  };
}

function rowStatus(result: ReturnType<typeof validateAimixReferenceCandidate>, metric: string) {
  return result.rows.find((row) => row.metric === metric)?.status ?? "n/a";
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { strict: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reference") parsed.reference = argv[++index];
    else if (arg === "--candidate") parsed.candidate = argv[++index];
    else if (arg === "--spatial") parsed.spatial = argv[++index];
    else if (arg === "--strict") parsed.strict = true;
    else if (arg === "--json") parsed.json = true;
  }
  return parsed;
}
