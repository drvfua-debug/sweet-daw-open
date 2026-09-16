import { describe, expect, it } from "vitest";
import type { PeakSummary } from "../../audio/analysis/PeakBuilder";
import { createEmptyProject, createTrack, type Clip, type Project } from "../model/Project";
import { AI_ARTIFACT_DEESSER_PLUGIN_NAME, AI_LAYOUT_DEPTH_PLUGIN_NAME, AI_LAYOUT_WIDTH_PLUGIN_NAME, AI_MASTER_DEESSER_PLUGIN_NAME, AI_MASTER_DENSITY_PLUGIN_NAME, AI_MASTER_WIDTH_PLUGIN_NAME, applyArtifactLightFixToProject, applyAutoMixPlanToProject, applyMasterFinishToProject, applySpectralRepairOpsToProject, createSpectralRepairReport } from "./mixDoctorApply";
import { analyzeMixDoctor } from "./mixDoctorEngine";
import type { ArtifactProblem } from "./mixDoctorTypes";

function makePeakSummary(peak: number, bins = 32): PeakSummary {
  return {
    bins,
    min: new Array<number>(bins).fill(-peak),
    max: new Array<number>(bins).fill(peak),
    durationSec: 10,
  };
}

function makeTransientPeakSummary(peak: number, bed = 0.04, bins = 32): PeakSummary {
  return {
    bins,
    min: [-peak, ...new Array<number>(bins - 1).fill(-bed)],
    max: [peak, ...new Array<number>(bins - 1).fill(bed)],
    durationSec: 10,
  };
}

function makeProject(): Project {
  const vocal = createTrack("Lead Vocal", 0, "vocal", "vocal");
  const bass = createTrack("Bass", 1, "bass", "bass");
  const synth = createTrack("Synth Pad", 2, "synth", "synth");
  synth.pan = 0.2;
  synth.eq.bands = synth.eq.bands.map((band) =>
    band.type === "highshelf" ? { ...band, gainDb: 2, enabled: true } : band,
  );

  const clips: Clip[] = [vocal, bass, synth].map((track, index) => ({
    id: `clip-${index}`,
    trackId: track.id,
    fileId: `file-${index}`,
    role: track.role,
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
    createdBy: "import",
  }));

  return {
    ...createEmptyProject(),
    tracks: [vocal, bass, synth],
    clips,
  };
}

