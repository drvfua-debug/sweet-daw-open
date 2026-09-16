import { describe, expect, it } from "vitest";
import { analyzeRepairIssues } from "./repairAnalysis";

describe("repair analysis v0.2a", () => {
  it("flags excessive low side or phase risk in stereo low-frequency material", () => {
    const sampleRate = 48000;
    const length = Math.floor(sampleRate * 0.25);
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const sample = Math.sin((2 * Math.PI * 70 * index) / sampleRate) * 0.6;
      left[index] = sample;
      right[index] = -sample;
    }
    const result = analyzeRepairIssues([left, right], sampleRate, { durationSec: 0.25 });
    expect(result.summary.low_side ?? 0).toBeGreaterThan(0.35);
    expect(result.summary.phase_risk ?? 0).toBeGreaterThan(0.2);
  });
});