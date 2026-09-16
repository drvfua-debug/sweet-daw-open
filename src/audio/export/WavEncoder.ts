export type WavBitDepth = "pcm16" | "pcm24" | "float32";
export type DitherOptions = {
  enabled: boolean;
  seed?: number;
};

export type ChannelProvider = {
  sampleRate: number;
  channelCount: number;
  sampleCount: number;
  getChannelData(channel: number): Float32Array;
};

export type WavEncodeInput = {
  sampleRate: number;
  channels: Float32Array[];
  normalizePeak?: boolean;
  peakTargetDb?: number;
  bitDepth?: WavBitDepth;
  dither?: boolean | DitherOptions;
};

export type EncodeWavFromAudioBufferOptions = {
  normalizePeak?: boolean;
  peakTargetDb?: number;
  bitDepth?: WavBitDepth;
  dither?: boolean | DitherOptions;
};

const RIFF_HEADER_BYTES = 44;
const WAV_AUDIO_CHUNK_BYTES = 2 * 1024 * 1024;

export function encodeWavFromAudioBuffer(
  buffer: AudioBuffer,
  options: EncodeWavFromAudioBufferOptions = {},
) {
  return encodeWavFromChannelProvider({
    sampleRate: buffer.sampleRate,
    channelCount: buffer.numberOfChannels,
    sampleCount: buffer.length,
    getChannelData: (channel) => buffer.getChannelData(channel),
  }, {
    normalizePeak: options.normalizePeak ?? false,
    peakTargetDb: options.peakTargetDb ?? -1,
    bitDepth: options.bitDepth ?? "pcm16",
    dither: options.dither,
  });
}

export function encodePcm16Wav(input: WavEncodeInput) {
  return encodeWav({ ...input, bitDepth: "pcm16" });
}

export function encodeWav(input: WavEncodeInput) {
  return encodeWavFromChannelProvider({
    sampleRate: input.sampleRate,
    channelCount: input.channels.length,
    sampleCount: input.channels.length === 0 ? 0 : Math.min(...input.channels.map((channel) => channel.length)),
    getChannelData: (channel) => input.channels[channel] ?? new Float32Array(0),
  }, input);
}

export function encodeWavFromChannelProvider(
  provider: ChannelProvider,
  options: Pick<WavEncodeInput, "normalizePeak" | "peakTargetDb" | "bitDepth" | "dither"> = {},
) {
  const channelCount = Math.max(0, Math.floor(provider.channelCount));
  if (channelCount === 0) {
    throw new Error("Cannot encode WAV without audio channels.");
  }

  const channels = Array.from({ length: channelCount }, (_, channel) => provider.getChannelData(channel));
  const providerSampleCount = Number.isFinite(provider.sampleCount) ? Math.floor(provider.sampleCount) : Infinity;
  const sampleCount = Math.max(0, Math.min(providerSampleCount, ...channels.map((channel) => channel.length)));
  const bitDepth = options.bitDepth ?? "pcm16";
  const bytesPerSample = bitDepth === "pcm24" ? 3 : bitDepth === "float32" ? 4 : 2;
  const blockAlign = channelCount * bytesPerSample;
  const byteRate = provider.sampleRate * blockAlign;
  const dataBytes = sampleCount * blockAlign;
  const header = new ArrayBuffer(RIFF_HEADER_BYTES);
  const view = new DataView(header);
  const peakGain = options.normalizePeak ? computePeakGain(channels, sampleCount, options.peakTargetDb ?? -1) : 1;
  const audioFormat = bitDepth === "float32" ? 3 : 1;
  const bitsPerSample = bitDepth === "pcm24" ? 24 : bitDepth === "float32" ? 32 : 16;
  const dither = resolveDitherOptions(bitDepth === "pcm16" ? options.dither : false);
  const ditherRandom = dither.seed == null ? Math.random : createSeededRandom(dither.seed);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, provider.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const parts: BlobPart[] = [header];
  const framesPerChunk = Math.max(1, Math.floor(WAV_AUDIO_CHUNK_BYTES / blockAlign));
  for (let chunkStart = 0; chunkStart < sampleCount; chunkStart += framesPerChunk) {
    const chunkFrames = Math.min(framesPerChunk, sampleCount - chunkStart);
    const chunkBuffer = new ArrayBuffer(chunkFrames * blockAlign);
    const chunkView = new DataView(chunkBuffer);
    let offset = 0;

    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const sample = chunkStart + frame;
      for (let channel = 0; channel < channelCount; channel += 1) {
        offset = writeWavSample(
          chunkView,
          offset,
          (channels[channel]?.[sample] ?? 0) * peakGain,
          bitDepth,
          bytesPerSample,
          dither.enabled ? ditherRandom : null,
        );
      }
    }

    parts.push(chunkBuffer);
  }

  return new Blob(parts, { type: "audio/wav" });
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

  // Digital zero is exactly representable, so adding dither there only creates
  // audible hiss in silent intros, gaps, and tails.
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

function resolveDitherOptions(dither: WavEncodeInput["dither"]): DitherOptions {
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

function computePeakGain(channels: Float32Array[], sampleCount: number, targetDb: number) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < sampleCount; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }

  if (peak <= 0) return 1;

  const target = 10 ** (targetDb / 20);
  return Math.min(16, target / peak);
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
