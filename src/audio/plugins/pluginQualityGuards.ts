import type { BuiltinPluginId, PluginInstance, PluginParams, PluginTargetKind } from "@/daw/model/Plugin";
import { clamp, clamp01, finiteNumber } from "./pluginDspUtils";

export type PluginQualitySeverity = "info" | "warning" | "danger";

export type PluginQualityGuardResult = {
  pluginId: BuiltinPluginId;
  target: PluginTargetKind;
  params: PluginParams;
  warnings: string[];
  severity: PluginQualitySeverity;
};

function withNumber(params: PluginParams, key: string, fallback: number, min: number, max: number, warnings: string[], warning: string): void {
  const original = finiteNumber(params[key], fallback);
  const safe = clamp(original, min, max);
  if (safe !== original) warnings.push(warning);
  params[key] = safe;
}

function withBoolean(params: PluginParams, key: string, safe: boolean, warnings: string[], warning: string): void {
  if (params[key] !== safe) warnings.push(warning);
  params[key] = safe;
}

function capMix(params: PluginParams, max: number, warnings: string[], warning: string): void {
  withNumber(params, "mix", 0, 0, max, warnings, warning);
}

function maxOutput(params: PluginParams, max: number, warnings: string[], warning: string): void {
  const original = finiteNumber(params.outputDb, 0);
  if (original > max) warnings.push(warning);
  params.outputDb = Math.min(original, max);
}

export function resolvePluginQualityGuard(pluginId: BuiltinPluginId, target: PluginTargetKind, rawParams: PluginParams = {}): PluginQualityGuardResult {
  const params: PluginParams = { ...rawParams };
  const warnings: string[] = [];

  switch (pluginId) {
    case "sweet-air-exciter": {
      withBoolean(params, "syntheticAirBed", false, warnings, "Synthetic Air Bed is disabled; Sweet Air Exciter now derives gloss only from the source signal.");
      withNumber(params, "airBedLevel", 0, 0, 0, warnings, "Synthetic Air Bed level is forced to 0 to prevent a steady export hiss.");
      if (target === "master") {
        capMix(params, 0.04, warnings, "Sweet Air Exciter is capped on master to avoid constant hiss or brittle 14-20kHz side noise.");
        maxOutput(params, -0.8, warnings, "Sweet Air Exciter output is trimmed on master.");
      } else {
        capMix(params, 0.12, warnings, "Sweet Air Exciter mix is capped for realtime track use.");
        maxOutput(params, 0, warnings, "Sweet Air Exciter output boost is capped on tracks.");
      }
      break;
    }
    case "sweet-aimix-glow": {
      capMix(params, 0.5, warnings, "AIMIX Glow insert mix is capped so it stays a polish, not a replacement chain.");
      maxOutput(params, 0, warnings, "AIMIX Glow output boost is capped to preserve headroom.");
      break;
    }
    case "sweet-stereo-widener": {
      if (target === "master") {
        capMix(params, 0.08, warnings, "Stereo Widener is capped on master; use support tracks for width.");
        withNumber(params, "width", 0.12, 0, 0.16, warnings, "Stereo Widener width is capped on master.");
      } else {
        capMix(params, 0.2, warnings, "Stereo Widener mix is capped for mono safety.");
        withNumber(params, "delayMs", 8, 2, 18, warnings, "Stereo Widener delay is capped to reduce comb filtering.");
      }
      break;
    }
    case "sweet-support-widener": {
      capMix(params, 0.18, warnings, "Support Widener mix is capped for mono safety.");
      withNumber(params, "highPassHz", 2500, 180, 8000, warnings, "Support Widener high-pass is clamped.");
      withNumber(params, "delayMs", 7, 3, 14, warnings, "Support Widener delay is capped to reduce phase smear.");
      break;
    }
    case "sweet-reverb-lite": {
      if (target === "master") {
        capMix(params, 0.04, warnings, "Reverb Lite is capped on master; use track sends or ambience for depth.");
        withNumber(params, "decaySec", 0.65, 0.12, 0.9, warnings, "Reverb decay is capped on master.");
      } else {
        capMix(params, 0.22, warnings, "Reverb Lite mix is capped for mobile-safe exports.");
      }
      break;
    }
    case "sweet-ir-space":
    case "sweet-guitar-cab": {
      if (target === "master") {
        capMix(params, 0.12, warnings, "Convolver cabinet/space is capped on master to avoid washing out the full mix.");
        withNumber(params, "width", 0.12, 0, 0.16, warnings, "Convolver width is capped on master.");
      } else {
        capMix(params, 0.58, warnings, "Convolver wet mix is capped to protect the source tone.");
      }
      break;
    }
    case "sweet-delay-lite": {
      if (target === "master") capMix(params, 0.08, warnings, "Delay Lite is capped on master.");
      withNumber(params, "feedback", 0.25, 0, 0.65, warnings, "Delay feedback is capped to prevent runaway repeats.");
      break;
    }
    case "sweet-granular-texture": {
      capMix(params, 0.18, warnings, "Granular Texture mix is capped for realtime stability.");
      withNumber(params, "spray", 0.42, 0, 0.72, warnings, "Granular spray is capped to prevent smeared tails.");
      break;
    }
    case "sweet-vocoder-lite":
    case "sweet-wavetable-carrier": {
      capMix(params, 0.28, warnings, "Generated carrier mix is capped so it does not replace the stem.");
      break;
    }
    case "sweet-multiband-comp": {
      capMix(params, target === "master" ? 0.45 : 0.6, warnings, "Multiband Comp mix is capped to avoid over-flattening.");
      withNumber(params, "makeupDb", 0, -6, target === "master" ? 1 : 3, warnings, "Multiband makeup gain is capped for headroom.");
      break;
    }
    case "sweet-saturator": {
      if (target === "master") capMix(params, 0.08, warnings, "Saturator is capped on master to avoid accumulating high-frequency grit.");
      maxOutput(params, target === "master" ? -0.2 : 0, warnings, "Saturator output boost is capped.");
      break;
    }
    default:
      break;
  }

  const severity: PluginQualitySeverity = warnings.length === 0 ? "info" : warnings.length >= 2 ? "danger" : "warning";
  return { pluginId, target, params, warnings, severity };
}

export function applyPluginQualityGuards(instance: PluginInstance): { instance: PluginInstance; warnings: string[]; severity: PluginQualitySeverity } {
  const result = resolvePluginQualityGuard(instance.pluginId, instance.target, instance.params);
  return {
    instance: result.warnings.length > 0 ? { ...instance, params: result.params } : instance,
    warnings: result.warnings,
    severity: result.severity,
  };
}

export function isRiskyPluginMix(params: PluginParams, threshold = 0.5): boolean {
  return clamp01(finiteNumber(params.mix, 0)) > threshold;
}
