"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/daw/model/Project";
import {
  getBrowserStorageEstimate,
  getStorageHealthFromIndexedDb,
  listProjectsFromIndexedDb,
  saveProjectToIndexedDb,
} from "@/storage/ProjectStorage";
import { inspectProjectAssetHealth } from "@/storage/ProjectAssetHealth";

export type RecentProject = {
  projectId: string;
  title: string;
  savedAt: string;
  assetCount: number;
  estimatedBytes: number;
};

export function useStorageSync(
  project: Project,
  addDebug: (message: string) => void,
) {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [storageHealth, setStorageHealth] = useState<Record<string, string | number | null>>({});

  const refreshStorageState = useCallback(async () => {
    const [projects, health, browserStorage, assetHealth] = await Promise.all([
      listProjectsFromIndexedDb(),
      getStorageHealthFromIndexedDb(),
      getBrowserStorageEstimate().catch(() => null),
      inspectProjectAssetHealth(project).catch(() => null),
    ]);
    const usageMB = browserStorage?.usage == null ? null : Number((browserStorage.usage / 1024 / 1024).toFixed(1));
    const quotaMB = browserStorage?.quota == null ? null : Number((browserStorage.quota / 1024 / 1024).toFixed(1));
    const remainingMB =
      browserStorage?.usage == null || browserStorage.quota == null
        ? null
        : Number(((browserStorage.quota - browserStorage.usage) / 1024 / 1024).toFixed(1));
    setRecentProjects(projects);
    setStorageHealth({
      backend: health.backend,
      projects: health.projectCount,
      audioAssets: health.audioAssetCount,
      audioMB: Number((health.estimatedAudioBytes / 1024 / 1024).toFixed(1)),
      browserUsageMB: usageMB,
      browserQuotaMB: quotaMB,
      browserRemainingMB: remainingMB,
      persisted: browserStorage?.persisted == null ? null : browserStorage.persisted ? "yes" : "no",
      missingAssets: assetHealth?.missingCount ?? 0,
      recoverableAssets: assetHealth?.recoverableCount ?? 0,
      lastSaved: health.lastSavedAt ? new Date(health.lastSavedAt).toLocaleTimeString() : null,
    });
  }, [project]);

  // Autosave debounced
  useEffect(() => {
    if (project.files.length === 0 && project.tracks.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      saveProjectToIndexedDb(project)
        .then(refreshStorageState)
        .catch((error) => {
          addDebug(error instanceof Error ? `Local autosave failed: ${error.message}` : "Local autosave failed");
        });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [addDebug, project, refreshStorageState]);

  // Initial load
  useEffect(() => {
    refreshStorageState().catch(() => undefined);
  }, [refreshStorageState]);

  return { recentProjects, storageHealth, refreshStorageState };
}
