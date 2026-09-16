import { describe, expect, it } from "vitest";
import { resolveSweetVocalDuckInsertParams } from "./PluginChain";

describe("Sweet Vocal Duck EQ insert routing", () => {
  it("keeps the insert path neutral so the post-insert dynamic node is the only reduction stage", () => {
    const params = resolveSweetVocalDuckInsertParams({ frequencyHz: 2500, q: 1.1, maxReductionDb: 1.6, mix: 1 }, 48000);

    expect(params.frequencyHz).toBe(2500);
    expect(params.q).toBe(1.1);
    expect(params.staticDryGain).toBe(1);
    expect(params.staticWetGain).toBe(0);
  });
});
