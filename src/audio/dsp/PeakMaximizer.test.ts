import { describe, expect, it } from "vitest";
import {
  estimatePeakMaximizerMemoryBytes,
  processPeakMaximizerOffline,
  resolvePeakMaximizerMemoryPlan,
  resolvePeakMaximizerParams,
} from "./PeakMaximizer";

describe("PeakMaximizer offline DSP", () => {
  it("keeps silence stable and finite", () => {
    const input = makeAudioBufferLike([new Float32Array(128), new Float32Array(128)]);
    const result = processPeakMaximizerOffline(input, {});

    expect(result.buffer.numberOfChannels).toBe(2);
    expect(result.buffer.length).toBe(128);
    expect(result.report.limitedSamples).toBe(0);
    expect(result.report.maxGainReductionDb).toBe(0);
    expect(result.buffer.getChannelData(0).every((sample) => sample === 0)).toBe(true);
  });

  it("limits a hot stereo buffer below the selected ceiling", () => {
    const left = new Float32Array([0.2, 0.72, 1.1, -1.15, 0.35]);
    const right = new Float32Array([0.1, -0.7, 1.08, -1.1, 0.2]);
    const result = processPeakMaximizerOffline(makeAudioBufferLike([left, right]), {
      inputDriveDb: 3,
      ceilingDb: -1,
      lookaheadMs: 1,
      releaseMs: 80,
      truePeakGuard: true,
      oversample: "4x",
    });

    expect(result.report.outputPeakDb).toBeLessThanOrEqual(-0.95);
    expect(result.report.truePeakEstimateDb).toBeLessThanOrEqual(-0.95);
    expect(result.report.maxGainReductionDb).toBeGreaterThan(0);
  });

  it("uses auto drive without exceeding the configured max auto drive", () => {
    const quiet = sineBuffer(440, 0.03, 48000, 4800);
    const result = processPeakMaximizerOffline(quiet, {
      inputDriveDb: 1.5,
      autoDrive: true,
      targetLufs: -10,
      maxAutoDriveDb: 4,
    });

    expect(result.report.appliedDriveDb).toBeGreaterThanOrEqual(1.5);
    expect(result.report.appliedDriveDb).toBeLessThanOrEqual(5.5);
  });

  it("links stereo reduction when stereoLink is high", () => {
    const hotLeft = new Float32Array([0.95, 0.95, 0.95, 0.95, 0.95, 0.95]);
    const quietRight = new Float32Array([0.2, 0.2, 0.2, 0.2, 0.2, 0.2]);
    const linked = processPeakMaximizerOffline(makeAudioBufferLike([hotLeft, quietRight]), {
      inputDriveDb: 5,
      stereoLink: 1,
      ceilingDb: -1,
      lookaheadMs: 0.5,
      releaseMs: 30,
    });
    const unlinked = processPeakMaximizerOffline(makeAudioBufferLike([hotLeft, quietRight]), {
      inputDriveDb: 5,
      stereoLink: 0,
      ceilingDb: -1,
      lookaheadMs: 0.5,
      releaseMs: 30,
    });

    expect(rms(linked.buffer.getChannelData(1))).toBeLessThan(rms(unlinked.buffer.getChannelData(1)));
  });

  it("sanitizes unsafe parameter values", () => {
    const params = resolvePeakMaximizerParams({
      mode: "wild",
      inputDriveDb: 100,
      ceilingDb: 4,
      lookaheadMs: -10,
      releaseMs: 999,
      transientProtect: 5,
      stereoLink: -2,
      softClipGuard: 9,
      oversample: "16x",
    });

    expect(params.mode).toBe("clean");
    expect(params.inputDriveDb).toBe(9);
    expect(params.ceilingDb).toBe(-0.3);
    expect(params.lookaheadMs).toBe(0.5);
    expect(params.releaseMs).toBe(300);
    expect(params.transientProtect).toBe(1);
    expect(params.stereoLink).toBe(0);
    expect(params.softClipGuard).toBe(0.5);
    expect(params.oversample).toBe("4x");
  });

  it("downgrades true-peak oversampling when the memory budget is too small", () => {
    const estimate4x = estimatePeakMaximizerMemoryBytes(48000 * 120, 2, "4x");
    const plan = resolvePeakMaximizerMemoryPlan(48000 * 120, 2, "4x", {
      memoryBudgetBytes: estimate4x * 0.42,
    });

    expect(plan.memoryFallbackApplied).toBe(true);
    expect(plan.effectiveOversample).toBe("off");
    expect(plan.estimatedMemoryBytes).toBeLessThan(estimate4x);
  });

  it("estimates output AudioBuffer and unlinked lookahead memory in the plan", () => {
    const frames = 48000;
    const channels = 2;
    const linked = estimatePeakMaximizerMemoryBytes(frames, channels, "off", 1);
    const unlinked = estimatePeakMaximizerMemoryBytes(frames, channels, "off", 0);
    const fullChannelCopies = channels * frames * 4 * 3;

    expect(linked).toBeGreaterThan(fullChannelCopies);
    expect(unlinked).toBeGreaterThan(linked);
  });

  it("bypasses before allocating processing scratch when memory remains over budget", () => {
    const input = sineBuffer(220, 0.7, 48000, 1_200_000);
    const result = processPeakMaximizerOffline(input, {
      oversample: "off",
      stereoLink: 0,
      memoryBudgetBytes: 1,
      inputDriveDb: 6,
    });

    expect(result.buffer).toBe(input);
    expect(result.report.memoryExceeded).toBe(true);
    expect(result.report.memoryFallbackApplied).toBe(true);
    expect(result.report.appliedDriveDb).toBe(0);
    expect(result.report.limitedSamples).toBe(0);
  });

  it("reports memory fallback without changing buffer shape", () => {
    const input = sineBuffer(220, 0.7, 48000, 2048);
    const result = processPeakMaximizerOffline(input, {
      oversample: "4x",
      memoryBudgetBytes: 16 * 1024 * 1024,
    });

    expect(result.buffer.length).toBe(input.length);
    expect(result.buffer.numberOfChannels).toBe(input.numberOfChannels);
    expect(result.report.effectiveOversample).toBeDefined();
    expect(result.report.estimatedMemoryBytes).toBeGreaterThan(0);
  });

  it("keeps buffer shape when memory bypass is used", () => {
    const input = sineBuffer(330, 0.4, 48000, 1_200_000);
    const result = processPeakMaximizerOffline(input, {
      oversample: "off",
      stereoLink: 0,
      memoryBudgetBytes: 1,
    });

    expect(result.buffer.length).toBe(input.length);
    expect(result.buffer.numberOfChannels).toBe(input.numberOfChannels);
    expect(result.buffer.getChannelData(0)).toBe(input.getChannelData(0));
  });
});

function sineBuffer(frequency: number, amplitude: number, sampleRate: number, length: number) {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = Math.sin((Math.PI * 2 * frequency * index) / sampleRate) * amplitude;
    left[index] = sample;
    right[index] = sample;
  }
  return makeAudioBufferLike([left, right], sampleRate);
}

function makeAudioBufferLike(channels: Float32Array[], sampleRate = 48000): AudioBuffer {
  const length = channels.length === 0 ? 0 : Math.min(...channels.map((channel) => channel.length));
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => channels[channel] ?? channels[0] ?? new Float32Array(),
    copyFromChannel: (destination: Float32Array, channelNumber: number, startInChannel = 0) => {
      destination.set((channels[channelNumber] ?? new Float32Array()).subarray(startInChannel, startInChannel + destination.length));
    },
    copyToChannel: (source: Float32Array, channelNumber: number, startInChannel = 0) => {
      (channels[channelNumber] ?? channels[0])?.set(source, startInChannel);
    },
  } as AudioBuffer;
}

function rms(channel: Float32Array) {
  let sum = 0;
  for (const sample of channel) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, channel.length));
}
