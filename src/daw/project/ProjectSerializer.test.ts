import { describe, expect, it } from "vitest";
import { createEmptyProject, createId, createTrack, type AudioFileRef, type Clip } from "../model/Project";
import { createProjectPackage, readProjectPackageFile, readSweetDawProjectFile } from "./ProjectSerializer";

const PACKAGE_MAGIC = "SWEETDAWPKG1\n";
const PACKAGE_LENGTH_DIGITS = 12;
const PACKAGE_HEADER_BYTES = PACKAGE_MAGIC.length + PACKAGE_LENGTH_DIGITS + 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function createTestFileRef(fileId = createId("file"), byteLength = 4): AudioFileRef {
  return {
    id: fileId,
    name: "0_vocal.wav",
    originalName: "0_vocal.wav",
    role: "vocal",
    mimeType: "audio/wav",
    durationSec: 1,
    sampleRate: 48000,
    channelCount: 2,
    byteLength,
    storageKey: `idb:audio:${fileId}`,
    peakCacheKey: `peaks:${fileId}`,
    createdAt: new Date().toISOString(),
  };
}

function createRawPackage(manifest: unknown, audioBlob: Blob) {
  const manifestBytes = textEncoder.encode(JSON.stringify(manifest));
  return new Blob(
    [PACKAGE_MAGIC, String(manifestBytes.byteLength).padStart(PACKAGE_LENGTH_DIGITS, "0"), "\n", manifestBytes, audioBlob],
    { type: "application/vnd.sweet-daw.project" },
  );
}

async function mutateFirstAudioByte(packageBlob: Blob) {
  const bytes = new Uint8Array(await packageBlob.arrayBuffer());
  const header = textDecoder.decode(bytes.slice(0, PACKAGE_HEADER_BYTES));
  const manifestLength = Number(header.slice(PACKAGE_MAGIC.length, PACKAGE_MAGIC.length + PACKAGE_LENGTH_DIGITS));
  const audioStart = PACKAGE_HEADER_BYTES + manifestLength;
  bytes[audioStart] = (bytes[audioStart] ?? 0) ^ 0xff;
  return new File([bytes], "corrupt.swtd");
}

