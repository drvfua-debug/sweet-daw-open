import type { DitherOptions, WavBitDepth } from "./WavEncoder";

export type WavStreamingEncoderOptions = {
  sampleRate: number;
  channels: number;
  bitDepth: WavBitDepth;
  dither: boolean | DitherOptions;
  normalizePeak?: false;
  totalFrames: number;
  silenceChunkFrames?: number;
  onChunkWritten?: (info: { frames: number; silent: boolean; bytes: number }) => void;
  maxBlobBytes?: number;
};

export type WavStreamingEncoder = {
  writeChunk: (channels: Float32Array[]) => void;
  finish: () => Blob;
  getWrittenFrames: () => number;
};

export type WavExportWriter = {
  storageMode: "opfs" | "memory";
  fallbackReason?: string;
  writeChunk: (channels: Float32Array[]) => Promise<void>;
  finish: () => Promise<Blob>;
  abort: () => Promise<void>;
  cleanup: () => Promise<void>;
  getWrittenFrames: () => number;
};

type OpfsWritable = {
  write: (data: ArrayBuffer) => Promise<void>;
  close: () => Promise<void>;
  abort?: () => Promise<void>;
};

type OpfsFileHandle = {
  createWritable: () => Promise<OpfsWritable>;
  getFile: () => Promise<File>;
};

type OpfsDirectory = {
  getFileHandle: (name: string, options: { create: true }) => Promise<OpfsFileHandle>;
  removeEntry: (name: string) => Promise<void>;
};

export const RIFF_HEADER_BYTES = 44;
const RIFF_UINT32_MAX = 0xffffffff;
export const MAX_RIFF_WAV_DATA_BYTES = RIFF_UINT32_MAX - 36;
const DEFAULT_MAX_BLOB_BYTES = Math.floor(1.8 * 1024 * 1024 * 1024);

export function createWavStreamingEncoder(options: WavStreamingEncoderOptions): WavStreamingEncoder {
  if (options.normalizePeak) {
    throw new Error("Streaming encoder does not normalize in one pass. Run a peak-scan pass first.");
  }

  const channelCount = Math.max(1, Math.round(options.channels));
  const sampleRate = Math.max(1, Math.round(options.sampleRate));
  const totalFrames = Math.max(0, Math.round(options.totalFrames));
  const bitDepth = options.bitDepth ?? "pcm16";
  const bytesPerSample = bitDepth === "pcm24" ? 3 : bitDepth === "float32" ? 4 : 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = totalFrames * blockAlign;
  assertWavDataBytes(dataBytes);
  const estimatedTotalBytes = RIFF_HEADER_BYTES + dataBytes;
  const maxBlobBytes = Math.max(RIFF_HEADER_BYTES, Math.floor(options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES));
  if (estimatedTotalBytes > maxBlobBytes) {
    throw new Error("WAV Blob export is too large for stable browser memory. Use a shorter export, lower bit depth, or stable/chunked export when available.");
  }
  const silenceChunkFrames = Math.max(1, Math.round(options.silenceChunkFrames ?? 65536));
  const parts: BlobPart[] = [createWavHeader({ sampleRate, channelCount, bitDepth, totalFrames })];
  const dither = resolveDitherOptions(bitDepth === "pcm16" ? options.dither : false);
  const ditherRandom = dither.seed == null ? Math.random : createSeededRandom(dither.seed);
  let writtenFrames = 0;
  let finished = false;

  return {
    writeChunk(channels) {
      if (finished) throw new Error("Cannot write to a finished WAV encoder.");
      if (writtenFrames >= totalFrames) return;

      const encoded = encodeWavChunk(channels, {
        channelCount,
        bitDepth,
        bytesPerSample,
        blockAlign,
        remainingFrames: totalFrames - writtenFrames,
        ditherRandom: dither.enabled ? ditherRandom : null,
      });
      if (encoded.frames <= 0) return;
      const chunkBuffer = encoded.buffer;
      const chunkFrames = encoded.frames;
      parts.push(chunkBuffer);
      writtenFrames += chunkFrames;
      if (options.onChunkWritten) {
        options.onChunkWritten({ frames: chunkFrames, silent: isSilentChunk(channels, chunkFrames), bytes: chunkBuffer.byteLength });
      }
    },
    finish() {
      if (!finished && writtenFrames < totalFrames) {
        while (!finished && writtenFrames < totalFrames) {
          const remaining = totalFrames - writtenFrames;
          const frames = Math.min(remaining, silenceChunkFrames);
          const silence = Array.from({ length: channelCount }, () => new Float32Array(frames));
          this.writeChunk(silence);
        }
      }
      finished = true;
      return new Blob(parts, { type: "audio/wav" });
    },
    getWrittenFrames() {
      return writtenFrames;
    },
  };
}

