import { describe, expect, it } from "vitest";
import {
  canRunSingleFileMasteringExport,
  getSingleFileExportButtonLabel,
  getSingleFileExportDisabledReason,
} from "./singleFileMasteringUi";

describe("singleFileMasteringUi", () => {
  it.each(["lightMaster", "loudnessOnly", "loudRelease"] as const)(
    "allows %s export without a reference when work clips exist",
    (mode) => {
      expect(canRunSingleFileMasteringExport({
        isSingleFileMasteringMode: true,
        mode,
        hasWorkClips: true,
        hasDirectWavClip: false,
        referenceAnalysisReady: false,
        isWorking: false,
      })).toBe(true);
    },
  );

  it("requires an analyzed reference only for Reference Catch-Up", () => {
    expect(canRunSingleFileMasteringExport({
      isSingleFileMasteringMode: true,
      mode: "referenceCatchUp",
      hasWorkClips: true,
      hasDirectWavClip: false,
      referenceAnalysisReady: false,
      isWorking: false,
    })).toBe(false);
    expect(getSingleFileExportDisabledReason({
      isSingleFileMasteringMode: true,
      mode: "referenceCatchUp",
      hasWorkClips: true,
      hasDirectWavClip: false,
      referenceAnalysisReady: false,
      isWorking: false,
    })).toContain("Reference Catch-Up requires");
  });

  it("blocks export while busy or when only reference tracks are present", () => {
    expect(canRunSingleFileMasteringExport({
      isSingleFileMasteringMode: true,
      mode: "lightMaster",
      hasWorkClips: true,
      hasDirectWavClip: false,
      referenceAnalysisReady: false,
      isWorking: true,
    })).toBe(false);
    expect(canRunSingleFileMasteringExport({
      isSingleFileMasteringMode: true,
      mode: "lightMaster",
      hasWorkClips: false,
      hasDirectWavClip: true,
      referenceAnalysisReady: true,
      isWorking: false,
    })).toBe(false);
  });

  it("allows Direct WAV Polish with a Reference clip and no stem clips", () => {
    const availability = {
      isSingleFileMasteringMode: true,
      mode: "directWavPolish" as const,
      hasWorkClips: false,
      hasDirectWavClip: true,
      referenceAnalysisReady: false,
      isWorking: false,
    };

    expect(canRunSingleFileMasteringExport(availability)).toBe(true);
    expect(getSingleFileExportDisabledReason(availability)).toBeNull();
  });

  it("labels smart export based on processed buffer availability", () => {
    expect(getSingleFileExportButtonLabel({ isWorking: false, hasProcessedBuffer: false })).toBe("Polish & Export Processed WAV");
    expect(getSingleFileExportButtonLabel({ isWorking: false, hasProcessedBuffer: true })).toBe("Export Processed WAV");
    expect(getSingleFileExportButtonLabel({ isWorking: true, hasProcessedBuffer: true })).toBe("Exporting...");
  });
});
