import { describe, expect, it } from "vitest";
import { applyRepairOperationsToChannels, type RepairProcessSegment } from "./repairProcessors";

describe("repair processors v0.2a", () => {
  it("keeps silence finite through each operation", () => {
    const sampleRate = 16000;
    const operations: RepairProcessSegment["operation"][] = ["attenuate", "declick_lite", "decrackle_lite", "deess_lite", "deharsh_lite", "dechirp_lite", "lowend_tighten_lite"];
    for (const operation of operations) {
      const result = applyRepairOperationsToChannels([new Float32Array(sampleRate / 10)], sampleRate, [segment({ operation })]);
      expect(result.channels[0]?.some((sample) => !Number.isFinite(sample))).toBe(false);
      expect(maxAbs(result.channels[0] ?? new Float32Array())).toBeLessThan(1e-6);
    }
  });

  it("deharsh_lite reduces a synthetic 4kHz peak more than 500Hz body", () => {
    const sampleRate = 48000;
    const input = mixedTone(sampleRate, 0.25, [{ hz: 500, gain: 0.28 }, { hz: 4000, gain: 0.28 }]);
    const before500 = toneEnergy(input, sampleRate, 500);
    const before4k = toneEnergy(input, sampleRate, 4000);
    const result = applyRepairOperationsToChannels([input], sampleRate, [segment({ operation: "deharsh_lite", lowHz: 2500, highHz: 6500, amountDb: -6, strength: 1 })]);
    const after = result.channels[0] ?? new Float32Array();
    const bodyDrop = before500 - toneEnergy(after, sampleRate, 500);
    const harshDrop = before4k - toneEnergy(after, sampleRate, 4000);
    expect(harshDrop).toBeGreaterThan(bodyDrop + 0.01);
  });

  it("deharsh_lite is transparent when reduction amount is zero", () => {
    const sampleRate = 48000;
    const input = mixedTone(sampleRate, 0.25, [{ hz: 4000, gain: 0.28 }, { hz: 5200, gain: 0.12 }]);
    const result = applyRepairOperationsToChannels([input], sampleRate, [segment({ operation: "deharsh_lite", lowHz: 2500, highHz: 6500, amountDb: 0, strength: 1 })]);

    expect(rmsDiff(input, result.channels[0] ?? new Float32Array())).toBeLessThan(1e-5);
  });

  it("dechirp_lite reduces a synthetic 9kHz narrow tone", () => {
    const sampleRate = 48000;
    const input = mixedTone(sampleRate, 0.25, [{ hz: 1000, gain: 0.18 }, { hz: 9000, gain: 0.32 }]);
    const before9k = toneEnergy(input, sampleRate, 9000);
    const before1k = toneEnergy(input, sampleRate, 1000);
    const result = applyRepairOperationsToChannels([input], sampleRate, [segment({ operation: "dechirp_lite", lowHz: 7000, highHz: 12000, amountDb: -6, strength: 1 })]);
    const after = result.channels[0] ?? new Float32Array();
    expect(before9k - toneEnergy(after, sampleRate, 9000)).toBeGreaterThan(before1k - toneEnergy(after, sampleRate, 1000));
  });

  it("declick_lite reduces a single-sample spike without muting the full signal", () => {
    const sampleRate = 16000;
    const input = mixedTone(sampleRate, 0.1, [{ hz: 440, gain: 0.1 }]);
    input[400] = 1;
    const result = applyRepairOperationsToChannels([input], sampleRate, [segment({ operation: "declick_lite", amountDb: -6, strength: 1 })]);
    const output = result.channels[0] ?? new Float32Array();
    expect(Math.abs(output[400] ?? 0)).toBeLessThan(0.7);
    expect(maxAbs(output)).toBeGreaterThan(0.05);
  });

  it("declick_lite detects a right-channel-only click", () => {
    const sampleRate = 16000;
    const left = mixedTone(sampleRate, 0.1, [{ hz: 440, gain: 0.1 }]);
    const right = mixedTone(sampleRate, 0.1, [{ hz: 440, gain: 0.1 }]);
    right[400] = 1;

    const result = applyRepairOperationsToChannels([left, right], sampleRate, [segment({ operation: "declick_lite", amountDb: -6, strength: 1 })]);
    const outputRight = result.channels[1] ?? new Float32Array();

    expect(Math.abs(outputRight[400] ?? 0)).toBeLessThan(0.7);
    expect(maxAbs(outputRight)).toBeGreaterThan(0.05);
  });
});

function segment(patch: Partial<RepairProcessSegment> = {}): RepairProcessSegment {
  return {
    regionId: "r1",
    operation: "attenuate",
    startLocalSec: 0,
    endLocalSec: 0.25,
    lowHz: 20,
    highHz: 20000,
    amountDb: -3,
    strength: 0.5,
    featherTimeSec: 0,
    ...patch,
  };
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

function maxAbs(channel: Float32Array) {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function rmsDiff(a: Float32Array, b: Float32Array) {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    sum += diff * diff;
  }
  return Math.sqrt(sum / Math.max(1, length));
}
