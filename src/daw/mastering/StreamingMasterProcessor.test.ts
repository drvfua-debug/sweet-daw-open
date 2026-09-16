import { describe, expect, it } from "vitest";
import { createStreamingMasterChunkJoiner, cropStreamingMasterChunk } from "./StreamingMasterProcessor";

describe("StreamingMasterProcessor", () => {
  it("keeps only the stable center of a padded chunk", () => {
    const channels = [Float32Array.from([0, 1, 2, 3, 4, 5]), Float32Array.from([10, 11, 12, 13, 14, 15])];
    const cropped = cropStreamingMasterChunk(channels, { cropStartFrame: 2, cropFrameCount: 3 });
    expect(Array.from(cropped[0] ?? [])).toEqual([2, 3, 4]);
    expect(Array.from(cropped[1] ?? [])).toEqual([12, 13, 14]);
  });

  it("crossfades the same pre-roll time range without changing total frames", () => {
    const joiner = createStreamingMasterChunkJoiner({ sampleRate: 1000, crossfadeSec: 0.016 });
    const first = [new Float32Array(48).fill(0.2)];
    const second = [new Float32Array(64).fill(0.3)];
    const output = [
      ...joiner.add(first, { cropStartFrame: 0, cropFrameCount: 40 }),
    ];
    const joined = joiner.add(second, { cropStartFrame: 16, cropFrameCount: 40 });
    const tail = joiner.flush();
    const stitched = new Float32Array((output[0]?.length ?? 0) + (joined[0]?.length ?? 0) + (tail[0]?.length ?? 0));
    let offset = 0;
    for (const chunk of [output[0], joined[0], tail[0]]) {
      if (!chunk) continue;
      stitched.set(chunk, offset);
      offset += chunk.length;
    }

    let largestStep = 0;
    for (let index = 1; index < stitched.length; index += 1) {
      largestStep = Math.max(largestStep, Math.abs(stitched[index]! - stitched[index - 1]!));
    }
    expect(stitched.length).toBe(80);
    expect(largestStep).toBeLessThan(0.01);
  });
});
