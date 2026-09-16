import type { CharacterPluginState, CompressorState, ParametricEQState, StemRole } from "@/daw/model/Project";

export type BuiltinPluginId =
  | "sweet-parametric-eq"
  | "sweet-character"
  | "sweet-compressor"
  | "sweet-limiter"
  | "sweet-filter"
  | "sweet-drive"
  | "sweet-saturator"
  | "sweet-clipper"
  | "sweet-peak-maximizer"
  | "sweet-low-end-translator"
  | "sweet-air-exciter"
  | "sweet-tilt-eq"
  | "sweet-aimix-glow"
  | "sweet-utility"
  | "sweet-delay-lite"
  | "sweet-reverb-lite"
  | "sweet-guitar-fx"
  | "sweet-guitar-drive"
  | "sweet-guitar-amp"
  | "sweet-guitar-cab"
  | "sweet-guitar-rig"
  | "sweet-vocal-fx"
  | "sweet-bass-enhancer"
  | "sweet-de-esser"
  | "sweet-vocal-duck-eq"
  | "sweet-parallel-comp"
  | "sweet-gate-lite"
  | "sweet-chorus"
  | "sweet-phaser"
  | "sweet-stereo-widener"
  | "sweet-support-widener"
  | "sweet-transient-shaper"
  | "sweet-rhythm-chopper"
  | "sweet-guitarizer"
  | "sweet-vocal-formant-color"
  | "sweet-ir-space"
  | "sweet-vocoder-lite"
  | "sweet-pitch-assist"
  | "sweet-granular-texture"
  | "sweet-multiband-comp"
  | "sweet-wavetable-carrier";

export const BUILTIN_PLUGIN_IDS: BuiltinPluginId[] = [
  "sweet-parametric-eq",
  "sweet-character",
  "sweet-compressor",
  "sweet-limiter",
  "sweet-filter",
  "sweet-drive",
  "sweet-saturator",
  "sweet-clipper",
  "sweet-peak-maximizer",
  "sweet-low-end-translator",
  "sweet-air-exciter",
  "sweet-tilt-eq",
  "sweet-aimix-glow",
  "sweet-utility",
  "sweet-delay-lite",
  "sweet-reverb-lite",
  "sweet-guitar-fx",
  "sweet-guitar-drive",
  "sweet-guitar-amp",
  "sweet-guitar-cab",
  "sweet-guitar-rig",
  "sweet-vocal-fx",
  "sweet-bass-enhancer",
  "sweet-de-esser",
  "sweet-vocal-duck-eq",
  "sweet-parallel-comp",
  "sweet-gate-lite",
  "sweet-chorus",
  "sweet-phaser",
  "sweet-stereo-widener",
  "sweet-support-widener",
  "sweet-transient-shaper",
  "sweet-rhythm-chopper",
  "sweet-guitarizer",
  "sweet-vocal-formant-color",
  "sweet-ir-space",
  "sweet-vocoder-lite",
  "sweet-pitch-assist",
  "sweet-granular-texture",
  "sweet-multiband-comp",
  "sweet-wavetable-carrier",
];

const BUILTIN_PLUGIN_ID_SET = new Set<string>(BUILTIN_PLUGIN_IDS);

export function isBuiltinPluginId(value: unknown): value is BuiltinPluginId {
  return typeof value === "string" && BUILTIN_PLUGIN_ID_SET.has(value);
}

export type PluginTargetKind = "clip" | "track" | "master" | "instrument";

export type PluginCategory =
  | "eq"
  | "dynamics"
  | "saturation"
  | "modulation"
  | "space"
  | "utility"
  | "instrument"
  | "transform"
  | "vocal"
  | "guitar"
  | "cabinet";

export type PluginCpuCost = "low" | "medium" | "high";

export type PluginDescriptor = {
  id: BuiltinPluginId;
  name: string;
  shortName: string;
  category: PluginCategory;
  description: string;
  supportedTargets: PluginTargetKind[];
  supportedRoles?: StemRole[];
  recommendedFor?: StemRole[];
  latencySec: number;
  mobileSafe: boolean;
  cpuCost?: PluginCpuCost;
  memoryCost?: PluginCpuCost;
  realtimeSafe?: boolean;
  offlineOnly?: boolean;
  external: false;
  insertable: boolean;
  createDefaultParams: () => PluginParams;
};

export type PluginTarget =
  | {
      kind: "clip";
      clipId: string;
    }
  | {
      kind: "track";
      trackId: string;
    }
  | {
      kind: "master";
    };

export type PluginParams = Record<string, unknown>;

export type PluginInstance = {
  id: string;
  pluginId: BuiltinPluginId;
  name: string;
  enabled: boolean;
  target: PluginTargetKind;
  params: PluginParams;
  createdAt: string;
  updatedAt: string;
};

export type PluginRackState = {
  eq: ParametricEQState;
  character?: CharacterPluginState;
  compressor?: CompressorState;
  limiterEnabled?: boolean;
};
