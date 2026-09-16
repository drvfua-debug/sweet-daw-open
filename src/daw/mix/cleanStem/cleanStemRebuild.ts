import { createPluginInstance } from "../../../audio/plugins/pluginRegistry";
import type { Project, StemRole, Track } from "../../model/Project";
import type { BuiltinPluginId, PluginInstance } from "../../model/Plugin";
import type { StemFeatureReport } from "../mixDoctorTypes";
import { applyPeakingToSlot } from "../eqSlotUtils";
import { buildBandOwnershipPlan, type BandOwnerPlan } from "./bandOwnershipPlanner";
import { resolveEffectiveStemRoles, type EffectiveStemRole } from "./effectiveRole";
import { buildPlacementPlan, type PlacementPlan } from "./placementPlanner";

export type CleanStemRebuildOptions = {
  stemFeatureReports?: StemFeatureReport[];
};

export type CleanStemRebuildResult = {
  project: Project;
  effectiveRoles: EffectiveStemRole[];
  bandPlans: BandOwnerPlan[];
  placementPlans: PlacementPlan[];
  decisions: string[];
};

const CLEAN_REBUILD_FORBIDDEN_INSERTS = new Set<BuiltinPluginId>([
  "sweet-stereo-widener",
  "sweet-reverb-lite",
  "sweet-ir-space",
  "sweet-granular-texture",
  "sweet-vocoder-lite",
]);

export function applyCleanStemRebuild(project: Project, options: CleanStemRebuildOptions = {}): CleanStemRebuildResult {
  const source = cloneProject(project);
  const effectiveRoles = resolveEffectiveStemRoles(source, { stemFeatureReports: options.stemFeatureReports });
  const bandPlans = buildBandOwnershipPlan(source, effectiveRoles, { stemFeatureReports: options.stemFeatureReports });
  const placementPlans = buildPlacementPlan(source, effectiveRoles, { stemFeatureReports: options.stemFeatureReports });
  const cutsByTrackId = groupCutsByTrack(bandPlans);
  const placementByTrackId = new Map(placementPlans.map((plan) => [plan.trackId, plan]));
  const effectiveByTrackId = new Map(effectiveRoles.map((role) => [role.trackId, role]));
  const decisions: string[] = [
    "Clean Rebuild: Suno clean stems are treated as DAW source material, not as a direct WAV clone.",
  ];

  const tracks = source.tracks.map((track) => {
    if (track.role === "reference") return track;
    const role = effectiveByTrackId.get(track.id)?.effectiveRole ?? track.role;
    const placement = placementByTrackId.get(track.id);
    const cuts = cutsByTrackId.get(track.id) ?? [];
    const next = applyCleanStemTrack(track, role, placement, cuts);
    if (role !== track.role) {
      decisions.push(`Effective Role: ${track.name} stays displayed as ${track.role}, processed as ${role}.`);
    }
    if (cuts.length > 0) {
      decisions.push(`Band Ownership: ${track.name} received ${cuts.length} small EQ cut(s).`);
    }
    if (placement && Math.abs(placement.panBias) > 0.001) {
      decisions.push(`Placement: ${track.name} pan ${formatSigned(placement.panBias)} / ${placement.widthBand}.`);
    }
    return next;
  });

  const guardedMasterGain = source.master.limiterEnabled
    ? clamp(source.master.gainDb, 0, 2)
    : clamp(source.master.gainDb, -1, 2);
  if (source.master.gainDb > 3) {
    decisions.push(`Master Gain Guard: master gain ${source.master.gainDb.toFixed(1)}dB was reduced to ${guardedMasterGain.toFixed(1)}dB before the limiter output stage.`);
  }
  decisions.push("Master Gain Guard: master gain now feeds the limiter stage, with export peak safety kept on.");

  return {
    project: {
      ...source,
      tracks,
      master: {
        ...source.master,
        gainDb: round1(guardedMasterGain),
        limiterEnabled: true,
        exportNormalizePeak: true,
        exportPeakTargetDb: source.master.exportPeakTargetDb ?? -1,
      },
      updatedAt: new Date().toISOString(),
    },
    effectiveRoles,
    bandPlans,
    placementPlans,
    decisions,
  };
}

