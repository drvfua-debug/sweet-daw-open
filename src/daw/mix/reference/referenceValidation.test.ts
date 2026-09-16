import { describe, expect, it } from "vitest";
import type { ReferenceProfile } from "@/daw/mix/mixDoctorTypes";
import { validateReferenceMatchProgress, type ReferenceMatchMeter } from "./referenceValidation";

describe("validateReferenceMatchProgress", () => {
  it("keeps missing reference validation non-blocking", () => {
    const meter = createMeter();
    const result = validateReferenceMatchProgress(meter, meter, null);

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("reports hard safety failures separately from warnings", () => {
    const before = createMeter({ integratedLufs: -14.2, truePeakDb: -1.4 });
    const after = createMeter({ integratedLufs: -12.8, truePeakDb: -0.4 });
    const reference = createReference({ integratedLufsApprox: -14, truePeakApproxDb: -1.2 });

    const result = validateReferenceMatchProgress(before, after, reference);

    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toContain("True Peak");
    expect(result.warnings.join(" ")).toContain("True Peak");
  });
});

function createMeter(overrides: Partial<ReferenceMatchMeter> = {}): ReferenceMatchMeter {
  return {
    integratedLufs: -14,
    truePeakDb: -1.2,
    rmsDb: -15,
    crestDb: 10,
    lowMidDb: -24,
    presenceDb: -25,
    airDb: -28,
    widthDb: -10,
    low120250Db: -24,
    body250500Db: -25,
    mid5002000Db: -24,
    presence20005000Db: -25,
    air500010000Db: -28,
    ultraAir1000020000Db: -30,
    ...overrides,
  };
}

function createReference(overrides: Partial<ReferenceProfile> = {}): ReferenceProfile {
  return {
    stemId: "ref-stem",
    trackId: "ref",
    trackName: "Reference",
    role: "reference",
    sourceRole: "reference",
    integratedLufsApprox: -14,
    truePeakApproxDb: -1.2,
    peakDb: -1.4,
    rmsDb: -15,
    crestFactorDb: 10,
    lrCorrelation: 0.78,
    sideMidRatioDb: -10,
    stereoWidthScore: 70,
    spectralCentroidHz: 2400,
    spectralFlatness: 0.4,
    bandEnergyDb: {
      "20-35": -34,
      "35-60": -33,
      "60-120": -30,
      "120-250": -24,
      "250-500": -25,
      "500-900": -24,
      "900-1500": -24,
      "1500-3000": -25,
      "3000-5000": -25,
      "5000-9000": -28,
      "9000-12000": -29,
      "12000-16000": -30,
      "16000-20000": -31,
    },
    targetRanges: {},
    loudnessTargetLabel: "Reference",
    notes: [],
    ...overrides,
  };
}
