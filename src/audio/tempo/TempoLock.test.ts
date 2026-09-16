import { describe, expect, it } from "vitest";
import { createTempoLockMap, mapTargetToSourceSec, renderTempoLockedBuffer } from "./TempoLock";

class TestAudioBuffer {
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
  private channels: Float32Array[];

  constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = options.length;
    this.numberOfChannels = options.numberOfChannels;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
    this.channels = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
  }

  getChannelData(channel: number) {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`Missing channel ${channel}`);
    return data;
  }
}

(globalThis as unknown as { AudioBuffer: typeof TestAudioBuffer }).AudioBuffer = TestAudioBuffer;

function makePulseBuffer(bpm = 120, seconds = 16, sampleRate = 24_000) {
  const buffer = new AudioBuffer({ length: seconds * sampleRate, numberOfChannels: 2, sampleRate });
  const beatSamples = Math.round((60 / bpm) * sampleRate);
  for (let sample = 0; sample < buffer.length; sample += beatSamples) {
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let offset = 0; offset < 120 && sample + offset < data.length; offset += 1) {
        data[sample + offset] = Math.max(data[sample + offset] ?? 0, 1 - offset / 120);
      }
    }
  }
  return buffer;
}

function countBadSamples(buffer: AudioBuffer) {
  let bad = 0;
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const value = data[index] ?? 0;
      if (!Number.isFinite(value)) bad += 1;
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return { bad, peak };
}

describe("TempoLock", () => {
  it("creates a bounded shared tempo map and renders finite audio", () => {
    const source = makePulseBuffer(118);
    const map = createTempoLockMap(source, { targetBpm: 120, mode: "tight", maxAnalysisSec: 16 });

    expect(map.targetBpm).toBe(120);
    expect(map.analysis.confidence).toBeGreaterThan(0.3);
    expect(map.analysis.maxWarpPercent).toBeLessThanOrEqual(7.5);
    expect(map.sourceAnchorsSec.length).toBe(map.targetAnchorsSec.length);
    for (let index = 1; index < map.targetAnchorsSec.length; index += 1) {
      expect(map.targetAnchorsSec[index]).toBeGreaterThan(map.targetAnchorsSec[index - 1]);
      expect(map.sourceAnchorsSec[index]).toBeGreaterThan(map.sourceAnchorsSec[index - 1]);
    }

    const locked = renderTempoLockedBuffer(source, map, { grainMs: 30, hopRatio: 0.5 });
    const stats = countBadSamples(locked);

    expect(locked.numberOfChannels).toBe(source.numberOfChannels);
    expect(locked.sampleRate).toBe(source.sampleRate);
    expect(locked.duration).toBeGreaterThan(0);
    expect(stats.bad).toBe(0);
    expect(stats.peak).toBeLessThanOrEqual(1.2);
  });

  it("maps target time monotonically back to source time", () => {
    const source = makePulseBuffer(95, 12);
    const map = createTempoLockMap(source, { targetBpm: 96, mode: "gentle", maxAnalysisSec: 12 });
    let previous = -Infinity;
    for (let sec = 0; sec < map.analysis.outputDurationSec; sec += 0.25) {
      const mapped = mapTargetToSourceSec(sec, map);
      expect(mapped).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = mapped;
    }
  });
});