function applyCleanStemTrack(
  track: Track,
  effectiveRole: StemRole,
  placement: PlacementPlan | undefined,
  cuts: BandOwnerPlan["cuts"],
): Track {
  const eq = cloneEq(track.eq);
  eq.enabled = true;
  setHighpass(eq, getRoleHighpassHz(effectiveRole));
  for (const cut of cuts) {
    applyPeakingToSlot(eq, "manual_adjustment", `clean_rebuild_${Math.round(cut.frequency)}`, cut.frequency, cut.gainDb, cut.q);
  }

  let insertChain = sanitizeCleanRebuildInserts(track.insertChain);
  if (placement && shouldUseSupportWidener(effectiveRole, placement)) {
    insertChain = upsertPlugin(insertChain, "sweet-support-widener", "track", {
      width: round2(placement.widthIntent),
      mix: round2(clamp(0.04 + placement.widthIntent * 0.55, 0.04, 0.14)),
      delayMs: round1(clamp(4 + placement.widthIntent * 55, 3, 14)),
      highPassHz: placement.widthBand === "air-only" ? 5000 : 2500,
      lowPassHz: placement.widthBand === "air-only" ? 18000 : 16000,
      lowMonoHz: placement.lowMonoHz,
      tone: 0.58,
      monoSafety: true,
    });
  }

  return {
    ...track,
    pan: round2(placement?.panBias ?? 0),
    eq,
    character: {
      ...track.character,
      enabled: false,
    },
    vocalImage: {
      ...track.vocalImage,
      enabled: false,
    },
    insertChain,
  };
}

function sanitizeCleanRebuildInserts(chain: PluginInstance[]) {
  return chain.filter((plugin) => !CLEAN_REBUILD_FORBIDDEN_INSERTS.has(plugin.pluginId));
}

function shouldUseSupportWidener(role: StemRole, placement: PlacementPlan) {
  if (placement.widthBand === "none" || placement.widthIntent <= 0.01) return false;
  if (role === "vocal" || role === "bass" || role === "drums" || role === "reference") return false;
  return true;
}

function upsertPlugin(chain: PluginInstance[], pluginId: BuiltinPluginId, target: PluginInstance["target"], params: Record<string, unknown>) {
  const index = chain.findIndex((plugin) => plugin.pluginId === pluginId);
  const now = new Date().toISOString();
  if (index >= 0) {
    return chain.map((plugin, candidateIndex) => candidateIndex === index
      ? {
          ...plugin,
          enabled: true,
          params: {
            ...plugin.params,
            ...params,
          },
          updatedAt: now,
        }
      : plugin);
  }
  const instance = createPluginInstance(pluginId, target);
  return [
    ...chain,
    {
      ...instance,
      enabled: true,
      params: {
        ...instance.params,
        ...params,
      },
      updatedAt: now,
    },
  ];
}

function groupCutsByTrack(plans: BandOwnerPlan[]) {
  const map = new Map<string, BandOwnerPlan["cuts"]>();
  for (const plan of plans) {
    for (const cut of plan.cuts) {
      const list = map.get(cut.trackId) ?? [];
      list.push(cut);
      map.set(cut.trackId, list);
    }
  }
  return map;
}

function getRoleHighpassHz(role: StemRole) {
  if (role === "bass" || role === "drums") return 28;
  if (role === "vocal") return 70;
  if (role === "backingVocal") return 90;
  if (role === "fx") return 120;
  return 40;
}

function setHighpass(eq: Project["master"]["eq"], frequency: number) {
  const band = eq.bands.find((candidate) => candidate.type === "highpass");
  if (!band) return;
  band.enabled = true;
  band.frequency = round1(clamp(frequency, 20, 20000));
  band.gainDb = 0;
  band.q = 0.7;
}

function cloneEq(eq: Project["master"]["eq"]): Project["master"]["eq"] {
  return {
    ...eq,
    bands: eq.bands.map((band) => ({ ...band })),
  };
}

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
