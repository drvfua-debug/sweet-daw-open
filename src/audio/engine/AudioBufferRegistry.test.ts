import { describe, expect, it } from "vitest";
import { AudioBufferRegistry } from "./AudioBufferRegistry";

describe("AudioBufferRegistry memory controls", () => {
  it("releases individual buffers and reports lightweight stats", () => {
    const registry = new AudioBufferRegistry();
    const first = registry.registerRenderedBuffer("first.wav", makeAudioBufferLike(2, 128));
    const second = registry.registerRenderedBuffer("second.wav", makeAudioBufferLike(1, 64));

    expect(registry.getStats()).toMatchObject({
      bufferCount: 2,
      sourceFileCount: 0,
      estimatedPcmBytes: (2 * 128 + 1 * 64) * 4,
    });

    expect(registry.release(first.fileRef.id)).toBe(true);
    expect(registry.getBuffer(first.fileRef.id)).toBeNull();
    expect(registry.getBuffer(second.fileRef.id)).toBe(second.buffer);
    expect(registry.release(first.fileRef.id)).toBe(false);
  });

  it("releases unused buffers while keeping active ids", () => {
    const registry = new AudioBufferRegistry();
    const active = registry.registerRenderedBuffer("active.wav", makeAudioBufferLike(2, 16));
    const staleA = registry.registerRenderedBuffer("stale-a.wav", makeAudioBufferLike(2, 16));
    const staleB = registry.registerRenderedBuffer("stale-b.wav", makeAudioBufferLike(2, 16));

    expect(registry.releaseUnused([active.fileRef.id])).toBe(2);
    expect(registry.getBuffer(active.fileRef.id)).toBe(active.buffer);
    expect(registry.getBuffer(staleA.fileRef.id)).toBeNull();
    expect(registry.getBuffer(staleB.fileRef.id)).toBeNull();
    expect(registry.getStats().bufferCount).toBe(1);
  });

  it("can release decoded PCM while retaining the source file for later restore", () => {
    const registry = new AudioBufferRegistry();
    const sourceFile = Object.assign(new Blob([new Uint8Array(16)], { type: "audio/wav" }), {
      name: "reference.wav",
      lastModified: 0,
    }) as File;
    const asset = registry.register(sourceFile, makeAudioBufferLike(2, 128));

    expect(registry.releaseDecodedBuffer(asset.fileRef.id)).toBe(true);
    expect(registry.getBuffer(asset.fileRef.id)).toBeNull();
    expect(registry.getFile(asset.fileRef.id)).toBe(sourceFile);
    expect(registry.getStats()).toMatchObject({ bufferCount: 0, sourceFileCount: 1 });
  });
});

function makeAudioBufferLike(numberOfChannels: number, length: number, sampleRate = 48000): AudioBuffer {
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  return {
    numberOfChannels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (channel: number) => channels[channel] ?? channels[0] ?? new Float32Array(length),
    copyFromChannel: (destination: Float32Array, channelNumber: number, startInChannel = 0) => {
      destination.set((channels[channelNumber] ?? channels[0] ?? new Float32Array()).subarray(startInChannel, startInChannel + destination.length));
    },
    copyToChannel: (source: Float32Array, channelNumber: number, startInChannel = 0) => {
      (channels[channelNumber] ?? channels[0])?.set(source, startInChannel);
    },
  } as AudioBuffer;
}
