import { describe, expect, it } from "vitest";
import type { BuiltinPluginId, PluginInstance, PluginTargetKind } from "@/daw/model/Plugin";
import { createPluginQualityReport } from "./pluginQualityReport";

function plugin(pluginId: BuiltinPluginId, target: PluginTargetKind, params: Record<string, unknown>): PluginInstance {
  return {
    id: `${pluginId}-${target}`,
    pluginId,
    name: pluginId,
    enabled: true,
    target,
    params,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("plugin quality report", () => {
  it("summarizes risky master inserts and high CPU plugins", () => {
    const report = createPluginQualityReport([
      plugin("sweet-air-exciter", "master", { mix: 0.2, syntheticAirBed: true, outputDb: 2 }),
      plugin("sweet-ir-space", "master", { mix: 0.6, width: 0.5 }),
      plugin("sweet-granular-texture", "track", { mix: 0.6, spray: 1 }),
    ]);

    expect(report.itemCount).toBe(3);
    expect(report.highCpuCount).toBeGreaterThanOrEqual(2);
    expect(report.masterRiskCount).toBe(2);
    expect(report.warnings.join(" ")).toContain("Master insert risk");
    expect(report.cpuScore).toBeGreaterThanOrEqual(9);
  });

  it("keeps a light track utility chain clean", () => {
    const report = createPluginQualityReport([
      plugin("sweet-filter", "track", { mix: 1 }),
      plugin("sweet-utility", "track", { gainDb: 0, width: 1 }),
    ]);

    expect(report.highCpuCount).toBe(0);
    expect(report.masterRiskCount).toBe(0);
    expect(report.warnings).toHaveLength(0);
  });
});