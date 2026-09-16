import { describe, expect, it } from "vitest";
import { encodePcm16Wav, encodeWavFromAudioBuffer } from "./WavEncoder";

function readAscii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe("encodePcm16Wav", () => {
  it("writes a valid PCM16 WAV header", async () => {
    const blob = encodePcm16Wav({
      sampleRate: 44100,
      channels: [Float32Array.from([0, 0.5, -0.5])],
    });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);

    expect(readAscii(bytes, 0, 4)).toBe("RIFF");
    expect(readAscii(bytes, 8, 4)).toBe("WAVE");
    expect(readAscii(bytes, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(readAscii(bytes, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
  });

  it("interleaves stereo channels", async () => {
    const blob = encodePcm16Wav({
      sampleRate: 48000,
      channels: [Float32Array.from([1, 0]), Float32Array.from([0, -1])],
    });

    const view = new DataView(await blob.arrayBuffer());
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(0);
    expect(view.getInt16(50, true)).toBe(-32768);
  });
});

describe("encodeWavFromAudioBuffer", () => {
  it("keeps dither separate from normalizePeak in the object options API", async () => {
    const quiet = makeAudioBufferLike([0.05, -0.05]);
    const blob = encodeWavFromAudioBuffer(quiet, {
      normalizePeak: false,
      dither: false,
      bitDepth: "pcm16",
      peakTargetDb: -1,
    });

    const view = new DataView(await blob.arrayBuffer());
    expect(Math.abs(view.getInt16(44, true))).toBeLessThan(2500);
  });

  it("normalizes only when normalizePeak is explicitly enabled", async () => {
    const quiet = makeAudioBufferLike([0.05, -0.05]);
    const blob = encodeWavFromAudioBuffer(quiet, {
      normalizePeak: true,
      dither: false,
      bitDepth: "pcm16",
      peakTargetDb: -1,
    });

    const view = new DataView(await blob.arrayBuffer());
    expect(Math.abs(view.getInt16(44, true))).toBeGreaterThan(25000);
  });

  it("reads AudioBuffer channel data by reference without repeated channel copies", async () => {
    const samples = Float32Array.from([0.1, -0.1, 0.2]);
    let reads = 0;
    const buffer = {
      sampleRate: 44100,
      numberOfChannels: 1,
      length: samples.length,
      getChannelData: () => {
        reads += 1;
        return samples;
      },
    } as unknown as AudioBuffer;

    await encodeWavFromAudioBuffer(buffer, { bitDepth: "pcm16" }).arrayBuffer();
    expect(reads).toBe(1);
  });

  it("ignores dither for PCM24 exports", async () => {
    const quiet = makeAudioBufferLike([0.05, -0.05]);
    const withoutDither = new Uint8Array(await encodeWavFromAudioBuffer(quiet, {
      bitDepth: "pcm24",
      dither: false,
    }).arrayBuffer());
    const withDither = new Uint8Array(await encodeWavFromAudioBuffer(quiet, {
      bitDepth: "pcm24",
      dither: { enabled: true, seed: 999 },
    }).arrayBuffer());

    expect(Array.from(withDither)).toEqual(Array.from(withoutDither));
  });
});

describe("encodeWav", () => {
  it("can make PCM16 dither deterministic with a seed", async () => {
    const input = {
      sampleRate: 44100,
      channels: [Float32Array.from([0, 0, 0, 0])],
      bitDepth: "pcm16" as const,
      dither: { enabled: true, seed: 1234 },
    };
    const first = new Uint8Array(await encodePcm16Wav(input).arrayBuffer());
    const second = new Uint8Array(await encodePcm16Wav(input).arrayBuffer());

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("keeps exact PCM16 digital silence at zero when dither is enabled", async () => {
    const bytes = new Uint8Array(await encodePcm16Wav({
      sampleRate: 44100,
      channels: [new Float32Array(8)],
      bitDepth: "pcm16",
      dither: { enabled: true, seed: 1234 },
    }).arrayBuffer());
    const view = new DataView(bytes.buffer);

    for (let offset = 44; offset < bytes.length; offset += 2) {
      expect(view.getInt16(offset, true)).toBe(0);
    }
  });
});

function makeAudioBufferLike(samples: number[]): AudioBuffer {
  const data = Float32Array.from(samples);
  return {
    sampleRate: 44100,
    numberOfChannels: 1,
    length: data.length,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}
