import { describe, expect, it } from "vitest";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { createEmptyProject, createTrack, type Clip, type StemRole } from "../model/Project";
import type { ReferenceProfile } from "../mix/mixDoctorTypes";
import type { AutoReferenceMixMetrics } from "./autoReferenceMixTypes";
import { maybeAddStemAirLayer, measureProject, runAutoReferenceMixPipeline } from "./autoReferenceMixPipeline";
import { buildReferenceDensityMaster } from "./referenceDensity";

describe("buildReferenceDensityMaster", () => {
  it("adds gentle master density when stem sum is much thinner than the reference", () => {
    const project = createEmptyProject();
    const result = buildReferenceDensityMaster(
      project.master,
      metrics({ integratedLufs: -20.28, rmsDb: -19.18, peakDb: -1, truePeakDb: -0.65, crestDb: 18.18 }),
      reference({ integratedLufsApprox: -17.84, rmsDb: -16.74, peakDb: -4.01, crestFactorDb: 12.73 }),
    );

    expect(result.amount).toBeGreaterThan(0.5);
    expect(result.master.compressor.enabled).toBe(true);
    expect(result.master.compressor.ratio).toBeGreaterThan(1.4);
    expect(result.master.compressor.ratio).toBeLessThanOrEqual(1.8);
    expect(result.master.compressor.threshold).toBeLessThanOrEqual(-16);
    expect(result.master.compressor.makeupGainDb).toBe(0);
    expect(result.master.exportPeakTargetDb).toBeLessThanOrEqual(-1.2);
    expect(result.master.limiterEnabled).toBe(true);
    expect(result.decisions.join(" ")).toContain("Reference Density");
  });

  it("does not add extra compression when crest and LUFS are already close", () => {
    const project = createEmptyProject();
    const result = buildReferenceDensityMaster(
      project.master,
      metrics({ integratedLufs: -18.1, rmsDb: -17, peakDb: -4, truePeakDb: -3.8, crestDb: 13 }),
      reference({ integratedLufsApprox: -17.8, rmsDb: -16.7, peakDb: -4.1, crestFactorDb: 12.7 }),
    );

    expect(result.amount).toBe(0);
    expect(result.master.compressor).toEqual(project.master.compressor);
  });

  it("adds density when LUFS is matched but the stem sum is still peakier than the reference", () => {
    const project = createEmptyProject();
    const result = buildReferenceDensityMaster(
      project.master,
      metrics({ integratedLufs: -17.89, rmsDb: -16.69, peakDb: -1.66, truePeakDb: -1.46, crestDb: 15.03 }),
      reference({ integratedLufsApprox: -17.89, rmsDb: -16.69, peakDb: -4.62, truePeakApproxDb: -4.42, crestFactorDb: 12.07 }),
    );

    expect(result.amount).toBeGreaterThan(0.4);
    expect(result.master.compressor.enabled).toBe(true);
    expect(result.master.compressor.ratio).toBeGreaterThan(1.4);
    expect(result.master.compressor.makeupGainDb).toBe(0);
    expect(result.decisions.join(" ")).toContain("Peak差");
  });
});

