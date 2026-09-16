import { describe, expect, it } from "vitest";
import { analyzeTransientSustain, applySweetFinalRepairModulesToChannels, type SweetFinalRepairParams } from "../finalRepairModules";

describe("final repair modules v0.7", () => {
  it("keeps silence finite and preserves channel lengths through all modules", () => {
    const sampleRate = 16000;
    const input = [new Float32Array(sampleRate / 4), new Float32Array(sampleRate / 4)];
    const modules: SweetFinalRepairParams[] = [
      params("dereverb-lite"),
      params("peak-restore-lite"),
      params("hum-tone-reducer-lite"),
      params("plosive-breath-tamer-lite"),
      params("stereo-phase-guard"),
      params("transient-sustain-split"),
    ];
    const result = applySweetFinalRepairModulesToChannels(input, sampleRate, modules);
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]?.length).toBe(input[0]?.length);
    expect(result.channels[1]?.length).toBe(input[1]?.length);
    expect(result.channels.every((channel) => Array.from(channel).every(Number.isFinite))).toBe(true);
    expect(maxAbs(result.channels[0] ?? new Float32Array())).toBeLessThan(1e-7);
  });

  it("is effectively unchanged when module amount is zero", () => {
    const sampleRate = 24000;
    const input = [mixedTone(sampleRate, 0.25, [{ hz: 440, gain: 0.2 }, { hz: 2800, gain: 0.05 }])];
    const result = applySweetFinalRepairModulesToChannels(input, sampleRate, [
      { ...params("dereverb-lite"), amount: 0 },
      { ...params("peak-restore-lite"), amount: 0 },
      { ...params("hum-tone-reducer-lite"), amount: 0 },
      { ...params("plosive-breath-tamer-lite"), amount: 0 },
    ]);
    expect(maxAbsDiff(input[0] ?? new Float32Array(), result.channels[0] ?? new Float32Array())).toBeLessThan(1e-8);
    expect(result.appliedModules).toHaveLength(0);
  });

  it("hum-tone-reducer-lite reduces a stable 60Hz hum more than vocal body", () => {
    const sampleRate = 48000;
    const input = [mixedTone(sampleRate, 0.5, [{ hz: 60, gain: 0.32 }, { hz: 500, gain: 0.2 }])];
    const before60 = toneEnergy(input[0] ?? new Float32Array(), sampleRate, 60);
    const before500 = toneEnergy(input[0] ?? new Float32Array(), sampleRate, 500);
    const result = applySweetFinalRepairModulesToChannels(input, sampleRate, [params("hum-tone-reducer-lite", 0.9)]);
    const output = result.channels[0] ?? new Float32Array();
    const humDrop = before60 - toneEnergy(output, sampleRate, 60);
    const bodyDrop = before500 - toneEnergy(output, sampleRate, 500);
    expect(humDrop).toBeGreaterThan(bodyDrop + 0.01);
  });

  it("hum-tone-reducer-lite protects low-end fundamentals for bass-focused material", () => {
    const sampleRate = 48000;
    const input = [mixedTone(sampleRate, 0.5, [{ hz: 60, gain: 0.32 }, { hz: 500, gain: 0.08 }])];
    const before60 = toneEnergy(input[0] ?? new Float32Array(), sampleRate, 60);
    const result = applySweetFinalRepairModulesToChannels(input, sampleRate, [{ ...params("hum-tone-reducer-lite", 1, "bass"), protect: ["low-end"] }]);
    const after60 = toneEnergy(result.channels[0] ?? new Float32Array(), sampleRate, 60);
    expect(after60).toBeGreaterThan(before60 * 0.92);
  });

  it("plosive-breath-tamer-lite reduces a low burst without removing the full signal", () => {
    const sampleRate = 24000;
    const channel = mixedTone(sampleRate, 0.35, [{ hz: 440, gain: 0.08 }]);
    for (let index = 1200; index < 1350; index += 1) channel[index] += Math.sin((2 * Math.PI * 70 * index) / sampleRate) * 0.55;
    const beforeBurst = windowRms(channel, 1200, 1350);
    const beforeBody = windowRms(channel, 3500, 5000);
    const result = applySweetFinalRepairModulesToChannels([channel], sampleRate, [params("plosive-breath-tamer-lite", 0.9, "vocal")]);
    const output = result.channels[0] ?? new Float32Array();
    expect(windowRms(output, 1200, 1350)).toBeLessThan(beforeBurst);
    expect(windowRms(output, 3500, 5000)).toBeGreaterThan(beforeBody * 0.82);
  });

  it("stereo-phase-guard reduces low side energy and improves correlation", () => {
    const sampleRate = 48000;
    const left = mixedTone(sampleRate, 0.4, [{ hz: 80, gain: 0.28 }, { hz: 2000, gain: 0.08 }]);
    const right = mixedTone(sampleRate, 0.4, [{ hz: 80, gain: -0.28 }, { hz: 2000, gain: 0.08 }]);
    const beforeSideLow = toneEnergy(sideSignal(left, right), sampleRate, 80);
    const beforeCorr = correlation(left, right);
    const result = applySweetFinalRepairModulesToChannels([left, right], sampleRate, [params("stereo-phase-guard", 0.85)]);
    const afterLeft = result.channels[0] ?? new Float32Array();
    const afterRight = result.channels[1] ?? new Float32Array();
    expect(toneEnergy(sideSignal(afterLeft, afterRight), sampleRate, 80)).toBeLessThan(beforeSideLow);
    expect(correlation(afterLeft, afterRight)).toBeGreaterThan(beforeCorr);
  });

  it("peak-restore-lite can lift transient contrast without exceeding ceiling", () => {
    const sampleRate = 24000;
    const channel = mixedTone(sampleRate, 0.3, [{ hz: 220, gain: 0.08 }]);
    channel[2400] += 0.35;
    channel[6000] -= 0.28;
    const beforeTransient = Math.abs(channel[2400] ?? 0);
    const result = applySweetFinalRepairModulesToChannels([channel], sampleRate, [params("peak-restore-lite", 0.8)]);
    const output = result.channels[0] ?? new Float32Array();
    expect(Math.abs(output[2400] ?? 0)).toBeGreaterThanOrEqual(beforeTransient);
    expect(maxAbs(output)).toBeLessThanOrEqual(0.986);
  });

  it("transient/sustain analysis reports transient and sustain envelopes", () => {
    const sampleRate = 16000;
    const channel = mixedTone(sampleRate, 0.2, [{ hz: 330, gain: 0.1 }]);
    channel[600] += 0.5;
    const analysis = analyzeTransientSustain([channel], sampleRate);
    expect(analysis.transientEnvelope.length).toBe(channel.length);
    expect(analysis.sustainEnvelope.length).toBe(channel.length);
    expect(analysis.transientDensity).toBeGreaterThan(0);
    expect(analysis.sustainSmearScore).toBeGreaterThan(0);
    expect(analysis.sampleAccurate).toBe(true);
    expect(analysis.frameStep).toBe(1);
  });

  it("treats transient-sustain-split as analysis-only instead of applied audio DSP", () => {
    const sampleRate = 16000;
    const input = [mixedTone(sampleRate, 0.2, [{ hz: 330, gain: 0.1 }])];
    const result = applySweetFinalRepairModulesToChannels(input, sampleRate, [params("transient-sustain-split", 1)]);

    expect(result.appliedModules).not.toContain("transient-sustain-split");
    expect(result.warnings.join(" ")).toContain("analysis utility");
    expect(maxAbsDiff(input[0] ?? new Float32Array(), result.channels[0] ?? new Float32Array())).toBeLessThan(1e-8);
  });

  it("uses block envelope fallback for long final repair inputs", () => {
    const sampleRate = 48000;
    const input = [mixedTone(sampleRate, 6.1, [{ hz: 220, gain: 0.04 }])];
    const result = applySweetFinalRepairModulesToChannels(input, sampleRate, [params("peak-restore-lite", 0.2)]);

    expect(result.analysis.sampleAccurate).toBe(false);
    expect(result.analysis.frameStep).toBeGreaterThan(1);
    expect(result.analysis.transientEnvelope.length).toBeLessThan(input[0]?.length ?? 0);
    expect(result.warnings.join(" ")).toContain("block envelope fallback");
  });
});

