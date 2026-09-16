import { AudioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { decodeAudioFile } from "@/audio/engine/AudioDecode";
import { hasSoloTrack, isReferenceTrack, isTrackAudible } from "@/audio/engine/TrackGraph";
import { inferStemRole, type AudioFileRef, type Clip, type Project } from "@/daw/model/Project";

const HEADER_READ_BYTES = 1024 * 1024;

export type PcmWavFileInfo = {
  audioFormat: 1 | 3;
  sampleRate: number;
  channelCount: number;
  bitDepth: number;
  blockAlign: number;
  dataOffset: number;
  dataBytes: number;
  frameCount: number;
  durationSec: number;
};

export type PcmWavRange = {
  info: PcmWavFileInfo;
  channels: Float32Array[];
  startFrame: number;
  frameCount: number;
  startSec: number;
};

export type StreamableBufferRelease = {
  releasedFileIds: string[];
  releasedBytes: number;
  retainedFileIds: string[];
};

export type PreparedStreamingWavSources = {
  project: Project;
  registry: AudioBufferRegistry;
  streamedFileCount: number;
  fallbackFileCount: number;
  warnings: string[];
  dispose: () => void;
};

const infoCache = new WeakMap<Blob, Promise<PcmWavFileInfo | null>>();

export function inspectPcmWavFile(file: Blob): Promise<PcmWavFileInfo | null> {
  const cached = infoCache.get(file);
  if (cached) return cached;
  const pending = readPcmWavInfo(file).catch(() => null);
  infoCache.set(file, pending);
  return pending;
}

export async function readPcmWavRange(file: Blob, startSec: number, endSec: number): Promise<PcmWavRange | null> {
  const info = await inspectPcmWavFile(file);
  if (!info) return null;
  const safeStartSec = Math.max(0, Number.isFinite(startSec) ? startSec : 0);
  const safeEndSec = Math.max(safeStartSec, Number.isFinite(endSec) ? endSec : safeStartSec);
  const startFrame = Math.min(info.frameCount, Math.max(0, Math.floor(safeStartSec * info.sampleRate)));
  const endFrame = Math.min(info.frameCount, Math.max(startFrame, Math.ceil(safeEndSec * info.sampleRate)));
  const frameCount = Math.max(0, endFrame - startFrame);
  const byteStart = info.dataOffset + startFrame * info.blockAlign;
  const byteEnd = info.dataOffset + endFrame * info.blockAlign;
  const bytes = await file.slice(byteStart, byteEnd).arrayBuffer();
  const view = new DataView(bytes);
  const bytesPerSample = Math.ceil(info.bitDepth / 8);
  const channels = Array.from({ length: info.channelCount }, () => new Float32Array(frameCount));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame * info.blockAlign;
    for (let channel = 0; channel < info.channelCount; channel += 1) {
      channels[channel]![frame] = readSample(view, frameOffset + channel * bytesPerSample, info.bitDepth, info.audioFormat);
    }
  }

  return {
    info,
    channels,
    startFrame,
    frameCount,
    startSec: startFrame / info.sampleRate,
  };
}

export async function releaseStreamableProjectBuffers(
  project: Project,
  registry: AudioBufferRegistry,
): Promise<StreamableBufferRelease> {
  const fileIds = collectSourceFileIds(project.clips);
  const releasedFileIds: string[] = [];
  const retainedFileIds: string[] = [];
  let releasedBytes = 0;

  for (const fileId of fileIds) {
    const sourceFile = registry.getFile(fileId);
    const buffer = registry.getBuffer(fileId);
    if (!sourceFile || !buffer || !(await inspectPcmWavFile(sourceFile))) {
      if (buffer) retainedFileIds.push(fileId);
      continue;
    }
    const bytes = Math.max(0, buffer.length) * Math.max(1, buffer.numberOfChannels) * Float32Array.BYTES_PER_ELEMENT;
    if (registry.releaseDecodedBuffer(fileId)) {
      releasedFileIds.push(fileId);
      releasedBytes += bytes;
    }
  }

  if (releasedFileIds.length > 0) {
    // Give Safari an event-loop/idle boundary after AudioBuffer references are
    // dropped before allocating the first OfflineAudioContext chunk.
    await yieldForMemoryReclaim();
  }

  return { releasedFileIds, releasedBytes, retainedFileIds };
}

