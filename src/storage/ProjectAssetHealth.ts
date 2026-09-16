import { audioBufferRegistry } from "../audio/engine/AudioBufferRegistry";
import type { Project } from "../daw/model/Project";
import { loadAudioAssetFromIndexedDb } from "./ProjectStorage";

export type ProjectAssetHealth = {
  fileId: string;
  name: string;
  byteLength: number;
  inRegistryFile: boolean;
  inRegistryBuffer: boolean;
  inIndexedDb: boolean;
  missing: boolean;
};

export type ProjectAssetHealthSummary = {
  assets: ProjectAssetHealth[];
  missingCount: number;
  recoverableCount: number;
  totalBytes: number;
};

type InspectProjectAssetHealthOptions = {
  getRegistryFile?: (fileId: string) => File | null;
  getRegistryBuffer?: (fileId: string) => AudioBuffer | null;
  loadAudioAsset?: (fileId: string) => Promise<Blob | null>;
};

export async function inspectProjectAssetHealth(
  project: Project,
  options: InspectProjectAssetHealthOptions = {},
): Promise<ProjectAssetHealthSummary> {
  const getRegistryFile = options.getRegistryFile ?? ((fileId: string) => audioBufferRegistry.getFile(fileId));
  const getRegistryBuffer = options.getRegistryBuffer ?? ((fileId: string) => audioBufferRegistry.getBuffer(fileId));
  const loadAudioAsset = options.loadAudioAsset ?? loadAudioAssetFromIndexedDb;

  const assets = await Promise.all(
    project.files.map(async (fileRef) => {
      const registryFile = getRegistryFile(fileRef.id);
      const registryBuffer = getRegistryBuffer(fileRef.id);
      const idbBlob = await loadAudioAsset(fileRef.id).catch(() => null);
      const inRegistryFile = Boolean(registryFile);
      const inRegistryBuffer = Boolean(registryBuffer);
      const inIndexedDb = Boolean(idbBlob);

      return {
        fileId: fileRef.id,
        name: fileRef.name,
        byteLength: fileRef.byteLength || registryFile?.size || idbBlob?.size || 0,
        inRegistryFile,
        inRegistryBuffer,
        inIndexedDb,
        missing: !inRegistryFile && !inIndexedDb,
      } satisfies ProjectAssetHealth;
    }),
  );

  return {
    assets,
    missingCount: assets.filter((asset) => asset.missing).length,
    recoverableCount: assets.filter((asset) => !asset.inRegistryFile && asset.inIndexedDb).length,
    totalBytes: assets.reduce((sum, asset) => sum + asset.byteLength, 0),
  };
}
