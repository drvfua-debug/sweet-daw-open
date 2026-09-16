import { describe, expect, it } from "vitest";
import type { LoudnessAnalysis } from "@/audio/analysis/LoudnessAnalyzer";
import { createDefaultMasterTargetState } from "@/daw/model/Project";
import { buildMasterTargetAnalysisSummary, createHeadroomPlan } from "./HeadroomPlanner";

describe("createHeadroomPlan", () => {
  it("does not trim when pre-master headroom is acceptable", () => {
    const target = createDefaultMasterTargetState();
    const plan = createHeadroomPlan(analysis({ samplePeakDbfs: -7, truePeakDbtp: -6.5, integratedLufs: -18.2 }), target);

    expect(plan.shouldApplyTrim).toBe(false);
    expect(plan.recommendedTrimDb).toBe(0);
  });

  it("recommends mix bus trim without forcing it in analysis mode", () => {
    const target = createDefaultMasterTargetState();
    const plan = createHeadroomPlan(analysis({ samplePeakDbfs: -2.4, truePeakDbtp: -2.1, integratedLufs: -15 }), target);

    expect(plan.shouldApplyTrim).toBe(false);
    expect(plan.recommendedTrimDb).toBeLessThanOrEqual(-3.5);
    expect(plan.reason).toContain("mix bus headroom");
  });

  it("can mark the trim as applicable in auto-trim mode", () => {
    const target = { ...createDefaultMasterTargetState(), headroomMode: "auto-trim" as const };
    const plan = createHeadroomPlan(analysis({ samplePeakDbfs: -3, truePeakDbtp: -2.8 }), target);

    expect(plan.shouldApplyTrim).toBe(true);
    expect(plan.recommendedTrimDb).toBeLessThan(0);
  });

  it("builds a persisted analysis summary", () => {
    const target = createDefaultMasterTargetState();
    const summary = buildMasterTargetAnalysisSummary(analysis({ integratedLufs: -17, samplePeakDbfs: -4 }), target);

    expect(summary.preMasterIntegratedLufs).toBe(-17);
    expect(summary.predictedGainToTargetDb).toBe(5);
    expect(summary.analysisVersion).toBe("master-target-v1");
  });
});

function analysis(patch: Partial<LoudnessAnalysis>): LoudnessAnalysis {
  return {
    durationSec: 10,
    integratedLufs: -18,
    shortTermMaxLufs: -16,
    momentaryMaxLufs: -15,
    loudnessRangeLu: 3,
    samplePeakDbfs: -6,
    truePeakDbtp: -5.8,
    clippedSampleRatio: 0,
    dcOffset: 0,
    ...patch,
  };
}
