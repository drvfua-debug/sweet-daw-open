import { describe, expect, it } from "vitest";
import {
  validateAimixReferenceCandidate,
  validateSpatialAutoCandidate,
  type ReferenceQualityMetrics,
} from "./referenceQualityGate";

describe("referenceQualityGate", () => {
  it("warns when Reference Match remains more than 1.5dB short in 10-20kHz air", () => {
    const reference = metrics({
      bandEnergyDb: { ultraAir_10000_20000: -24 },
    });
    const candidate = metrics({
      bandEnergyDb: { ultraAir_10000_20000: -25.7 },
    });

    const result = validateAimixReferenceCandidate(reference, candidate);

    expect(result.passed).toBe(true);
    expect(result.warnings.join(" ")).toContain("10-20kHz air");
  });

  it("warns when LUFS is matched but candidate peaks far above the reference", () => {
    const reference = metrics({ integratedLufs: -17.89, truePeakDb: -4.42, crestDb: 12.07 });
    const candidate = metrics({ integratedLufs: -17.89, truePeakDb: -1.46, crestDb: 15.03 });

    const result = validateAimixReferenceCandidate(reference, candidate);

    expect(result.passed).toBe(true);
    expect(result.warnings.join(" ")).toContain("true peak");
    expect(result.rows.find((entry) => entry.metric === "Reference True Peak")?.status).toBe("warn");
  });

  it("fails AIMIX Reference when vocal mid and presence stay below reference even if ultra air is high", () => {
    const reference = metrics({
      bandEnergyDb: {
        sub_20_60: -36,
        mid_500_2000: -24,
        presence_2000_5000: -24,
        air_5000_10000: -25,
        ultraAir_10000_20000: -30,
      },
    });
    const candidate = metrics({
      bandEnergyDb: {
        sub_20_60: -33.5,
        mid_500_2000: -26.0,
        presence_2000_5000: -25.4,
        air_5000_10000: -26.3,
        ultraAir_10000_20000: -28.8,
      },
    });

    const result = validateAimixReferenceCandidate(reference, candidate);

    expect(result.passed).toBe(false);
    expect(result.warnings.join(" ")).toContain("500Hz-2kHz");
    expect(result.warnings.join(" ")).toContain("Air is not counted as clarity");
  });

  it("warns when reference loudness is blocked by peak headroom", () => {
    const reference = metrics({ integratedLufs: -11.5, truePeakDb: -1.1 });
    const candidate = metrics({ integratedLufs: -13.0, truePeakDb: -1.2 });

    const result = validateAimixReferenceCandidate(reference, candidate);

    expect(result.passed).toBe(true);
    expect(result.warnings.join(" ")).toContain("Mastering > Reference Catch-Up");
  });

  it("does not fail 14-20k side clamp when candidate band-side metrics are not available", () => {
    const reference = metrics({
      sideMidDb: -8.8,
      bandSideMidDb: {
        ultraAir_10000_20000: -15,
        sheen_14000_20000: -24,
      },
    });
    const candidate = metrics({
      sideMidDb: -1.5,
      bandEnergyDb: { ultraAir_10000_20000: -29 },
    });

    const result = validateAimixReferenceCandidate(reference, candidate);

    expect(result.failures.join(" ")).not.toContain("Air/Noise Side failed");
    expect(result.rows.find((entry) => entry.metric === "Air/Noise Side 14-20k")?.status).toBe("warn");
  });
  it("fails Spatial Auto when Side/Mid is still more than 1.5dB narrower than reference", () => {
    const reference = metrics({ sideMidDb: -8.5, lrCorrelation: 0.74 });
    const before = metrics({ sideMidDb: -12.5, lrCorrelation: 0.8 });
    const after = metrics({ sideMidDb: -10.2, lrCorrelation: 0.76 });

    const result = validateSpatialAutoCandidate(reference, before, after);

    expect(result.passed).toBe(false);
    expect(result.warnings.join(" ")).toContain("more than 1.5dB narrower");
  });
});

function metrics(overrides: Partial<ReferenceQualityMetrics> = {}): ReferenceQualityMetrics {
  return {
    integratedLufs: -14,
    truePeakDb: -1.2,
    rmsDb: -13,
    crestDb: 11,
    sideMidDb: -10,
    lrCorrelation: 0.78,
    bandEnergyDb: {
      sub_20_60: -34,
      lowMid_120_250: -24,
      body_250_500: -25,
      mid_500_2000: -24,
      presence_2000_5000: -25,
      air_5000_10000: -27,
      ultraAir_10000_20000: -28,
      ...(overrides.bandEnergyDb ?? {}),
    },
    ...overrides,
  };
}
