import { describe, expect, it } from "vitest";
import { getPluginDescriptor } from "./pluginRegistry";
import { resolveSweetClipperParams } from "./PluginChain";

describe("Sweet Clipper plugin", () => {
  it("registers as a mobile-safe dynamics insert for tracks and master", () => {
    const descriptor = getPluginDescriptor("sweet-clipper");

    expect(descriptor?.name).toBe("Sweet Clipper");
    expect(descriptor?.category).toBe("dynamics");
    expect(descriptor?.supportedTargets).toEqual(["track", "master"]);
    expect(descriptor?.external).toBe(false);
    expect(descriptor?.mobileSafe).toBe(true);
    expect(descriptor?.realtimeSafe).toBe(true);
    expect(descriptor?.createDefaultParams()).toMatchObject({
      mode: "soft",
      driveDb: 2,
      ceilingDb: -1,
      mix: 0.65,
      autoTrim: true,
    });
  });

  it("clamps realtime parameters to safe ranges", () => {
    const params = resolveSweetClipperParams({
      mode: "hard",
      driveDb: 24,
      ceilingDb: 0,
      knee: 2,
      hardness: 2,
      mix: 3,
      outputDb: 24,
      autoTrim: true,
    });

    expect(params.mode).toBe("hard");
    expect(params.driveDb).toBe(12);
    expect(params.ceilingDb).toBe(-0.1);
    expect(params.knee).toBe(1);
    expect(params.hardness).toBe(1);
    expect(params.mix).toBe(1);
    expect(params.outputDb).toBe(6);
    expect(params.autoTrim).toBe(true);
  });

  it("uses mode defaults when knee and hardness are not set", () => {
    const params = resolveSweetClipperParams({
      mode: "medium",
      driveDb: 2,
      ceilingDb: -1,
      mix: 0.5,
      outputDb: 0,
    });

    expect(params.knee).toBe(0.38);
    expect(params.hardness).toBe(0.55);
  });
});
