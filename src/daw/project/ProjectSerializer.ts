import { migrateProject, migrateProjectWithReport, type Project, type ProjectMigrationIssue } from "../model/Project";

export type ProjectBackup = {
  format: "sweet-daw.project";
  version: 4;
  exportedAt: string;
  project: Project;
  audit?: ProjectWorkflowAudit;
  migrationIssues?: ProjectMigrationIssue[];
  note: string;
};

const PACKAGE_MAGIC = "SWEETDAWPKG1\n";
const PACKAGE_LENGTH_DIGITS = 12;
const PACKAGE_HEADER_BYTES = PACKAGE_MAGIC.length + PACKAGE_LENGTH_DIGITS + 1;
const MAX_PACKAGE_ASSETS = 64;
const MAX_PACKAGE_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function sha256Blob(blob: Blob) {
  if (!globalThis.crypto?.subtle) {
    return undefined;
  }
  const buffer = await blob.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type ProjectPackageAsset = {
  fileId: string;
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  byteLength: number;
  durationSec: number;
  sampleRate: number;
  channelCount: number;
  role: string;
  sha256?: string;
};

export type ProjectPackageManifest = {
  format: "sweet-daw.package";
  version: 1;
  packageVersion: 1;
  exportedAt: string;
  projectId: string;
  projectTitle: string;
  schemaVersion: number;
  projectJsonLength: number;
  assetCount: number;
  totalAssetBytes: number;
  project: Project;
  assets: ProjectPackageAsset[];
  audit?: ProjectWorkflowAudit;
  note: string;
};

export type ProjectPackage = {
  manifest: ProjectPackageManifest;
  audioAssets: Array<ProjectPackageAsset & { blob: Blob }>;
  migrationIssues?: ProjectMigrationIssue[];
};

export type ProjectWorkflowAudit = {
  workflow: "AIMIX -> Spatial v2 -> Mastering";
  autoReferenceMix: {
    enabled: boolean;
    referenceTrackCount: number;
    workTrackCount: number;
  };
  referenceSummary: {
    referenceFileCount: number;
    referenceTrackNames: string[];
  };
  mixDoctorSummary: {
    analysisNotes: number;
    markers: number;
    regions: number;
  };
  aimixSpatialSummary: {
    mode: "spatial-v2-no-layers";
    generatedTracks: number;
    generatedClips: number;
    pannedTracks: number;
    pannedClips: number;
    note: string;
  };
  masteringSummary: {
    masterGainDb: number;
    finalOutputTrimDb: number;
    finalOutputTrimOwner: Project["master"]["finalOutputTrimOwner"] | null;
    limiterEnabled: boolean;
    exportNormalizePeak: boolean;
    exportBitDepth: Project["master"]["exportBitDepth"];
    exportSampleRate: Project["master"]["exportSampleRate"];
  };
};

export function createProjectBackup(project: Project): ProjectBackup {
  return {
    format: "sweet-daw.project",
    version: 4,
    exportedAt: new Date().toISOString(),
    project,
    audit: buildProjectWorkflowAudit(project),
    note: "Sweet DAW JSON backup contains non-destructive edit metadata and plug-in values. Use .swtd package export when moving projects with audio assets to another device.",
  };
}

export function downloadProjectBackup(project: Project) {
  const backup = createProjectBackup(project);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const safeTitle = project.title.trim().replace(/[^a-z0-9-_]+/gi, "_") || "project";
  downloadBlob(blob, `${safeTitle}.sweet-daw.json`);
}

export async function readProjectBackupFile(file: File): Promise<ProjectBackup> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<ProjectBackup>;

  if (parsed.format !== "sweet-daw.project" || !parsed.project) {
    throw new Error("This is not a Sweet DAW project backup.");
  }
  const migration = migrateProjectWithReport(parsed.project);

  return {
    format: "sweet-daw.project",
    version: 4,
    exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
    project: migration.project,
    audit: isProjectWorkflowAudit(parsed.audit) ? parsed.audit : undefined,
    migrationIssues: migration.issues,
    note: typeof parsed.note === "string" ? parsed.note : "",
  };
}