export async function createWavExportWriter(options: WavStreamingEncoderOptions): Promise<WavExportWriter> {
  if (options.normalizePeak) {
    throw new Error("Streaming writer does not normalize in one pass. Run a peak-scan pass first.");
  }
  const opfs = await tryCreateOpfsWavWriter(options);
  if (opfs) return opfs;

  const encoder = createWavStreamingEncoder(options);
  return {
    storageMode: "memory",
    fallbackReason: "OPFS streaming is unavailable; encoded WAV chunks are buffered in browser memory.",
    async writeChunk(channels) {
      encoder.writeChunk(channels);
    },
    async finish() {
      return encoder.finish();
    },
    async abort() {},
    async cleanup() {},
    getWrittenFrames: encoder.getWrittenFrames,
  };
}

async function tryCreateOpfsWavWriter(options: WavStreamingEncoderOptions): Promise<WavExportWriter | null> {
  if (typeof navigator === "undefined") return null;
  const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<OpfsDirectory> };
  if (typeof storage?.getDirectory !== "function") return null;

  const channelCount = Math.max(1, Math.round(options.channels));
  const sampleRate = Math.max(1, Math.round(options.sampleRate));
  const totalFrames = Math.max(0, Math.round(options.totalFrames));
  const bitDepth = options.bitDepth ?? "pcm16";
  const bytesPerSample = bitDepth === "pcm24" ? 3 : bitDepth === "float32" ? 4 : 2;
  const blockAlign = channelCount * bytesPerSample;
  assertWavDataBytes(totalFrames * blockAlign);
  const dither = resolveDitherOptions(bitDepth === "pcm16" ? options.dither : false);
  const ditherRandom = dither.seed == null ? Math.random : createSeededRandom(dither.seed);
  const silenceChunkFrames = Math.max(1, Math.round(options.silenceChunkFrames ?? 65536));
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const filename = `sweet-daw-export-${randomId}.wav`;

  let directory: OpfsDirectory;
  let writable: OpfsWritable;
  let fileHandle: OpfsFileHandle;
  try {
    directory = await storage.getDirectory();
    fileHandle = await directory.getFileHandle(filename, { create: true });
    writable = await fileHandle.createWritable();
    await writable.write(createWavHeader({ sampleRate, channelCount, bitDepth, totalFrames }));
  } catch {
    return null;
  }

  let writtenFrames = 0;
  let finished = false;
  let cleaned = false;

  const writeChunk = async (channels: Float32Array[]) => {
    if (finished) throw new Error("Cannot write to a finished WAV writer.");
    if (writtenFrames >= totalFrames) return;
    const encoded = encodeWavChunk(channels, {
      channelCount,
      bitDepth,
      bytesPerSample,
      blockAlign,
      remainingFrames: totalFrames - writtenFrames,
      ditherRandom: dither.enabled ? ditherRandom : null,
    });
    if (encoded.frames <= 0) return;
    await writable.write(encoded.buffer);
    writtenFrames += encoded.frames;
    options.onChunkWritten?.({
      frames: encoded.frames,
      silent: isSilentChunk(channels, encoded.frames),
      bytes: encoded.buffer.byteLength,
    });
  };

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await directory.removeEntry(filename);
    } catch {
      // The browser may remove temporary OPFS files during storage cleanup.
    }
  };

  return {
    storageMode: "opfs",
    async writeChunk(channels) {
      await writeChunk(channels);
    },
    async finish() {
      if (!finished && writtenFrames < totalFrames) {
        while (writtenFrames < totalFrames) {
          const frames = Math.min(totalFrames - writtenFrames, silenceChunkFrames);
          await writeChunk(Array.from({ length: channelCount }, () => new Float32Array(frames)));
        }
      }
      if (!finished) {
        finished = true;
        await writable.close();
      }
      return fileHandle.getFile();
    },
    async abort() {
      if (!finished) {
        finished = true;
        try {
          await writable.abort?.();
        } catch {
          // Cleanup below remains authoritative.
        }
      }
      await cleanup();
    },
    cleanup,
    getWrittenFrames() {
      return writtenFrames;
    },
  };
}

