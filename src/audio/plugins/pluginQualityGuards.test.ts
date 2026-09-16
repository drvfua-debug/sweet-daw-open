import { describe, expect, it } from "vitest";
import { resolvePluginQualityGuard } from "./pluginQualityGuards";

describe("plugin quality guards", () => {
  it("caps Air Exciter on the master bus and disables synthetic air bed", () => {
    const result = resolvePluginQualityGuard("sweet-air-exciter", "master", {
      mix: 0.4,
      outputDb: 2,
      syntheticAirBed: true,
      airBedLevel: 0.12,
    });

    expect(result.params.mix).toBe(0.04);
    expect(result.params.syntheticAirBed).toBe(false);
    expect(result.params.airBedLevel).toBe(0);
    expect(result.params.outputDb).toBe(-0.8);
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps track Air Exciter source-derived and removes legacy synthetic hiss", () => {
    const result = resolvePluginQualityGuard("sweet-air-exciter", "track", {
      mix: 0.9,
      outputDb: 4,
      syntheticAirBed: true,
      airBedLevel: 0.18,
    });

    expect(result.params.mix).toBe(0.12);
    expect(result.params.outputDb).toBe(0);
    expect(result.params.syntheticAirBed).toBe(false);
    expect(result.params.airBedLevel).toBe(0);
  });

  it("caps master width and multiband density before export", () => {
    const width = resolvePluginQualityGuard("sweet-stereo-widener", "master", { mix: 0.4, width: 0.8 });
    const mb = resolvePluginQualityGuard("sweet-multiband-comp", "master", { mix: 0.8, makeupDb: 8 });

    expect(width.params.mix).toBe(0.08);
    expect(width.params.width).toBe(0.16);
    expect(mb.params.mix).toBe(0.45);
    expect(mb.params.makeupDb).toBe(1);
  });
});