export async function createProjectPackage(
  project: Project,
  resolveAudioBlob: (fileId: string) => Promise<Blob | null>,
): Promise<Blob> {
  if (project.files.length > MAX_PACKAGE_ASSETS) {
    throw new Error(`Sweet DAW package has too many audio assets (${project.files.length}/${MAX_PACKAGE_ASSETS}).`);
  }

  const audioBlobs: Blob[] = [];
  const assets: ProjectPackageAsset[] = [];
  let totalAssetBytes = 0;

  for (const fileRef of project.files) {
    const blob = await resolveAudioBlob(fileRef.id);
    if (!blob) {
      throw new Error(`Audio asset is missing: ${fileRef.name} (${fileRef.id}). Re-import or restore the asset before exporting .swtd.`);
    }
    totalAssetBytes += blob.size;
    if (totalAssetBytes > MAX_PACKAGE_TOTAL_BYTES) {
      throw new Error("Sweet DAW package audio assets are too large for a portable .swtd package.");
    }

    audioBlobs.push(blob);
    assets.push({
      fileId: fileRef.id,
      id: fileRef.id,
      name: fileRef.name,
      originalName: fileRef.originalName || fileRef.name,
      mimeType: blob.type || fileRef.mimeType || "audio/unknown",
      byteLength: blob.size,
      durationSec: fileRef.durationSec,
      sampleRate: fileRef.sampleRate,
      channelCount: fileRef.channelCount,
      role: fileRef.role,
      sha256: await sha256Blob(blob),
    });
  }
  const packagedProject = migrateProject({
    ...project,
    storage: {
          ...project.storage,
          saveMode: "package",
          assetCount: assets.length,
          estimatedBytes: totalAssetBytes,
        },
      });
  const projectJsonLength = textEncoder.encode(JSON.stringify(packagedProject)).byteLength;

  const manifest: ProjectPackageManifest = {
    format: "sweet-daw.package",
    version: 1,
    packageVersion: 1,
    exportedAt: new Date().toISOString(),
    projectId: packagedProject.id,
    projectTitle: packagedProject.title,
    schemaVersion: packagedProject.schemaVersion,
    projectJsonLength,
    assetCount: assets.length,
    totalAssetBytes,
    project: packagedProject,
    assets,
    audit: buildProjectWorkflowAudit(packagedProject),
    note: "Sweet DAW portable package. Contains project metadata plus original audio blobs for cross-device restore.",
  };

  const manifestText = JSON.stringify(manifest);
  const manifestBytes = textEncoder.encode(manifestText);
  const manifestLength = manifestBytes.byteLength;
  if (manifestLength > MAX_MANIFEST_BYTES) {
    throw new Error("Sweet DAW package manifest is too large.");
  }
  if (manifestLength > 10 ** PACKAGE_LENGTH_DIGITS - 1) {
    throw new Error("Project manifest is too large to package.");
  }

  return new Blob(
    [
      PACKAGE_MAGIC,
      String(manifestLength).padStart(PACKAGE_LENGTH_DIGITS, "0"),
      "\n",
      manifestBytes,
      ...audioBlobs,
    ],
    { type: "application/vnd.sweet-daw.project" },
  );
}

export async function readProjectPackageFile(file: File): Promise<ProjectPackage> {
  const headerBytes = new Uint8Array(await file.slice(0, PACKAGE_HEADER_BYTES).arrayBuffer());
  const header = textDecoder.decode(headerBytes);
  if (!header.startsWith(PACKAGE_MAGIC) || header[PACKAGE_HEADER_BYTES - 1] !== "\n") {
    throw new Error("This is not a Sweet DAW package.");
  }

  const lengthText = header.slice(PACKAGE_MAGIC.length, PACKAGE_MAGIC.length + PACKAGE_LENGTH_DIGITS);
  const manifestLength = Number(lengthText);
  if (!Number.isFinite(manifestLength) || manifestLength <= 0) {
    throw new Error("Sweet DAW package manifest is invalid.");
  }
  if (manifestLength > MAX_MANIFEST_BYTES) {
    throw new Error("Sweet DAW package manifest is too large.");
  }

  const manifestStart = PACKAGE_HEADER_BYTES;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestEnd > file.size) {
    throw new Error("Sweet DAW package is incomplete.");
  }

  const manifestBytes = new Uint8Array(await file.slice(manifestStart, manifestEnd).arrayBuffer());
  const parsed = JSON.parse(textDecoder.decode(manifestBytes)) as Partial<ProjectPackageManifest>;
  if (parsed.format !== "sweet-daw.package" || parsed.version !== 1 || !parsed.project || !Array.isArray(parsed.assets)) {
    throw new Error("Sweet DAW package manifest is not supported.");
  }
  if (parsed.assets.length > MAX_PACKAGE_ASSETS) {
    throw new Error(`Sweet DAW package has too many audio assets (${parsed.assets.length}/${MAX_PACKAGE_ASSETS}).`);
  }
  if (typeof parsed.assetCount === "number" && parsed.assetCount !== parsed.assets.length) {
    throw new Error("Sweet DAW package asset count does not match the manifest.");
  }

  let offset = manifestEnd;
  const audioAssets = parsed.assets.map((asset) => {
    const fileId = typeof asset.fileId === "string" ? asset.fileId : "";
    const byteLength = typeof asset.byteLength === "number" && Number.isFinite(asset.byteLength) ? asset.byteLength : 0;
    const mimeType = typeof asset.mimeType === "string" ? asset.mimeType : "audio/unknown";
    const name = typeof asset.name === "string" ? asset.name : fileId;
    if (!fileId || byteLength < 0 || offset + byteLength > file.size) {
      throw new Error(`Sweet DAW package audio asset is invalid: ${name}`);
    }
    const blob = file.slice(offset, offset + byteLength, mimeType);
    offset += byteLength;
    return {
      fileId,
      id: typeof asset.id === "string" ? asset.id : fileId,
      name,
      originalName: typeof asset.originalName === "string" ? asset.originalName : name,
      mimeType,
      byteLength,
      durationSec: typeof asset.durationSec === "number" ? asset.durationSec : 0,
      sampleRate: typeof asset.sampleRate === "number" ? asset.sampleRate : 48000,
      channelCount: typeof asset.channelCount === "number" ? asset.channelCount : 2,
      role: typeof asset.role === "string" ? asset.role : "other",
      sha256: typeof asset.sha256 === "string" ? asset.sha256 : undefined,
      blob,
    };
  });
  const totalAssetBytes = audioAssets.reduce((sum, asset) => sum + asset.byteLength, 0);
  if (totalAssetBytes > MAX_PACKAGE_TOTAL_BYTES) {
    throw new Error("Sweet DAW package audio assets are too large.");
  }
  if (typeof parsed.totalAssetBytes === "number" && parsed.totalAssetBytes !== totalAssetBytes) {
    throw new Error("Sweet DAW package total audio bytes do not match the manifest.");
  }
  for (const asset of audioAssets) {
    if (!asset.sha256) continue;
    const actual = await sha256Blob(asset.blob);
    if (actual !== asset.sha256) {
      throw new Error(`Sweet DAW package audio checksum mismatch: ${asset.name}`);
    }
  }

  const migration = migrateProjectWithReport(parsed.project);

  return {
    manifest: {
      format: "sweet-daw.package",
      version: 1,
      packageVersion: 1,
      exportedAt: typeof parsed.exportedAt === "string" ? parsed.exportedAt : new Date().toISOString(),
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
      projectTitle: typeof parsed.projectTitle === "string" ? parsed.projectTitle : "",
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 0,
      projectJsonLength: typeof parsed.projectJsonLength === "number" ? parsed.projectJsonLength : 0,
      assetCount: audioAssets.length,
      totalAssetBytes,
      project: migration.project,
      assets: audioAssets.map(({ blob: _blob, ...asset }) => asset),
      audit: isProjectWorkflowAudit(parsed.audit) ? parsed.audit : undefined,
      note: typeof parsed.note === "string" ? parsed.note : "",
    },
    audioAssets,
    migrationIssues: migration.issues,
  };
}

