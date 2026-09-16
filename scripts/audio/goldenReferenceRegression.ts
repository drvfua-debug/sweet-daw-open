import fs from "node:fs";
import path from "node:path";
import { analyzeWavFile, type WavMetrics } from "./wavMetrics.ts";

type GoldenProfile =
  | "default"
  | "same_song_reference"
  | "reference_better_master"
  | "instrumental_master"
  | "vocal_forward"
  | "sheen_missing"
  | "muffle";

type GoldenPair = {
  name: string;
  reference: string;
  candidate: string;
  profile?: GoldenProfile;
};

type Args = {
  config: string;
  reference: string;
  candidate: string;
  name: string;
  profile: GoldenProfile;
};

type GoldenReport = ReturnType<typeof buildReport>;

const args = parseArgs(process.argv.slice(2));
const pairs = loadPairs(args);
const reports = pairs.map(runPair);
const finalReport = reports.length === 1 ? reports[0] : {
  status: reports.some((report) => report.status === "fail") ? "fail" : reports.some((report) => report.status === "warn") ? "warn" : "pass",
  reports,
};

console.log(JSON.stringify(finalReport, null, 2));
if ((finalReport as { status: string }).status === "fail") process.exitCode = 1;

function runPair(pair: GoldenPair) {
  assertFixture(pair.reference);
  assertFixture(pair.candidate);
  const reference = analyzeWavFile(pair.reference);
  const candidate = analyzeWavFile(pair.candidate);
  return buildReport(pair.name, pair.profile ?? "default", reference, candidate);
}

