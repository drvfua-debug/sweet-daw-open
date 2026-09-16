import { describe, expect, it } from "vitest";
import { AudioBufferRegistry } from "./AudioBufferRegistry";
import { inspectPcmWavFile, prepareStreamingWavSources, readPcmWavRange, releaseStreamableProjectBuffers } from "./StreamingWavSource";
import { createEmptyProject, createTrack, type AudioFileRef, type Clip } from "@/daw/model/Project";

describe("StreamingWavSource", () => {
  it("reads only the requested PCM WAV frame range", async () => {
    const file = createPcm16WavFile(10, [
      Float32Array.from({ length: 100 }, (_, index) => index / 100),
      Float32Array.from({ length: 100 }, (_, index) => -index / 100),
    ]);
    const info = await inspectPcmWavFile(file);
    const range = await readPcmWavRange(file, 2, 4);

    expect(info?.durationSec).toBe(10);
    expect(range?.startFrame).toBe(20);
    expect(range?.frameCount).toBe(20);
    expect(range?.channels[0]?.[0]).toBeCloseTo(0.2, 3);
    expect(range?.channels[1]?.[19]).toBeCloseTo(-0.39, 3);
  });

  it("reassembles sequential source ranges without changing PCM samples", async () => {
    const file = createPcm16WavFile(10, [
      Float32Array.from({ length: 100 }, (_, index) => Math.sin(index * 0.17) * 0.8),
      Float32Array.from({ length: 100 }, (_, index) => Math.cos(index * 0.13) * 0.7),
    ]);
    const full = await readPcmWavRange(file, 0, 10);
    const ranges = await Promise.all([
      readPcmWavRange(file, 0, 2),
      readPcmWavRange(file, 2, 7),
      readPcmWavRange(file, 7, 10),
    ]);

    for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
      const joined = new Float32Array(100);
      let offset = 0;
      for (const range of ranges) {
        const channel = range?.channels[channelIndex] ?? new Float32Array();
        joined.set(channel, offset);
        offset += channel.length;
      }
      expect(joined).toEqual(full?.channels[channelIndex]);
    }
  });

  it("releases decoded PCM while keeping the source File available for streamed export", async () => {
    const file = createPcm16WavFile(10, [new Float32Array(100), new Float32Array(100)]);
    const registry = new AudioBufferRegistry();
    const fileRef: AudioFileRef = {
      id: "file-1",
      name: file.name,
      originalName: file.name,
      role: "other",
      mimeType: "audio/wav",
      durationSec: 10,
      sampleRate: 10,
      channelCount: 2,
      byteLength: file.size,
      storageKey: "memory:file-1",
      createdAt: new Date(0).toISOString(),
    };
    const fakeBuffer = {
      duration: 10,
      sampleRate: 10,
      numberOfChannels: 2,
      length: 100,
    } as AudioBuffer;
    registry.registerRestored(fileRef, fakeBuffer, file);
    const project = createEmptyProject();
    const track = createTrack("Stem", 0, "other", "other");
    const clip: Clip = {
      id: "clip-1",
      trackId: track.id,
      fileId: fileRef.id,
      role: "other",
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 10,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      reverse: false,
      stretchRatio: null,
      pitchShiftSemitones: null,
      lockedToGrid: true,
      movementLocked: true,
      intentTags: [],
      actionHistory: [],
      insertChain: [],
    };
    project.tracks = [track];
    project.files = [fileRef];
    project.clips = [clip];

    const result = await releaseStreamableProjectBuffers(project, registry);
    expect(result.releasedFileIds).toEqual([fileRef.id]);
    expect(result.releasedBytes).toBe(800);
    expect(registry.getBuffer(fileRef.id)).toBeNull();
    expect(registry.getFile(fileRef.id)).toBe(file);
  });

  it("builds a clip-local AudioBuffer instead of retaining the full WAV", async () => {
    const file = createPcm16WavFile(10, [
      Float32Array.from({ length: 100 }, (_, index) => index / 100),
      Float32Array.from({ length: 100 }, (_, index) => -index / 100),
    ]);
    const registry = new AudioBufferRegistry();
    const fileRef = createFileRef(file, 10);
    registry.registerRestored(fileRef, createFakeAudioBuffer(2, 100, 10), file);
    const project = createProjectWithClip(fileRef, 5, 2);
    const context = {
      createBuffer: (channels: number, length: number, sampleRate: number) => createFakeAudioBuffer(channels, length, sampleRate),
    } as BaseAudioContext;

    const prepared = await prepareStreamingWavSources(project, registry, context);
    const partial = prepared.registry.getBuffer(fileRef.id);
    expect(prepared.streamedFileCount).toBe(1);
    expect(partial?.length).toBe(20);
    expect(prepared.project.clips[0]?.sourceStartSec).toBe(0);
    expect(partial?.getChannelData(0)[0]).toBeCloseTo(0.5, 3);
    prepared.dispose();
  });

  it("does not load analysis-only Reference audio into render chunks", async () => {
    const stemFile = createPcm16WavFile(10, [new Float32Array(100), new Float32Array(100)]);
    const referenceFile = createPcm16WavFile(10, [new Float32Array(100), new Float32Array(100)]);
    const stemRef = createFileRef(stemFile, 10, "stem-file");
    const referenceRef = createFileRef(referenceFile, 10, "reference-file");
    const registry = new AudioBufferRegistry();
    registry.registerRestored(stemRef, createFakeAudioBuffer(2, 100, 10), stemFile);
    registry.registerRestored(referenceRef, createFakeAudioBuffer(2, 100, 10), referenceFile);
    const project = createProjectWithClip(stemRef, 0, 10);
    const referenceTrack = createTrack("Reference", 1, "reference", "reference");
    project.tracks.push(referenceTrack);
    project.files.push(referenceRef);
    project.clips.push({
      ...project.clips[0]!,
      id: "reference-clip",
      trackId: referenceTrack.id,
      fileId: referenceRef.id,
      role: "reference",
    });
    const context = {
      createBuffer: (channels: number, length: number, sampleRate: number) => createFakeAudioBuffer(channels, length, sampleRate),
    } as BaseAudioContext;

    const prepared = await prepareStreamingWavSources(project, registry, context);
    expect(prepared.streamedFileCount).toBe(1);
    expect(prepared.registry.getBuffer(stemRef.id)).not.toBeNull();
    expect(prepared.registry.getBuffer(referenceRef.id)).toBeNull();
    prepared.dispose();
  });
});

