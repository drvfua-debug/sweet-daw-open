import { describe, expect, it } from "vitest";
import { PEAK_SUMMARY_ANALYSIS_VERSION, buildPeakSummary } from "./PeakBuilder";

function makeSineAudioBuffer(frequency: number, options: { invertedRight?: boolean } = {}) {
  const sampleRate = 48000;
  const length = sampleRate;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 0.5;
    left[index] = value;
    right[index] = options.invertedRight ? -value : value;
  }

  return {
    length,
    duration: length / sampleRate,
    sampleRate,
    numberOfChannels: 2,
    getChannelData(channel: number) {
      return channel === 0 ? left : right;
    },
  } as AudioBuffer;
}

describe("buildPeakSummary analysis features", () => {
  it("stores measured band energy from the source waveform", () => {
    const summary = buildPeakSummary(makeSineAudioBuffer(1000), 128);

    expect(summary.analysisVersion).toBe(PEAK_SUMMARY_ANALYSIS_VERSION);
    expect(summary.bandEnergyDb).toBeDefined();
    expect(summary.bandEnergyDb?.["900-1500"]).toBeGreaterThan(summary.bandEnergyDb?.["5000-9000"] ?? 0);
    expect(summary.spectralCentroidHz).toBeGreaterThan(500);
    expect(summary.spectralCentroidHz).toBeLessThan(1800);
  });

  it("stores waveform-based stereo correlation", () => {
    const mono = buildPeakSummary(makeSineAudioBuffer(440), 128);
    const inverted = buildPeakSummary(makeSineAudioBuffer(440, { invertedRight: true }), 128);

    expect(mono.lrCorrelation).toBeGreaterThan(0.95);
    expect(inverted.lrCorrelation).toBeLessThan(-0.95);
    expect(inverted.sideMidRatioDb).toBeGreaterThan(mono.sideMidRatioDb ?? -48);
  });
});