function buildReport(name: string, profile: GoldenProfile, reference: WavMetrics, candidate: WavMetrics) {
  const thresholds = getThresholds(profile);
  const delta = {
    lufsDb: round2(candidate.integratedLufsApprox - reference.integratedLufsApprox),
    truePeakDb: round2(candidate.truePeakApproxDb - reference.truePeakApproxDb),
    crestDb: round2(candidate.crestDb - reference.crestDb),
    plrDb: round2(candidate.plrDb - reference.plrDb),
    sideMidDb: round2(candidate.sideMidDb - reference.sideMidDb),
    correlation: round2(candidate.lrCorrelation - reference.lrCorrelation),
    subDeltaDb: bandDelta(candidate, reference, "sub_20_60"),
    lowDeltaDb: bandDelta(candidate, reference, "low_60_120"),
    lowMidDeltaDb: bandDelta(candidate, reference, "lowMid_120_250"),
    bodyDeltaDb: bandDelta(candidate, reference, "body_250_500"),
    midGapDb: bandGap(reference, candidate, "mid_500_2000"),
    presenceGapDb: bandGap(reference, candidate, "presence_2000_5000"),
    clarityGapDb: bandGap(reference, candidate, "air_5000_10000"),
    glossGapDb: bandGap(reference, candidate, "gloss_9000_14000"),
    sheenGapDb: bandGap(reference, candidate, "ultraAir_10000_20000"),
    topSheenGapDb: bandGap(reference, candidate, "sheen_14000_20000"),
    presenceExcessDb: bandDelta(candidate, reference, "presence_2000_5000"),
    clarityExcessDb: bandDelta(candidate, reference, "air_5000_10000"),
    glossExcessDb: bandDelta(candidate, reference, "gloss_9000_14000"),
    sheenExcessDb: bandDelta(candidate, reference, "ultraAir_10000_20000"),
    topSheenExcessDb: bandDelta(candidate, reference, "sheen_14000_20000"),
    airSideDb: round2(candidate.bandSideMidDb.ultraAir_10000_20000 - reference.bandSideMidDb.ultraAir_10000_20000),
    midImageSideDb: round2(
      average([candidate.bandSideMidDb.mid_500_2000, candidate.bandSideMidDb.presence_2000_5000])
      - average([reference.bandSideMidDb.mid_500_2000, reference.bandSideMidDb.presence_2000_5000]),
    ),
  };

  const summary: string[] = [];
  const recommendedFix: string[] = [];
  let failed = false;
  const fail = (message: string, fix: string) => {
    failed = true;
    summary.push(`FAIL: ${message}`);
    recommendedFix.push(fix);
  };
  const warn = (message: string, fix: string) => {
    summary.push(`WARN: ${message}`);
    recommendedFix.push(fix);
  };

  if (delta.lufsDb < -thresholds.lufsTooQuietDb && delta.truePeakDb > thresholds.truePeakHigherDb) {
    fail(
      "Candidate is quieter than Reference but has higher true peak.",
      "Fix density/crest before adding more gain.",
    );
  }
  if (delta.crestDb > thresholds.crestFailDb) {
    fail("Candidate crest is too high. Peaks are sticking out before the mix becomes dense.", "Reduce crest before target loudness.");
  } else if (delta.crestDb > thresholds.crestWarnDb) {
    warn("Candidate crest is higher than Reference.", "Use gentler density or clipping before final loudness.");
  }
  if (delta.plrDb < -1.5) {
    fail("Candidate PLR is too low versus Reference.", "Reduce over-density before chasing loudness.");
  }
  if (delta.presenceGapDb > thresholds.presenceFailDb) {
    fail(`2-5kHz presence is ${delta.presenceGapDb.toFixed(1)}dB below Reference.`, "Restore vocal/lead presence before adding more air.");
  } else if (delta.presenceGapDb > thresholds.presenceWarnDb) {
    warn(`2-5kHz presence is ${delta.presenceGapDb.toFixed(1)}dB below Reference.`, "Add a small presence catch-up only where the lead needs it.");
  }
  if (delta.clarityGapDb > thresholds.clarityFailDb) {
    fail(`5-10kHz clarity is ${delta.clarityGapDb.toFixed(1)}dB below Reference.`, "Increase post-clip clarity recovery around 5-10kHz.");
  } else if (delta.clarityGapDb > thresholds.clarityWarnDb) {
    warn(`5-10kHz clarity is ${delta.clarityGapDb.toFixed(1)}dB below Reference.`, "Check de-esser and harshness guard before raising clarity.");
  }
  const broadUltraOnlyGap = delta.sheenGapDb > thresholds.sheenWarnDb && delta.glossGapDb <= 1.0 && delta.topSheenGapDb <= 0.8;
  if (delta.sheenGapDb > thresholds.sheenFailDb) {
    if (delta.topSheenGapDb > 0.8 && delta.topSheenExcessDb <= 0.8) {
      fail(`10-20kHz sheen is ${delta.sheenGapDb.toFixed(1)}dB below Reference.`, "Use sheen recovery only after 2-10kHz is close enough.");
    } else if (!broadUltraOnlyGap) {
      warn(
        `10-20kHz is ${delta.sheenGapDb.toFixed(1)}dB below Reference, but 14-20kHz is not safely missing.`,
        "Do not use a broad high shelf; treat 9-14kHz gloss and 14-20kHz air/noise separately.",
      );
    }
  } else if (delta.sheenGapDb > thresholds.sheenWarnDb) {
    if (delta.topSheenGapDb > 0.8 && delta.topSheenExcessDb <= 0.8) {
      warn(`10-20kHz sheen is ${delta.sheenGapDb.toFixed(1)}dB below Reference.`, "Add a small sheen shelf without boosting sibilance.");
    } else if (!broadUltraOnlyGap) {
      warn(
        `10-20kHz is ${delta.sheenGapDb.toFixed(1)}dB below Reference, but 14-20kHz is already close or high.`,
        "Prefer gloss/mid-air shaping instead of a broad 14-20kHz lift.",
      );
    }
  }
  if (delta.glossGapDb > 1.5 && delta.presenceGapDb <= 1.2) {
    warn(`9-14kHz gloss is ${delta.glossGapDb.toFixed(1)}dB below Reference.`, "Prefer gloss recovery before broad 14-20kHz sheen.");
  }

  const fakeAirRisk = delta.sheenGapDb <= 0.5 && (delta.presenceGapDb > 1.2 || delta.clarityGapDb > 1.2);
  if (fakeAirRisk) {
    fail("Fake air risk. Ultra-air is close enough, but 2-10kHz is still behind Reference.", "Disable sheen catch-up until presence and clarity are closer.");
  }
  if (delta.airSideDb > 3 && (delta.presenceGapDb > 1.2 || delta.clarityGapDb > 1.2)) {
    fail("Air Bed Risk. 10-20kHz side is wider while 2-10kHz clarity is still behind Reference.", "Reduce air bed and recover vocal clarity/image first.");
  }
  if (delta.midImageSideDb < -1.5 && delta.airSideDb > 1 && (delta.presenceGapDb > 1.2 || delta.clarityGapDb > 1.2)) {
    fail("Image Balance fail. Mid image is narrow while ultra-air side is wide.", "Widen support in 500Hz-5kHz gently, not only the top-air bed.");
  }
  if (delta.presenceExcessDb > thresholds.presenceExcessFailDb) {
    fail("Candidate is brighter than Reference in 2-5kHz.", "Do not solve muffle by making vocal presence harsh.");
  }
  if (delta.clarityExcessDb > thresholds.clarityExcessFailDb) {
    fail("Candidate is brighter than Reference in 5-10kHz.", "Reduce clarity catch-up or de-esser bypass.");
  }
  if (delta.sheenExcessDb > thresholds.sheenExcessFailDb) {
    fail("Candidate is brighter than Reference in 10-20kHz.", "Reduce sheen/air layer to avoid hiss or shimmer noise.");
  }

  return {
    name,
    status: failed ? "fail" : summary.length ? "warn" : "pass",
    profile,
    summary,
    reference: pickMetrics(reference),
    candidate: pickMetrics(candidate),
    delta,
    recommendedFix: Array.from(new Set(recommendedFix)),
  };
}

