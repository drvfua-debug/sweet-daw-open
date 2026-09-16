import { describe, expect, it } from "vitest";
import type { StemRole } from "@/daw/model/Project";
import { emptyBandEnergyMap } from "./mixDoctorAnalysisUtils";
import { analyzePeakCulprits } from "./peakCulpritReport";
import type { StemFeatureReport, StemMixScore } from "./mixDoctorTypes";

describe("analyzePeakCulprits", () => {
  it("identifies a hot drum transient before limiter gain", () => {
    const report = analyzePeakCulprits([
      feature("drums-1", "Drums", "drums", { truePeakApproxDb: 0.2, peakDb: 0, rmsDb: -15, crestFactorDb: 15 }),
      feature("bass-1", "Bass", "bass", { truePeakApproxDb: -4, peakDb: -4.2, rmsDb: -17, crestFactorDb: 12 }),
    ], [
      score("drums-1", "Drums", "drums", { peak: 0, rms: -15, crestFactor: 15 }),
      score("bass-1", "Bass", "bass", { peak: -4.2, rms: -17, crestFactor: 12 }),
    ]);

    expect(report.status).toBe("fail");
    expect(report.topCulprits[0]?.trackName).toBe("Drums");
    expect(["clip_before_limiter", "transient_shape"]).toContain(report.topCulprits[0]?.action);
  });

  it("suggests density before gain when LUFS is short but true peak is near ceiling", () => {
    const report = analyzePeakCulprits([
      feature("bass-1", "Bass", "bass", { truePeakApproxDb: -0.8, peakDb: -1, rmsDb: -14, crestFactorDb: 9 }),
    ], [], { lufsShortfallDb: 2.2 });

    expect(report.status).toBe("fail");
    expect(report.densityShortfallLikely).toBe(true);
    expect(report.topCulprits[0]?.action).toBe("density_before_gain");
  });

  it("passes when true peak and crest are already safe", () => {
    const report = analyzePeakCulprits([
      feature("synth-1", "Synth", "synth", { truePeakApproxDb: -5, peakDb: -5.2, rmsDb: -17, crestFactorDb: 9 }),
    ]);

    expect(report.status).toBe("pass");
    expect(report.topCulprits).toHaveLength(0);
  });
});

function feature(
  trackId: string,
  trackName: string,
  role: StemRole,
  values: Partial<Pick<StemFeatureReport, "truePeakApproxDb" | "peakDb" | "rmsDb" | "crestFactorDb">>,
): StemFeatureReport {
  return {
    stemId: `${trackId}-file`,
    trackId,
    trackName,
    role,
    rmsDb: values.rmsDb ?? -18,
    peakDb: values.peakDb ?? -4,
    truePeakApproxDb: values.truePeakApproxDb ?? -3.8,
    crestFactorDb: values.crestFactorDb ?? 12,
    integratedLufsApprox: -19.2,
    lrCorrelation: 0.8,
    sideMidRatioDb: -12,
    stereoWidthScore: 35,
    spectralCentroidHz: 1000,
    spectralFlatness: 0.35,
    bandEnergyDb: emptyBandEnergyMap(-18),
    notes: [],
  };
}

function score(trackId: string, trackName: string, role: StemRole, values: Partial<Pick<StemMixScore, "peak" | "rms" | "crestFactor">>): StemMixScore {
  return {
    stemId: `${trackId}-file`,
    trackId,
    trackName,
    role,
    rms: values.rms ?? -18,
    peak: values.peak ?? -4,
    crestFactor: values.crestFactor ?? 12,
    loudnessApprox: -19.2,
    mudScore: 0,
    harshnessScore: 0,
    sibilanceScore: 0,
    metallicScore: 0,
    rumbleScore: 0,
    stereoWidthScore: 0,
    maskingRisk: 0,
    aiArtifactScore: 0,
    problems: [],
  };
}
