import { describe, expect, it } from "vitest";
import { buildAutoPluginPlan } from "./autoPluginPlanner";
import type {
  AutoMixPlan,
  LowEndKingReport,
  MixDoctorBandId,
  PeakCulpritReport,
  ReferenceClarityGapReport,
  ReferenceDelta,
  StemContaminationReport,
  StemFeatureReport,
  StemPurityReport,
} from "../mixDoctorTypes";
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

function feature(trackId: string, role: StemRole, bandOverrides: Partial<Record<MixDoctorBandId, number>> = {}): StemFeatureReport {
  return {
    stemId: trackId,
    trackId,
    trackName: `${role} ${trackId}`,
    role,
    rmsDb: -18,
    peakDb: -5,
    truePeakApproxDb: -4,
    crestFactorDb: 10,
    integratedLufsApprox: -20,
    lrCorrelation: 0.7,
    sideMidRatioDb: -10,
    stereoWidthScore: 42,
    spectralCentroidHz: 1800,
    spectralFlatness: 0.32,
    bandEnergyDb: {
      ...(Object.fromEntries(BANDS.map((band) => [band, -18])) as StemFeatureReport["bandEnergyDb"]),
      ...bandOverrides,
    },
    notes: [],
  };
}

function purity(trackId: string, role: StemRole): StemPurityReport {
  return {
    stemId: trackId,
    trackId,
    trackName: `${role} ${trackId}`,
    role,
    purityScore: 82,
    mode: "normal_track_processing_allowed",
    dominantComponents: [],
    protectedComponents: [],
    notes: [],
  };
}

function contamination(trackId: string, role: StemRole, overrides: Partial<StemContaminationReport> = {}): StemContaminationReport {
  return {
    stemId: trackId,
    trackId,
    trackName: `${role} ${trackId}`,
    role,
    vocalBleedScore: 0,
    cymbalMetallicScore: 0,
    roomWashScore: 0,
    lowEndContaminationScore: 10,
    artifactScore: 0,
    warnings: [],
    ...overrides,
  };
}

function autoMixPlan(role: StemRole, target: AutoMixPlan["target"] = "streaming_safe", mode: AutoMixPlan["mode"] = "balanced"): AutoMixPlan {
  return {
    id: "auto-plan-test",
    createdAt: "2026-06-19T00:00:00.000Z",
    mode,
    target,
    trackPlans: [{
      trackId: "track-a",
      trackName: `${role} track`,
      role,
      volumeTrimDb: 0,
      pan: 0,
      width: 0.16,
      depth: 0.25,
      priority: role === "bass" ? "protect" : "support",
      protectFlags: [],
      reason: "test plan",
      confidence: 0.8,
    }],
    masterPlan: {
      limiterCeilingDb: -1,
      maxGainPushDb: 0.4,
      tone: "clean",
      notes: [],
    },
  };
}

const lowEndKingPass: LowEndKingReport = {
  owner: "bass",
  kickTrackId: null,
  bassTrackId: "track-a",
  kickTrackName: null,
  bassTrackName: "bass track",
  sub2060ConflictDb: 4,
  sub2035Db: -12,
  sub3560Db: -11,
  low60120Db: -10,
  lowMid120250MudDb: -16,
  monoLowRisk: 20,
  phaseRisk: 18,
  limiterStressFromLowEnd: 22,
  status: "pass",
  recommendations: [],
};

const peakPass: PeakCulpritReport = {
  status: "pass",
  topCulprits: [],
  limiterLoadRisk: 0,
  densityShortfallLikely: false,
  recommendations: [],
};

const muffleFail: ReferenceClarityGapReport = {
  status: "fail",
  bodyGapDb: -0.2,
  presenceGapDb: 2.1,
  clarityGapDb: 2.3,
  airGapDb: 0.4,
  falseAirRisk: true,
  muffleRisk: 86,
  recommendations: ["Reference Clarity: restore 2-10kHz before Air."],
};