function createFileRef(file: File, durationSec: number, id = "file-1"): AudioFileRef {
  return {
    id,
    name: file.name,
    originalName: file.name,
    role: "other",
    mimeType: "audio/wav",
    durationSec,
    sampleRate: 10,
    channelCount: 2,
    byteLength: file.size,
    storageKey: `memory:${id}`,
    createdAt: new Date(0).toISOString(),
  };
}

function createProjectWithClip(fileRef: AudioFileRef, sourceStartSec: number, durationSec: number) {
  const project = createEmptyProject();
  const track = createTrack("Stem", 0, "other", "other");
  project.tracks = [track];
  project.files = [fileRef];
  project.clips = [{
    id: "clip-1",
    trackId: track.id,
    fileId: fileRef.id,
    role: "other",
    timelineStartSec: 0,
    sourceStartSec,
    durationSec,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: true,
    movementLocked: true,
    intentTags: [],
    actionHistory: [],
    insertChain: [],
  }];
  return project;
}

function createFakeAudioBuffer(channelCount: number, length: number, sampleRate: number): AudioBuffer {
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
  return {
    duration: length / sampleRate,
    sampleRate,
    numberOfChannels: channelCount,
    length,
    getChannelData: (channel: number) => channels[channel]!,
    copyToChannel: (source: Float32Array, channel: number, offset = 0) => channels[channel]!.set(source, offset),
  } as AudioBuffer;
}

function createPcm16WavFile(sampleRate: number, channels: Float32Array[]) {
  const channelCount = channels.length;
  const frameCount = Math.min(...channels.map((channel) => channel.length));
  const blockAlign = channelCount * 2;
  const dataBytes = frameCount * blockAlign;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(bytes);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      view.setInt16(offset, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
      offset += 2;
    }
  }
  return new File([bytes], "stem.wav", { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}