function params(module: SweetFinalRepairParams["module"], amount = 0.6, focus: SweetFinalRepairParams["focus"] = "stem"): SweetFinalRepairParams {
  return { module, amount, focus, safeMode: true, protect: [] };
}

function mixedTone(sampleRate: number, durationSec: number, tones: Array<{ hz: number; gain: number }>) {
  const length = Math.floor(sampleRate * durationSec);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = tones.reduce((sum, tone) => sum + Math.sin((2 * Math.PI * tone.hz * index) / sampleRate) * tone.gain, 0);
  }
  return out;
}

function toneEnergy(channel: Float32Array, sampleRate: number, hz: number) {
  let real = 0;
  let imag = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const angle = (2 * Math.PI * hz * index) / sampleRate;
    real += (channel[index] ?? 0) * Math.cos(angle);
    imag -= (channel[index] ?? 0) * Math.sin(angle);
  }
  return Math.hypot(real, imag) / Math.max(1, channel.length);
}

function windowRms(channel: Float32Array, start: number, end: number) {
  let sum = 0;
  let count = 0;
  for (let index = start; index < end && index < channel.length; index += 1) {
    const sample = channel[index] ?? 0;
    sum += sample * sample;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function sideSignal(left: Float32Array, right: Float32Array) {
  const length = Math.min(left.length, right.length);
  const side = new Float32Array(length);
  for (let index = 0; index < length; index += 1) side[index] = ((left[index] ?? 0) - (right[index] ?? 0)) * 0.5;
  return side;
}

function correlation(left: Float32Array, right: Float32Array) {
  const length = Math.min(left.length, right.length);
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    ll += l * l;
    rr += r * r;
    lr += l * r;
  }
  return lr / Math.sqrt(Math.max(1e-12, ll * rr));
}

function maxAbs(channel: Float32Array) {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function maxAbsDiff(a: Float32Array, b: Float32Array) {
  let peak = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) peak = Math.max(peak, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
  return peak;
}
