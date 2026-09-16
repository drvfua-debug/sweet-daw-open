import { describe, expect, it } from "vitest";
import { analyzeSingleFileMastering, processSingleFileMastering, resolveSingleFileMasteringSettings } from "./singleFileMastering";
import { cropStreamingMasterChunk } from "./StreamingMasterProcessor";

const SAMPLE_RATE = 48000;

function createSignal(seconds: number) {
  const frames = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = 0.12 + 0.07 * Math.max(0, Math.sin(time * 1.7));
    left[index] = (Math.sin(2 * Math.PI * 180 * time) * 0.52 + Math.sin(2 * Math.PI * 3100 * time) * 0.24 + Math.sin(2 * Math.PI * 7600 * time) * 0.1) * envelope;
    right[index] = (Math.sin(2 * Math.PI * 210 * time) * 0.48 + Math.sin(2 * Math.PI * 2800 * time) * 0.2 + Math.sin(2 * Math.PI * 8300 * time) * 0.12) * envelope;
  }
  return [left, right];
}

function createParitySettings() {
  return resolveSingleFileMasteringSettings("lightMaster", {
    stages: {
      safetyHpf: true,
      tiltBalance: true,
      toneCleanup: true,
      harshnessGuard: true,
      glueCompression: true,
      preLimiterClipper: true,
      targetLoudness: false,
      truePeakLimiter: true,
    },
  });
}

function processChunked(input: Float32Array[], paddingFrames: number) {
  const chunkFrames = SAMPLE_RATE * 3;
  const output = input.map((channel) => new Float32Array(channel.length));
  const settings = createParitySettings();
  for (let start = 0; start < input[0]!.length; start += chunkFrames) {
    const end = Math.min(input[0]!.length, start + chunkFrames);
    const paddedStart = Math.max(0, start - paddingFrames);
    const paddedEnd = Math.min(input[0]!.length, end + Math.min(paddingFrames, Math.floor(SAMPLE_RATE * 0.15)));
    const padded = input.map((channel) => channel.slice(paddedStart, paddedEnd));
    const processed = processSingleFileMastering(padded, SAMPLE_RATE, settings, { quality: "fast" }).channels;
    const stable = cropStreamingMasterChunk(processed, {
      cropStartFrame: start - paddedStart,
      cropFrameCount: end - start,
    });
    stable.forEach((channel, channelIndex) => output[channelIndex]!.set(channel, start));
  }
  return output;
}

function boundaryClickScore(channels: Float32Array[]) {
  const chunkFrames = SAMPLE_RATE * 3;
  let worst = 0;
  for (let boundary = chunkFrames; boundary < channels[0]!.length; boundary += chunkFrames) {
    for (const channel of channels) {
      const before = channel[boundary - 2] ?? 0;
      const previous = channel[boundary - 1] ?? 0;
      const current = channel[boundary] ?? 0;
      const after = channel[boundary + 1] ?? current;
      const expectedSlope = ((previous - before) + (after - current)) * 0.5;
      const boundarySlope = current - previous;
      worst = Math.max(worst, Math.abs(boundarySlope - expectedSlope));
    }
  }
  return worst;
}

describe("Streaming Master padded chunks", () => {
  it("reduces chunk-boundary discontinuity without changing output length", () => {
    const input = createSignal(12);
    const unpadded = processChunked(input, 0);
    const padded = processChunked(input, Math.floor(SAMPLE_RATE * 0.75));
    const full = processSingleFileMastering(input, SAMPLE_RATE, createParitySettings(), { quality: "fast" }).channels;
    const fullMetrics = analyzeSingleFileMastering(full, SAMPLE_RATE);
    const paddedMetrics = analyzeSingleFileMastering(padded, SAMPLE_RATE);

    expect(padded.map((channel) => channel.length)).toEqual(input.map((channel) => channel.length));
    expect(boundaryClickScore(padded)).toBeLessThanOrEqual(boundaryClickScore(unpadded));
    expect(Math.abs(paddedMetrics.estimatedLufs - fullMetrics.estimatedLufs)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(paddedMetrics.estimatedTruePeakDb - fullMetrics.estimatedTruePeakDb)).toBeLessThanOrEqual(0.35);
  });
});