export async function prepareStreamingWavSources(
  project: Project,
  sourceRegistry: AudioBufferRegistry,
  context: BaseAudioContext,
): Promise<PreparedStreamingWavSources> {
  const localRegistry = new AudioBufferRegistry();
  const clipsByFileId = new Map<string, Clip[]>();
  const exportTracks = project.tracks.filter((track) => !isReferenceTrack(track));
  const soloActive = hasSoloTrack(exportTracks);
  const audibleTrackIds = new Set(
    exportTracks.filter((track) => isTrackAudible(track, soloActive)).map((track) => track.id),
  );
  for (const clip of project.clips) {
    if (!audibleTrackIds.has(clip.trackId)) continue;
    const sourceFileId = resolveSourceFileId(clip);
    const clips = clipsByFileId.get(sourceFileId) ?? [];
    clips.push(clip);
    clipsByFileId.set(sourceFileId, clips);
  }

  const segmentStartByFileId = new Map<string, number>();
  const warnings: string[] = [];
  let streamedFileCount = 0;
  let fallbackFileCount = 0;

  try {
    for (const [fileId, clips] of clipsByFileId) {
      const sourceFile = sourceRegistry.getFile(fileId);
      const fileRef = resolveFileRef(project, fileId, sourceFile, sourceRegistry.getBuffer(fileId));
      const info = sourceFile ? await inspectPcmWavFile(sourceFile) : null;

      if (sourceFile && info) {
        const startSec = clips.reduce((value, clip) => Math.min(value, Math.max(0, clip.sourceStartSec)), Number.POSITIVE_INFINITY);
        const endSec = clips.reduce((value, clip) => Math.max(value, Math.max(0, clip.sourceStartSec) + Math.max(0, clip.durationSec)), 0);
        const range = await readPcmWavRange(sourceFile, Number.isFinite(startSec) ? startSec : 0, endSec);
        if (range) {
          const frameCount = Math.max(1, range.frameCount);
          const buffer = context.createBuffer(range.info.channelCount, frameCount, range.info.sampleRate);
          range.channels.forEach((channel, channelIndex) => {
            buffer.copyToChannel(new Float32Array(channel.subarray(0, frameCount)), channelIndex);
          });
          range.channels.length = 0;
          localRegistry.registerRestored(fileRef, buffer, sourceFile);
          segmentStartByFileId.set(fileId, range.startSec);
          streamedFileCount += 1;
          continue;
        }
      }

      const existingBuffer = sourceRegistry.getBuffer(fileId);
      if (existingBuffer) {
        localRegistry.registerRestored(fileRef, existingBuffer, sourceFile ?? undefined);
        fallbackFileCount += 1;
        continue;
      }

      if (sourceFile) {
        const decoded = await decodeAudioFile(context, sourceFile);
        localRegistry.registerRestored(fileRef, decoded, sourceFile);
        fallbackFileCount += 1;
        warnings.push(`${sourceFile.name}: partial PCM WAV reading was unavailable, so this chunk used the browser decoder.`);
        continue;
      }

      warnings.push(`${fileRef.name}: source audio is unavailable for this render chunk.`);
    }
  } catch (error) {
    localRegistry.clear();
    throw error;
  }

  const adjustedClips = project.clips.map((clip) => {
    const sourceFileId = resolveSourceFileId(clip);
    const segmentStartSec = segmentStartByFileId.get(sourceFileId);
    if (segmentStartSec == null) return clip;
    return {
      ...clip,
      sourceStartSec: Math.max(0, clip.sourceStartSec - segmentStartSec),
    };
  });
  const originalClipById = new Map(project.clips.map((clip) => [clip.id, clip]));
  const adjustedRepairRegions = project.repairRegions.map((region) => {
    if (region.coordinateSpace !== "source") return region;
    const fileId = region.fileId ?? (region.clipId ? resolveSourceFileId(originalClipById.get(region.clipId) ?? null) : null);
    const segmentStartSec = fileId ? segmentStartByFileId.get(fileId) : undefined;
    if (segmentStartSec == null) return region;
    return {
      ...region,
      startSec: region.startSec - segmentStartSec,
      endSec: region.endSec - segmentStartSec,
    };
  });

  return {
    project: {
      ...project,
      clips: adjustedClips,
      repairRegions: adjustedRepairRegions,
    },
    registry: localRegistry,
    streamedFileCount,
    fallbackFileCount,
    warnings,
    dispose: () => localRegistry.clear(),
  };
}