describe("maybeAddStemAirLayer", () => {
  it("builds an editable stem-derived air layer without using the reference audio as a source", () => {
    const project = createEmptyProject();
    const referenceTrack = createTrack("Reference", 0, "reference", "reference");
    const synthTrack = createTrack("Synth", 1, "synth", "synth");
    const bassTrack = createTrack("Bass", 2, "bass", "bass");
    bassTrack.mute = true;
    project.tracks = [referenceTrack, synthTrack, bassTrack];
    project.clips = [
      clip(referenceTrack.id, "reference-file", "reference"),
      clip(synthTrack.id, "synth-file", "synth"),
      clip(bassTrack.id, "bass-file", "bass"),
    ];

    const result = maybeAddStemAirLayer(project, {
      "reference-file": peak({ ultraAir: -54, air: -52, side: -8 }),
      "synth-file": peak({ ultraAir: -73, air: -50, side: -8.4 }),
      "bass-file": peak({ ultraAir: -86, air: -51, side: -8.6 }),
    }, reference({
      sideMidRatioDb: -8,
      bandEnergyDb: referenceBands({
        "5000-9000": -2,
        "9000-12000": -2,
        "12000-16000": -2.5,
        "16000-20000": -3,
      }),
    }), {
      passed: true,
      airLayerAllowed: true,
      stemAirLayer: "bypassed",
      items: [],
      summary: "PASS",
      warnings: [],
      subExcessDb: 0,
      midShortageDb: 0,
      presenceShortageDb: 0,
      airShortageDb: 2,
      ultraAirExcessDb: 0,
      ultraAirShortageDb: 4,
      sideShortfallDb: 2,
      decisions: [],
    });

    const airTrack = result.project.tracks.find((track) => track.referenceAssist?.type === "stem-air");
    expect(airTrack).toBeTruthy();
    expect(airTrack?.name).toBe("Stem Air Layer");
    expect(airTrack?.character.enabled).toBe(false);
    expect(airTrack?.character.mode).toBe("brightExciter");
    expect(airTrack?.insertChain.map((plugin) => plugin.pluginId)).toEqual(["sweet-air-exciter", "sweet-de-esser", "sweet-support-widener"]);
    expect(airTrack?.gainDb).toBeLessThanOrEqual(-20);
    expect(result.stemAirLayer).toBe("enabled");
    const airExciter = airTrack?.insertChain.find((plugin) => plugin.pluginId === "sweet-air-exciter");
    const widener = airTrack?.insertChain.find((plugin) => plugin.pluginId === "sweet-support-widener");
    expect(airExciter?.params.syntheticAirBed).toBe(false);
    expect(airExciter?.params.airBedLevel).toBe(0);
    expect(widener?.params.mix).toBeLessThanOrEqual(0.04);
    const airClips = result.project.clips.filter((entry) => entry.trackId === airTrack?.id);
    expect(airClips).toHaveLength(1);
    expect(airClips[0]?.fileId).toBe("synth-file");
    expect(airClips[0]?.fileId).not.toBe("reference-file");
    expect(result.decisions.join(" ")).toContain("Reference音声は混ぜていません");
  });

  it("bypasses the stem air layer when 10-20kHz already exceeds the reference", () => {
    const project = createEmptyProject();
    const referenceTrack = createTrack("Reference", 0, "reference", "reference");
    const synthTrack = createTrack("Synth", 1, "synth", "synth");
    project.tracks = [referenceTrack, synthTrack];
    project.clips = [
      clip(referenceTrack.id, "reference-file", "reference"),
      clip(synthTrack.id, "synth-file", "synth"),
    ];

    const result = maybeAddStemAirLayer(project, {
      "reference-file": peak({ ultraAir: -44, air: -38, side: -8 }),
      "synth-file": peak({ ultraAir: -36, air: -38, side: -7.5 }),
    }, reference({
      sideMidRatioDb: -8,
      bandEnergyDb: referenceBands({
        "5000-9000": -38,
        "9000-12000": -42,
        "12000-16000": -44,
        "16000-20000": -46,
      }),
    }), {
      passed: true,
      airLayerAllowed: true,
      stemAirLayer: "bypassed",
      items: [],
      summary: "PASS",
      warnings: [],
      subExcessDb: 0,
      midShortageDb: 0,
      presenceShortageDb: 0,
      airShortageDb: 0,
      ultraAirExcessDb: 0.8,
      ultraAirShortageDb: 0,
      sideShortfallDb: 0,
      decisions: [],
    });

    expect(result.stemAirLayer).toBe("bypassed");
    expect(result.project.tracks.some((track) => track.referenceAssist?.type === "stem-air")).toBe(false);
    expect(result.decisions.join(" ")).toContain("already meets or exceeds the Reference");
  });
  it("holds the stem air layer when vocal clarity bands are still below the reference", () => {
    const project = createEmptyProject();
    const referenceTrack = createTrack("Reference", 0, "reference", "reference");
    const synthTrack = createTrack("Synth", 1, "synth", "synth");
    project.tracks = [referenceTrack, synthTrack];
    project.clips = [
      clip(referenceTrack.id, "reference-file", "reference"),
      clip(synthTrack.id, "synth-file", "synth"),
    ];

    const result = maybeAddStemAirLayer(project, {
      "reference-file": peak({ ultraAir: -66, air: -44, side: -8 }),
      "synth-file": peak({ ultraAir: -54, air: -55, side: -11.5 }),
    }, reference({
      sideMidRatioDb: -8,
      bandEnergyDb: referenceBands({
        "500-900": -42,
        "900-1500": -42,
        "1500-3000": -42,
        "3000-5000": -43,
        "5000-9000": -43,
        "9000-12000": -44,
        "12000-16000": -66,
        "16000-20000": -67,
      }),
    }));

    expect(result.stemAirLayer).toBe("bypassed");
    expect(result.project.tracks.some((track) => track.referenceAssist?.type === "stem-air")).toBe(false);
    expect(result.decisions.join(" ")).toContain("500Hz-10kHz clarity must pass");
    expect(result.decisions.join(" ")).toContain("500Hz-10kHz clarity must pass");
  });
});

