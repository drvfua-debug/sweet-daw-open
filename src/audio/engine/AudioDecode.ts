export type AudioContainerKind = "wav" | "mp3" | "mp4" | "aac" | "aiff" | "flac" | "ogg" | "unknown";

export class AudioImportDecodeError extends Error {
  constructor(
    message: string,
    readonly fileName: string,
    readonly kind: AudioContainerKind,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AudioImportDecodeError";
  }
}

export type PcmWavData = {
  sampleRate: number;
  channelCount: number;
  channels: Float32Array[];
  bitDepth: number;
  format: "pcm" | "float";
};

const AUDIO_EXTENSIONS = new Set(["wav", "wave", "mp3", "m4a", "mp4", "aac", "aif", "aiff", "flac", "ogg"]);

export async function decodeAudioFile(context: BaseAudioContext, file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return decodeAudioBlobBytes(context, arrayBuffer, file.name, file.type);
}

export async function decodeAudioBlob(context: BaseAudioContext, blob: Blob, fileName: string, mimeType?: string): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return decodeAudioBlobBytes(context, arrayBuffer, fileName, mimeType ?? blob.type);
}

export async function decodeAudioBlobBytes(
  context: BaseAudioContext,
  arrayBuffer: ArrayBuffer,
  fileName: string,
  mimeType?: string,
): Promise<AudioBuffer> {
  const wavOffset = findWavHeaderOffset(arrayBuffer);
  const shouldDecodeAsOffsetWav = wavOffset > 0 && hasWavHint(fileName, mimeType);
  const decodeBytes = shouldDecodeAsOffsetWav ? arrayBuffer.slice(wavOffset) : arrayBuffer;
  const kind = sniffAudioContainer(decodeBytes, fileName, mimeType);
  if (arrayBuffer.byteLength < 12) {
    throw new AudioImportDecodeError(`${fileName}: audio file is empty or too small to decode.`, fileName, kind);
  }
  if (kind === "unknown" && !isPotentialAudioFile(fileName, mimeType)) {
    throw new AudioImportDecodeError(
      `${fileName}: this does not look like an audio file. Use WAV, MP3, M4A/AAC, AIFF, or a ZIP containing those files.`,
      fileName,
      kind,
    );
  }

  if (kind === "wav" && hasWavHint(fileName, mimeType) && findWavHeaderOffset(arrayBuffer) < 0) {
    const fill = detectRepeatedByteFill(arrayBuffer);
    const fillMessage = fill == null ? "" : ` The sampled bytes are filled with 0x${fill.toString(16).padStart(2, "0").toUpperCase()}, so this file is probably corrupt or incomplete.`;
    throw new AudioImportDecodeError(
      `${fileName}: this file is named WAV, but it has no RIFF/WAVE header.${fillMessage} Re-download/export this stem as a real PCM WAV and import again.`,
      fileName,
      kind,
    );
  }

  try {
    return await context.decodeAudioData(decodeBytes.slice(0));
  } catch (error) {
    if (kind === "wav") {
      try {
        return createAudioBufferFromPcmWav(context, decodePcmWavBytes(decodeBytes));
      } catch (wavError) {
        throw new AudioImportDecodeError(buildDecodeFailureMessage(fileName, kind, error, wavError), fileName, kind, error);
      }
    }
    throw new AudioImportDecodeError(buildDecodeFailureMessage(fileName, kind, error), fileName, kind, error);
  }
}

