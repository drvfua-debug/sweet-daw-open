import { describe, expect, it } from "vitest";
import {
  buildLowEndTranslatorCurve,
  processLowEndTranslatorBuffer,
  sanitizeLowEndTranslatorParams,
  shapeLowEndTranslatorSample,
} from "./lowEndTranslator";

describe("lowEndTranslator DSP", () => {
  it("sanitizes unsafe values into mobile-safe ranges", () => {
    const params = sanitizeLowEndTranslatorParams({
      amount: 9,
      drive: -2,
      lowCutHz: 5,
      translateHz: 999,
      subGuardDb: 4,
      mix: 3,
      outputDb: 12,
    });

    expect(params.amount).toBe(1);
    expect(params.drive).toBe(0);
    expect(params.lowCutHz).toBe(22);
    expect(params.translateHz).toBe(180);
    expect(params.subGuardDb).toBe(0);
    expect(params.mix).toBe(0.5);
    expect(params.outputDb).toBe(3);
  });

  it("keeps bypass-style mix dry apart from output trim", () => {
    const params = sanitizeLowEndTranslatorParams({ mix: 0, outputDb: 0 });
    expect(shapeLowEndTranslatorSample(0.25, params)).toBeCloseTo(0.25, 6);
  });

  it("builds a bounded waveshaper curve", () => {
    const curve = buildLowEndTranslatorCurve({ amount: 0.5, drive: 0.5 }, 128);
    expect(curve).toHaveLength(128);
    expect(Math.max(...Array.from(curve))).toBeLessThanOrEqual(1);
    expect(Math.min(...Array.from(curve))).toBeGreaterThanOrEqual(-1);
  });

  it("processes buffers without mutating when copy is true", () => {
    const input = [new Float32Array([0.1, -0.2, Number.NaN, 0.9])];
    const output = processLowEndTranslatorBuffer(input, { amount: 0.5, drive: 0.4, mix: 0.2 }, { copy: true });

    expect(output[0]).not.toBe(input[0]);
    expect(output[0]![2]).toBe(0);
    for (const sample of output[0]!) {
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });

  it("uses subGuardDb to reduce sub energy in buffer processing", () => {
    const sampleRate = 44100;
    const input = [sine(50, sampleRate, 1, 0.5)];
    const guarded = processLowEndTranslatorBuffer(input, { mix: 0.35, amount: 0.5, subGuardHz: 70, subGuardDb: -2.4, outputDb: 0 }, { copy: true, sampleRate });
    const open = processLowEndTranslatorBuffer(input, { mix: 0.35, amount: 0.5, subGuardHz: 70, subGuardDb: 0, outputDb: 0 }, { copy: true, sampleRate });

    expect(tonePower(guarded[0]!, 50, sampleRate)).toBeLessThan(tonePower(open[0]!, 50, sampleRate));
  });

  it("moves translated harmonic emphasis when translateHz changes", () => {
    const sampleRate = 44100;
    const input = [sine(58, sampleRate, 1, 0.7)];
    const lowTranslate = processLowEndTranslatorBuffer(input, { mix: 0.5, amount: 0.9, drive: 0.8, sourceLowHz: 58, translateHz: 95, upperHarmonicHz: 190, outputDb: 0 }, { copy: true, sampleRate });
    const highTranslate = processLowEndTranslatorBuffer(input, { mix: 0.5, amount: 0.9, drive: 0.8, sourceLowHz: 58, translateHz: 165, upperHarmonicHz: 280, outputDb: 0 }, { copy: true, sampleRate });

    expect(tonePower(lowTranslate[0]!, 95, sampleRate)).toBeGreaterThan(tonePower(highTranslate[0]!, 95, sampleRate));
    expect(tonePower(highTranslate[0]!, 165, sampleRate)).toBeGreaterThan(tonePower(lowTranslate[0]!, 165, sampleRate));
  });

  it("reduces low-frequency side content when monoSafe is enabled", () => {
    const sampleRate = 44100;
    const left = sine(60, sampleRate, 1, 0.45);
    const right = sine(60, sampleRate, 1, -0.45);
    const unsafe = processLowEndTranslatorBuffer([left, right], { mix: 0.35, amount: 0.5, monoSafe: false, outputDb: 0 }, { copy: true, sampleRate });
    const safe = processLowEndTranslatorBuffer([left, right], { mix: 0.35, amount: 0.5, monoSafe: true, outputDb: 0 }, { copy: true, sampleRate });

    expect(sideTonePower(safe[0]!, safe[1]!, 60, sampleRate)).toBeLessThan(sideTonePower(unsafe[0]!, unsafe[1]!, 60, sampleRate));
  });
});

function sine(freq: number, sampleRate: number, seconds: number, amp: number) {
  const length = Math.floor(sampleRate * seconds);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = Math.sin((2 * Math.PI * freq * index) / sampleRate) * amp;
  }
  return output;
}

function tonePower(channel: Float32Array, freq: number, sampleRate: number) {
  let real = 0;
  let imag = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const phase = (2 * Math.PI * freq * index) / sampleRate;
    real += (channel[index] ?? 0) * Math.cos(phase);
    imag -= (channel[index] ?? 0) * Math.sin(phase);
  }
  return (real * real + imag * imag) / Math.max(1, channel.length * channel.length);
}

function sideTonePower(left: Float32Array, right: Float32Array, freq: number, sampleRate: number) {
  const length = Math.min(left.length, right.length);
  const side = new Float32Array(length);
  for (let index = 0; index < length; index += 1) side[index] = ((left[index] ?? 0) - (right[index] ?? 0)) * 0.5;
  return tonePower(side, freq, sampleRate);
}