async function readPcmWavInfo(file: Blob): Promise<PcmWavFileInfo | null> {
  if (file.size < 44) return null;
  const headerBytes = await file.slice(0, Math.min(file.size, HEADER_READ_BYTES)).arrayBuffer();
  const view = new DataView(headerBytes);
  const riffOffset = findRiffOffset(view);
  if (riffOffset < 0 || ascii(view, riffOffset + 8, 4) !== "WAVE") return null;

  let audioFormat = 0;
  let sampleRate = 0;
  let channelCount = 0;
  let bitDepth = 0;
  let blockAlign = 0;
  let dataOffset = -1;
  let dataBytes = 0;
  let offset = riffOffset + 12;

  while (offset + 8 <= view.byteLength) {
    const chunkId = ascii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkId === "fmt ") {
      if (chunkDataOffset + Math.min(chunkSize, 40) > view.byteLength || chunkSize < 16) return null;
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
      dataBytes = chunkSize === 0xffffffff
        ? Math.max(0, file.size - dataOffset)
        : Math.min(chunkSize, Math.max(0, file.size - dataOffset));
      break;
    }
    const nextOffset = chunkDataOffset + chunkSize + (chunkSize % 2);
    if (nextOffset <= offset || nextOffset > view.byteLength) return null;
    offset = nextOffset;
  }

  if ((audioFormat !== 1 && audioFormat !== 3) || !sampleRate || !channelCount || !bitDepth || !blockAlign || dataOffset < 0 || dataBytes <= 0) return null;
  if (![8, 16, 24, 32, 64].includes(bitDepth)) return null;
  if (audioFormat === 1 && bitDepth === 64) return null;
  const minimumBlockAlign = Math.ceil(bitDepth / 8) * channelCount;
  if (blockAlign < minimumBlockAlign) return null;
  const frameCount = Math.floor(dataBytes / blockAlign);
  return {
    audioFormat,
    sampleRate,
    channelCount,
    bitDepth,
    blockAlign,
    dataOffset,
    dataBytes,
    frameCount,
    durationSec: frameCount / sampleRate,
  };
}

function readSample(view: DataView, offset: number, bitDepth: number, audioFormat: number) {
  let value = 0;
  if (audioFormat === 3) {
    value = bitDepth === 64 ? view.getFloat64(offset, true) : view.getFloat32(offset, true);
  } else if (bitDepth === 8) {
    value = (view.getUint8(offset) - 128) / 128;
  } else if (bitDepth === 16) {
    value = view.getInt16(offset, true) / 32768;
  } else if (bitDepth === 24) {
    let sample = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    if (sample & 0x800000) sample |= 0xff000000;
    value = sample / 8388608;
  } else if (bitDepth === 32) {
    value = view.getInt32(offset, true) / 2147483648;
  }
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function findRiffOffset(view: DataView) {
  const limit = Math.max(0, view.byteLength - 12);
  for (let offset = 0; offset <= limit; offset += 1) {
    const tag = ascii(view, offset, 4);
    if ((tag === "RIFF" || tag === "RF64") && ascii(view, offset + 8, 4) === "WAVE") return offset;
  }
  return -1;
}

function ascii(view: DataView, offset: number, length: number) {
  if (offset < 0 || offset + length > view.byteLength) return "";
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(view.getUint8(offset + index));
  return value;
}

function collectSourceFileIds(clips: Clip[]) {
  return [...new Set(clips.map((clip) => resolveSourceFileId(clip)))];
}

function resolveSourceFileId(clip: Clip | null) {
  if (!clip) return "";
  return clip.isFrozen && clip.frozenRenderFileId ? clip.frozenRenderFileId : clip.fileId;
}

function resolveFileRef(project: Project, fileId: string, file: File | null, buffer: AudioBuffer | null): AudioFileRef {
  const existing = project.files.find((entry) => entry.id === fileId);
  if (existing) return existing;
  const name = file?.name ?? `${fileId}.wav`;
  return {
    id: fileId,
    name,
    originalName: name,
    role: inferStemRole(name),
    mimeType: file?.type || "audio/wav",
    durationSec: buffer?.duration ?? 0,
    sampleRate: buffer?.sampleRate ?? project.sampleRate,
    channelCount: buffer?.numberOfChannels ?? 2,
    byteLength: file?.size ?? 0,
    storageKey: `memory:${fileId}`,
    peakCacheKey: `peaks:${fileId}`,
    createdAt: new Date().toISOString(),
  };
}

function yieldForMemoryReclaim() {
  return new Promise<void>((resolve) => {
    const requestIdle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    }).requestIdleCallback;
    if (typeof requestIdle === "function") {
      requestIdle(() => resolve(), { timeout: 80 });
      return;
    }
    setTimeout(resolve, 32);
  });
}