function getThresholds(profile: GoldenProfile) {
  const base = {
    lufsTooQuietDb: 1.2,
    truePeakHigherDb: 0.8,
    crestWarnDb: 2.0,
    crestFailDb: 3.0,
    presenceWarnDb: 1.2,
    presenceFailDb: 1.8,
    clarityWarnDb: 1.0,
    clarityFailDb: 1.6,
    sheenWarnDb: 2.0,
    sheenFailDb: 3.0,
    presenceExcessFailDb: 1.5,
    clarityExcessFailDb: 1.5,
    sheenExcessFailDb: 2.0,
  };
  if (profile === "sheen_missing") {
    return { ...base, lufsTooQuietDb: 1.0, presenceWarnDb: 1.0, presenceFailDb: 1.2, clarityFailDb: 1.2, sheenFailDb: 2.0, crestFailDb: 2.0 };
  }
  if (profile === "muffle") {
    return {
      ...base,
      lufsTooQuietDb: 1.0,
      presenceFailDb: 1.2,
      clarityFailDb: 1.0,
      sheenFailDb: 2.4,
      crestFailDb: 2.5,
      presenceExcessFailDb: 1.8,
      clarityExcessFailDb: 2.25,
    };
  }
  if (profile === "same_song_reference") {
    return {
      ...base,
      lufsTooQuietDb: 0.8,
      presenceFailDb: 1.2,
      clarityFailDb: 1.2,
      sheenFailDb: 2.2,
      crestFailDb: 2.0,
      presenceExcessFailDb: 2.0,
      clarityExcessFailDb: 2.0,
    };
  }
  if (profile === "reference_better_master") {
    return {
      ...base,
      lufsTooQuietDb: 0.5,
      truePeakHigherDb: 1.2,
      crestWarnDb: 2.5,
      crestFailDb: 4.0,
      presenceExcessFailDb: 3.0,
      clarityExcessFailDb: 3.0,
      sheenWarnDb: 1.5,
      sheenFailDb: 2.2,
      sheenExcessFailDb: 1.8,
    };
  }
  if (profile === "instrumental_master") {
    return {
      ...base,
      lufsTooQuietDb: 0.8,
      presenceWarnDb: 1.5,
      presenceFailDb: 2.0,
      clarityWarnDb: 1.5,
      clarityFailDb: 2.0,
      sheenWarnDb: 1.5,
      sheenFailDb: 2.0,
      presenceExcessFailDb: 2.5,
      clarityExcessFailDb: 2.5,
      sheenExcessFailDb: 2.5,
    };
  }
  if (profile === "vocal_forward") {
    return { ...base, presenceFailDb: 1.0, clarityFailDb: 1.0, sheenFailDb: 2.0, crestFailDb: 2.5 };
  }
  return base;
}

