import { describe, expect, it } from "vitest";
import type { PeakSummary } from "../../audio/analysis/PeakBuilder";
import { createEmptyProject, createId, createTrack, type AudioFileRef, type Clip, type StemRole } from "../model/Project";
import { applyClipIntelligenceToProject, buildClipIntelligenceReport } from "./clipIntelligence";
import type { BandEnergyMap, ReferenceDelta, ReferenceProfile, StemFeatureReport } from "./mixDoctorTypes";

describe("AIMIX clip intelligence", () => {
  it("adds clip pan automation that survives into the proposed project", () => {
    const project = projectWithTrack("Pad", "synth");
    const report = buildClipIntelligenceReport(project, { file_a: peakSummary(synthBands()) }, { mode: "balanced", enableClipPan: true });
    const after = applyClipIntelligenceToProject(project, report, { file_a: peakSummary(synthBands()) }, { mode: "balanced", enableClipPan: true });

    expect(report.panAutomationClipIds).toContain("clip_a");
    expect(after.clips[0]?.panAutomation?.enabled).toBe(true);
    expect(after.clips[0]?.panAutomation?.anchorPoints.length).toBeGreaterThanOrEqual(3);
    expect(after.clips[0]?.intentTags).toContain("aimix-auto-pan");
  });

  it("marks role-mismatched clips without muting original audio", () => {
    const project = projectWithTrack("Lead Vocal", "vocal");
    const report = buildClipIntelligenceReport(project, { file_a: peakSummary(guitarBands()) }, { mode: "balanced", enableClipPan: true });
    const after = applyClipIntelligenceToProject(project, report, { file_a: peakSummary(guitarBands()) }, { mode: "balanced", enableClipPan: true });

    expect(report.mismatchClipIds).toContain("clip_a");
    expect(after.clips[0]?.artifact?.repairQueue).toBe(true);
    expect(after.clips[0]?.artifact?.isMuted).toBe(false);
    expect(after.clips[0]?.intentTags).toContain("role-mismatch");
  });

  it("does not mark a centered vocal as guitar or synth just because it has presence", () => {
    const project = projectWithTrack("Lead Vocal", "vocal");
    const summary = peakSummary(vocalLikeBands(), { sideMidRatioDb: -18, spectralCentroidHz: 2300, spectralFlatness: 0.24 });
    const report = buildClipIntelligenceReport(project, { file_a: summary }, { mode: "balanced", enableClipPan: true });

    expect(report.mismatchClipIds).not.toContain("clip_a");
  });

  it("does not mark a low-dominant bass as synth when upper harmonics exist", () => {
    const project = projectWithTrack("Bass", "bass");
    const summary = peakSummary(bassWithHarmonicsBands(), { sideMidRatioDb: -17, spectralCentroidHz: 520, spectralFlatness: 0.31 });
    const report = buildClipIntelligenceReport(project, { file_a: summary }, { mode: "balanced", enableClipPan: true });

    expect(report.mismatchClipIds).not.toContain("clip_a");
  });

  it("uses a reference profile for conservative stem-side adjustment", () => {
    const project = projectWithTrack("Music", "music");
    const stemReport = stemFeature("track_a", "music", muddyBands(), -20);
    const reference = { ...stemFeature("ref_track", "reference", cleanReferenceBands(), -15), sourceRole: "reference" as const, targetRanges: {}, loudnessTargetLabel: "reference-range" };
    const delta: ReferenceDelta = {
      loudnessDeltaDb: 1,
      peakDeltaDb: 0,
      crestFactorDeltaDb: 0,
      lowEndDeltaDb: 0,
      bodyDeltaDb: -2,
      presenceDeltaDb: 0.5,
      airDeltaDb: 1.6,
      stereoWidthDelta: 2,
      correlationDelta: -0.1,
      advisory: [],
    };
    const report = buildClipIntelligenceReport(project, { file_a: peakSummary(muddyBands()) }, {
      mode: "balanced",
      referenceDelta: delta,
      referenceProfile: reference,
      stemFeatureReports: [stemReport],
    });
    const after = applyClipIntelligenceToProject(project, report, { file_a: peakSummary(muddyBands()) }, {
      mode: "balanced",
      referenceDelta: delta,
      referenceProfile: reference,
      stemFeatureReports: [stemReport],
    });

    expect(report.referenceAdjustedTrackIds).toContain("track_a");
    expect(after.tracks[0]?.eq.enabled).toBe(true);
    expect(after.tracks[0]?.eq.bands.some((band) => band.enabled && band.gainDb < 0)).toBe(true);
  });

  it("can disable pan automation or use Reference+ pan depth", () => {
    const project = projectWithTrack("Pad", "synth");
    const reference = { ...stemFeature("ref_track", "reference", cleanReferenceBands(), -9), sourceRole: "reference" as const, targetRanges: {}, loudnessTargetLabel: "reference-range" };
    const delta: ReferenceDelta = {
      loudnessDeltaDb: 0,
      peakDeltaDb: 0,
      crestFactorDeltaDb: 0,
      lowEndDeltaDb: 0,
      bodyDeltaDb: 0,
      presenceDeltaDb: 0,
      airDeltaDb: 0,
      stereoWidthDelta: 12,
      correlationDelta: -0.1,
      advisory: [],
    };

    const offReport = buildClipIntelligenceReport(project, { file_a: peakSummary(synthBands()) }, { mode: "balanced", panDesignMode: "off", enableClipPan: true });
    const roleReport = buildClipIntelligenceReport(project, { file_a: peakSummary(synthBands()) }, { mode: "balanced", panDesignMode: "role", panDesignAmount: 70, enableClipPan: true });
    const referenceReport = buildClipIntelligenceReport(project, { file_a: peakSummary(synthBands()) }, {
      mode: "balanced",
      referenceProfile: reference,
      referenceDelta: delta,
      panDesignMode: "referencePlus",
      panDesignAmount: 100,
      enableClipPan: true,
    });
    const roleAfter = applyClipIntelligenceToProject(project, roleReport, { file_a: peakSummary(synthBands()) }, { mode: "balanced", panDesignMode: "role", panDesignAmount: 70, enableClipPan: true });
    const referenceAfter = applyClipIntelligenceToProject(project, referenceReport, { file_a: peakSummary(synthBands()) }, {
      mode: "balanced",
      referenceProfile: reference,
      referenceDelta: delta,
      panDesignMode: "referencePlus",
      panDesignAmount: 100,
      enableClipPan: true,
    });

    expect(offReport.panAutomationClipIds).toHaveLength(0);
    expect(referenceReport.panAutomationClipIds).toContain("clip_a");
    expect(referenceAfter.clips[0]?.panAutomation?.depth ?? 0).toBeGreaterThan(roleAfter.clips[0]?.panAutomation?.depth ?? 0);
  });

  it("reduces Reference+ clip pan depth when reference correlation is risky", () => {
    const project = projectWithTrack("Pad", "synth");
    const delta: ReferenceDelta = {
      loudnessDeltaDb: 0,
      peakDeltaDb: 0,
      crestFactorDeltaDb: 0,
      lowEndDeltaDb: 0,
      bodyDeltaDb: 0,
      presenceDeltaDb: 0,
      airDeltaDb: 0,
      stereoWidthDelta: 12,
      correlationDelta: -0.2,
      advisory: [],
    };
    const safeReference = {
      ...stemFeature("ref_track", "reference", cleanReferenceBands(), -8),
      sourceRole: "reference" as const,
      lrCorrelation: 0.82,
      targetRanges: {},
      loudnessTargetLabel: "reference-range",
    };
    const riskyReference = { ...safeReference, lrCorrelation: 0.55 };

    const safeReport = buildClipIntelligenceReport(project, { file_a: peakSummary(synthBands()) }, {
      mode: "balanced",
      referenceProfile: safeReference,
      referenceDelta: delta,
      panDesignMode: "referencePlus",
      panDesignAmount: 100,
      enableClipPan: true,
    });
    const riskyReport = buildClipIntelligenceReport(project, { file_a: peakSummary(synthBands()) }, {
      mode: "balanced",
      referenceProfile: riskyReference,
      referenceDelta: delta,
      panDesignMode: "referencePlus",
      panDesignAmount: 100,
      enableClipPan: true,
    });
    const safeAfter = applyClipIntelligenceToProject(project, safeReport, { file_a: peakSummary(synthBands()) }, {
      mode: "balanced",
      referenceProfile: safeReference,
      referenceDelta: delta,
      panDesignMode: "referencePlus",
      panDesignAmount: 100,
      enableClipPan: true,
    });
    const riskyAfter = applyClipIntelligenceToProject(project, riskyReport, { file_a: peakSummary(synthBands()) }, {
      mode: "balanced",
      referenceProfile: riskyReference,
      referenceDelta: delta,
      panDesignMode: "referencePlus",
      panDesignAmount: 100,
      enableClipPan: true,
    });

    expect(maxEffectivePan(riskyAfter.clips[0])).toBeLessThan(maxEffectivePan(safeAfter.clips[0]));
  });

  it("applies time-aware pan to every non-reference clip while protecting center roles", () => {
    const project = projectWithTimelinePanTargets();
    const peaks = {
      file_vocal: peakSummary(synthBands()),
      file_fx_a: peakSummary(synthBands()),
      file_fx_b: peakSummary(synthBands()),
    };
    const report = buildClipIntelligenceReport(project, peaks, { mode: "balanced", panDesignMode: "referencePlus", panDesignAmount: 100, enableClipPan: true });
    const after = applyClipIntelligenceToProject(project, report, peaks, { mode: "balanced", panDesignMode: "referencePlus", panDesignAmount: 100, enableClipPan: true });

    expect(report.panAutomationClipIds).toEqual(expect.arrayContaining(["clip_vocal", "clip_fx_a", "clip_fx_b"]));
    expect(maxEffectivePan(after.clips.find((clip) => clip.id === "clip_vocal") ?? after.clips[0])).toBeLessThan(0.04);
    expect(maxEffectivePan(after.clips.find((clip) => clip.id === "clip_fx_a") ?? after.clips[1])).toBeGreaterThan(0.28);
    expect(firstMovingPan(after.clips.find((clip) => clip.id === "clip_fx_a") ?? after.clips[1])).toBeGreaterThan(0);
    expect(firstMovingPan(after.clips.find((clip) => clip.id === "clip_fx_b") ?? after.clips[2])).toBeLessThan(0);
  });
});

