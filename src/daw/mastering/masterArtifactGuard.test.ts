import { describe, expect, it } from "vitest";
import { analyzeMasterArtifacts, applyMasterArtifactGuard } from "./masterArtifactGuard";

const SAMPLE_RATE = 48_000;

function grittyMix(seconds = 1.2) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const body = Math.sin(2 * Math.PI * 900 * t) * 0.06;
    const presence = Math.sin(2 * Math.PI * 3600 * t) * 0.018;
    const metallic = Math.sin(2 * Math.PI * 10800 * t) * 0.036;
    const hiss = Math.sin(2 * Math.PI * 15600 * t) * 0.034;
    const shimmer = ((index * 17) % 31) / 31 - 0.5;
    left[index] = body + presence + metallic + hiss + shimmer * 0.012;
    right[index] = body * 0.96 + presence + metallic * 0.9 + hiss * 1.08 - shimmer * 0.01;
  }
  return [left, right];
}

function metallicArtifact(seconds = 1.2) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const body = Math.sin(2 * Math.PI * 900 * t) * 0.055;
    const metallic = Math.sin(2 * Math.PI * 10800 * t) * 0.045;
    left[index] = body + metallic;
    right[index] = body * 0.96 + metallic * 0.92;
  }
  return [left, right];
}

function hissBed(seconds = 1.2) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let state = 123456789;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
  let highNoiseL = 0;
  let highNoiseR = 0;
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const body = Math.sin(2 * Math.PI * 900 * t) * 0.04 + Math.sin(2 * Math.PI * 2200 * t) * 0.012;
    highNoiseL = random() * 0.045 - highNoiseL * 0.72;
    highNoiseR = random() * 0.045 - highNoiseR * 0.72;
    left[index] = body + highNoiseL;
    right[index] = body * 0.98 + highNoiseR;
  }
  return [left, right];
}

function brightCleanCymbal(seconds = 1.2) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const decay = Math.exp(-t * 2.5);
    const tone =
      Math.sin(2 * Math.PI * 7200 * t) * 0.026 +
      Math.sin(2 * Math.PI * 10400 * t) * 0.019 +
      Math.sin(2 * Math.PI * 13800 * t) * 0.013;
    const body = Math.sin(2 * Math.PI * 1800 * t) * 0.025;
    left[index] = body + tone * decay;
    right[index] = body * 0.97 + tone * decay * 0.92;
  }
  return [left, right];
}

function airyVocal(seconds = 1.2) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const vowel = Math.sin(2 * Math.PI * 480 * t) * 0.045 + Math.sin(2 * Math.PI * 950 * t) * 0.026;
    const breath = Math.sin(2 * Math.PI * 6200 * t) * 0.008 + Math.sin(2 * Math.PI * 11200 * t) * 0.004;
    left[index] = vowel + breath;
    right[index] = vowel * 0.99 + breath * 0.96;
  }
  return [left, right];
}

function cleanMix(seconds = 1.2) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    left[index] = Math.sin(2 * Math.PI * 700 * t) * 0.07 + Math.sin(2 * Math.PI * 2500 * t) * 0.012;
    right[index] = Math.sin(2 * Math.PI * 710 * t) * 0.065 + Math.sin(2 * Math.PI * 2600 * t) * 0.011;
  }
  return [left, right];
}

function toneEnergy(channels: Float32Array[], frequency: number) {
  const mono = channels[0]!.map((sample, index) => (sample + (channels[1]?.[index] ?? sample)) * 0.5);
  let real = 0;
  let imag = 0;
  const omega = (2 * Math.PI * frequency) / SAMPLE_RATE;
  for (let index = 0; index < mono.length; index += 1) {
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, mono.length - 1));
    real += mono[index] * win * Math.cos(omega * index);
    imag -= mono[index] * win * Math.sin(omega * index);
  }
  return Math.hypot(real, imag);
}