function loadPairs(args: Args): GoldenPair[] {
  if (args.config) {
    if (!fs.existsSync(args.config)) handleMissingFixture(args.config);
    const configPath = path.resolve(args.config);
    const configDir = path.dirname(configPath);
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")) as GoldenPair[];
    return raw.map((pair) => ({
      ...pair,
      reference: resolveFrom(configDir, pair.reference),
      candidate: resolveFrom(configDir, pair.candidate),
      profile: pair.profile ?? "default",
    }));
  }
  if (!args.reference || !args.candidate) {
    throw new Error("Usage: node --experimental-strip-types scripts/audio/goldenReferenceRegression.ts --config test-fixtures/audio/golden/pairs.json");
  }
  return [{ name: args.name || "golden", reference: args.reference, candidate: args.candidate, profile: args.profile }];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { config: "", reference: "", candidate: "", name: "", profile: "default" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--config" && value) {
      args.config = value;
      index += 1;
    } else if (key === "--reference" && value) {
      args.reference = value;
      index += 1;
    } else if ((key === "--candidate" || key === "--output") && value) {
      args.candidate = value;
      index += 1;
    } else if (key === "--name" && value) {
      args.name = value;
      index += 1;
    } else if (key === "--profile" && value) {
      args.profile = normalizeProfile(value);
      index += 1;
    }
  }
  return args;
}

function assertFixture(filePath: string) {
  if (!fs.existsSync(filePath)) handleMissingFixture(filePath);
}

function handleMissingFixture(filePath: string): never {
  console.error(`Golden WAV fixtures missing. Copy real reference/candidate WAVs into test-fixtures/audio/golden. Missing: ${filePath}`);
  process.exit(process.env.CI === "true" ? 0 : 1);
}

function resolveFrom(baseDir: string, filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  const cwdPath = path.resolve(filePath);
  return fs.existsSync(cwdPath) || filePath.startsWith("test-fixtures/") ? cwdPath : path.resolve(baseDir, filePath);
}

function normalizeProfile(value: string): GoldenProfile {
  if (
    value === "same_song_reference" ||
    value === "reference_better_master" ||
    value === "instrumental_master" ||
    value === "vocal_forward" ||
    value === "sheen_missing" ||
    value === "muffle"
  ) {
    return value;
  }
  return "default";
}

function pickMetrics(metrics: WavMetrics) {
  return {
    integratedLufsApprox: metrics.integratedLufsApprox,
    truePeakApproxDb: metrics.truePeakApproxDb,
    crestDb: metrics.crestDb,
    plrDb: metrics.plrDb,
    sideMidDb: metrics.sideMidDb,
    lrCorrelation: metrics.lrCorrelation,
    bandEnergyDb: metrics.bandEnergyDb,
    bandSideMidDb: metrics.bandSideMidDb,
    bandCorrelation: metrics.bandCorrelation,
    spectralFlatnessHigh: metrics.spectralFlatnessHigh,
    hfHashIndex: metrics.hfHashIndex,
  };
}

function bandGap(reference: WavMetrics, candidate: WavMetrics, band: keyof WavMetrics["bandEnergyDb"]) {
  return round2(reference.bandEnergyDb[band] - candidate.bandEnergyDb[band]);
}

function bandDelta(candidate: WavMetrics, reference: WavMetrics, band: keyof WavMetrics["bandEnergyDb"]) {
  return round2(candidate.bandEnergyDb[band] - reference.bandEnergyDb[band]);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