function projectWithTrack(name: string, role: "vocal" | "synth" | "music" | "bass") {
  const project = createEmptyProject();
  const track = { ...createTrack(name, 0, role, role), id: "track_a" };
  const file: AudioFileRef = {
    id: "file_a",
    name: `${name}.wav`,
    originalName: `${name}.wav`,
    role,
    mimeType: "audio/wav",
    durationSec: 12,
    sampleRate: 48000,
    channelCount: 2,
    byteLength: 1024,
    storageKey: "idb:audio:file_a",
    peakCacheKey: "peaks:file_a",
    createdAt: new Date().toISOString(),
  };
  const clip: Clip = {
    id: "clip_a",
    trackId: "track_a",
    fileId: "file_a",
    role,
    intentTags: [],
    actionHistory: [],
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: 12,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: true,
    movementLocked: true,
    insertChain: [],
    createdBy: "import",
  };

  return { ...project, tracks: [track], files: [file], clips: [clip] };
}

function projectWithTimelinePanTargets() {
  const project = createEmptyProject();
  const vocalTrack = { ...createTrack("Lead Vocal", 0, "vocal", "vocal"), id: "track_vocal" };
  const fxTrack = { ...createTrack("FX Throws", 1, "fx", "fx"), id: "track_fx" };
  const vocal = makeFileAndClip("vocal", "track_vocal", "file_vocal", "clip_vocal", 0, 12);
  const fxA = makeFileAndClip("fx", "track_fx", "file_fx_a", "clip_fx_a", 0, 6);
  const fxB = makeFileAndClip("fx", "track_fx", "file_fx_b", "clip_fx_b", 16, 6);
  return {
    ...project,
    tracks: [vocalTrack, fxTrack],
    files: [vocal.file, fxA.file, fxB.file],
    clips: [vocal.clip, fxA.clip, fxB.clip],
  };
}

