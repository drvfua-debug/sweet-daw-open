import { describe, expect, it } from "vitest";
import { createEmptyProject, createId, type AudioFileRef } from "../daw/model/Project";
import { inspectProjectAssetHealth } from "./ProjectAssetHealth";

function createProjectWithFile(fileRef: AudioFileRef) {
  return {
    ...createEmptyProject(),
    files: [fileRef],
  };
}

function createFileRef(byteLength = 0): AudioFileRef {
  const id = createId("file");
  return {
    id,
    name: "0_vocal.wav",
    originalName: "0_vocal.wav",
    role: "vocal",
    mimeType: "audio/wav",
    durationSec: 1,
    sampleRate: 48000,
    channelCount: 2,
    byteLength,
    storageKey: `idb:audio:${id}`,
    peakCacheKey: `peaks:${id}`,
    createdAt: new Date().toISOString(),
  };
}

describe("ProjectAssetHealth", () => {
  it("treats assets with a registry source file as healthy", async () => {
    const fileRef = createFileRef();
    const sourceFile = new File([new Uint8Array([1, 2, 3])], fileRef.name, { type: "audio/wav" });

    const summary = await inspectProjectAssetHealth(createProjectWithFile(fileRef), {
      getRegistryFile: () => sourceFile,
      getRegistryBuffer: () => null,
      loadAudioAsset: async () => null,
    });

    expect(summary.missingCount).toBe(0);
    expect(summary.recoverableCount).toBe(0);
    expect(summary.assets[0]).toMatchObject({
      inRegistryFile: true,
      inIndexedDb: false,
      missing: false,
      byteLength: sourceFile.size,
    });
  });

  it("marks assets as recoverable when only IndexedDB has the blob", async () => {
    const fileRef = createFileRef();
    const storedBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });

    const summary = await inspectProjectAssetHealth(createProjectWithFile(fileRef), {
      getRegistryFile: () => null,
      getRegistryBuffer: () => null,
      loadAudioAsset: async () => storedBlob,
    });

    expect(summary.missingCount).toBe(0);
    expect(summary.recoverableCount).toBe(1);
    expect(summary.assets[0]).toMatchObject({
      inRegistryFile: false,
      inIndexedDb: true,
      missing: false,
      byteLength: storedBlob.size,
    });
  });

  it("marks assets missing when neither registry nor IndexedDB has audio data", async () => {
    const fileRef = createFileRef(12);

    const summary = await inspectProjectAssetHealth(createProjectWithFile(fileRef), {
      getRegistryFile: () => null,
      getRegistryBuffer: () => ({} as AudioBuffer),
      loadAudioAsset: async () => null,
    });

    expect(summary.missingCount).toBe(1);
    expect(summary.recoverableCount).toBe(0);
    expect(summary.assets[0]).toMatchObject({
      inRegistryBuffer: true,
      missing: true,
      byteLength: 12,
    });
  });
});