describe("runAutoReferenceMixPipeline decision layer reports", () => {
  it("passes Low-End King and Peak Culprit diagnostics through the result", () => {
    const project = createEmptyProject();
    const referenceTrack = createTrack("Reference Mix", 0, "reference", "reference");
    const drumsTrack = createTrack("Drums", 1, "drums", "drums");
    const bassTrack = createTrack("Bass", 2, "bass", "bass");
    project.tracks = [referenceTrack, drumsTrack, bassTrack];
    project.clips = [
      clip(referenceTrack.id, "reference-file", "reference"),
      clip(drumsTrack.id, "drums-file", "drums"),
      clip(bassTrack.id, "bass-file", "bass"),
    ];

    const result = runAutoReferenceMixPipeline(project, {
      "reference-file": peak({ ultraAir: -56, air: -52, side: -8 }),
      "drums-file": peak({ ultraAir: -64, air: -58, side: -10 }),
      "bass-file": peak({ ultraAir: -76, air: -70, side: -18 }),
    }, {
      autoTrySpatial: false,
      allowStemAirLayer: false,
      allowReferenceAirGlue: false,
    });

    expect(result.mixDoctorReport?.lowEndKingReport).toBeTruthy();
    expect(result.lowEndKingReport).toBe(result.mixDoctorReport?.lowEndKingReport);
    expect(result.peakCulpritReport).toBe(result.mixDoctorReport?.peakCulpritReport);
    expect(result.decisions.some((decision) => decision.startsWith("Low-End King"))).toBe(true);
  });

  it("runs Sweet No-Reference Finish when stems are present without a reference track", () => {
    const project = createEmptyProject();
    const vocalTrack = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const keysTrack = createTrack("Keys", 1, "keys", "keys");
    project.tracks = [vocalTrack, keysTrack];
    project.clips = [
      clip(vocalTrack.id, "vocal-file", "vocal"),
      clip(keysTrack.id, "keys-file", "keys"),
    ];

    const result = runAutoReferenceMixPipeline(project, {
      "vocal-file": peak({ ultraAir: -74, air: -64, side: -16, presence: -58 }),
      "keys-file": peak({ ultraAir: -78, air: -66, side: -14, presence: -62 }),
    }, {
      autoTrySpatial: false,
      allowStemAirLayer: false,
      allowReferenceAirGlue: false,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("accepted-sweet-no-reference");
    expect(result.mixDoctorReport?.referenceProfile).toBeFalsy();
    expect(result.decisions.some((decision) => decision.startsWith("Sweet No-Reference Finish"))).toBe(true);
    expect(result.after.master.finalOutputTrimOwner).toBe("sweet-no-reference");
    expect(result.after.master.limiterEnabled).toBe(true);
    expect(result.after.master.exportPeakTargetDb).toBeLessThanOrEqual(-1.2);
    expect(result.message).toContain("Sweet No-Reference Finish");
  });

  it("blocks no-reference stem air when fake-air and side-high risk are elevated", () => {
    const project = createEmptyProject();
    const vocalTrack = createTrack("Lead Vocal", 0, "vocal", "vocal");
    const keysTrack = createTrack("Keys", 1, "keys", "keys");
    project.tracks = [vocalTrack, keysTrack];
    project.clips = [
      clip(vocalTrack.id, "vocal-file", "vocal"),
      clip(keysTrack.id, "keys-file", "keys"),
    ];

    const result = runAutoReferenceMixPipeline(project, {
      "vocal-file": peak({ ultraAir: -40, air: -47, side: -4.2, presence: -58 }),
      "keys-file": peak({ ultraAir: -42, air: -48, side: -4.5, presence: -60 }),
    }, {
      autoTrySpatial: false,
      allowStemAirLayer: true,
      allowReferenceAirGlue: false,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("accepted-sweet-no-reference");
    expect(result.vocalClarityGate?.summary).toContain("No-Reference Gate");
    expect(result.vocalClarityGate?.stemAirLayer).toBe("bypassed");
    expect(result.vocalClarityGate?.warnings.join(" ")).toContain("Stem Air Layer held");
  });
});

describe("measureProject", () => {
  it("counts track EQ when judging vocal clarity bands", () => {
    const project = createEmptyProject();
    const vocalTrack = createTrack("Lead Vocal", 0, "vocal", "vocal");
    project.tracks = [vocalTrack];
    project.clips = [clip(vocalTrack.id, "vocal-file", "vocal")];

    const before = measureProject(project, {
      "vocal-file": peak({ ultraAir: -88, air: -86, presence: -82, side: -12 }),
    });

    const boostedTrack = {
      ...vocalTrack,
      eq: {
        ...vocalTrack.eq,
        enabled: true,
        bands: vocalTrack.eq.bands.map((band, index) => index === 0
          ? { ...band, type: "peaking" as const, frequency: 3800, gainDb: 3, q: 1, enabled: true }
          : band),
      },
    };
    const after = measureProject({ ...project, tracks: [boostedTrack] }, {
      "vocal-file": peak({ ultraAir: -88, air: -86, presence: -82, side: -12 }),
    });

    expect(after.presence20005000Db).toBeGreaterThan(before.presence20005000Db + 1);
  });
});

function metrics(overrides: Partial<AutoReferenceMixMetrics>): AutoReferenceMixMetrics {
  return {
    peakDb: -1,
    truePeakDb: -0.8,
    rmsDb: -19,
    integratedLufs: -20,
    crestDb: 18,
    lowMidDb: -26,
    presenceDb: -27,
    airDb: -35,
    widthDb: -9,
    sub2060Db: -34,
    low120250Db: -26,
    body250500Db: -28,
    mid5002000Db: -27,
    presence20005000Db: -29,
    air500010000Db: -35,
    ultraAir1000020000Db: -43,
    ...overrides,
  };
}

function reference(overrides: Partial<ReferenceProfile>): ReferenceProfile {
  return {
    stemId: "reference",
    trackId: "reference",
    trackName: "Reference",
    role: "reference",
    peakDb: -4,
    truePeakApproxDb: -3.7,
    rmsDb: -16.7,
    crestFactorDb: 12.7,
    integratedLufsApprox: -17.8,
    stereoWidthScore: 50,
    lrCorrelation: 0.77,
    sideMidRatioDb: -8.9,
    bandEnergyDb: referenceBands(),
    sourceRole: "reference",
    loudnessTargetLabel: "reference-range",
    targetRanges: {},
    ...overrides,
  } as ReferenceProfile;
}

function referenceBands(overrides: Record<string, number> = {}) {
  return {
    "20-35": -18,
    "35-60": -16,
    "60-120": -14,
    "120-250": -12,
    "250-500": -10,
    "500-900": -8,
    "900-1500": -7,
    "1500-3000": -6,
    "3000-5000": -7,
    "5000-9000": -9,
    "9000-12000": -10,
    "12000-16000": -12,
    "16000-20000": -14,
    ...overrides,
  };
}

function clip(trackId: string, fileId: string, role: StemRole): Clip {
  return {
    id: `${fileId}-clip`,
    trackId,
    fileId,
    role,
    clipKind: "audio",
    intentTags: [],
    actionHistory: [],
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: 10,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: true,
    movementLocked: true,
    insertChain: [],
  };
}

function peak(options: { ultraAir: number; air: number; side: number; presence?: number }): PeakSummary {
  return {
    analysisVersion: 2,
    bins: 4,
    min: [-0.08, -0.1, -0.06, -0.07],
    max: [0.08, 0.1, 0.06, 0.07],
    durationSec: 10,
    sideMidRatioDb: options.side,
    bandEnergyDb: {
      "20-35": -72,
      "35-60": -70,
      "60-120": -68,
      "120-250": -62,
      "250-500": -58,
      "500-900": -55,
      "900-1500": -54,
      "1500-3000": options.presence ?? -55,
      "3000-5000": options.presence ?? -57,
      "5000-9000": options.air,
      "9000-12000": options.ultraAir,
      "12000-16000": options.ultraAir - 1,
      "16000-20000": options.ultraAir - 2,
    },
  };
}