function makeFileAndClip(role: StemRole, trackId: string, fileId: string, clipId: string, timelineStartSec: number, durationSec: number) {
  const file: AudioFileRef = {
    id: fileId,
    name: `${fileId}.wav`,
    originalName: `${fileId}.wav`,
    role,
    mimeType: "audio/wav",
    durationSec,
    sampleRate: 48000,
    channelCount: 2,
    byteLength: 1024,
    storageKey: `idb:audio:${fileId}`,
    peakCacheKey: `peaks:${fileId}`,
    createdAt: new Date().toISOString(),
  };
  const clip: Clip = {
    id: clipId,
    trackId,
    fileId,
    role,
    intentTags: [],
    actionHistory: [],
    timelineStartSec,
    sourceStartSec: 0,
    durationSec,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: true,
    movementLocked: true,
    insertChain: [],
    createdBy: "import",
  };
  return { file, clip };
}

function maxEffectivePan(clip: Clip | undefined) {
  const automation = clip?.panAutomation;
  if (!automation) return 0;
  return Math.max(...automation.anchorPoints.map((point) => Math.abs(point.pan * automation.depth)));
}

function firstMovingPan(clip: Clip | undefined) {
  const automation = clip?.panAutomation;
  if (!automation) return 0;
  return (automation.anchorPoints[1]?.pan ?? 0) * automation.depth;
}

