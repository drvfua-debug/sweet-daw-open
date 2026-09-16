import { describe, expect, it } from "vitest";
import { getPluginDescriptor } from "./pluginRegistry";
import { resolveSweetLowEndTranslatorParams } from "./PluginChain";

describe("sweet-low-end-translator plugin", () => {
  it("is registered as a track-only mobile-safe saturation plugin", () => {
    const descriptor = getPluginDescriptor("sweet-low-end-translator");
    expect(descriptor?.shortName).toBe("Low+");
    expect(descriptor?.category).toBe("saturation");
    expect(descriptor?.supportedTargets).toEqual(["track"]);
    expect(descriptor?.mobileSafe).toBe(true);
  });

  it("clamps runtime params for safe browser playback/export", () => {
    const params = resolveSweetLowEndTranslatorParams({
      mode: "808Audibility",
      amount: 5,
      drive: 5,
      lowCutHz: 4,
      subGuardDb: -20,
      mix: 1,
      outputDb: 9,
    });

    expect(params.mode).toBe("808Audibility");
    expect(params.amount).toBe(1);
    expect(params.drive).toBe(1);
    expect(params.lowCutHz).toBe(22);
    expect(params.subGuardDb).toBe(-2.5);
    expect(params.mix).toBe(0.5);
    expect(params.outputDb).toBe(3);
  });
});
