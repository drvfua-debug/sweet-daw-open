export type MobileAudioQuality = "fast" | "mobile-hq" | "offline-best";

export type MobileProcessingBudget = {
  quality: MobileAudioQuality;
  maxFullSongCopies: number;
  truePeakOversample: 1 | 2 | 4;
  analysisHopSize: number;
  maxAnalysisSeconds?: number;
  allowWindowedSincSrc: boolean;
  allowPostRenderSecondPass: boolean;
};

export const MOBILE_FAST_BUDGET: MobileProcessingBudget = {
  quality: "fast",
  maxFullSongCopies: 1,
  truePeakOversample: 1,
  analysisHopSize: 1024,
  allowWindowedSincSrc: false,
  allowPostRenderSecondPass: false,
};

export const MOBILE_HQ_BUDGET: MobileProcessingBudget = {
  quality: "mobile-hq",
  maxFullSongCopies: 2,
  truePeakOversample: 2,
  analysisHopSize: 512,
  allowWindowedSincSrc: true,
  allowPostRenderSecondPass: true,
};

export const OFFLINE_BEST_BUDGET: MobileProcessingBudget = {
  quality: "offline-best",
  maxFullSongCopies: 2,
  truePeakOversample: 4,
  analysisHopSize: 256,
  allowWindowedSincSrc: true,
  allowPostRenderSecondPass: true,
};

export function resolveMobileProcessingBudget(quality: MobileAudioQuality = "mobile-hq"): MobileProcessingBudget {
  if (quality === "fast") return MOBILE_FAST_BUDGET;
  if (quality === "offline-best") return OFFLINE_BEST_BUDGET;
  return MOBILE_HQ_BUDGET;
}
