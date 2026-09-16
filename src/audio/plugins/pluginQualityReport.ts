import type { BuiltinPluginId, PluginInstance, PluginTargetKind } from "@/daw/model/Plugin";
import { getPluginDescriptor, getPluginCpuCost } from "./pluginRegistry";
import { resolvePluginQualityGuard, type PluginQualitySeverity } from "./pluginQualityGuards";

export type PluginQualityReportItem = {
  instanceId: string;
  pluginId: BuiltinPluginId;
  name: string;
  target: PluginTargetKind;
  cpuCost: "low" | "medium" | "high";
  memoryCost: "low" | "medium" | "high";
  realtimeSafe: boolean;
  severity: PluginQualitySeverity;
  warnings: string[];
};

export type PluginQualityReport = {
  itemCount: number;
  cpuScore: number;
  highCpuCount: number;
  masterRiskCount: number;
  warnings: string[];
  items: PluginQualityReportItem[];
};

const CPU_SCORE = {
  low: 1,
  medium: 2,
  high: 4,
} as const;

const MASTER_RISK_PLUGINS = new Set<BuiltinPluginId>([
  "sweet-air-exciter",
  "sweet-stereo-widener",
  "sweet-reverb-lite",
  "sweet-ir-space",
  "sweet-guitar-cab",
  "sweet-delay-lite",
  "sweet-saturator",
  "sweet-multiband-comp",
]);

export function createPluginQualityReport(chain: PluginInstance[]): PluginQualityReport {
  const items = chain.map((instance) => createPluginQualityReportItem(instance));
  const cpuScore = items.reduce((sum, item) => sum + CPU_SCORE[item.cpuCost], 0);
  const highCpuCount = items.filter((item) => item.cpuCost === "high").length;
  const masterRiskCount = items.filter((item) => item.target === "master" && MASTER_RISK_PLUGINS.has(item.pluginId)).length;
  const warnings = items.flatMap((item) => item.warnings.map((warning) => `${item.name}: ${warning}`));
  if (cpuScore >= 14) warnings.push("Plugin chain is heavy for iPhone Safari. Freeze/export or bypass nonessential modulation/convolver plugins.");
  if (masterRiskCount >= 2) warnings.push("Multiple risky master inserts are active. Keep mastering simple before export.");

  return {
    itemCount: items.length,
    cpuScore,
    highCpuCount,
    masterRiskCount,
    warnings,
    items,
  };
}

export function createPluginQualityReportItem(instance: PluginInstance): PluginQualityReportItem {
  const descriptor = getPluginDescriptor(instance.pluginId);
  const cpuCost = descriptor?.cpuCost ?? getPluginCpuCost(instance.pluginId);
  const memoryCost = descriptor?.memoryCost ?? (cpuCost === "high" ? "medium" : "low");
  const realtimeSafe = descriptor?.realtimeSafe ?? cpuCost !== "high";
  const guard = resolvePluginQualityGuard(instance.pluginId, instance.target, instance.params);
  const warnings = [...guard.warnings];
  if (!realtimeSafe) warnings.push("This plugin can be heavy on mobile; prefer offline render or a shorter preview.");
  if (instance.target === "master" && MASTER_RISK_PLUGINS.has(instance.pluginId)) warnings.push("Master insert risk: use subtle settings and compare loudness-matched A/B.");

  return {
    instanceId: instance.id,
    pluginId: instance.pluginId,
    name: descriptor?.name ?? instance.name,
    target: instance.target,
    cpuCost,
    memoryCost,
    realtimeSafe,
    severity: warnings.length >= 2 ? "danger" : warnings.length === 1 ? "warning" : guard.severity,
    warnings,
  };
}