describe("autoPluginPlanner Phase 3-5", () => {
  it("keeps Safe mode free of automatic density, reverb, widener, and bass translator inserts", () => {
    const bassPlan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "bass", {
        "20-35": -12,
        "35-60": -11,
        "120-250": -12,
        "250-500": -13,
      })],
      autoMixPlan: autoMixPlan("bass", "streaming_safe", "light"),
      stemPurityReports: [purity("track-a", "bass")],
      contaminationReports: [contamination("track-a", "bass")],
      referenceDelta: null,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: lowEndKingPass,
      peakCulpritReport: peakPass,
    });
    const supportPlan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "synth")],
      autoMixPlan: autoMixPlan("synth", "wide_pop", "light"),
      stemPurityReports: [purity("track-a", "synth")],
      contaminationReports: [contamination("track-a", "synth")],
      referenceDelta: null,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: null,
      peakCulpritReport: peakPass,
    });

    const forbidden = new Set(["sweet-bass-enhancer", "sweet-low-end-translator", "sweet-parallel-comp", "sweet-support-widener", "sweet-stereo-widener", "sweet-reverb-lite"]);
    expect(bassPlan.trackPlans[0]?.insertPlans.some((insert) => forbidden.has(insert.pluginId))).toBe(false);
    expect(supportPlan.trackPlans[0]?.insertPlans.some((insert) => forbidden.has(insert.pluginId))).toBe(false);
    expect(supportPlan.trackPlans[0]?.sendPlans).toHaveLength(0);
  });

  it("adds Low-End Translator only for bass audibility problems", () => {
    const plan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "bass", {
        "20-35": -12,
        "35-60": -11,
        "120-250": -12,
        "250-500": -13,
      })],
      autoMixPlan: autoMixPlan("bass"),
      stemPurityReports: [purity("track-a", "bass")],
      contaminationReports: [contamination("track-a", "bass")],
      referenceDelta: null,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: lowEndKingPass,
      peakCulpritReport: peakPass,
    });

    expect(plan.trackPlans[0]?.insertPlans.some((insert) => insert.pluginId === "sweet-low-end-translator")).toBe(true);
  });

  it("uses Ambience Seat to keep dirty support ambience disabled", () => {
    const plan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "synth")],
      autoMixPlan: autoMixPlan("synth", "wide_pop"),
      stemPurityReports: [purity("track-a", "synth")],
      contaminationReports: [contamination("track-a", "synth")],
      referenceDelta: null,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: null,
      peakCulpritReport: peakPass,
      ambienceSeatPlan: {
        status: "warn",
        busPreset: "wide_air",
        globalLowCutHz: 180,
        globalHighCutHz: 12000,
        warnings: [],
        recommendations: ["Ambience Seat: Vocal / Bass / Kick protected dry; 0 support track(s) sent; 1 blocked."],
        tracks: [{
          trackId: "track-a",
          trackName: "synth track",
          role: "synth",
          seat: "no_send",
          sendDb: -96,
          preDelayMs: 0,
          lowCutHz: 180,
          highCutHz: 12000,
          width: 0,
          reason: "test block",
          warnings: [],
        }],
      },
    });

    expect(plan.trackPlans[0]?.sendPlans).toHaveLength(0);
  });

  it("proposes master Tilt EQ only for safe reference tonal imbalance", () => {
    const referenceDelta: ReferenceDelta = {
      loudnessDeltaDb: 0,
      peakDeltaDb: 0,
      crestFactorDeltaDb: 0,
      lowEndDeltaDb: 0,
      bodyDeltaDb: -1.2,
      presenceDeltaDb: 0,
      airDeltaDb: 2.2,
      stereoWidthDelta: 0,
      correlationDelta: 0,
      advisory: [],
    };
    const plan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "synth")],
      autoMixPlan: autoMixPlan("synth", "reference_polish"),
      stemPurityReports: [purity("track-a", "synth")],
      contaminationReports: [contamination("track-a", "synth")],
      referenceDelta,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: { ...lowEndKingPass, owner: "none", bassTrackId: null, bassTrackName: null },
      peakCulpritReport: peakPass,
    });

    expect(plan.masterInsertPlans.some((insert) => insert.pluginId === "sweet-tilt-eq")).toBe(true);
  });

  it("allows mild Reference Clarity Catch-Up even when safety guards block broad master tilt", () => {
    const plan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "synth")],
      autoMixPlan: autoMixPlan("synth", "reference_polish"),
      stemPurityReports: [purity("track-a", "synth")],
      contaminationReports: [contamination("track-a", "synth")],
      referenceDelta: {
        loudnessDeltaDb: 0,
        peakDeltaDb: 0,
        crestFactorDeltaDb: 0,
        lowEndDeltaDb: 0,
        bodyDeltaDb: 0,
        presenceDeltaDb: 0,
        airDeltaDb: 0,
        stereoWidthDelta: 0,
        correlationDelta: 0,
        advisory: [],
      },
      referenceClarityGap: muffleFail,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: { ...lowEndKingPass, status: "fail" },
      peakCulpritReport: { ...peakPass, status: "fail" },
    });

    expect(plan.masterInsertPlans).toHaveLength(1);
    expect(plan.masterInsertPlans[0]?.name).toBe("Reference Clarity Catch-Up");
    expect(plan.masterInsertPlans[0]?.params.tiltDb).toBeGreaterThan(0);
    expect(plan.masterInsertPlans[0]?.params.outputDb).toBe(-0.2);
  });

  it("plans vocal inserts in the safe stem mix order", () => {
    const vocalPlan = autoMixPlan("vocal", "streaming_safe", "balanced");
    vocalPlan.trackPlans[0]!.volumeTrimDb = -2.4;
    const plan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "vocal", {
        "20-35": -20,
        "35-60": -19,
        "5000-9000": -12,
        "9000-12000": -13,
        "12000-16000": -18,
        "16000-20000": -20,
      })],
      autoMixPlan: vocalPlan,
      stemPurityReports: [purity("track-a", "vocal")],
      contaminationReports: [contamination("track-a", "vocal", { vocalBleedScore: 72 })],
      referenceDelta: null,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: null,
      peakCulpritReport: peakPass,
    });
    const inserts = plan.trackPlans[0]?.insertPlans ?? [];
    const ids = inserts.map((insert) => insert.pluginId);
    const vocalOrders = inserts
      .filter((insert) => typeof insert.params.vocalMixOrder === "number")
      .map((insert) => Number(insert.params.vocalMixOrder));

    expect(ids).toEqual(["sweet-utility", "sweet-filter", "sweet-de-esser", "sweet-aimix-glow"]);
    expect(vocalOrders).toEqual([...vocalOrders].sort((a, b) => a - b));
    expect(inserts.find((insert) => insert.pluginId === "sweet-utility")?.params.vocalMixStage).toBe("01-input-gain");
    expect(inserts.find((insert) => insert.pluginId === "sweet-utility")?.params.inputTrimConsumesFader).toBe(true);
    expect(inserts.find((insert) => insert.pluginId === "sweet-filter")?.params.vocalMixStage).toBe("03-corrective-eq");
    expect(inserts.find((insert) => insert.pluginId === "sweet-de-esser")?.params.vocalMixStage).toBe("04-de-esser-harshness-guard");
    expect(inserts.some((insert) => insert.pluginId === "sweet-parallel-comp")).toBe(false);
    expect(inserts.find((insert) => insert.pluginId === "sweet-aimix-glow")?.params.broadHighShelfAllowed).toBe(false);
    expect(plan.trackPlans[0]?.notes.join(" ")).toContain("Vocal Stem Order");
    expect(plan.trackPlans[0]?.notes.join(" ")).toContain("Density Guard");
  });

  it("caps Balanced automatic parallel compression to four non-lead tracks with reduced mix", () => {
    const roles: StemRole[] = ["vocal", "drums", "bass", "music", "backingVocal", "guitar", "keys", "synth"];
    const autoPlan = autoMixPlan("music", "streaming_safe", "balanced");
    autoPlan.trackPlans = roles.map((role, index) => ({
      trackId: `track-${index}`,
      trackName: `${role} ${index}`,
      role,
      volumeTrimDb: 0,
      pan: 0,
      width: 0.24,
      depth: 0.24,
      priority: role === "vocal" || role === "bass" ? "protect" : "support",
      protectFlags: [],
      reason: "multi plan",
      confidence: 0.8,
    }));
    const plan = buildAutoPluginPlan({
      featureReports: roles.map((role, index) => feature(`track-${index}`, role)),
      autoMixPlan: autoPlan,
      stemPurityReports: roles.map((role, index) => purity(`track-${index}`, role)),
      contaminationReports: roles.map((role, index) => contamination(`track-${index}`, role)),
      referenceDelta: null,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: lowEndKingPass,
      peakCulpritReport: peakPass,
    });
    const parallelInserts = plan.trackPlans.flatMap((trackPlan) =>
      trackPlan.insertPlans
        .filter((insert) => insert.pluginId === "sweet-parallel-comp")
        .map((insert) => ({ role: trackPlan.role, insert })),
    );

    expect(parallelInserts).toHaveLength(4);
    expect(parallelInserts.some((item) => item.role === "vocal")).toBe(false);
    expect(parallelInserts.every((item) => Number(item.insert.params.mix) <= 0.09)).toBe(true);
    expect(plan.notes.join(" ")).toContain("Density Guard: Balanced kept 4");
  });

  it("blocks vocal Glow and Air recovery when fake-air risk is high", () => {
    const plan = buildAutoPluginPlan({
      featureReports: [feature("track-a", "vocal", {
        "5000-9000": -20,
        "9000-12000": -19,
        "12000-16000": -10,
        "16000-20000": -9,
      })],
      autoMixPlan: autoMixPlan("vocal", "streaming_safe", "balanced"),
      stemPurityReports: [purity("track-a", "vocal")],
      contaminationReports: [contamination("track-a", "vocal", { cymbalMetallicScore: 78, artifactScore: 72 })],
      referenceDelta: null,
      loudnessMatchReport: null,
      kickBassRoleReport: null,
      lowEndKingReport: null,
      peakCulpritReport: peakPass,
    });
    const inserts = plan.trackPlans[0]?.insertPlans ?? [];
    const guard = inserts.find((insert) => insert.params.blockedStage === "air-recovery");

    expect(inserts.some((insert) => insert.pluginId === "sweet-aimix-glow" && insert.enabled)).toBe(false);
    expect(inserts.some((insert) => insert.pluginId === "sweet-air-exciter")).toBe(false);
    expect(guard?.enabled).toBe(false);
    expect(guard?.reason).toContain("blocked");
  });
});