function encodeWavChunk(
  channels: Float32Array[],
  options: {
    channelCount: number;
    bitDepth: WavBitDepth;
    bytesPerSample: number;
    blockAlign: number;
    remainingFrames: number;
    ditherRandom: (() => number) | null;
  },
) {
  const chunkFrames = Math.min(
    options.remainingFrames,
    Math.max(0, Math.min(...Array.from(
      { length: options.channelCount },
      (_, index) => channels[index]?.length ?? channels[0]?.length ?? 0,
    ))),
  );
  const buffer = new ArrayBuffer(chunkFrames * options.blockAlign);
  if (chunkFrames <= 0) return { buffer, frames: 0 };
  const view = new DataView(buffer);
  let offset = 0;
  for (let frame = 0; frame < chunkFrames; frame += 1) {
    for (let channel = 0; channel < options.channelCount; channel += 1) {
      const source = channels[channel] ?? channels[0];
      offset = writeWavSample(
        view,
        offset,
        sanitizeSample(source?.[frame] ?? 0),
        options.bitDepth,
        options.bytesPerSample,
        options.ditherRandom,
      );
    }
  }
  return { buffer, frames: chunkFrames };
}

function createWavHeader(input: { sampleRate: number; channelCount: number; bitDepth: WavBitDepth; totalFrames: number }) {
  const bytesPerSample = input.bitDepth === "pcm24" ? 3 : input.bitDepth === "float32" ? 4 : 2;
  const blockAlign = input.channelCount * bytesPerSample;
  const byteRate = input.sampleRate * blockAlign;
  const dataBytes = input.totalFrames * blockAlign;
  assertWavDataBytes(dataBytes);
  const header = new ArrayBuffer(RIFF_HEADER_BYTES);
  const view = new DataView(header);
  const audioFormat = input.bitDepth === "float32" ? 3 : 1;
  const bitsPerSample = input.bitDepth === "pcm24" ? 24 : input.bitDepth === "float32" ? 32 : 16;

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, input.channelCount, true);
  view.setUint32(24, input.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  return header;
}

function assertWavDataBytes(dataBytes: number) {
  if (!Number.isFinite(dataBytes) || dataBytes > MAX_RIFF_WAV_DATA_BYTES) {
    throw new Error("WAV output is larger than the RIFF 4GB limit. Export a shorter range or lower sample rate/bit depth.");
  }
}

function writeWavSample(
  view: DataView,
  offset: number,
  value: number,
  bitDepth: WavBitDepth,
  bytesPerSample: number,
  ditherRandom: (() => number) | null,
) {
  let sourceValue = value;
  if (bitDepth === "float32") {
    view.setFloat32(offset, sourceValue, true);
    return offset + bytesPerSample;
  }

  // Preserve exact digital silence while retaining dither for non-zero PCM16
  // samples where quantization error can occur.
  if (bitDepth === "pcm16" && ditherRandom && sourceValue !== 0) {
    sourceValue += triangularPdfDither(ditherRandom) / 0x8000;
  }

  const clamped = Math.max(-1, Math.min(1, sourceValue));
  if (bitDepth === "pcm24") {
    const pcm = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7fffff);
    view.setUint8(offset, pcm & 0xff);
    view.setUint8(offset + 1, (pcm >> 8) & 0xff);
    view.setUint8(offset + 2, (pcm >> 16) & 0xff);
    return offset + bytesPerSample;
  }

  const pcm = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
  view.setInt16(offset, pcm, true);
  return offset + bytesPerSample;
}

function resolveDitherOptions(dither: boolean | DitherOptions): DitherOptions {
  if (typeof dither === "object" && dither != null) {
    return {
      enabled: Boolean(dither.enabled),
      seed: Number.isFinite(dither.seed) ? Number(dither.seed) : undefined,
    };
  }
  return {
    enabled: Boolean(dither),
  };
}

function triangularPdfDither(random: () => number) {
  return random() - random();
}

function createSeededRandom(seed: number) {
  let state = (Math.trunc(seed) >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function isSilentChunk(channels: Float32Array[], frames: number) {
  for (const channel of channels) {
    for (let index = 0; index < frames; index += 1) {
      if ((channel[index] ?? 0) !== 0) return false;
    }
  }
  return true;
}
