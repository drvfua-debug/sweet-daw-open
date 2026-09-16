import { createId, inferStemRole, type AudioFileRef } from "../../daw/model/Project";

export type DecodedAudioAsset = {
  fileRef: AudioFileRef;
  buffer: AudioBuffer;
};

export class AudioBufferRegistry {
  private buffers = new Map<string, AudioBuffer>();
  private sourceFiles = new Map<string, File>();

  register(file: File, buffer: AudioBuffer): DecodedAudioAsset {
    const id = createId("file");
    const fileRef: AudioFileRef = {
      id,
      name: file.name,
      originalName: file.name,
      role: inferStemRole(file.name),
      mimeType: file.type || "audio/unknown",
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      channelCount: buffer.numberOfChannels,
      byteLength: file.size,
      storageKey: `memory:${id}`,
      peakCacheKey: `peaks:${id}`,
      createdAt: new Date().toISOString(),
    };

    this.buffers.set(id, buffer);
    this.sourceFiles.set(id, file);

    return {
      fileRef,
      buffer,
    };
  }

  registerRenderedBuffer(name: string, buffer: AudioBuffer): DecodedAudioAsset {
    const id = createId("file");
    const safeName = name.toLowerCase().endsWith(".wav") ? name : `${name}.wav`;
    const fileRef: AudioFileRef = {
      id,
      name: safeName,
      originalName: safeName,
      role: inferStemRole(name),
      mimeType: "audio/wav",
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      channelCount: buffer.numberOfChannels,
      byteLength: 0,
      storageKey: `memory:${id}`,
      peakCacheKey: `peaks:${id}`,
      createdAt: new Date().toISOString(),
    };

    this.buffers.set(id, buffer);

    return {
      fileRef,
      buffer,
    };
  }

  registerRestored(fileRef: AudioFileRef, buffer: AudioBuffer, sourceFile?: File): DecodedAudioAsset {
    const restoredFileRef: AudioFileRef = {
      ...fileRef,
      originalName: fileRef.originalName ?? fileRef.name,
      role: fileRef.role ?? inferStemRole(fileRef.name),
      durationSec: buffer.duration,
      sampleRate: buffer.sampleRate,
      channelCount: buffer.numberOfChannels,
      byteLength: fileRef.byteLength ?? sourceFile?.size ?? 0,
      peakCacheKey: fileRef.peakCacheKey ?? `peaks:${fileRef.id}`,
      createdAt: fileRef.createdAt ?? new Date().toISOString(),
    };

    this.buffers.set(restoredFileRef.id, buffer);
    if (sourceFile) {
      this.sourceFiles.set(restoredFileRef.id, sourceFile);
    }

    return {
      fileRef: restoredFileRef,
      buffer,
    };
  }

  getBuffer(fileId: string) {
    return this.buffers.get(fileId) ?? null;
  }

  getFile(fileId: string) {
    return this.sourceFiles.get(fileId) ?? null;
  }

  release(fileId: string) {
    const removedBuffer = this.buffers.delete(fileId);
    const removedFile = this.sourceFiles.delete(fileId);
    return removedBuffer || removedFile;
  }

  releaseDecodedBuffer(fileId: string) {
    return this.buffers.delete(fileId);
  }

  releaseUnused(activeFileIds: Iterable<string>) {
    const active = new Set(activeFileIds);
    let released = 0;
    for (const fileId of new Set([...this.buffers.keys(), ...this.sourceFiles.keys()])) {
      if (active.has(fileId)) continue;
      if (this.release(fileId)) released += 1;
    }
    return released;
  }

  getStats() {
    let estimatedPcmBytes = 0;
    for (const buffer of this.buffers.values()) {
      estimatedPcmBytes += Math.max(0, buffer.length) * Math.max(1, buffer.numberOfChannels) * 4;
    }
    return {
      bufferCount: this.buffers.size,
      sourceFileCount: this.sourceFiles.size,
      estimatedPcmBytes,
    };
  }

  clear() {
    this.buffers.clear();
    this.sourceFiles.clear();
  }
}

export const audioBufferRegistry = new AudioBufferRegistry();
