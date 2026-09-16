import { describe, expect, it } from "vitest";
import type { StemRole } from "@/daw/model/Project";
import { emptyBandEnergyMap } from "./mixDoctorAnalysisUtils";
import { analyzeLowEndKing } from "./lowEndKingReport";
import type { StemFeatureReport } from "./mixDoctorTypes";

describe("analyzeLowEndKing", () => {
  it("fails when drums and bass share the same 20-60Hz lane", () => {
    const report = analyzeLowEndKing([
      feature("drums-1", "Kick Drum", "drums", { "20-35": -8, "35-60": -6, "60-120": -8 }),
      feature("bass-1", "Bass", "bass", { "20-35": -8.5, "35-60": -6.3, "60-120": -5 }),
    ]);

    expect(report.owner).toBe("shared");
    expect(report.status).toBe("fail");
    expect(report.recommendations.join(" ")).toContain("Choose one owner");
  });

  it("keeps bass as the owner when it clearly dominates sub", () => {
    const report = analyzeLowEndKing([
      feature("drums-1", "Drums", "drums", { "20-35": -20, "35-60": -18, "60-120": -7 }),
      feature("bass-1", "Bass", "bass", { "20-35": -8, "35-60": -5, "60-120": -4 }),
      feature("synth-1", "Synth", "synth", { "20-35": -22, "35-60": -21, "120-250": -10 }),
    ]);

    expect(report.owner).toBe("bass");
    expect(report.status).not.toBe("fail");
    expect(report.bassTrackName).toBe("Bass");
  });

  it("raises low-end risk when support stems carry unnecessary sub", () => {
    const report = analyzeLowEndKing([
      feature("bass-1", "Bass", "bass", { "20-35": -9, "35-60": -5, "60-120": -4 }),
      feature("music-1", "Music Stem", "music", { "20-35": -8, "35-60": -7, "120-250": -8, "250-500": -8 }),
    ]);

    expect(report.monoLowRisk).toBeGreaterThan(50);
    expect(report.limiterStressFromLowEnd).toBeGreaterThan(40);
    expect(report.recommendations.join(" ")).toContain("support stem");
  });
});

function feature(trackId: string, trackName: string, role: StemRole, bands: Partial<Record<string, number>>): StemFeatureReport {
  return {
    stemId: `${trackId}-file`,
    trackId,
    trackName,
    role,
    rmsDb: -18,
    peakDb: -4,
    truePeakApproxDb: -3.8,
    crestFactorDb: 12,
    integratedLufsApprox: -19.2,
    lrCorrelation: 0.8,
    sideMidRatioDb: -12,
    stereoWidthScore: 35,
    spectralCentroidHz: 900,
    spectralFlatness: 0.35,
    bandEnergyDb: {
      ...emptyBandEnergyMap(-22),
      ...bands,
    },
    notes: [],
  };
}
