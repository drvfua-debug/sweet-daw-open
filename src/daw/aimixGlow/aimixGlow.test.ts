import { describe, expect, it } from "vitest";
import { analyzeAimixGlow, processAimixGlow } from "./processor";
import type { AimixGlowAudioChannel } from "./types";

const SAMPLE_RATE = 48000;

describe("AIMIX Glow", () => {
  it("leaves samples unchanged when disabled", () => {
    const input = stereoSine(440, 0.2, 1);
    const result = processAimixGlow(input, SAMPLE_RATE, { enabled: false });

    expect(result.actions.join(" ")).toContain("bypassed");
    expect(maxAbsDiff(input[0], result.channels[0])).toBeLessThan(1e-7);
    expect(maxAbsDiff(input[1], result.channels[1])).toBeLessThan(1e-7);
  });

  it("detects vocal activity from a vocal sidechain", () => {
    const mix = stereoSine(220, 0.12, 1);
    const silentVocal = [new Float32Array(mix[0].length)];
    const activeVocal = [sine(880, 0.2, 1)];

    const silent = analyzeAimixGlow(mix, SAMPLE_RATE, silentVocal);
    const active = analyzeAimixGlow(mix, SAMPLE_RATE, activeVocal);

    expect(active.vocalActivityMean).toBeGreaterThan(silent.vocalActivityMean + 0.1);
    expect(active.vocalAvailable).toBe(true);
  });

  it("keeps output loudness close when outputMatch is enabled", () => {
    const input = mixTone();
    const result = processAimixGlow(input, SAMPLE_RATE, {
      enabled: true,
      preset: "aiStemRescue",
      amount: 80,
      vocalKey: 70,
      recover: 60,
      gloss: 40,
      air: 45,
      tame: 45,
      outputMatch: true,
      quality: "offlineHighQuality",
    }, { vocalSidechain: [sine(1200, 0.18, 1)] });

    expect(Math.abs(result.after.inputLufsApprox - result.before.inputLufsApprox)).toBeLessThanOrEqual(0.6);
    expect(result.after.inputTruePeakDb).toBeLessThanOrEqual(-1.15);
    expect(Number.isFinite(result.outputMatchGainDb)).toBe(true);
  });

  it("never emits NaN or Infinity", () => {
    const input = mixTone();
    input[0][100] = Number.NaN;
    input[1][200] = Number.POSITIVE_INFINITY;

    const result = processAimixGlow(input, SAMPLE_RATE, { enabled: true, amount: 65, outputMatch: true }, { copyInput: false });

    for (const channel of result.channels) {
      for (const sample of channel) expect(Number.isFinite(sample)).toBe(true);
    }
    expect(result.warnings.join(" ")).toContain("invalid samples");
  });

  it("guards air recovery when fake-air risk is already high", () => {
    const input = fakeAirTone();
    const result = processAimixGlow(input, SAMPLE_RATE, {
      enabled: true,
      preset: "brightButSafe",
      amount: 85,
      vocalKey: 80,
      recover: 80,
      gloss: 20,
      air: 90,
      tame: 55,
      outputMatch: true,
      quality: "offlineHighQuality",
    }, { vocalSidechain: [sine(1200, 0.18, 1)] });

    expect(result.before.fakeAirRisk).toBeGreaterThan(0.2);
    expect(result.actions.join(" ")).toContain("Air Recovery guarded");
    expect(result.after.inputTruePeakDb).toBeLessThanOrEqual(-1.15);
  });

  it("reduces intensity when no vocal sidechain is available", () => {
    const inputWithKey = mixTone();
    const inputWithoutKey = mixTone();
    const settings = {
      enabled: true,
      preset: "vocalBreath" as const,
      amount: 80,
      vocalKey: 100,
      recover: 60,
      gloss: 55,
      air: 55,
      tame: 35,
      outputMatch: true,
      quality: "offlineHighQuality" as const,
    };
    const active = processAimixGlow(inputWithKey, SAMPLE_RATE, settings, { vocalSidechain: [sine(1200, 0.2, 1)] });
    const fallback = processAimixGlow(inputWithoutKey, SAMPLE_RATE, settings);

    expect(fallback.warnings.join(" ")).toContain("Vocal Key: unavailable");
    expect(readAirRecoveryDb(fallback.actions)).toBeLessThanOrEqual(readAirRecoveryDb(active.actions));
  });
});

function mixTone(): AimixGlowAudioChannel[] {
  const left = new Float32Array(SAMPLE_RATE);
  const right = new Float32Array(SAMPLE_RATE);
  for (let index = 0; index < left.length; index += 1) {
    const t = index / SAMPLE_RATE;
    const body = Math.sin(2 * Math.PI * 330 * t) * 0.1;
    const presence = Math.sin(2 * Math.PI * 2800 * t) * 0.035;
    const air = Math.sin(2 * Math.PI * 10500 * t) * 0.012;
    left[index] = body + presence + air;
    right[index] = body * 0.98 + presence * 0.9 - air * 0.2;
  }
  return [left, right];
}

function fakeAirTone(): AimixGlowAudioChannel[] {
  const left = new Float32Array(SAMPLE_RATE);
  const right = new Float32Array(SAMPLE_RATE);
  for (let index = 0; index < left.length; index += 1) {
    const t = index / SAMPLE_RATE;
    const body = Math.sin(2 * Math.PI * 420 * t) * 0.06;
    const presence = Math.sin(2 * Math.PI * 3200 * t) * 0.01;
    const brittle = Math.sin(2 * Math.PI * 14800 * t) * 0.05;
    left[index] = body + presence + brittle;
    right[index] = body * 0.95 + presence * 0.8 - brittle * 0.82;
  }
  return [left, right];
}

function stereoSine(freq: number, amp: number, seconds: number): AimixGlowAudioChannel[] {
  const tone = sine(freq, amp, seconds);
  const right = new Float32Array(tone.length);
  right.set(tone);
  return [tone, right];
}

function sine(freq: number, amp: number, seconds: number): Float32Array {
  const output = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.sin(2 * Math.PI * freq * index / SAMPLE_RATE) * amp;
  }
  return output;
}

function maxAbsDiff(a: Float32Array, b: Float32Array) {
  let max = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    max = Math.max(max, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
  }
  return max;
}

function readAirRecoveryDb(actions: string[]) {
  const action = actions.find((entry) => entry.startsWith("Air Recovery +"));
  if (!action) return 0;
  const match = /\+([0-9.]+) dB/.exec(action);
  return match ? Number(match[1]) : 0;
}