describe("Mix Doctor engine", () => {
  it("creates a stable report and safe AutoMix plan", () => {
    const project = makeProject();
    const report = analyzeMixDoctor(project, {
      "file-0": makePeakSummary(0.45),
      "file-1": makePeakSummary(0.55),
      "file-2": makePeakSummary(0.35),
    });

    expect(report.masterReadiness.overall).toBeGreaterThan(0);
    expect(report.stemScores).toHaveLength(3);
    expect(report.autoMixPlan.masterPlan.limiterCeilingDb).toBeLessThanOrEqual(-1);
    expect(report.autoMixPlan.trackPlans.find((plan) => plan.role === "bass")?.pan).toBe(0);
    expect(report.problems.some((problem) => problem.type === "metallic_high")).toBe(true);
    expect(report.lowEndKingReport?.owner).toBeTruthy();
    expect(report.peakCulpritReport?.status).toMatch(/pass|warn|fail/);
    expect(report.philosophyScore?.overall).toBeGreaterThan(0);
    expect(report.summary.some((line) => line.startsWith("Philosophy score:"))).toBe(true);
  });

  it("does not crash when peak summaries are missing", () => {
    const project = makeProject();
    const report = analyzeMixDoctor(project, {}, { mode: "balanced", target: "clean" });

    expect(report.stemScores).toHaveLength(3);
    expect(report.summary.length).toBeGreaterThan(0);
    expect(report.autoMixPlan.mode).toBe("balanced");
    expect(report.lowEndKingReport).toBeTruthy();
    expect(report.peakCulpritReport).toBeTruthy();
  });

  it("applies layout without widening the center foundation", () => {
    const project = makeProject();
    const report = analyzeMixDoctor(project, {
      "file-0": makePeakSummary(0.45),
      "file-1": makePeakSummary(0.55),
      "file-2": makePeakSummary(0.35),
    });
    const nextProject = applyAutoMixPlanToProject(project, report.autoMixPlan);
    const vocal = nextProject.tracks.find((track) => track.role === "vocal");
    const bass = nextProject.tracks.find((track) => track.role === "bass");
    const synth = nextProject.tracks.find((track) => track.role === "synth");

    expect(vocal?.pan).toBe(0);
    expect(bass?.pan).toBe(0);
    expect(vocal?.insertChain.some((plugin) => plugin.name === AI_LAYOUT_DEPTH_PLUGIN_NAME && plugin.enabled)).toBe(false);
    expect(bass?.insertChain.some((plugin) => plugin.name === AI_LAYOUT_DEPTH_PLUGIN_NAME && plugin.enabled)).toBe(false);
    expect(synth?.insertChain.find((plugin) => plugin.name === AI_LAYOUT_WIDTH_PLUGIN_NAME)?.params.width ?? 0).toBeLessThanOrEqual(0.28);
    expect(synth?.insertChain.find((plugin) => plugin.name === AI_LAYOUT_DEPTH_PLUGIN_NAME)?.params.depth ?? 0).toBeLessThanOrEqual(0.2);
  });

  it("applies safe AutoPluginPlan inserts to the track rack", () => {
    const project = makeProject();
    const report = analyzeMixDoctor(project, {
      "file-0": makePeakSummary(0.45),
      "file-1": makePeakSummary(0.55),
      "file-2": makePeakSummary(0.35),
    }, { mode: "strong", target: "wide_pop" });
    const nextProject = applyAutoMixPlanToProject(project, report.autoMixPlan);
    const vocal = nextProject.tracks.find((track) => track.role === "vocal");
    const bass = nextProject.tracks.find((track) => track.role === "bass");

    expect(vocal?.insertChain.some((plugin) => plugin.pluginId === "sweet-vocal-fx" && plugin.params.autoInserted === true)).toBe(false);
    expect(bass?.insertChain.some((plugin) => plugin.pluginId === "sweet-bass-enhancer" && plugin.params.autoInserted === true)).toBe(true);
  });

  it("suggests Sweet Clipper only for peak-heavy limiter culprits", () => {
    const project = makeProject();
    const report = analyzeMixDoctor(project, {
      "file-0": makePeakSummary(0.32),
      "file-1": makePeakSummary(0.4),
      "file-2": makeTransientPeakSummary(1),
    }, { mode: "balanced", target: "streaming_safe" });
    const synthPlan = report.autoPluginPlan?.trackPlans.find((plan) => plan.role === "synth");
    const bassPlan = report.autoPluginPlan?.trackPlans.find((plan) => plan.role === "bass");

    expect(synthPlan?.insertPlans.some((insert) => insert.pluginId === "sweet-clipper")).toBe(true);
    expect(bassPlan?.insertPlans.some((insert) => insert.pluginId === "sweet-clipper")).toBe(false);
    expect(report.peakCulpritReport?.topCulprits[0]?.trackName).toBe("Synth Pad");
  });

  it("updates AI plugin inserts instead of duplicating them on repeated apply", () => {
    const project = makeProject();
    const report = analyzeMixDoctor(project, {
      "file-0": makePeakSummary(0.45),
      "file-1": makePeakSummary(0.55),
      "file-2": makePeakSummary(0.35),
    }, { mode: "balanced", target: "clean" });
    const once = applyAutoMixPlanToProject(project, report.autoMixPlan);
    const twice = applyAutoMixPlanToProject(once, report.autoMixPlan);
    const vocal = twice.tracks.find((track) => track.role === "vocal");
    const bass = twice.tracks.find((track) => track.role === "bass");

    expect(vocal?.insertChain.filter((plugin) => plugin.pluginId === "sweet-vocal-fx" && plugin.params.autoInserted === true)).toHaveLength(0);
    expect(bass?.insertChain.filter((plugin) => plugin.pluginId === "sweet-bass-enhancer" && plugin.params.autoInserted === true)).toHaveLength(1);
  });

  it("applies shared ambience sends without duplicating them", () => {
    const project = makeProject();
    const report = analyzeMixDoctor(project, {
      "file-0": makePeakSummary(0.45),
      "file-1": makePeakSummary(0.55),
      "file-2": makePeakSummary(0.35),
    }, { mode: "strong", target: "wide_pop" });
    const synthPlan = report.autoMixPlan.pluginPlan?.trackPlans.find((plan) => plan.role === "synth");
    expect(synthPlan).toBeTruthy();
    if (synthPlan) {
      synthPlan.sendPlans = [{
        id: "send-test-synth-ambience",
        sourceTrackId: synthPlan.trackId,
        sourceTrackName: synthPlan.trackName,
        targetBusId: "bus-ambience",
        targetBusName: "Ambience Bus",
        gainDb: -16,
        enabled: true,
        reason: "Test shared ambience send application.",
      }];
    }
    expect(synthPlan?.sendPlans.filter((send) => send.targetBusId === "bus-ambience")).toHaveLength(1);
    const once = applyAutoMixPlanToProject(project, report.autoMixPlan);
    const twice = applyAutoMixPlanToProject(once, report.autoMixPlan);
    const synth = twice.tracks.find((track) => track.role === "synth");

    expect(synth?.sends.filter((send) => send.targetBusId === "bus-ambience")).toHaveLength(1);
    expect(synth?.sends[0]?.gainDb).toBeLessThanOrEqual(-9);
  });

  it("keeps automatic reverb proposals filtered, ducked, and low-mix", () => {
    const project = makeProject();
    project.tracks[2]!.role = "music";
    project.clips[2]!.role = "music";
    const report = analyzeMixDoctor(project, {
      "file-0": makePeakSummary(0.45),
      "file-1": makePeakSummary(0.55),
      "file-2": makePeakSummary(0.35),
    }, { mode: "strong", target: "wide_pop" });
    const musicPlan = report.autoPluginPlan?.trackPlans.find((plan) => plan.role === "music");
    const reverb = musicPlan?.insertPlans.find((insert) => insert.pluginId === "sweet-reverb-lite");

    expect(reverb?.params.mode).toMatch(/room|tail/);
    expect(reverb?.params.lowCutHz).toBeGreaterThanOrEqual(180);
    expect(reverb?.params.highCutHz).toBeLessThanOrEqual(11000);
    expect(reverb?.params.ducking).toBeGreaterThanOrEqual(0.18);
    expect(reverb?.params.mix).toBeLessThanOrEqual(0.07);
  });

  it("applies light artifact cleanup without exceeding safe reduction limits", () => {
    const project = makeProject();
    const sourceVocal = project.tracks.find((track) => track.role === "vocal");
    const problems: ArtifactProblem[] = [
      {
        id: "test-sibilance",
        stemId: sourceVocal?.id ?? "track-0",
        role: "vocal",
        type: "sibilance",
        lowFreq: 5000,
        highFreq: 9000,
        score: 82,
        confidence: 0.8,
        reason: "Synthetic sibilance test problem.",
        suggestedFix: "Apply a light dynamic de-esser.",
      },
      {
        id: "test-mud",
        stemId: sourceVocal?.id ?? "track-0",
        role: "vocal",
        type: "mud",
        lowFreq: 150,
        highFreq: 350,
        score: 74,
        confidence: 0.75,
        reason: "Synthetic mud test problem.",
        suggestedFix: "Apply a gentle low-mid cut.",
      },
    ];
    const nextProject = applyArtifactLightFixToProject(project, problems);
    const vocal = nextProject.tracks.find((track) => track.role === "vocal");
    const deepestCut = Math.min(...(vocal?.eq.bands.map((band) => band.gainDb) ?? [0]));

    expect(deepestCut).toBeGreaterThanOrEqual(-2.5);
    expect(vocal?.insertChain.some((plugin) => plugin.name === AI_ARTIFACT_DEESSER_PLUGIN_NAME)).toBe(true);
  });

  it("applies a safe master finish chain with damage checks", () => {
    const project = makeProject();
    project.master.gainDb = 2;
    const { project: nextProject, report } = applyMasterFinishToProject(project, "streaming_safe");

    expect(nextProject.master.limiterEnabled).toBe(true);
    expect(nextProject.master.exportNormalizePeak).toBe(true);
    expect(nextProject.master.gainDb).toBeLessThanOrEqual(1.2);
    expect(nextProject.master.eq.enabled).toBe(true);
    expect(nextProject.master.compressor.enabled).toBe(true);
    expect(nextProject.master.insertChain.some((plugin) => plugin.name === AI_MASTER_WIDTH_PLUGIN_NAME && plugin.enabled)).toBe(false);
    expect(nextProject.master.insertChain.some((plugin) => plugin.name === AI_MASTER_DEESSER_PLUGIN_NAME && plugin.enabled)).toBe(false);
    expect(report.ceilingDb).toBeLessThanOrEqual(-1);
    expect(report.damageChecks.length).toBeGreaterThan(0);
  });

  it("keeps reference polish mastering-safe and advisory", () => {
    const project = makeProject();
    const { project: nextProject, report } = applyMasterFinishToProject(project, "reference_polish");
    const density = nextProject.master.insertChain.find((plugin) => plugin.name === AI_MASTER_DENSITY_PLUGIN_NAME);
    const width = nextProject.master.insertChain.find((plugin) => plugin.name === AI_MASTER_WIDTH_PLUGIN_NAME);

    expect(report.targetLoudness).toContain("mastering-safe");
    expect(nextProject.master.limiterEnabled).toBe(false);
    expect(nextProject.master.exportNormalizePeak).toBe(false);
    expect(density?.enabled).toBe(true);
    expect(density?.pluginId).toBe("sweet-drive");
    expect(width?.enabled ?? false).toBe(false);
    expect(report.damageChecks.some((check) => check.includes("Reference guard"))).toBe(true);
    expect(report.damageChecks.some((check) => check.includes("Mastering-safe guard"))).toBe(true);
  });

  it("creates spectral repair edit ops and applies brush reduce safely", () => {
    const project = makeProject();
    const vocal = project.tracks.find((track) => track.role === "vocal");
    const problems: ArtifactProblem[] = [
      {
        id: "test-harsh",
        stemId: vocal?.id ?? "track-0",
        role: "vocal",
        type: "harshness",
        lowFreq: 2500,
        highFreq: 6000,
        score: 78,
        confidence: 0.76,
        reason: "Synthetic harsh band.",
        suggestedFix: "Brush reduce the harsh range.",
      },
      {
        id: "test-rumble",
        stemId: vocal?.id ?? "track-0",
        role: "vocal",
        type: "rumble",
        score: 66,
        confidence: 0.68,
        reason: "Synthetic rumble.",
        suggestedFix: "Brush reduce low rumble.",
      },
    ];
    const report = createSpectralRepairReport(problems, "light");
    const nextProject = applySpectralRepairOpsToProject(project, report.ops);
    const compatibilityProject = applySpectralRepairOpsToProject(project, report.ops, { applyCompatibilityGlobalFix: true });
    const nextVocal = nextProject.tracks.find((track) => track.role === "vocal");
    const compatibilityVocal = compatibilityProject.tracks.find((track) => track.role === "vocal");
    const deepestCut = Math.min(...(compatibilityVocal?.eq.bands.map((band) => band.gainDb) ?? [0]));

    expect(report.ops).toHaveLength(2);
    expect(report.removedOnlyAvailable).toBe(false);
    expect(report.heatmapCells?.length).toBeGreaterThan(0);
    expect(report.beforeSummary?.hotCells).toBeGreaterThan(0);
    expect(report.ops[0].highFreq).toBeGreaterThan(report.ops[0].lowFreq);
    expect(nextVocal?.eq.enabled).toBe(false);
    expect(nextProject.repairRegions.length).toBeGreaterThan(0);
    expect(nextProject.repairRegions.every((region) => region.fixed)).toBe(true);
    expect(compatibilityVocal?.eq.enabled).toBe(true);
    expect(deepestCut).toBeGreaterThanOrEqual(-2.5);
  });
});
