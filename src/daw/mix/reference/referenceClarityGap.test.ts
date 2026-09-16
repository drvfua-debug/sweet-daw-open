import { describe, expect, it } from "vitest";
import type { MixDoctorBandId, ReferenceProfile, StemFeatureReport } from "../mixDoctorTypes";
import { analyzeReferenceClarityGap } from "./referenceClarityGap";

const BANDS: MixDoctorBandId[] = [
  "20-35",
  "35-60",
  "60-120",
  "120-250",
  "250-500",
  "500-900",
  "900-1500",
  "1500-3000",
  "3000-5000",
  "5000-9000",
  "9000-12000",
  "12000-16000",
  "16000-20000",
];

function report(overrides: Partial<Record<MixDoctorBandId, number>> = {}): StemFeatureReport {
  return {
    stemId: "stem",
    trackId: "track",
    trackName: "Track",
    role: "music",
    rmsDb: -18,
    peakDb: -4,
    truePeakApproxDb: -3.8,
    crestFactorDb: 14,
    integratedLufsApprox: -19.2,
    lrCorrelation: 0.75,
    sideMidRatioDb: -9,
    stereoWidthScore: 55,
    spectralCentroidHz: 2500,
    spectralFlatness: 0.35,
    bandEnergyDb: {
      ...(Object.fromEntries(BANDS.map((band) => [band, -12])) as StemFeatureReport["bandEnergyDb"]),
      ...overrides,
    },
    notes: [],
  };
}

function reference(overrides: Partial<Record<MixDoctorBandId, number>> = {}): ReferenceProfile {
  return {
    ...report(overrides),
    stemId: "reference",
    trackId: "reference",
    trackName: "Reference",
    role: "reference",
    sourceRole: "reference",
    targetRanges: {},
    loudnessTargetLabel: "reference",
  };
}

describe("referenceClarityGap", () => {
  it("warns when 2-5kHz and 5-10kHz are behind the reference", () => {
    const result = analyzeReferenceClarityGap([
      report({ "1500-3000": -15, "3000-5000": -15, "5000-9000": -15, "9000-12000": -15 }),
    ], reference({ "1500-3000": -12, "3000-5000": -12, "5000-9000": -12, "9000-12000": -12 }));

    expect(result?.status).toBe("fail");
    expect(result?.presenceGapDb).toBeGreaterThan(1.8);
    expect(result?.clarityGapDb).toBeGreaterThan(2);
    expect(result?.recommendations.join(" ")).toContain("5-10kHz");
  });

  it("flags false air risk when upper air is not the real clarity problem", () => {
    const result = analyzeReferenceClarityGap([
      report({
        "1500-3000": -14,
        "3000-5000": -14,
        "5000-9000": -14,
        "9000-12000": -11,
        "12000-16000": -11,
      }),
    ], reference({
      "1500-3000": -12,
      "3000-5000": -12,
      "5000-9000": -12,
      "9000-12000": -12,
      "12000-16000": -12,
    }));

    expect(result?.falseAirRisk).toBe(true);
    expect(result?.recommendations.join(" ")).toContain("false Air");
  });
});
