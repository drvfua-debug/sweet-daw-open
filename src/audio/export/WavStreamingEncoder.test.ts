import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RIFF_WAV_DATA_BYTES, createWavExportWriter, createWavStreamingEncoder } from "./WavStreamingEncoder";

function readAscii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("createWavStreamingEncoder", () => {
  it("writes a valid WAV header without keeping a full channel array", async () => {
    const encoder = createWavStreamingEncoder({
      sampleRate: 48000,
      channels: 2,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: 4,
    });

    encoder.writeChunk([Float32Array.from([1, 0]), Float32Array.from([0, -1])]);
    encoder.writeChunk([Float32Array.from([0.5, -0.5]), Float32Array.from([0.25, -0.25])]);
    const bytes = new Uint8Array(await encoder.finish().arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(readAscii(bytes, 0, 4)).toBe("RIFF");
    expect(readAscii(bytes, 8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(16);
    expect(encoder.getWrittenFrames()).toBe(4);
  });

  it("pads short writes with silence to the declared frame count", async () => {
    const encoder = createWavStreamingEncoder({
      sampleRate: 44100,
      channels: 1,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: 3,
    });

    encoder.writeChunk([Float32Array.from([0.5])]);
    const view = new DataView(await encoder.finish().arrayBuffer());

    expect(encoder.getWrittenFrames()).toBe(3);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(44, true)).toBeGreaterThan(15000);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(0);
  });

  it("pads finish silence in bounded chunks", async () => {
    const written: Array<{ frames: number; silent: boolean; bytes: number }> = [];
    const encoder = createWavStreamingEncoder({
      sampleRate: 44100,
      channels: 2,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: 10,
      silenceChunkFrames: 3,
      onChunkWritten: (chunk) => written.push(chunk),
    });

    encoder.writeChunk([Float32Array.from([0.25]), Float32Array.from([-0.25])]);
    await encoder.finish().arrayBuffer();

    expect(encoder.getWrittenFrames()).toBe(10);
    expect(written.map((chunk) => chunk.frames)).toEqual([1, 3, 3, 3]);
    expect(written.slice(1).every((chunk) => chunk.silent && chunk.bytes <= 12)).toBe(true);
  });

  it("keeps exact PCM16 digital silence at zero when dither is enabled", async () => {
    const encoder = createWavStreamingEncoder({
      sampleRate: 44100,
      channels: 1,
      bitDepth: "pcm16",
      dither: { enabled: true, seed: 1234 },
      totalFrames: 8,
    });

    encoder.writeChunk([new Float32Array(8)]);
    const bytes = new Uint8Array(await encoder.finish().arrayBuffer());
    const view = new DataView(bytes.buffer);
    for (let offset = 44; offset < bytes.length; offset += 2) {
      expect(view.getInt16(offset, true)).toBe(0);
    }
  });

  it("throws when RIFF WAV data exceeds 4GB", () => {
    expect(() => createWavStreamingEncoder({
      sampleRate: 48000,
      channels: 2,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: Math.floor(MAX_RIFF_WAV_DATA_BYTES / 4) + 1,
      maxBlobBytes: Number.POSITIVE_INFINITY,
    })).toThrow(/RIFF 4GB limit/);
  });

  it("throws when estimated Blob output exceeds maxBlobBytes", () => {
    expect(() => createWavStreamingEncoder({
      sampleRate: 48000,
      channels: 2,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: 1024,
      maxBlobBytes: 1024,
    })).toThrow(/too large for stable browser memory/);
  });

  it("supports 24-bit and float32 output headers", async () => {
    const pcm24 = createWavStreamingEncoder({
      sampleRate: 44100,
      channels: 1,
      bitDepth: "pcm24",
      dither: false,
      totalFrames: 2,
    });
    pcm24.writeChunk([Float32Array.from([0, 0])]);
    const pcm24View = new DataView(await pcm24.finish().arrayBuffer());
    expect(pcm24View.getUint16(34, true)).toBe(24);
    expect(pcm24View.getUint32(40, true)).toBe(6);

    const float32 = createWavStreamingEncoder({
      sampleRate: 44100,
      channels: 1,
      bitDepth: "float32",
      dither: false,
      totalFrames: 2,
    });
    float32.writeChunk([Float32Array.from([0, 0])]);
    const float32View = new DataView(await float32.finish().arrayBuffer());
    expect(float32View.getUint16(20, true)).toBe(3);
    expect(float32View.getUint16(34, true)).toBe(32);
    expect(float32View.getUint32(40, true)).toBe(8);
  });
});

describe("createWavExportWriter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the async chunk writer valid when OPFS is unavailable", async () => {
    const writer = await createWavExportWriter({
      sampleRate: 48000,
      channels: 2,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: 4,
    });

    await writer.writeChunk([Float32Array.from([1, 0]), Float32Array.from([0, -1])]);
    await writer.writeChunk([Float32Array.from([0.5, -0.5]), Float32Array.from([0.25, -0.25])]);
    const bytes = new Uint8Array(await (await writer.finish()).arrayBuffer());

    expect(readAscii(bytes, 0, 4)).toBe("RIFF");
    expect(readAscii(bytes, 8, 4)).toBe("WAVE");
    expect(writer.getWrittenFrames()).toBe(4);
    await writer.cleanup();
  });

  it("writes chunks to OPFS instead of accumulating the final WAV in RAM", async () => {
    const parts: ArrayBuffer[] = [];
    let removed = false;
    vi.stubGlobal("navigator", {
      storage: {
        getDirectory: async () => ({
          getFileHandle: async () => ({
            createWritable: async () => ({
              write: async (data: ArrayBuffer) => {
                parts.push(data.slice(0));
              },
              close: async () => {},
              abort: async () => {},
            }),
            getFile: async () => new Blob(parts, { type: "audio/wav" }) as File,
          }),
          removeEntry: async () => {
            removed = true;
          },
        }),
      },
    });
    const writer = await createWavExportWriter({
      sampleRate: 48000,
      channels: 2,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: 4,
    });

    expect(writer.storageMode).toBe("opfs");
    await writer.writeChunk([Float32Array.from([1, 0, 0.5, -0.5]), Float32Array.from([0, -1, 0.25, -0.25])]);
    const bytes = new Uint8Array(await (await writer.finish()).arrayBuffer());
    expect(readAscii(bytes, 0, 4)).toBe("RIFF");
    expect(bytes.byteLength).toBe(60);
    await writer.cleanup();
    expect(removed).toBe(true);
  });
});
