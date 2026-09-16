import { describe, expect, it } from "vitest";
import { decodeAudioBlobBytes, decodePcmWavBytes, findWavHeaderOffset, sniffAudioContainer } from "./AudioDecode";

describe("AudioDecode", () => {
  it("sniffs wav files by RIFF/WAVE header", () => {
    const wav = makePcm16Wav([0, 0], 48000);
    expect(sniffAudioContainer(wav, "stem.bin", "application/octet-stream")).toBe("wav");
  });

  it("sniffs ADTS AAC without mislabeling it as MP3", () => {
    const adts = new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0x00, 0x1f, 0xfc, 0x00]).buffer;
    expect(sniffAudioContainer(adts, "2 Drums.wav", "audio/wav")).toBe("aac");
  });

  it("finds RIFF/WAVE after a leading ID3-style prefix", () => {
    const wav = new Uint8Array(makePcm16Wav([0, 1], 48000));
    const prefix = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0]);
    const wrapped = new Uint8Array(prefix.length + wav.length);
    wrapped.set(prefix, 0);
    wrapped.set(wav, prefix.length);
    expect(findWavHeaderOffset(wrapped.buffer)).toBe(prefix.length);
    expect(sniffAudioContainer(wrapped.buffer.slice(prefix.length), "2 Drums.wav", "audio/wav")).toBe("wav");
  });

  it("rejects corrupt WAV-named files with no RIFF header before browser decode", async () => {
    const corrupt = new Uint8Array(4096).fill(0xff).buffer;
    await expect(decodeAudioBlobBytes({} as BaseAudioContext, corrupt, "2 Drums.wav", "audio/wav")).rejects.toThrow(/no RIFF\/WAVE header/);
  });

  it("decodes PCM16 wav bytes without browser decodeAudioData", () => {
    const wav = makePcm16Wav([0, 32767, -32768], 48000);
    const decoded = decodePcmWavBytes(wav);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channelCount).toBe(1);
    expect(decoded.format).toBe("pcm");
    expect(decoded.channels[0]?.[0]).toBeCloseTo(0, 5);
    expect(decoded.channels[0]?.[1]).toBeCloseTo(0.9999, 3);
    expect(decoded.channels[0]?.[2]).toBeCloseTo(-1, 5);
  });

  it("decodes stereo float wav bytes", () => {
    const wav = makeFloat32Wav([
      [0.25, -0.5],
      [0.75, -1],
    ], 44100);
    const decoded = decodePcmWavBytes(wav);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channelCount).toBe(2);
    expect(decoded.format).toBe("float");
    expect(decoded.channels[0]?.[0]).toBeCloseTo(0.25, 5);
    expect(decoded.channels[1]?.[0]).toBeCloseTo(-0.5, 5);
    expect(decoded.channels[0]?.[1]).toBeCloseTo(0.75, 5);
    expect(decoded.channels[1]?.[1]).toBeCloseTo(-1, 5);
  });
});

function makePcm16Wav(samples: number[], sampleRate: number) {
  const channelCount = 1;
  const bitsPerSample = 16;
  const blockAlign = channelCount * (bitsPerSample / 8);
  const dataSize = samples.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return buffer;
}

function makeFloat32Wav(frames: Array<[number, number]>, sampleRate: number) {
  const channelCount = 2;
  const bitsPerSample = 32;
  const blockAlign = channelCount * (bitsPerSample / 8);
  const dataSize = frames.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  frames.forEach((frame, index) => {
    const offset = 44 + index * blockAlign;
    view.setFloat32(offset, frame[0], true);
    view.setFloat32(offset + 4, frame[1], true);
  });
  return buffer;
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
