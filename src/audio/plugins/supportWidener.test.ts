import { describe, expect, it } from "vitest";
import { getPluginDescriptor } from "./pluginRegistry";
import { resolveSweetAimixGlowParams, resolveSweetAirExciterParams, resolveSweetSupportWidenerParams } from "./PluginChain";

describe("Sweet Support Widener", () => {
  it("registers separate defaults without changing Sweet Stereo Widener", () => {
    const support = getPluginDescriptor("sweet-support-widener");
    const stereo = getPluginDescriptor("sweet-stereo-widener");

    expect(support?.createDefaultParams()).toMatchObject({
      highPassHz: 2500,
      lowPassHz: 16000,
      lowMonoHz: 120,
      monoSafety: true,
    });
    expect(stereo?.createDefaultParams()).not.toHaveProperty("highPassHz");
  });

  it("keeps the low band out of the wide wet path", () => {
    const params = resolveSweetSupportWidenerParams({
      width: 0.8,
      mix: 1,
      delayMs: 30,
      highPassHz: 40,
      lowPassHz: 30000,
      lowMonoHz: 120,
      monoSafety: true,
    }, 48000);

    expect(params.mix).toBe(0.18);
    expect(params.delayMs).toBe(14);
    expect(params.highPassHz).toBeGreaterThanOrEqual(params.lowMonoHz);
    expect(params.highPassHz).toBeGreaterThanOrEqual(180);
    expect(params.lowPassHz).toBeLessThanOrEqual(20000);
  });
});


describe("Sweet Air Exciter", () => {
  it("registers a mobile-safe ultra-high air generator", () => {
    const descriptor = getPluginDescriptor("sweet-air-exciter");

    expect(descriptor?.category).toBe("saturation");
    expect(descriptor?.mobileSafe).toBe(true);
    expect(descriptor?.createDefaultParams()).toMatchObject({
      highPassHz: 6800,
      postHighPassHz: 10000,
      lowPassHz: 18500,
      harshGuard: 0.74,
      syntheticAirBed: false,
      airBedLevel: 0,
      airBedKeyHz: 3200,
      dryLevel: 1,
      mix: 0.06,
    });
  });

  it("clamps air generation so it cannot become a harsh full-band boost", () => {
    const params = resolveSweetAirExciterParams({
      amount: 2,
      tone: 2,
      highPassHz: 2000,
      focusHz: 21000,
      lowPassHz: 30000,
      harshGuard: 2,
      mix: 1,
      outputDb: 12,
      airBedLevel: 2,
      airBedKeyHz: 40,
      dryLevel: -1,
    }, 48000);

    expect(params.amount).toBe(1);
    expect(params.mix).toBe(0.18);
    expect(params.highPassHz).toBeGreaterThanOrEqual(6000);
    expect(params.postHighPassHz).toBeGreaterThan(params.highPassHz);
    expect(params.focusHz).toBeGreaterThan(params.postHighPassHz);
    expect(params.lowPassHz).toBeGreaterThan(params.focusHz);
    expect(params.lowPassHz).toBeLessThanOrEqual(20000);
    expect(params.harshGuard).toBe(1);
    expect(params.outputDb).toBe(3);
    expect(params.airBedLevel).toBe(0.18);
    expect(params.airBedKeyHz).toBeGreaterThanOrEqual(1800);
    expect(params.dryLevel).toBe(0);
  });
});


describe("Sweet AIMIX Glow", () => {
  it("registers as a normal track insert with safe defaults", () => {
    const descriptor = getPluginDescriptor("sweet-aimix-glow");

    expect(descriptor?.insertable).toBe(true);
    expect(descriptor?.supportedTargets).toEqual(["track"]);
    expect(descriptor?.mobileSafe).toBe(true);
    expect(descriptor?.createDefaultParams()).toMatchObject({
      preset: "AI Stem Rescue",
      amount: 42,
      recover: 34,
      gloss: 22,
      air: 18,
      tame: 55,
      mix: 0.32,
    });
  });

  it("clamps realtime Glow parameters for mobile-safe use", () => {
    const params = resolveSweetAimixGlowParams({
      amount: 200,
      recover: 200,
      gloss: 200,
      air: 200,
      tame: 200,
      mix: 2,
      outputDb: 12,
    }, 48000);

    expect(params.amount).toBe(1);
    expect(params.recover).toBe(1);
    expect(params.air).toBe(1);
    expect(params.tame).toBe(1);
    expect(params.mix).toBe(0.72);
    expect(params.outputDb).toBe(3);
    expect(params.airHighpassHz).toBeGreaterThanOrEqual(5600);
    expect(params.airLowpassHz).toBeLessThanOrEqual(19500);
  });
});