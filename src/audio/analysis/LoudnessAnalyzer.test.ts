import { describe, expect, it } from "vitest";
import { analyzeAudioBufferLoudness, analyzeFloat32ChannelsLoudness } from "./LoudnessAnalyzer";

describe("analyzeAudioBufferLoudness", () => {
  it("handles silence without leaking NaN", () => {
    const analysis = analyzeAudioBufferLoudness(fakeBuffer([new Float32Array(48000)]));

    expect(analysis.integratedLufs).toBeNull();
    expect(analysis.samplePeakDbfs).toBe(-Infinity);
    expect(analysis.truePeakDbtp).toBe(-Infinity);
    expect(analysis.clippedSampleRatio).toBe(0);
    expect(Number.isNaN(analysis.dcOffset)).toBe(false);
  });

  it("reports a -6dBFS sine peak near -6dBFS", () => {
    const sampleRate = 48000;
    const channel = new Float32Array(sampleRate);
    const amp = 10 ** (-6 / 20);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.sin((2 * Math.PI * 1000 * index) / sampleRate) * amp;
    }

    const analysis = analyzeAudioBufferLoudness(fakeBuffer([channel], sampleRate));

    expect(analysis.samplePeakDbfs).toBeGreaterThan(-6.2);
    expect(analysis.samplePeakDbfs).toBeLessThan(-5.8);
    expect(analysis.integratedLufs).not.toBeNull();
  });

  it("detects stereo peaks and clipped sample ratio", () => {
    const left = new Float32Array([0, 1, -1, 0.5]);
    const right = new Float32Array([0, 0.25, -0.25, 0.1]);

    const analysis = analyzeAudioBufferLoudness(fakeBuffer([left, right], 4));

    expect(analysis.samplePeakDbfs).toBe(0);
    expect(analysis.truePeakDbtp).toBeGreaterThanOrEqual(0);
    expect(analysis.clippedSampleRatio).toBeGreaterThan(0);
  });

  it("keeps true peak at or above sample peak with streaming oversampling", () => {
    const channel = new Float32Array([0, 0.9, -0.9, 0.9, -0.9, 0]);
    const fast = analyzeAudioBufferLoudness(fakeBuffer([channel], 48000), { quality: "fast" });
    const hq = analyzeAudioBufferLoudness(fakeBuffer([channel], 48000), { quality: "mobile-hq" });

    expect(hq.truePeakDbtp).toBeGreaterThanOrEqual(hq.samplePeakDbfs);
    expect(hq.truePeakDbtp).toBeGreaterThanOrEqual(fast.truePeakDbtp);
  });

  it("analyzes Float32 channels without requiring an AudioBuffer", () => {
    const sampleRate = 48000;
    const left = new Float32Array(sampleRate);
    const right = new Float32Array(sampleRate);
    for (let index = 0; index < sampleRate; index += 1) {
      left[index] = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 0.2;
      right[index] = Math.sin((2 * Math.PI * 880 * index) / sampleRate) * 0.18;
    }

    const analysis = analyzeFloat32ChannelsLoudness([left, right], sampleRate, { quality: "offline-best" });

    expect(analysis.durationSec).toBe(1);
    expect(analysis.integratedLufs).not.toBeNull();
    expect(analysis.truePeakDbtp).toBeGreaterThanOrEqual(analysis.samplePeakDbfs);
  });
});

function fakeBuffer(channels: Float32Array[], sampleRate = 48000): AudioBuffer {
  return {
    sampleRate,
    length: channels[0]?.length ?? 0,
    duration: (channels[0]?.length ?? 0) / sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel] ?? channels[0] ?? new Float32Array(),
  } as AudioBuffer;
}