export function sniffAudioContainer(arrayBuffer: ArrayBuffer, fileName = "", mimeType = ""): AudioContainerKind {
  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, 256));
  const tag = ascii(bytes, 0, 4);
  if ((tag === "RIFF" || tag === "RF64") && ascii(bytes, 8, 4) === "WAVE") return "wav";
  if (tag === "FORM" && (ascii(bytes, 8, 4) === "AIFF" || ascii(bytes, 8, 4) === "AIFC")) return "aiff";
  if (tag === "fLaC") return "flac";
  if (tag === "OggS") return "ogg";
  if (ascii(bytes, 4, 4) === "ftyp") return "mp4";
  if (isAdtsAacHeader(bytes)) return "aac";
  if (ascii(bytes, 0, 3) === "ID3") {
    const id3End = getId3v2EndOffset(bytes);
    if (hasWavHint(fileName, mimeType) && findWavHeaderOffset(arrayBuffer) > 0) return "wav";
    if (isMpegAudioFrame(bytes, id3End) || getExtension(fileName) === "mp3" || /mpeg|mp3/i.test(mimeType)) return "mp3";
    return getExtension(fileName) === "wav" || /wav|wave/i.test(mimeType) ? "wav" : "unknown";
  }
  if (isMpegAudioFrame(bytes)) return "mp3";

  const extension = getExtension(fileName);
  if (extension === "wav" || extension === "wave") return "wav";
  if (extension === "mp3") return "mp3";
  if (extension === "m4a" || extension === "mp4") return "mp4";
  if (extension === "aac") return "aac";
  if (extension === "aif" || extension === "aiff") return "aiff";
  if (extension === "flac") return "flac";
  if (extension === "ogg") return "ogg";

  if (/wav|wave/i.test(mimeType)) return "wav";
  if (/mpeg|mp3/i.test(mimeType)) return "mp3";
  if (/mp4|m4a/i.test(mimeType)) return "mp4";
  if (/aac/i.test(mimeType)) return "aac";
  if (/aiff|aif/i.test(mimeType)) return "aiff";
  if (/flac/i.test(mimeType)) return "flac";
  if (/ogg/i.test(mimeType)) return "ogg";
  return "unknown";
}

export function decodePcmWavBytes(arrayBuffer: ArrayBuffer): PcmWavData {
  const view = new DataView(arrayBuffer);
  if (asciiView(view, 0, 4) !== "RIFF" && asciiView(view, 0, 4) !== "RF64") throw new Error("Missing RIFF header.");
  if (asciiView(view, 8, 4) !== "WAVE") throw new Error("Missing WAVE header.");

  let offset = 12;
  let audioFormat = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let blockAlign = 0;
  let bitDepth = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = asciiView(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkDataOffset + chunkSize > view.byteLength) break;

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(chunkDataOffset, true);
      channelCount = view.getUint16(chunkDataOffset + 2, true);
      sampleRate = view.getUint32(chunkDataOffset + 4, true);
      blockAlign = view.getUint16(chunkDataOffset + 12, true);
      bitDepth = view.getUint16(chunkDataOffset + 14, true);
      if (audioFormat === 0xfffe && chunkSize >= 40) {
        const subFormat = view.getUint16(chunkDataOffset + 24, true);
        if (subFormat === 1 || subFormat === 3) audioFormat = subFormat;
      }
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!channelCount || !sampleRate || !blockAlign || !bitDepth) throw new Error("WAV fmt chunk is missing or invalid.");
  if (dataOffset < 0 || dataSize <= 0) throw new Error("WAV data chunk is missing.");
  if (audioFormat !== 1 && audioFormat !== 3) throw new Error(`Unsupported WAV codec ${audioFormat}. Only PCM and float WAV are supported.`);
  if (![8, 16, 24, 32, 64].includes(bitDepth)) throw new Error(`Unsupported WAV bit depth ${bitDepth}.`);
  if (audioFormat === 1 && bitDepth === 64) throw new Error("64-bit integer WAV is not supported.");

  const bytesPerSample = Math.ceil(bitDepth / 8);
  const expectedBlockAlign = bytesPerSample * channelCount;
  if (blockAlign < expectedBlockAlign) throw new Error("WAV block align is invalid.");

  const frameCount = Math.floor(dataSize / blockAlign);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = dataOffset + frame * blockAlign;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sampleOffset = frameOffset + channel * bytesPerSample;
      channels[channel][frame] = readWavSample(view, sampleOffset, bitDepth, audioFormat);
    }
  }

  return {
    sampleRate,
    channelCount,
    channels,
    bitDepth,
    format: audioFormat === 3 ? "float" : "pcm",
  };
}

function createAudioBufferFromPcmWav(context: BaseAudioContext, wav: PcmWavData): AudioBuffer {
  const buffer = context.createBuffer(wav.channelCount, wav.channels[0]?.length ?? 0, wav.sampleRate);
  for (let channel = 0; channel < wav.channelCount; channel += 1) {
    const source = wav.channels[channel];
    const target = buffer.getChannelData(channel);
    if (source) {
      target.set(source.subarray(0, target.length));
    }
  }
  return buffer;
}

