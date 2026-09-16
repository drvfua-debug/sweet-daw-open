import { describe, expect, it } from "vitest";
import { connectPostInsertPath } from "./AudioGraphRouting";

describe("connectPostInsertPath", () => {
  it("connects insert output through pan to gain when vocal image is off", () => {
    const insert = fakeNode("insert");
    const pan = fakeNode("pan") as unknown as StereoPannerNode;
    const gain = fakeNode("gain") as unknown as GainNode;

    connectPostInsertPath({
      insertOutput: insert as unknown as AudioNode,
      vocalDuck: null,
      vocalImageLayer: null,
      pan,
      gain,
    });

    expect(edges()).toEqual(["insert->pan", "pan->gain"]);
  });

  it("routes through vocal image before pan without a direct insert-to-gain duplicate", () => {
    const insert = fakeNode("insert");
    const imageInput = fakeNode("imageInput");
    const imageOutput = fakeNode("imageOutput");
    const pan = fakeNode("pan") as unknown as StereoPannerNode;
    const gain = fakeNode("gain") as unknown as GainNode;

    connectPostInsertPath({
      insertOutput: insert as unknown as AudioNode,
      vocalDuck: null,
      vocalImageLayer: {
        input: imageInput as unknown as AudioNode,
        output: imageOutput as unknown as AudioNode,
      },
      pan,
      gain,
    });

    expect(edges()).toEqual(["insert->imageInput", "imageOutput->pan", "pan->gain"]);
    expect(edges()).not.toContain("insert->pan");
    expect(edges()).not.toContain("insert->gain");
  });
});

const connections: string[] = [];

function fakeNode(name: string) {
  return {
    name,
    connect(target: { name?: string }) {
      connections.push(`${name}->${target.name ?? "unknown"}`);
      return target;
    },
  };
}

function edges() {
  const current = [...connections];
  connections.length = 0;
  return current;
}
