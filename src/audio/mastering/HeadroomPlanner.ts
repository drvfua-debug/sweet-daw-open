import type { LoudnessAnalysis } from "@/audio/analysis/LoudnessAnalyzer";
import type { MasterTargetAnalysisSummary, MasterTargetState } from "@/daw/model/Project";

export type HeadroomPlan = {
  shouldApplyTrim: boolean;
  recommendedTrimDb: number;
  reason: string;
  warnings: string[];
};

const ANALYSIS_VERSION = "master-target-v1";

export function createHeadroomPlan(analysis: LoudnessAnalysis, target: MasterTargetState): HeadroomPlan {
  if (!target.enabled || target.headroomMode === "off") {
    return {
      shouldApplyTrim: false,
      recommendedTrimDb: 0,
      reason: "Master Target is disabled or headroom mode is off.",
      warnings: [],
    };
  }

  const warnings: string[] = [];
  const peakOverDb = Number.isFinite(analysis.samplePeakDbfs)
    ? analysis.samplePeakDbfs - target.preMasterPeakCeilingDbfs
    : 0;
  const truePeakOverDb = Number.isFinite(analysis.truePeakDbtp)
    ? analysis.truePeakDbtp - Math.min(target.preMasterPeakCeilingDbfs + 1, target.truePeakCeilingDbtp + 3)
    : 0;
  const loudnessOverHintDb = analysis.integratedLufs == null
    ? 0
    : analysis.integratedLufs - target.preMasterLoudnessHintLufs;

  if (analysis.clippedSampleRatio > 0) {
    warnings.push(`Pre-master contains clipped samples (${(analysis.clippedSampleRatio * 100).toFixed(2)}%).`);
  }
  if (analysis.integratedLufs != null && analysis.integratedLufs > target.targetIntegratedLufs + 1) {
    warnings.push("Pre-master is already louder than the final target. Avoid adding more loudness stages.");
  }

  const trimFromPeak = peakOverDb > 0 ? -peakOverDb : 0;
  const trimFromTruePeak = truePeakOverDb > 0 ? -truePeakOverDb : 0;
  const trimFromLoudness = loudnessOverHintDb > 2 ? -(loudnessOverHintDb - 2) * 0.35 : 0;
  const recommendedTrimDb = round1(clamp(Math.min(0, trimFromPeak, trimFromTruePeak, trimFromLoudness), -18, 0));

  if (recommendedTrimDb >= -0.1) {
    return {
      shouldApplyTrim: false,
      recommendedTrimDb: 0,
      reason: "Pre-master headroom is acceptable.",
      warnings,
    };
  }

  return {
    shouldApplyTrim: target.headroomMode === "auto-trim",
    recommendedTrimDb,
    reason: `Pre-master peak/headroom is high. Create ${Math.abs(recommendedTrimDb).toFixed(1)}dB of mix bus headroom before final mastering.`,
    warnings,
  };
}

export function buildMasterTargetAnalysisSummary(
  analysis: LoudnessAnalysis,
  target: MasterTargetState,
  plan: HeadroomPlan = createHeadroomPlan(analysis, target),
): MasterTargetAnalysisSummary {
  return {
    analyzedAt: new Date().toISOString(),
    analysisVersion: ANALYSIS_VERSION,
    durationSec: round2(analysis.durationSec),
    preMasterIntegratedLufs: analysis.integratedLufs,
    preMasterTruePeakDbtp: finiteOrNull(analysis.truePeakDbtp),
    preMasterSamplePeakDbfs: finiteOrNull(analysis.samplePeakDbfs),
    predictedGainToTargetDb: analysis.integratedLufs == null ? null : round2(target.targetIntegratedLufs - analysis.integratedLufs),
    recommendedHeadroomTrimDb: plan.recommendedTrimDb,
    warnings: [...plan.warnings],
  };
}

function finiteOrNull(value: number) {
  return Number.isFinite(value) ? round2(value) : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
