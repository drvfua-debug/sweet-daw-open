import { describe, expect, it } from "vitest";
import { resolveSweetDeEsserParams } from "./PluginChain";

const SAMPLE_RATE = 48000;

type CurrentTopologyMeasurement = {
  bandInputDb: number;
  bandOutputDb: number;
  reductionDb: number;
};

describe("Sweet De-Esser V2 characterization", () => {
  it("lowers the compression threshold as amount increases", () => {
    const gentle = resolveSweetDeEsserParams({ amount: 0.2, sharpness: 0.55, mix: 0.75 }, SAMPLE_RATE);
    const strong = resolveSweetDeEsserParams({ amount: 0.8, sharpness: 0.55, mix: 0.75 }, SAMPLE_RATE);

    expect(strong.thresholdDb).toBeLessThan(gentle.thresholdDb);
    expect(strong.ratio).toBeGreaterThan(gentle.ratio);
    expect(strong.bandCancelGain).toBeCloseTo(-strong.compressedBandGain, 8);
    console.info("Phase 1 De-Esser V2 threshold snapshot", {
      gentleThresholdDb: gentle.thresholdDb,
      strongThresholdDb: strong.thresholdDb,
      gentleRatio: gentle.ratio,
      strongRatio: strong.ratio,
    });
  });

  it("increases reduction as the sibilance band becomes louder", () => {
    const params = resolveSweetDeEsserParams({ amount: 0.5, sharpness: 0.55, mix: 0.75 }, SAMPLE_RATE);
    const low = measureV2DifferenceReconstruction(-36, params);
    const medium = measureV2DifferenceReconstruction(-24, params);
    const high = measureV2DifferenceReconstruction(-12, params);

    expect(low.reductionDb).toBeLessThan(medium.reductionDb);
    expect(medium.reductionDb).toBeLessThan(high.reductionDb);
    expect(low.reductionDb).toBeLessThan(0.1);
    expect(high.reductionDb).toBeLessThanOrEqual(5);
    console.info("Phase 1 De-Esser V2 topology", { low, medium, high });
  });

  it("keeps the model bypass-transparent when mix is zero", () => {
    const bypass = resolveSweetDeEsserParams({ amount: 0.8, mix: 0 }, SAMPLE_RATE);
    const measurement = measureV2DifferenceReconstruction(-12, bypass);

    expect(measurement.reductionDb).toBeCloseTo(0, 8);
  });
});

function measureV2DifferenceReconstruction(
  bandInputDb: number,
  params: ReturnType<typeof resolveSweetDeEsserParams>,
): CurrentTopologyMeasurement {
  const input = dbToGain(bandInputDb);
  const compressed = approximateCompressorOutput(input, params.thresholdDb, params.ratio);
  const output = Math.max(1e-12, input + input * params.bandCancelGain + compressed * params.compressedBandGain);
  const bandOutputDb = gainToDb(output);

  return {
    bandInputDb,
    bandOutputDb: round3(bandOutputDb),
    reductionDb: round3(bandInputDb - bandOutputDb),
  };
}

function approximateCompressorOutput(input: number, thresholdDb: number, ratio: number) {
  const inputDb = gainToDb(input);
  if (inputDb <= thresholdDb) return input;
  const outputDb = thresholdDb + (inputDb - thresholdDb) / Math.max(1, ratio);
  return dbToGain(outputDb);
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function gainToDb(gain: number) {
  return 20 * Math.log10(Math.max(1e-12, gain));
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
