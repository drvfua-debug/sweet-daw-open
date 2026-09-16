import type { AudioFileRef, Project } from "@/daw/model/Project";

const MASTER_EXPORT_COUNTER_PREFIX = "sweet-daw:master-export-revision:v1";
const sessionRevisions = new Map<string, number>();

export type MasterExportRevisionStore = Pick<Storage, "getItem" | "setItem">;

export function reserveMasterExportFilename(
  project: Project,
  store: MasterExportRevisionStore | null = getLocalStorage(),
) {
  const referenceFile = findPrimaryReferenceFile(project);
  const baseName = sanitizeExportBaseName(
    stripGeneratedMasterSuffix(stripFileExtension(referenceFile?.originalName || referenceFile?.name || project.title)),
  );
  const key = buildRevisionKey(project, referenceFile, baseName);
  const storedRevision = readStoredRevision(store, key);
  const revision = Math.max(storedRevision, sessionRevisions.get(key) ?? 0) + 1;

  sessionRevisions.set(key, revision);
  try {
    store?.setItem(key, String(revision));
  } catch {
    // Safari private storage can reject writes. Session numbering still works.
  }

  const revisionSuffix = revision <= 1 ? "" : `_${String(revision).padStart(2, "0")}`;
  return `${baseName}_sw_master${revisionSuffix}.wav`;
}

export function findPrimaryReferenceFile(project: Project): AudioFileRef | null {
  const referenceTrackIds = new Set(
    project.tracks
      .filter((track) => track.role === "reference" || track.type === "reference")
      .map((track) => track.id),
  );
  const durationByFileId = new Map<string, number>();

  for (const clip of project.clips) {
    if (!referenceTrackIds.has(clip.trackId) && clip.role !== "reference") continue;
    durationByFileId.set(clip.fileId, (durationByFileId.get(clip.fileId) ?? 0) + Math.max(0, clip.durationSec));
  }

  const referencedFile = project.files
    .filter((file) => durationByFileId.has(file.id))
    .sort((a, b) => (durationByFileId.get(b.id) ?? 0) - (durationByFileId.get(a.id) ?? 0))[0];
  if (referencedFile) return referencedFile;

  return project.files
    .filter((file) => file.role === "reference")
    .sort((a, b) => b.durationSec - a.durationSec)[0] ?? null;
}

function buildRevisionKey(project: Project, referenceFile: AudioFileRef | null, baseName: string) {
  const sourceKey = referenceFile?.id || referenceFile?.storageKey || baseName.toLocaleLowerCase();
  return `${MASTER_EXPORT_COUNTER_PREFIX}:${encodeURIComponent(project.id)}:${encodeURIComponent(sourceKey)}`;
}

function readStoredRevision(store: MasterExportRevisionStore | null, key: string) {
  try {
    const parsed = Number.parseInt(store?.getItem(key) ?? "0", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function getLocalStorage(): MasterExportRevisionStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function stripFileExtension(name: string) {
  const leafName = name.split(/[\\/]/).pop()?.trim() ?? "";
  return leafName.replace(/\.[^.]+$/u, "");
}

function stripGeneratedMasterSuffix(name: string) {
  return name.replace(/_sw_master(?:_\d{2,})?$/iu, "");
}

function sanitizeExportBaseName(name: string) {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/[. ]+$/u, "")
    .trim();
  return sanitized || "Sweet_DAW";
}
