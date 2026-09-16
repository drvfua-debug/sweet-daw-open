"use client";

import { migrateProject, type AudioFileRef, type Project } from "../daw/model/Project";

const DB_NAME = "sweet-daw-project-storage";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";
const AUDIO_STORE = "audioAssets";
const CURRENT_PROJECT_KEY = "current";

type StoredProjectRecord = {
  key: string;
  projectId: string;
  title: string;
  project: Project;
  savedAt: string;
  assetCount: number;
  estimatedBytes: number;
};

type StoredAudioAssetRecord = {
  fileId: string;
  fileRef: AudioFileRef;
  blob: Blob;
  savedAt: string;
};

function isIndexedDbAvailable() {
  return typeof indexedDB !== "undefined";
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

async function openSweetDawDb() {
  if (!isIndexedDbAvailable()) {
    throw new Error("IndexedDB is not available in this browser");
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE, { keyPath: "fileId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open Sweet DAW storage"));
  });
}

function withIdbConnection<T>(work: (db: IDBDatabase) => Promise<T>) {
  return openSweetDawDb().then(async (db) => {
    try {
      return await work(db);
    } finally {
      db.close();
    }
  });
}

export async function saveProjectToIndexedDb(project: Project) {
  await withIdbConnection(async (db) => {
    const transaction = db.transaction(PROJECT_STORE, "readwrite");
    const estimatedBytes = project.files.reduce((sum, file) => sum + (file.byteLength || 0), 0);
    const record: StoredProjectRecord = {
      key: project.id,
      projectId: project.id,
      title: project.title,
      project: {
        ...project,
        storage: {
          ...project.storage,
          saveMode: "indexeddb",
          lastSavedAt: new Date().toISOString(),
          assetCount: project.files.length,
          estimatedBytes,
        },
      },
      savedAt: new Date().toISOString(),
      assetCount: project.files.length,
      estimatedBytes,
    };
    const currentRecord = { ...record, key: CURRENT_PROJECT_KEY };
    transaction.objectStore(PROJECT_STORE).put(record);
    transaction.objectStore(PROJECT_STORE).put(currentRecord);
    await transactionDone(transaction);
  });
}

export async function loadProjectFromIndexedDb(projectId = CURRENT_PROJECT_KEY) {
  return withIdbConnection(async (db) => {
    const transaction = db.transaction(PROJECT_STORE, "readonly");
    const record = await requestToPromise<StoredProjectRecord | undefined>(
      transaction.objectStore(PROJECT_STORE).get(projectId),
    );
    await transactionDone(transaction);
    return record?.project ? migrateProject(record.project) : null;
  });
}

export async function listProjectsFromIndexedDb() {
  return withIdbConnection(async (db) => {
    const transaction = db.transaction(PROJECT_STORE, "readonly");
    const records = await requestToPromise<StoredProjectRecord[]>(transaction.objectStore(PROJECT_STORE).getAll());
    await transactionDone(transaction);
    return records
      .filter((record) => record.key !== CURRENT_PROJECT_KEY)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map((record) => ({
        projectId: record.projectId,
        title: record.title,
        savedAt: record.savedAt,
        assetCount: record.assetCount,
        estimatedBytes: record.estimatedBytes,
      }));
  });
}

export async function saveAudioAssetToIndexedDb(fileRef: AudioFileRef, blob: Blob) {
  await withIdbConnection(async (db) => {
    const transaction = db.transaction(AUDIO_STORE, "readwrite");
    const record: StoredAudioAssetRecord = {
      fileId: fileRef.id,
      fileRef,
      blob,
      savedAt: new Date().toISOString(),
    };
    transaction.objectStore(AUDIO_STORE).put(record);
    await transactionDone(transaction);
  });
}

export async function loadAudioAssetFromIndexedDb(fileId: string) {
  return withIdbConnection(async (db) => {
    const transaction = db.transaction(AUDIO_STORE, "readonly");
    const record = await requestToPromise<StoredAudioAssetRecord | undefined>(
      transaction.objectStore(AUDIO_STORE).get(fileId),
    );
    await transactionDone(transaction);
    return record?.blob ?? null;
  });
}

export async function getStorageHealthFromIndexedDb() {
  return withIdbConnection(async (db) => {
    const transaction = db.transaction([PROJECT_STORE, AUDIO_STORE], "readonly");
    const projectRecords = await requestToPromise<StoredProjectRecord[]>(transaction.objectStore(PROJECT_STORE).getAll());
    const audioRecords = await requestToPromise<StoredAudioAssetRecord[]>(transaction.objectStore(AUDIO_STORE).getAll());
    await transactionDone(transaction);
    return {
      backend: "indexeddb" as const,
      projectCount: projectRecords.filter((record) => record.key !== CURRENT_PROJECT_KEY).length,
      audioAssetCount: audioRecords.length,
      estimatedAudioBytes: audioRecords.reduce((sum, record) => sum + record.blob.size, 0),
      lastSavedAt: projectRecords
        .filter((record) => record.key === CURRENT_PROJECT_KEY)
        .map((record) => record.savedAt)[0],
    };
  });
}

export async function getBrowserStorageEstimate() {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }

  const estimate = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  return {
    usage: estimate.usage ?? null,
    quota: estimate.quota ?? null,
    persisted,
  };
}

export async function deleteSweetDawProjectFromIndexedDb() {
  await withIdbConnection(async (db) => {
    const transaction = db.transaction([PROJECT_STORE, AUDIO_STORE], "readwrite");
    transaction.objectStore(PROJECT_STORE).clear();
    transaction.objectStore(AUDIO_STORE).clear();
    await transactionDone(transaction);
  });
}
