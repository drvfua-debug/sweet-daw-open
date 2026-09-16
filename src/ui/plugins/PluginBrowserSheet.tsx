"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Plus, Puzzle, Search, Star, X } from "lucide-react";
import { getInsertablePluginsForTarget, getPluginCpuCost } from "@/audio/plugins/pluginRegistry";
import { createPluginQualityReportItem } from "@/audio/plugins/pluginQualityReport";
import { STEM_ROLES, type StemRole } from "@/daw/model/Project";
import type { BuiltinPluginId, PluginCategory, PluginDescriptor, PluginTargetKind } from "@/daw/model/Plugin";

type PluginBrowserSheetProps = {
  targetKind: PluginTargetKind;
  role?: StemRole;
  title: string;
  onAdd: (pluginId: BuiltinPluginId) => void;
  onClose: () => void;
};

const CATEGORY_LABELS: Record<PluginCategory, string> = {
  eq: "EQ",
  dynamics: "Dynamics",
  saturation: "Saturation",
  modulation: "Modulation",
  space: "Space",
  utility: "Utility",
  instrument: "Instrument",
  transform: "Transform",
  vocal: "Vocal",
  guitar: "Guitar",
  cabinet: "Cabinet",
};

const CATEGORY_GROUPS: Array<{ label: string; categories: PluginCategory[] }> = [
  { label: "Core Mix", categories: ["eq", "dynamics", "utility"] },
  { label: "Tone / Amp", categories: ["saturation", "guitar", "cabinet"] },
  { label: "Space / Movement", categories: ["space", "modulation"] },
  { label: "Creative / Render", categories: ["transform", "vocal", "instrument"] },
];

const FAVORITES_KEY = "sweet-daw.favorite-plugins";
const RECENTS_KEY = "sweet-daw.recent-plugins";