function rms(channels: Float32Array[]) {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (const sample of channel) {
      sum += sample * sample;
      count += 1;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

describe("master artifact guard", () => {
  it("scores metallic high grain without treating it as broadband hiss", () => {
    const report = analyzeMasterArtifacts(metallicArtifact(), SAMPLE_RATE);

    expect(report.scores.metallic).toBeGreaterThan(35);
    expect(report.scores.hiss).toBeLessThan(35);
    expect(report.bands.highRatioDb).toBeGreaterThan(-30);
  });

  it("reduces metallic high grain without crushing body level", () => {
    const channels = metallicArtifact();
    const beforeMetal = toneEnergy(channels, 10800);
    const beforeRms = rms(channels);

    const result = applyMasterArtifactGuard(channels, SAMPLE_RATE, { amount: 0.8, maxCutDb: 1.8 });

    expect(result.applied).toBe(true);
    expect(result.cuts.metallicDb).toBeLessThanOrEqual(-0.4);
    expect(toneEnergy(channels, 10800)).toBeLessThan(beforeMetal * 0.97);
    expect(rms(channels)).toBeGreaterThan(beforeRms * 0.92);
  });

  it("reduces broadband hiss bed", () => {
    const channels = hissBed();
    const beforeHiss = toneEnergy(channels, 15600);
    const beforeRms = rms(channels);

    const result = applyMasterArtifactGuard(channels, SAMPLE_RATE, { amount: 0.8, maxCutDb: 1.8 });

    expect(result.applied).toBe(true);
    expect(result.cuts.hissDb).toBeLessThanOrEqual(-0.4);
    expect(toneEnergy(channels, 15600)).toBeLessThan(beforeHiss * 0.93);
    expect(rms(channels)).toBeGreaterThan(beforeRms * 0.92);
  });

  it("stays bypassed for clean material", () => {
    const channels = cleanMix();
    const result = applyMasterArtifactGuard(channels, SAMPLE_RATE, { amount: 0.35 });

    expect(result.applied).toBe(false);
    expect(result.scores.hiss).toBeLessThan(35);
    expect(result.scores.metallic).toBeLessThan(35);
  });

  it("does not dull bright clean cymbal material", () => {
    const channels = brightCleanCymbal();
    const result = applyMasterArtifactGuard(channels, SAMPLE_RATE, { amount: 0.8, preserveBrightness: true, maxCutDb: 1.8 });

    expect(Math.abs(result.cuts.presenceDb)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(result.cuts.sibilanceDb)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(result.cuts.metallicDb)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(result.cuts.hissDb)).toBeLessThanOrEqual(0.15);
  });

  it("preserves airy vocal brightness in preserve mode", () => {
    const channels = airyVocal();
    const beforeAir = toneEnergy(channels, 11200);
    const result = applyMasterArtifactGuard(channels, SAMPLE_RATE, { amount: 0.7, preserveBrightness: true });
    const afterAir = toneEnergy(channels, 11200);

    expect(result.cuts.hissDb).toBeGreaterThanOrEqual(-0.15);
    expect(afterAir).toBeGreaterThan(beforeAir * 0.9);
  });

  it("applies a measurable but tiny final artifact guard when fake-air risk survives limiting", () => {
    const channels = hissBed();
    const beforeHiss = toneEnergy(channels, 15600);
    const beforeRms = rms(channels);
    const result = applyMasterArtifactGuard(channels, SAMPLE_RATE, {
      amount: 0.2,
      preserveBrightness: true,
      maxCutDb: 0.75,
      finalPass: true,
    });
    const hissCut = Math.abs(result.cuts.hissDb);

    expect(result.applied).toBe(true);
    expect(hissCut).toBeGreaterThanOrEqual(0.012);
    expect(hissCut).toBeLessThanOrEqual(0.25);
    expect(toneEnergy(channels, 15600)).toBeLessThan(beforeHiss);
    expect(rms(channels)).toBeGreaterThan(beforeRms * 0.985);
  });

  it("does not dull bright clean cymbals during final pass", () => {
    const channels = brightCleanCymbal();
    const beforeAir = toneEnergy(channels, 11200);
    applyMasterArtifactGuard(channels, SAMPLE_RATE, {
      amount: 0.2,
      preserveBrightness: true,
      maxCutDb: 0.75,
      finalPass: true,
    });

    expect(toneEnergy(channels, 11200)).toBeGreaterThan(beforeAir * 0.966);
  });
});
