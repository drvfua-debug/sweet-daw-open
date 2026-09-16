import { describe, expect, it } from "vitest";
import {
  averageBandEnergy,
  buildSweetReferenceDeltaReport,
  buildSweetReferenceDeltaReportFromFeatures,
  estimateBandEnergyDbFromPcm,
  toAimixReferenceDeltaHints,
  toMasterPolishTargetHints,
} from "../referenceDelta";
import { getSweetMasterTargetProfile } from "../targetProfiles";

describe("Reference Stem Delta v0.5", () => {
  it("bounds reference deltas by the selected target profile", () => {
    const profile = getSweetMasterTargetProfile("safe-streaming-ish");
    const report = buildSweetReferenceDeltaReport({
      source: "direct-wav",
      sampleRate: 44100,
      durationSec: 180,
      role: "master",
      profile,
      currentBands: { "5000-9000": -30, "9000-12000": -35, "35-60": -32 },
      referenceBands: { "5000-9000": -20, "9000-12000": -24, "35-60": -20 },
    });

    expect(report.bands.find((band) => band.bandId === "5000-9000")?.boundedDeltaDb).toBeLessThanOrEqual(profile.maxReferenceDeltaDb);
    expect(report.bands.find((band) => band.bandId === "9000-12000")?.boundedDeltaDb).toBeLessThanOrEqual(profile.maxHighBoostDb);
    expect(report.bands.find((band) => band.bandId === "35-60")?.boundedDeltaDb).toBeLessThanOrEqual(profile.maxLowBoostDb);
    expect(report.warnings.join(" ")).toContain("bounded delta");
  });

  it("keeps cuts bounded by maxReferenceDeltaDb", () => {
    const profile = getSweetMasterTargetProfile("balanced-ai-master");
    const report = buildSweetReferenceDeltaReport({
      source: "reference-wav",
      sampleRate: 48000,
      durationSec: 120,
      role: "lead-vocal",
      profile,
      currentBands: { "250-500": -12 },
      referenceBands: { "250-500": -24 },
    });

    expect(report.bands.find((band) => band.bandId === "250-500")?.boundedDeltaDb).toBe(-profile.maxReferenceDeltaDb);
  });

  it("reduces confidence for short or weak references", () => {
    const report = buildSweetReferenceDeltaReport({
      source: "reference-wav",
      sampleRate: 44100,
      durationSec: 3,
      role: "guitar",
      currentBands: { "1500-3000": -90 },
      referenceBands: { "1500-3000": -89 },
    });

    const band = report.bands.find((item) => item.bandId === "1500-3000");
    expect(band?.confidence).toBeLessThan(0.6);
    expect(report.warnings.join(" ")).toContain("短い");
  });

  it("builds master-only reports without pretending to separate stems", () => {
    const report = buildSweetReferenceDeltaReport({
      source: "current-mix",
      sampleRate: 44100,
      durationSec: 90,
      role: "bass",
      hasStems: false,
      currentBands: { "60-120": -20 },
      referenceBands: { "60-120": -18 },
    });

    expect(report.warnings.join(" ")).toContain("master-only");
    expect(report.bands.find((band) => band.bandId === "60-120")?.confidence).toBeLessThan(0.8);
  });

  it("averages stem feature energy and converts it into AIMIX and Master Polish hints", () => {
    const reference = { role: "reference", sampleRate: 44100, durationSec: 200, bandEnergyDb: { "60-120": -18, "1500-3000": -22, "9000-12000": -30 } };
    const features = [
      { role: "drums", bandEnergyDb: { "60-120": -21, "1500-3000": -25, "9000-12000": -40 } },
      { role: "bass", bandEnergyDb: { "60-120": -19, "1500-3000": -35, "9000-12000": -48 } },
    ];
    const profile = getSweetMasterTargetProfile("balanced-ai-master");
    const report = buildSweetReferenceDeltaReportFromFeatures({ reference, features, profile });

    expect(report).not.toBeNull();
    const aimixHints = toAimixReferenceDeltaHints(report, profile);
    const masterHints = toMasterPolishTargetHints(report, profile);
    expect(aimixHints.available).toBe(true);
    expect(aimixHints.maxProposalReductionDb).toBeGreaterThan(0);
    expect(masterHints.targetLufsApprox).toBe(profile.targetLufsApprox);
    expect(masterHints.boundedBandDeltas.length).toBeGreaterThan(0);
  });

  it("uses power averaging for band maps", () => {
    const result = averageBandEnergy([{ air: -20 }, { air: -20 }]);
    expect(result.air).toBeCloseTo(-20, 1);
  });

  it("keeps analysis window count in confidence and reports", () => {
    const oneWindow = buildSweetReferenceDeltaReport({
      source: "direct-wav",
      sampleRate: 44100,
      durationSec: 120,
      analysisWindowCount: 1,
      currentBands: { "3000-5000": -24 },
      referenceBands: { "3000-5000": -22 },
    });
    const multiWindow = buildSweetReferenceDeltaReport({
      source: "direct-wav",
      sampleRate: 44100,
      durationSec: 120,
      analysisWindowCount: 4,
      currentBands: { "3000-5000": -24 },
      referenceBands: { "3000-5000": -22 },
    });

    expect(oneWindow.analysisWindowCount).toBe(1);
    expect(multiWindow.analysisWindowCount).toBe(4);
    expect(multiWindow.bands.find((band) => band.bandId === "3000-5000")?.confidence).toBeGreaterThan(
      oneWindow.bands.find((band) => band.bandId === "3000-5000")?.confidence ?? 0,
    );
  });

  it("estimates band energy from several windows and band frequency points", () => {
    const sampleRate = 8000;
    const length = sampleRate * 8;
    const channel = new Float32Array(length);
    for (let index = sampleRate * 4; index < length; index += 1) {
      channel[index] = Math.sin((2 * Math.PI * 1500 * index) / sampleRate) * 0.5;
    }

    const result = estimateBandEnergyDbFromPcm([channel], sampleRate, [
      { id: "1000-2000", label: "Presence", minHz: 1000, maxHz: 2000 },
      { id: "2500-3500", label: "High", minHz: 2500, maxHz: 3500 },
    ]);

    expect(result["1000-2000"]).toBeGreaterThan(result["2500-3500"] ?? -160);
  });
});