function peakSummary(bandEnergyDb: BandEnergyMap, overrides: Partial<PeakSummary> = {}): PeakSummary {
  return {
    analysisVersion: 2,
    bins: 8,
    min: [-0.1, -0.2, -0.15, -0.12, -0.18, -0.1, -0.14, -0.1],
    max: [0.1, 0.2, 0.15, 0.12, 0.18, 0.1, 0.14, 0.1],
    durationSec: 12,
    bandEnergyDb,
    lrCorrelation: 0.4,
    sideMidRatioDb: -10,
    spectralCentroidHz: 2600,
    spectralFlatness: 0.32,
    ...overrides,
  };
}

function stemFeature(trackId: string, role: StemFeatureReport["role"], bandEnergyDb: BandEnergyMap, sideMidRatioDb: number): StemFeatureReport {
  return {
    stemId: createId("stem"),
    trackId,
    trackName: trackId,
    role,
    rmsDb: -18,
    peakDb: -4,
    truePeakApproxDb: -3.8,
    crestFactorDb: 10,
    integratedLufsApprox: -19,
    lrCorrelation: 0.6,
    sideMidRatioDb,
    stereoWidthScore: 60,
    spectralCentroidHz: 1800,
    spectralFlatness: 0.35,
    bandEnergyDb,
    notes: [],
  };
}

function baseBands(value = -18): BandEnergyMap {
  return {
    "20-35": value,
    "35-60": value,
    "60-120": value,
    "120-250": value,
    "250-500": value,
    "500-900": value,
    "900-1500": value,
    "1500-3000": value,
    "3000-5000": value,
    "5000-9000": value,
    "9000-12000": value,
    "12000-16000": value,
    "16000-20000": value,
  };
}

function synthBands(): BandEnergyMap {
  return {
    ...baseBands(-16),
    "1500-3000": -5,
    "3000-5000": -4,
    "5000-9000": -5,
    "9000-12000": -7,
  };
}

function guitarBands(): BandEnergyMap {
  return {
    ...baseBands(-20),
    "250-500": -5,
    "500-900": -4,
    "900-1500": -4,
    "1500-3000": -3,
    "3000-5000": -4,
    "5000-9000": -10,
  };
}

function vocalLikeBands(): BandEnergyMap {
  return {
    ...baseBands(-24),
    "120-250": -13,
    "250-500": -10,
    "500-900": -8,
    "900-1500": -7,
    "1500-3000": -5,
    "3000-5000": -6,
    "5000-9000": -8,
    "9000-12000": -10,
  };
}

function bassWithHarmonicsBands(): BandEnergyMap {
  return {
    ...baseBands(-26),
    "35-60": -4,
    "60-120": -3,
    "120-250": -9,
    "250-500": -14,
    "1500-3000": -20,
    "3000-5000": -18,
    "5000-9000": -19,
  };
}

function muddyBands(): BandEnergyMap {
  return {
    ...baseBands(-17),
    "250-500": -4,
    "500-900": -5,
    "900-1500": -8,
    "5000-9000": -15,
    "9000-12000": -17,
    "12000-16000": -18,
  };
}

function cleanReferenceBands(): BandEnergyMap {
  return {
    ...baseBands(-17),
    "250-500": -9,
    "500-900": -10,
    "1500-3000": -7,
    "3000-5000": -7,
    "5000-9000": -9,
    "9000-12000": -10,
    "12000-16000": -12,
  };
}