export function PluginBrowserSheet({ targetKind, role, title, onAdd, onClose }: PluginBrowserSheetProps) {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedRole, setSelectedRole] = useState<StemRole | "all">(role ?? "all");
  const [selectedTarget, setSelectedTarget] = useState<PluginTargetKind | "all">(targetKind);
  const [favorites, setFavorites] = useState<BuiltinPluginId[]>(() => readPluginIds(FAVORITES_KEY));
  const [recent, setRecent] = useState<BuiltinPluginId[]>(() => readPluginIds(RECENTS_KEY));

  const basePlugins = useMemo(() => getInsertablePluginsForTarget(targetKind), [targetKind]);
  const plugins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return basePlugins
      .filter((plugin) => selectedCategory === "all" || plugin.category === selectedCategory)
      .filter((plugin) => selectedTarget === "all" || plugin.supportedTargets.includes(selectedTarget) || (selectedTarget === "clip" && plugin.supportedTargets.includes("track")))
      .filter((plugin) => selectedRole === "all" || isPluginRecommendedForRole(plugin, selectedRole))
      .filter((plugin) => !normalizedQuery || `${plugin.name} ${plugin.shortName} ${plugin.description}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => sortPluginsForBrowser(a, b, role));
  }, [basePlugins, query, role, selectedCategory, selectedRole, selectedTarget]);

  const recommended = role ? plugins.filter((plugin) => isPluginRecommendedForRole(plugin, role)).slice(0, 6) : [];
  const favoritePlugins = favorites.map((id) => basePlugins.find((plugin) => plugin.id === id)).filter(Boolean) as PluginDescriptor[];
  const recentPlugins = recent.map((id) => basePlugins.find((plugin) => plugin.id === id)).filter(Boolean) as PluginDescriptor[];

  const handleAdd = (pluginId: BuiltinPluginId) => {
    const nextRecent = [pluginId, ...recent.filter((id) => id !== pluginId)].slice(0, 8);
    setRecent(nextRecent);
    writePluginIds(RECENTS_KEY, nextRecent);
    onAdd(pluginId);
  };

  const toggleFavorite = (pluginId: BuiltinPluginId) => {
    const next = favorites.includes(pluginId)
      ? favorites.filter((id) => id !== pluginId)
      : [pluginId, ...favorites].slice(0, 24);
    setFavorites(next);
    writePluginIds(FAVORITES_KEY, next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-daw-bg/80 p-2 backdrop-blur-md sm:items-center sm:justify-center">
      <section className="view-enter flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-panel shadow-2xl">
        <header className="flex min-h-[52px] items-center justify-between border-b border-daw-line px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-daw-cyan/25 bg-daw-cyan/10 text-daw-cyan">
              <Puzzle size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold">{title}</h2>
              <p className="truncate text-[11px] text-daw-muted">Built-in mobile-safe plug-ins</p>
            </div>
          </div>
          <button type="button" className="daw-btn daw-btn-ghost !min-h-[36px] !rounded-lg" onClick={onClose} aria-label="Close plug-in browser">
            <X size={16} />
          </button>
        </header>

        <div className="daw-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-daw-line bg-white/[0.03] px-3">
            <Search size={15} className="text-daw-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search plugins"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-daw-muted"
            />
          </label>

          <div className="space-y-2">
            <div className="text-[11px] font-bold text-daw-muted">Category</div>
            <div className="daw-scrollbar flex gap-2 overflow-x-auto pb-1">
              <FilterButton active={selectedCategory === "all"} label="All" onClick={() => setSelectedCategory("all")} />
              {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
                <FilterButton key={category} active={selectedCategory === category} label={label} onClick={() => setSelectedCategory(category)} />
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-daw-muted">Role</div>
              <div className="daw-scrollbar flex gap-2 overflow-x-auto pb-1">
                <FilterButton active={selectedRole === "all"} label="All" onClick={() => setSelectedRole("all")} />
                {STEM_ROLES.map((stemRole) => (
                  <FilterButton key={stemRole} active={selectedRole === stemRole} label={stemRole} onClick={() => setSelectedRole(stemRole)} />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-daw-muted">Target</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {(["all", "clip", "track", "master"] as const).map((target) => (
                  <FilterButton key={target} active={selectedTarget === target} label={target.toUpperCase()} onClick={() => setSelectedTarget(target)} />
                ))}
              </div>
            </div>
          </div>

          {recommended.length > 0 && (
            <PluginSection title={`Recommended for ${role}`} targetKind={targetKind} plugins={recommended} favorites={favorites} onAdd={handleAdd} onToggleFavorite={toggleFavorite} />
          )}
          {favoritePlugins.length > 0 && (
            <PluginSection title="Favorites" targetKind={targetKind} plugins={favoritePlugins} favorites={favorites} onAdd={handleAdd} onToggleFavorite={toggleFavorite} />
          )}
          {recentPlugins.length > 0 && (
            <PluginSection title="Recently Used" targetKind={targetKind} plugins={recentPlugins} favorites={favorites} onAdd={handleAdd} onToggleFavorite={toggleFavorite} />
          )}

          <PluginSection title="All Plugins" targetKind={targetKind} plugins={plugins} favorites={favorites} onAdd={handleAdd} onToggleFavorite={toggleFavorite} />
        </div>
      </section>
    </div>
  );
}

function PluginSection({
  title,
  targetKind,
  plugins,
  favorites,
  onAdd,
  onToggleFavorite,
}: {
  title: string;
  targetKind: PluginTargetKind;
  plugins: PluginDescriptor[];
  favorites: BuiltinPluginId[];
  onAdd: (pluginId: BuiltinPluginId) => void;
  onToggleFavorite: (pluginId: BuiltinPluginId) => void;
}) {
  if (plugins.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="text-[11px] font-bold text-daw-muted">{title}</div>
      <div className="grid gap-2">
        {plugins.map((plugin) => (
          <PluginButton
            key={`${title}-${plugin.id}`}
            plugin={plugin}
            targetKind={targetKind}
            favorite={favorites.includes(plugin.id)}
            onAdd={() => onAdd(plugin.id)}
            onToggleFavorite={() => onToggleFavorite(plugin.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PluginButton({
  plugin,
  targetKind,
  favorite,
  onAdd,
  onToggleFavorite,
}: {
  plugin: PluginDescriptor;
  targetKind: PluginTargetKind;
  favorite: boolean;
  onAdd: () => void;
  onToggleFavorite: () => void;
}) {
  const cpu = getPluginCpuCost(plugin.id);
  const heavy = cpu === "high";
  const quality = createPluginQualityReportItem({
    id: `preview-${plugin.id}`,
    pluginId: plugin.id,
    name: plugin.name,
    enabled: true,
    target: targetKind,
    params: plugin.createDefaultParams(),
    createdAt: "preview",
    updatedAt: "preview",
  });
  const warning = quality.warnings[0];
  const offlinePreferred = plugin.offlineOnly || !quality.realtimeSafe;
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-3 rounded-xl border border-daw-line bg-daw-panel2 p-3 text-left">
      <button type="button" onClick={onAdd} className="min-w-0 flex-1 text-left" aria-label={`Add ${plugin.name}`}>
        <span className="block truncate text-sm font-bold">{plugin.name}</span>
        <span className="mt-1 block text-[11px] leading-4 text-daw-muted">{plugin.description}</span>
        <span className="mt-1 flex flex-wrap gap-1 text-[10px]">
          <Badge>{CATEGORY_LABELS[plugin.category]}</Badge>
          <Badge>Clip OK</Badge>
          {plugin.supportedTargets.includes("track") && <Badge>Track OK</Badge>}
          {plugin.supportedTargets.includes("master") && <Badge>Master OK</Badge>}
          <Badge tone={heavy ? "heavy" : "safe"}>{heavy ? "Heavy" : `Load ${cpu}`}</Badge>
          {quality.memoryCost !== "low" && <Badge tone={quality.memoryCost === "high" ? "heavy" : "default"}>Memory {quality.memoryCost}</Badge>}
          {offlinePreferred && <Badge tone="heavy">Offline preferred</Badge>}
          {heavy && <Badge tone="heavy">Freeze Recommended</Badge>}
        </span>
        {warning && (
          <span className={`mt-2 flex items-center gap-1 text-[10px] font-semibold ${quality.severity === "danger" ? "text-daw-red" : "text-daw-amber"}`}>
            <AlertTriangle size={11} />
            <span className="line-clamp-2">{warning}</span>
          </span>
        )}
      </button>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          className={`grid h-9 w-9 place-items-center rounded-full border ${
            favorite ? "border-daw-amber/45 bg-daw-amber/15 text-daw-amber" : "border-daw-line bg-white/[0.03] text-daw-muted"
          }`}
          aria-label={`Favorite ${plugin.name}`}
        >
          <Star size={15} fill={favorite ? "currentColor" : "none"} />
        </button>
        <button type="button" onClick={onAdd} className="grid h-9 w-9 place-items-center rounded-full border border-daw-cyan/35 bg-daw-cyan/10 text-daw-cyan" aria-label={`Add ${plugin.name}`}>
          <Plus size={16} />
        </button>
      </span>
    </div>
  );
}

function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "heavy" | "safe" }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 font-bold ${
        tone === "heavy"
          ? "bg-daw-amber/15 text-daw-amber"
          : tone === "safe"
            ? "bg-daw-green/15 text-daw-green"
            : "bg-white/[0.06] text-daw-muted"
      }`}
    >
      {children}
    </span>
  );
}

function FilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-9 shrink-0 rounded-lg border px-3 text-[11px] font-bold ${
        active ? "border-daw-cyan/35 bg-daw-cyan/15 text-daw-cyan" : "border-daw-line bg-white/[0.03] text-daw-muted"
      }`}
    >
      {label}
    </button>
  );
}

function isRenderRecommended(category: PluginCategory) {
  return category === "transform" || category === "vocal" || category === "cabinet" || category === "guitar";
}

function sortPluginsForBrowser(a: PluginDescriptor, b: PluginDescriptor, role?: StemRole) {
  if (role) {
    const aRecommended = isPluginRecommendedForRole(a, role);
    const bRecommended = isPluginRecommendedForRole(b, role);
    if (aRecommended !== bRecommended) return aRecommended ? -1 : 1;
  }
  if (a.category === b.category) return a.name.localeCompare(b.name);
  return CATEGORY_LABELS[a.category].localeCompare(CATEGORY_LABELS[b.category]);
}

function isPluginRecommendedForRole(plugin: PluginDescriptor, role: StemRole) {
  const map: Record<StemRole, BuiltinPluginId[]> = {
    vocal: ["sweet-aimix-glow", "sweet-vocal-fx", "sweet-de-esser", "sweet-vocal-formant-color", "sweet-vocoder-lite", "sweet-pitch-assist", "sweet-delay-lite", "sweet-reverb-lite"],
    backingVocal: ["sweet-aimix-glow", "sweet-vocal-fx", "sweet-de-esser", "sweet-chorus", "sweet-stereo-widener", "sweet-reverb-lite"],
    drums: ["sweet-transient-shaper", "sweet-drive", "sweet-gate-lite", "sweet-multiband-comp"],
    bass: ["sweet-bass-enhancer", "sweet-drive", "sweet-multiband-comp", "sweet-filter"],
    guitar: ["sweet-vocal-duck-eq", "sweet-guitar-rig", "sweet-guitar-amp", "sweet-guitar-cab", "sweet-guitar-drive", "sweet-chorus"],
    synth: ["sweet-vocal-duck-eq", "sweet-rhythm-chopper", "sweet-granular-texture", "sweet-chorus", "sweet-stereo-widener", "sweet-filter"],
    keys: ["sweet-vocal-duck-eq", "sweet-chorus", "sweet-phaser", "sweet-stereo-widener", "sweet-filter", "sweet-reverb-lite"],
    fx: ["sweet-vocal-duck-eq", "sweet-granular-texture", "sweet-ir-space", "sweet-reverb-lite", "sweet-stereo-widener"],
    music: ["sweet-aimix-glow", "sweet-vocal-duck-eq", "sweet-filter", "sweet-compressor", "sweet-stereo-widener", "sweet-reverb-lite"],
    loop: ["sweet-vocal-duck-eq", "sweet-rhythm-chopper", "sweet-transient-shaper", "sweet-filter", "sweet-delay-lite"],
    other: ["sweet-vocal-duck-eq", "sweet-filter", "sweet-drive", "sweet-delay-lite", "sweet-reverb-lite"],
    reference: ["sweet-filter", "sweet-compressor"],
  };
  return map[role]?.includes(plugin.id) ?? false;
}

function readPluginIds(key: string): BuiltinPluginId[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is BuiltinPluginId => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writePluginIds(key: string, ids: BuiltinPluginId[]) {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Browsers can deny localStorage in private modes.
  }
}