describe("Sweet DAW project package", () => {
  it("round-trips project metadata with audio blobs", async () => {
    const project = createEmptyProject();
    const fileId = createId("file");
    const track = createTrack("0 Vocal", 0, "vocal", "vocal");
    const fileRef: AudioFileRef = {
      id: fileId,
      name: "0_vocal.wav",
      originalName: "0_vocal.wav",
      role: "vocal",
      mimeType: "audio/wav",
      durationSec: 1,
      sampleRate: 48000,
      channelCount: 2,
      byteLength: 4,
      storageKey: `idb:audio:${fileId}`,
      peakCacheKey: `peaks:${fileId}`,
      createdAt: new Date().toISOString(),
    };
    const clip: Clip = {
      id: createId("clip"),
      trackId: track.id,
      fileId,
      role: "vocal",
      intentTags: [],
      actionHistory: [],
      timelineStartSec: 0,
      sourceStartSec: 0,
      durationSec: 1,
      gainDb: 0,
      fadeInSec: 0,
      fadeOutSec: 0,
      reverse: false,
      stretchRatio: null,
      pitchShiftSemitones: null,
      lockedToGrid: true,
      movementLocked: true,
      insertChain: [],
      createdBy: "import",
    };
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });
    const packageBlob = await createProjectPackage(
      {
        ...project,
        tracks: [track],
        clips: [clip],
        files: [fileRef],
      },
      async () => blob,
    );

    const restored = await readProjectPackageFile(new File([packageBlob], "demo.swtd"));

    expect(restored.manifest.project.files[0]?.name).toBe("0_vocal.wav");
    expect(restored.manifest.project.schemaVersion).toBe(4);
    expect(restored.manifest.project.master.target.profileId).toBe("balanced-master");
    expect(restored.manifest.project.master.mixBusTrimDb).toBe(0);
    expect(restored.audioAssets).toHaveLength(1);
    expect(restored.audioAssets[0]?.fileId).toBe(fileId);
    expect(await restored.audioAssets[0]?.blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
  });

  it("detects .swtd packages through the shared project file reader", async () => {
    const project = createEmptyProject();
    const fileId = createId("file");
    const track = createTrack("1 Bass", 0, "bass", "bass");
    const fileRef: AudioFileRef = {
      id: fileId,
      name: "1_bass.wav",
      originalName: "1_bass.wav",
      role: "bass",
      mimeType: "audio/wav",
      durationSec: 1,
      sampleRate: 48000,
      channelCount: 2,
      byteLength: 3,
      storageKey: `idb:audio:${fileId}`,
      peakCacheKey: `peaks:${fileId}`,
      createdAt: new Date().toISOString(),
    };
    const packageBlob = await createProjectPackage(
      {
        ...project,
        tracks: [track],
        files: [fileRef],
      },
      async () => new Blob([new Uint8Array([5, 6, 7])], { type: "audio/wav" }),
    );

    const restored = await readSweetDawProjectFile(new File([packageBlob], "portable.swtd"));

    expect(restored.kind).toBe("package");
    if (restored.kind === "package") {
      expect(restored.package.manifest.project.files[0]?.role).toBe("bass");
      expect(restored.package.audioAssets[0]?.name).toBe("1_bass.wav");
    }
  });

  it("adds checksums to package assets and verifies them on import", async () => {
    const project = createEmptyProject();
    const fileRef = createTestFileRef();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });

    const packageBlob = await createProjectPackage(
      {
        ...project,
        files: [fileRef],
      },
      async () => blob,
    );

    const restored = await readProjectPackageFile(new File([packageBlob], "with-checksum.swtd"));

    expect(restored.manifest.assets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(restored.audioAssets[0]?.sha256).toBe(restored.manifest.assets[0]?.sha256);
  });

  it("rejects packages when an audio checksum does not match", async () => {
    const project = createEmptyProject();
    const fileRef = createTestFileRef();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });
    const packageBlob = await createProjectPackage(
      {
        ...project,
        files: [fileRef],
      },
      async () => blob,
    );

    await expect(readProjectPackageFile(await mutateFirstAudioByte(packageBlob))).rejects.toThrow(/checksum mismatch/i);
  });

  it("keeps compatibility with legacy packages that have no checksums", async () => {
    const project = createEmptyProject();
    const fileRef = createTestFileRef();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });
    const manifest = {
      format: "sweet-daw.package",
      version: 1,
      packageVersion: 1,
      exportedAt: new Date().toISOString(),
      projectId: project.id,
      projectTitle: project.title,
      schemaVersion: project.schemaVersion,
      projectJsonLength: JSON.stringify(project).length,
      assetCount: 1,
      totalAssetBytes: blob.size,
      project: {
        ...project,
        files: [fileRef],
      },
      assets: [
        {
          fileId: fileRef.id,
          id: fileRef.id,
          name: fileRef.name,
          originalName: fileRef.originalName,
          mimeType: fileRef.mimeType,
          byteLength: blob.size,
          durationSec: fileRef.durationSec,
          sampleRate: fileRef.sampleRate,
          channelCount: fileRef.channelCount,
          role: fileRef.role,
        },
      ],
      note: "Legacy package without checksums.",
    };

    const restored = await readProjectPackageFile(new File([createRawPackage(manifest, blob)], "legacy.swtd"));

    expect(restored.audioAssets).toHaveLength(1);
    expect(restored.audioAssets[0]?.sha256).toBeUndefined();
  });

  it("rejects packages when asset counts or total bytes disagree with the manifest", async () => {
    const project = createEmptyProject();
    const fileRef = createTestFileRef();
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });
    const asset = {
      fileId: fileRef.id,
      id: fileRef.id,
      name: fileRef.name,
      originalName: fileRef.originalName,
      mimeType: fileRef.mimeType,
      byteLength: blob.size,
      durationSec: fileRef.durationSec,
      sampleRate: fileRef.sampleRate,
      channelCount: fileRef.channelCount,
      role: fileRef.role,
    };
    const baseManifest = {
      format: "sweet-daw.package",
      version: 1,
      packageVersion: 1,
      exportedAt: new Date().toISOString(),
      projectId: project.id,
      projectTitle: project.title,
      schemaVersion: project.schemaVersion,
      projectJsonLength: JSON.stringify(project).length,
      totalAssetBytes: blob.size,
      project: {
        ...project,
        files: [fileRef],
      },
      assets: [asset],
      note: "Invalid manifest.",
    };

    await expect(
      readProjectPackageFile(new File([createRawPackage({ ...baseManifest, assetCount: 2 }, blob)], "bad-count.swtd")),
    ).rejects.toThrow(/asset count/i);
    await expect(
      readProjectPackageFile(
        new File([createRawPackage({ ...baseManifest, assetCount: 1, totalAssetBytes: blob.size + 1 }, blob)], "bad-bytes.swtd"),
      ),
    ).rejects.toThrow(/total audio bytes/i);
  });
});