function readWavSample(view: DataView, offset: number, bitDepth: number, audioFormat: number) {
  if (audioFormat === 3) {
    if (bitDepth === 32) return clampSample(view.getFloat32(offset, true));
    if (bitDepth === 64) return clampSample(view.getFloat64(offset, true));
    throw new Error(`Unsupported float WAV bit depth ${bitDepth}.`);
  }
  if (bitDepth === 8) return clampSample((view.getUint8(offset) - 128) / 128);
  if (bitDepth === 16) return clampSample(view.getInt16(offset, true) / 32768);
  if (bitDepth === 24) {
    let sample = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    if (sample & 0x800000) sample |= 0xff000000;
    return clampSample(sample / 8388608);
  }
  if (bitDepth === 32) return clampSample(view.getInt32(offset, true) / 2147483648);
  throw new Error(`Unsupported PCM WAV bit depth ${bitDepth}.`);
}

function buildDecodeFailureMessage(fileName: string, kind: AudioContainerKind, error: unknown, wavError?: unknown) {
  const browserMessage = error instanceof Error ? error.message : String(error);
  const wavMessage = wavError instanceof Error ? ` WAV fallback also failed: ${wavError.message}` : "";
  const extension = getExtension(fileName);
  const extensionHint = extension && kind !== "unknown" && extension !== kind && !(kind === "mp4" && (extension === "m4a" || extension === "mp4"))
    ? ` The file name ends in .${extension}, but the bytes look like ${kind.toUpperCase()}.`
    : "";
  if (kind === "flac") {
    return `${fileName}: FLAC may not be supported by this browser. Convert it to WAV or M4A and import again.${extensionHint} Browser said: ${browserMessage}`;
  }
  if (kind === "aac") {
    return `${fileName}: this looks like raw AAC/ADTS audio, not a PCM WAV file. Convert it to WAV or M4A and import again.${extensionHint} Browser said: ${browserMessage}`;
  }
  if (kind === "unknown") {
    return `${fileName}: audio format could not be identified. Use WAV, MP3, M4A/AAC, AIFF, or a ZIP containing those files. Browser said: ${browserMessage}`;
  }
  return `${fileName}: this ${kind.toUpperCase()} file could not be decoded by the browser.${extensionHint}${wavMessage} Browser said: ${browserMessage}`;
}

export function findWavHeaderOffset(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const limit = Math.min(bytes.length - 12, 1024 * 1024);
  for (let offset = 0; offset <= limit; offset += 1) {
    const riff = ascii(bytes, offset, 4);
    if ((riff === "RIFF" || riff === "RF64") && ascii(bytes, offset + 8, 4) === "WAVE") {
      return offset;
    }
  }
  return -1;
}

function isMpegAudioFrame(bytes: Uint8Array, offset = 0) {
  if (bytes.length < offset + 4) return false;
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[offset + 1] >> 3) & 0x03;
  const layer = (bytes[offset + 1] >> 1) & 0x03;
  const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
  return version !== 0x01 && layer !== 0x00 && bitrateIndex !== 0x00 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03;
}

function isAdtsAacHeader(bytes: Uint8Array, offset = 0) {
  if (bytes.length < offset + 7) return false;
  return bytes[offset] === 0xff && (bytes[offset + 1] & 0xf6) === 0xf0;
}

function getId3v2EndOffset(bytes: Uint8Array) {
  if (ascii(bytes, 0, 3) !== "ID3" || bytes.length < 10) return 0;
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return Math.min(bytes.length, 10 + size);
}

function detectRepeatedByteFill(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length === 0) return null;
  const sampleOffsets = [0, 128, 1024, 4096, 65536, Math.max(0, bytes.length - 128)];
  let fill: number | null = null;
  let checked = 0;
  for (const offset of sampleOffsets) {
    if (offset >= bytes.length) continue;
    const end = Math.min(bytes.length, offset + 32);
    for (let index = offset; index < end; index += 1) {
      if (fill == null) fill = bytes[index] ?? 0;
      if (bytes[index] !== fill) return null;
      checked += 1;
    }
  }
  return checked >= 32 ? fill : null;
}

function hasWavHint(fileName: string, mimeType = "") {
  const extension = getExtension(fileName);
  return extension === "wav" || extension === "wave" || /wav|wave/i.test(mimeType);
}

function isPotentialAudioFile(fileName: string, mimeType = "") {
  const extension = getExtension(fileName);
  return AUDIO_EXTENSIONS.has(extension) || /^audio\//i.test(mimeType);
}

function getExtension(fileName: string) {
  const match = /\.([^.]+)$/.exec(fileName.toLowerCase());
  return match?.[1] ?? "";
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function asciiView(view: DataView, offset: number, length: number) {
  if (view.byteLength < offset + length) return "";
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

function clampSample(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}
