import { describe, expect, it } from "vitest";
import { getPluginDescriptor } from "./pluginRegistry";
import { resolveSweetTiltEqParams } from "./PluginChain";

describe("sweet-tilt-eq plugin", () => {
  it("is registered for track and master broad tone balance", () => {
    const descriptor = getPluginDescriptor("sweet-tilt-eq");
    expect(descriptor?.shortName).toBe("Tilt");
    expect(descriptor?.category).toBe("eq");
    expect(descriptor?.supportedTargets).toEqual(["track", "master"]);
    expect(descriptor?.mobileSafe).toBe(true);
  });

  it("turns positive tilt into low cut and high lift", () => {
    const params = resolveSweetTiltEqParams({ tiltDb: 2, pivotHz: 1000, mix: 1 });
    expect(params.lowGainDb).toBe(-1);
    expect(params.highGainDb).toBe(1);
  });

  it("clamps broad master-safe ranges", () => {
    const params = resolveSweetTiltEqParams({ tiltDb: 20, pivotHz: 10000, lowShape: 9, highShape: -4, mix: 2, outputDb: 20 });
    expect(params.tiltDb).toBe(6);
    expect(params.pivotHz).toBe(2500);
    expect(params.lowShape).toBe(1.2);
    expect(params.highShape).toBe(0.3);
    expect(params.mix).toBe(1);
    expect(params.outputDb).toBe(6);
  });
});