export async function readSweetDawProjectFile(file: File) {
  const header = textDecoder.decode(new Uint8Array(await file.slice(0, PACKAGE_MAGIC.length).arrayBuffer()));
  if (header === PACKAGE_MAGIC) {
    return {
      kind: "package" as const,
      package: await readProjectPackageFile(file),
    };
  }

  return {
    kind: "json" as const,
    backup: await readProjectBackupFile(file),
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function buildProjectWorkflowAudit(project: Project): ProjectWorkflowAudit {
  const referenceTracks = project.tracks.filter((track) => track.role === "reference" || track.type === "reference");
  const workTracks = project.tracks.filter((track) => track.role !== "reference" && track.type !== "reference");
  const spatialGeneratedTrackIds = new Set(
    project.tracks.filter((track) => track.aimixSpatial?.isAimixSpatialGenerated).map((track) => track.id),
  );
  const pannedTracks = project.tracks.filter((track) => track.aimixSpatialPan?.isAimixSpatialPanApplied).length;
  const pannedClips = project.clips.filter((clip) => clip.aimixSpatialPan?.isAimixSpatialPanApplied || clip.panAutomation?.enabled).length;

  return {
    workflow: "AIMIX -> Spatial v2 -> Mastering",
    autoReferenceMix: {
      enabled: referenceTracks.length > 0 && workTracks.length > 0,
      referenceTrackCount: referenceTracks.length,
      workTrackCount: workTracks.length,
    },
    referenceSummary: {
      referenceFileCount: project.files.filter((file) => file.role === "reference").length,
      referenceTrackNames: referenceTracks.map((track) => track.name).slice(0, 12),
    },
    mixDoctorSummary: {
      analysisNotes: project.analysis.notes.length,
      markers: project.markers.length,
      regions: project.regions.length,
    },
    aimixSpatialSummary: {
      mode: "spatial-v2-no-layers",
      generatedTracks: spatialGeneratedTrackIds.size,
      generatedClips: project.clips.filter((clip) => clip.aimixSpatial?.isAimixSpatialGenerated || spatialGeneratedTrackIds.has(clip.trackId)).length,
      pannedTracks,
      pannedClips,
      note: "Spatial v2 does not create audio layers. It adjusts existing track/clip placement and keeps legacy generated layers removable.",
    },
    masteringSummary: {
      masterGainDb: project.master.gainDb,
      finalOutputTrimDb: project.master.finalOutputTrimDb ?? 0,
      finalOutputTrimOwner: project.master.finalOutputTrimOwner ?? null,
      limiterEnabled: project.master.limiterEnabled,
      exportNormalizePeak: project.master.exportNormalizePeak,
      exportBitDepth: project.master.exportBitDepth,
      exportSampleRate: project.master.exportSampleRate,
    },
  };
}

function isProjectWorkflowAudit(value: unknown): value is ProjectWorkflowAudit {
  return !!value && typeof value === "object" && (value as { workflow?: unknown }).workflow === "AIMIX -> Spatial v2 -> Mastering";
}
