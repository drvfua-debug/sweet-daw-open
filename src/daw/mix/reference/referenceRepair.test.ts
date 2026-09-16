import { describe, expect, it } from "vitest";
import type { BandEnergyMap, ReferenceProfile, StemFeatureReport } from "../mixDoctorTypes";
import { buildReferenceRepairDiagnosis, buildReferenceRepairDiagnosisFromMetrics, buildReferenceRepairMarkdown } from "./referenceRepair";

const BAND_KEYS: Array<keyof BandEnergyMap> = [
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

function bands(base = -16, overrides: Partial<BandEnergyMap> = {}): BandEnergyMap {
  return BAND_KEYS.reduce((acc, key, index) => {
    acc[key] = base - index * 0.25;
    return acc;
  }, { ...overrides } as BandEnergyMap);
}

function report(overrides: Partial<StemFeatureReport>): StemFeatureReport {
  return {
    stemId: "stem",
    trackId: "track",
    trackName: "Stem",
    role: "music",
    rmsDb: -18,
    peakDb: -1,
    truePeakApproxDb: -0.8,
    crestFactorDb: 17,
    integratedLufsApprox: -19.2,
    lrCorrelation: 0.78,
    sideMidRatioDb: -9,
    stereoWidthScore: 55,
    spectralCentroidHz: 2600,
    spectralFlatness: 0.35,
    bandEnergyDb: bands(),
    notes: [],
    ...overrides,
  };
}

function reference(overrides: Partial<ReferenceProfile>): ReferenceProfile {
  const base = report({
    stemId: "direct",
    trackId: "direct",
    trackName: "Direct WAV",
    role: "reference",
    rmsDb: -16.74,
    peakDb: -4.01,
    truePeakApproxDb: -3.81,
    crestFactorDb: 12.73,
    integratedLufsApprox: -17.94,
    lrCorrelation: 0.77,
    sideMidRatioDb: -8.85,
    bandEnergyDb: bands(-14, {
      "9000-12000": -10,
      "12000-16000": -9.5,
      "16000-20000": -11,
    }),
  });
  return {
    ...base,
    sourceRole: "reference",
    loudnessTargetLabel: "reference-range",
    targetRanges: {},
    ...overrides,
  };
}

describe("Reference Repair", () => {
  it("detects low RMS plus high peak stem sum before direct gain matching", () => {
    const diagnosis = buildReferenceRepairDiagnosis(
      [
        report({
          trackName: "Stem Sum Source",
          rmsDb: -18.55,
          peakDb: -0.37,
          truePeakApproxDb: -0.17,
          crestFactorDb: 18.18,
          integratedLufsApprox: -19.75,
          lrCorrelation: 0.783,
          sideMidRatioDb: -9.14,
        }),
      ],
      reference({}),
    );

    expect(diagnosis).toBeTruthy();
    expect(diagnosis?.rmsDiffDb).toBeCloseTo(1.8, 1);
    expect(diagnosis?.peakDiffDb).toBeCloseTo(3.6, 1);
    expect(diagnosis?.crestDiffDb).toBeGreaterThan(5);
    expect(diagnosis?.status).toBe("low_rms_high_peak");
    expect(diagnosis?.severity).toBe("critical");
    expect(diagnosis?.recommendedChain).toContain("Smart Peak Clip");
    expect(diagnosis?.messages.join(" ")).toContain("simple gain boost");
  });

  it("caps static match EQ and marks presence bands as dynamic-only", () => {
    const diagnosis = buildReferenceRepairDiagnosis(
      [
        report({
          bandEnergyDb: bands(-18, {
            "1500-3000": -21,
            "3000-5000": -22,
            "12000-16000": -18,
          }),
        }),
      ],
      reference({
        bandEnergyDb: bands(-10, {
          "1500-3000": -12,
          "3000-5000": -12,
          "12000-16000": -10,
        }),
      }),
    );

    const presence = diagnosis?.bandDeltas.find((delta) => delta.bandId === "3000-5000");
    const air = diagnosis?.bandDeltas.find((delta) => delta.bandId === "12000-16000");

    expect(presence?.dynamicOnly).toBe(true);
    expect(presence?.cappedEqDb).toBeLessThanOrEqual(1.5);
    expect(air?.cappedEqDb).toBeLessThanOrEqual(3);
  });

  it("exports a compact markdown report", () => {
    const diagnosis = buildReferenceRepairDiagnosis(
      [report({ rmsDb: -18.55, peakDb: -0.37, crestFactorDb: 18.18 })],
      reference({}),
    );
    expect(diagnosis).toBeTruthy();
    const markdown = buildReferenceRepairMarkdown(diagnosis!);

    expect(markdown).toContain("Direct WAV");
    expect(markdown).toContain("Stem Sum");
    expect(markdown).toContain("Suggested Repair Chain");
  });

  it("accepts rendered residual metrics and marks the report as non-estimated", () => {
    const diagnosis = buildReferenceRepairDiagnosisFromMetrics(
      {
        label: "Direct",
        rmsDb: -16.7,
        peakDb: -4,
        truePeakApproxDb: -3.8,
        crestFactorDb: 12.7,
        integratedLufsApprox: -18,
        lrCorrelation: 0.77,
        sideMidRatioDb: -8.8,
        bandEnergyDb: bands(-14),
      },
      {
        label: "Rendered Stem Sum",
        rmsDb: -18.6,
        peakDb: -0.4,
        truePeakApproxDb: -0.2,
        crestFactorDb: 18.2,
        integratedLufsApprox: -20,
        lrCorrelation: 0.78,
        sideMidRatioDb: -9.1,
        bandEnergyDb: bands(-16),
      },
      {
        residual: {
          estimated: false,
          gainMatchDb: 1.9,
          residualRmsDb: -21.4,
          residualPeakDb: -5.2,
          residualToDirectDb: -4.7,
          residualSideMidRatioDb: -3.8,
        },
      },
    );

    expect(diagnosis.residual.estimated).toBe(false);
    expect(diagnosis.status).toBe("low_rms_high_peak");
    expect(buildReferenceRepairMarkdown(diagnosis)).toContain("rendered from Direct WAV");
  });
});
