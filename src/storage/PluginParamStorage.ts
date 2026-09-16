import type { BuiltinPluginId, PluginInstance, PluginParams } from "@/daw/model/Plugin";

const STORAGE_KEY = "sweet-daw:plugin-param-defaults:v1";

type StoredPluginDefaults = {
  version: 1;
  updatedAt: string;
  plugins: Partial<Record<BuiltinPluginId, PluginParams>>;
};

export function applySavedPluginParams(instance: PluginInstance): PluginInstance {
  const savedParams = readSavedPluginParams(instance.pluginId);
  if (!savedParams) return instance;

  const now = new Date().toISOString();
  return {
    ...instance,
    params: {
      ...instance.params,
      ...savedParams,
    },
    updatedAt: now,
  };
}

export function rememberPluginParams(pluginId: BuiltinPluginId, params: PluginParams) {
  if (typeof window === "undefined") return;

  try {
    const stored = readStoredPluginDefaults();
    const next: StoredPluginDefaults = {
      version: 1,
      updatedAt: new Date().toISOString(),
      plugins: {
        ...stored.plugins,
        [pluginId]: sanitizePluginParams(params),
      },
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort convenience cache. Project JSON backup remains the reliable save path.
  }
}

function readSavedPluginParams(pluginId: BuiltinPluginId): PluginParams | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = readStoredPluginDefaults();
    return stored.plugins[pluginId] ?? null;
  } catch {
    return null;
  }
}

function readStoredPluginDefaults(): StoredPluginDefaults {
  if (typeof window === "undefined") {
    return createEmptyStoredPluginDefaults();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createEmptyStoredPluginDefaults();

  const parsed = JSON.parse(raw) as Partial<StoredPluginDefaults>;
  if (parsed.version !== 1 || !parsed.plugins || typeof parsed.plugins !== "object") {
    return createEmptyStoredPluginDefaults();
  }

  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    plugins: parsed.plugins,
  };
}

function createEmptyStoredPluginDefaults(): StoredPluginDefaults {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    plugins: {},
  };
}

function sanitizePluginParams(params: PluginParams): PluginParams {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) =>
      typeof value === "number" || typeof value === "string" || typeof value === "boolean",
    ),
  );
}
