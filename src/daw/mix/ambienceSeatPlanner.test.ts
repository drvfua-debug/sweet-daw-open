import { describe, expect, it } from "vitest";
import { buildAmbienceSeatPlan } from "./ambienceSeatPlanner";
import type { MixDoctorBandId, StemContaminationReport, StemFeatureReport, StemPurityReport } from "./mixDoctorTypes";
import type { StemRole } from "@/daw/model/Project";

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

function feature(trackId: string, role: StemRole, overrides: Partial<StemFeatureReport> = {}): StemFeatureReport {
  return {
    stemId: trackId,
    trackId,
    trackName: `${role} ${trackId}`,
    role,
    rmsDb: -18,
    peakDb: -4,
    truePeakApproxDb: -3.5,
    crestFactorDb: 10,
    integratedLufsApprox: -19,
    lrCorrelation: 0.7,
    sideMidRatioDb: -10,
    stereoWidthScore: 40,
    spectralCentroidHz: 1800,
    spectralFlatness: 0.3,
    bandEnergyDb: Object.fromEntries(BANDS.map((band) => [band, -18])) as StemFeatureReport["bandEnergyDb"],
    notes: [],
    ...overrides,
  };
}

function purity(trackId: string, role: StemRole, purityScore = 90): StemPurityReport {
  return {
    stemId: trackId,
    trackId,
    trackName: `${role} ${trackId}`,
    role,
    purityScore,
    mode: "normal_track_processing_allowed",
    dominantComponents: [],
    protectedComponents: [],
    notes: [],
  };
}

function contamination(trackId: string, role: StemRole, roomWashScore = 0): StemContaminationReport {
  return {
    stemId: trackId,
    trackId,
    trackName: `${role} ${trackId}`,
    role,
    vocalBleedScore: 0,
    cymbalMetallicScore: 0,
    roomWashScore,
    lowEndContaminationScore: 0,
    artifactScore: 0,
    warnings: [],
  };
}

describe("buildAmbienceSeatPlan", () => {
  it("keeps vocal and bass protected dry", () => {
    const plan = buildAmbienceSeatPlan([feature("v", "vocal"), feature("b", "bass"), feature("g", "guitar")], {
      stemPurityReports: [purity("v", "vocal"), purity("b", "bass"), purity("g", "guitar")],
      contaminationReports: [contamination("v", "vocal"), contamination("b", "bass"), contamination("g", "guitar")],
    });

    expect(plan.tracks.find((track) => track.trackId === "v")?.sendDb).toBeLessThanOrEqual(-28);
    expect(plan.tracks.find((track) => track.trackId === "b")?.seat).toBe("no_send");
    expect(plan.tracks.find((track) => track.trackId === "g")?.seat).toBe("near_support");
  });

  it("blocks dirty room-wash support tracks", () => {
    const plan = buildAmbienceSeatPlan([feature("s", "synth")], {
      stemPurityReports: [purity("s", "synth", 42)],
      contaminationReports: [contamination("s", "synth", 72)],
    });

    expect(plan.status).toBe("warn");
    expect(plan.tracks[0]?.seat).toBe("no_send");
    expect(plan.tracks[0]?.warnings.length).toBeGreaterThan(0);
  });
});
