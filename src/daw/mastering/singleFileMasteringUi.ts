import type { SingleFileMasteringMode } from "./singleFileMastering";

export type SingleFileMasteringExportAvailability = {
  isSingleFileMasteringMode: boolean;
  mode: SingleFileMasteringMode;
  hasWorkClips: boolean;
  hasDirectWavClip: boolean;
  referenceAnalysisReady: boolean;
  isWorking: boolean;
};

export type SingleFileMasteringExportLabelInput = {
  isWorking: boolean;
  hasProcessedBuffer: boolean;
};

export function isReferenceRequiredSingleFileMode(mode: SingleFileMasteringMode) {
  return mode === "referenceCatchUp";
}

export function canRunSingleFileMasteringExport(input: SingleFileMasteringExportAvailability) {
  if (!input.isSingleFileMasteringMode || input.isWorking) return false;
  if (input.mode === "directWavPolish") return input.hasDirectWavClip;
  if (!input.hasWorkClips) return false;
  if (isReferenceRequiredSingleFileMode(input.mode) && !input.referenceAnalysisReady) return false;
  return true;
}

export function getSingleFileExportButtonLabel(input: SingleFileMasteringExportLabelInput) {
  if (input.isWorking) return "Exporting...";
  return input.hasProcessedBuffer ? "Export Processed WAV" : "Polish & Export Processed WAV";
}

export function getSingleFileExportDisabledReason(input: SingleFileMasteringExportAvailability) {
  if (!input.isSingleFileMasteringMode) return null;
  if (input.isWorking) return "Single File Mastering is already processing.";
  if (input.mode === "directWavPolish" && !input.hasDirectWavClip) {
    return "Direct WAV Polish requires one imported Reference WAV. The original file remains analysis-only and is never overwritten.";
  }
  if (input.mode === "directWavPolish") return null;
  if (!input.hasWorkClips) return "Import at least one normal stem or WAV. Reference tracks are analysis-only and are not exported.";
  if (isReferenceRequiredSingleFileMode(input.mode) && !input.referenceAnalysisReady) {
    return "Reference Catch-Up requires an analyzed Reference Mix. Switch to Light Master to export without Reference.";
  }
  return null;
}
