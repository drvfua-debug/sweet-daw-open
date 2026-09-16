import type { BuiltinPluginId } from "@/daw/model/Plugin";
import { getPluginCpuCost, getPluginDescriptor } from "./pluginRegistry";

const HEAVY_RENDER_PLUGIN_IDS = new Set<string>([
  "sweet-reverb-lite",
  "sweet-ir-space",
  "sweet-guitar-cab",
  "sweet-guitar-rig",
  "sweet-granular-texture",
  "sweet-vocoder-lite",
  "sweet-aimix-glow",
  "sweet-air-exciter",
  "sweet-peak-maximizer",
  "sweet-multiband-comp",
  "sweet-stereo-widener",
  "sweet-support-widener",
  "sweet-vocal-formant-color",
]);

const MEDIUM_RENDER_PLUGIN_IDS = new Set<string>([
  "sweet-guitar-fx",
  "sweet-guitar-amp",
  "sweet-pitch-assist",
  "sweet-wavetable-carrier",
  "sweet-chorus",
  "sweet-phaser",
  "sweet-delay-lite",
  "sweet-saturator",
  "sweet-clipper",
  "sweet-low-end-translator",
]);

export function getPluginRenderWeight(pluginId: string): number {
  const descriptor = getPluginDescriptor(pluginId as BuiltinPluginId);
  const cpuCost = descriptor?.cpuCost ?? getPluginCpuCost(pluginId as BuiltinPluginId);
  const memoryCost = descriptor?.memoryCost ?? (cpuCost === "high" ? "medium" : "low");
  const realtimeSafe = descriptor?.realtimeSafe ?? cpuCost !== "high";

  let weight = 1;
  if (cpuCost === "medium") weight += 1;
  if (cpuCost === "high") weight += 2.5;
  if (memoryCost === "medium") weight += 0.75;
  if (memoryCost === "high") weight += 1.75;
  if (!realtimeSafe) weight += 1.25;
  if (HEAVY_RENDER_PLUGIN_IDS.has(pluginId)) weight += 1.5;
  if (MEDIUM_RENDER_PLUGIN_IDS.has(pluginId)) weight += 0.5;
  return Math.round(weight * 10) / 10;
}

export function isHeavyRenderPlugin(pluginId: string): boolean {
  if (HEAVY_RENDER_PLUGIN_IDS.has(pluginId)) return true;
  return getPluginRenderWeight(pluginId) >= 4;
}

export function isRealtimeRiskPlugin(pluginId: string): boolean {
  const descriptor = getPluginDescriptor(pluginId as BuiltinPluginId);
  if (descriptor?.realtimeSafe === false) return true;
  return isHeavyRenderPlugin(pluginId);
}
