import type { PeakSummary } from "../../audio/analysis/PeakBuilder";
import { createPluginInstance } from "../../audio/plugins/pluginRegistry";
import { applyAimixSpatialToProject } from "../aimixSpatial/aimixSpatialEngine";
import type { AimixSpatialOptions } from "../aimixSpatial/aimixSpatialTypes";
import { createClipHistoryItem, createId, createTrack, type Clip, type ParametricEQState, type Project, type ReferenceAssistMetadata, type StemRole, type Track } from "../model/Project";
import { computeAiMix, type MagicPolishAnalysis } from "../mix/aiMixAssistant";
import { applyPeakingToSlot, applyShelfGainToSlot } from "../mix/eqSlotUtils";
import { averageDbAsPower, estimateIntegratedLufsApproxFromRms } from "../mix/loudnessApprox";
import { mapBandEnergyEnergy } from "../mix/mixDoctorAnalysisUtils";
import { analyzeMixDoctor } from "../mix/mixDoctorEngine";
import type { MixDoctorReport, ReferenceDelta, ReferenceProfile } from "../mix/mixDoctorTypes";
import { validateSpatialAutoCandidate, type ReferenceQualityMetrics } from "../mix/reference/referenceQualityGate";
import { estimateReferenceAlignment } from "./referenceAlignmentGuard";
import { DEFAULT_AUTO_REFERENCE_MIX_SETTINGS, type AutoReferenceMixMetrics, type AutoReferenceMixResult, type AutoReferenceMixSettings, type StemAirLayerStatus, type VocalClarityGateItem, type VocalClarityGateReport, type VocalClarityGateStatus } from "./autoReferenceMixTypes";
import { buildReferenceDensityMaster } from "./referenceDensity";

type VocalClarityGate = VocalClarityGateReport & {
  airLayerAllowed: boolean;
  subExcessDb: number;
  midShortageDb: number;
  presenceShortageDb: number;
  airShortageDb: number;
  ultraAirExcessDb: number;
  ultraAirShortageDb: number;
  sideShortfallDb: number;
  decisions: string[];
};

const SPATIAL_AUTO_PRESET: AimixSpatialOptions = {
  mode: "spatial",
  panMode: "track",
  panScene: "pro-balanced",
  clarity: 20,
  smooth: 18,
  space: 62,
  depth: 22,
  motion: 0,
  centerProtect: 85,
  gainMatch: true,
  monoSafe: true,
  editableLayers: false,
  removePreviousAimixLayers: true,
  panAmount: 70,
  trackPanAmount: 60,
  clipPanAmount: 0,
  referencePanFollow: true,
  protectLeadVocalPan: true,
  protectLowEndPan: true,
  resetPreviousSpatialPan: true,
};

export function runAutoReferenceMixPipeline(
  project: Project,
  waveformPeaks: Record<string, PeakSummary>,
  rawSettings: Partial<AutoReferenceMixSettings> = {},
): AutoReferenceMixResult {
  const settings = { ...DEFAULT_AUTO_REFERENCE_MIX_SETTINGS, ...rawSettings };
  const before = cloneProject(project);
  const beforeMetrics = measureProject(before, waveformPeaks);
  const decisions: string[] = [];

  const hasReference = before.tracks.some((track) => track.role === "reference");
  const hasWorkTrack = before.tracks.some((track) => track.role !== "reference");
  const hasClips = before.clips.length > 0;
  if (!settings.enabled || settings.mode === "off") {
    return idleResult(before, beforeMetrics, "Auto Reference Mix is off.");
  }
  if (settings.requireReference && !hasReference) {
    return waitingResult(before, beforeMetrics, "Import a Reference Mix to run AIMIX Reference. Without Reference, One-Tap can use Sweet No-Reference Finish.");
  }
  if ((settings.requireAtLeastOneStem && !hasWorkTrack) || !hasClips) {
    return waitingResult(before, beforeMetrics, "Import at least one work stem or WAV before running One-Tap Finish.");
  }

  let mixDoctorReport: MixDoctorReport | null = null;
  try {
    mixDoctorReport = analyzeMixDoctor(before, waveformPeaks, { mode: "balanced", target: "reference_polish" });
    decisions.push(...buildDecisionLayerDecisionLines(mixDoctorReport));
    decisions.push(...buildReferenceClarityGapDecisionLines(mixDoctorReport));
    decisions.push("Reference解析: Direct WAVのLUFS / Crest / Tonal / Sideを読み取りました。");
  } catch (error) {
    return {
      ok: false,
      status: "error",
      before,
      after: before,
      aimixReference: before,
      mixDoctorReport: null,
      lowEndKingReport: null,
      peakCulpritReport: null,
      alignment: {
        ok: false,
        globalLagMs: 0,
        driftMs: 0,
        confidence: 0,
        mode: "warning",
        message: `Reference解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      },
      spatialReport: null,
      beforeMetrics,
      aimixMetrics: beforeMetrics,
      afterMetrics: beforeMetrics,
      decisions,
      message: "Reference解析に失敗しました。",
    };
  }

  const alignment = estimateReferenceAlignment(before, waveformPeaks, {
    maxAllowedLagMs: settings.maxAllowedLagMs,
    maxAllowedDriftMs: settings.maxAllowedDriftMs,
  });
  decisions.push(alignment.message);

  const aimixReferenceResult = applyAimixReferencePreset(before, waveformPeaks, mixDoctorReport, beforeMetrics);
  let aimixReference = aimixReferenceResult.project;
  decisions.push(...aimixReferenceResult.decisions);
  aimixReference = preservePanAndClipAutomation(aimixReference, before);
  if (settings.allowReferenceAirGlue && alignment.ok) {
    const airGlueResult = maybeAddReferenceAirGlue(aimixReference, waveformPeaks, mixDoctorReport.referenceProfile ?? null, beforeMetrics, alignment.globalLagMs);
    aimixReference = airGlueResult.project;
    decisions.push(...airGlueResult.decisions);
  } else if (settings.allowReferenceAirGlue) {
    decisions.push("Reference Air Glue: Alignmentが安定していないため追加しません。");
  }
  if (!settings.allowReferenceBackbone) {
    decisions.push("Reference Backbone: ExperimentalのためデフォルトOFFです。");
  }
  const hasReferenceProfile = Boolean(mixDoctorReport.referenceProfile);
  const targetResult = finalizeAimixReferenceTarget(aimixReference, waveformPeaks, mixDoctorReport.referenceProfile ?? null);
  aimixReference = targetResult.project;
  decisions.push(...targetResult.decisions);
  const clarityGate = evaluateVocalClarityGate(measureProject(aimixReference, waveformPeaks), mixDoctorReport.referenceProfile ?? null);
  decisions.push(...clarityGate.decisions);
  let stemAirLayerStatus: StemAirLayerStatus = "bypassed";
  if (settings.allowStemAirLayer && clarityGate.airLayerAllowed) {
    const stemAirResult = maybeAddStemAirLayer(aimixReference, waveformPeaks, mixDoctorReport.referenceProfile ?? null, clarityGate);
    aimixReference = stemAirResult.project;
    stemAirLayerStatus = stemAirResult.stemAirLayer;
    decisions.push(...stemAirResult.decisions);
  } else if (settings.allowStemAirLayer) {
    decisions.push("Stem Air Layer: skipped until Vocal Clarity Gate passes; 2-10kHz focus and sub masking come first.");
  } else {
    decisions.push("Stem Air Layer: OFF.");
  }
  const vocalClarityGate = withStemAirLayerStatus(clarityGate, stemAirLayerStatus);
  decisions.push("Vocal Clarity Gate Report: " + vocalClarityGate.summary + " / Stem Air Layer " + vocalClarityGate.stemAirLayer + ".");
  const aimixMetrics = measureProject(aimixReference, waveformPeaks);
  const remainingLufsShortfallDb = getReferenceLufsShortfallDb(aimixMetrics, mixDoctorReport.referenceProfile ?? null);
  if ((mixDoctorReport.peakCulpritReport?.status ?? "pass") !== "pass" && remainingLufsShortfallDb > 0.8) {
    decisions.push("Peak Culprit: limiter前にピーク犯人を整理してください。Master gain追加より先にdensity / clip / transient shapeが必要です。");
  }

  let after = aimixReference;
  let spatialReport = null;
  let status: AutoReferenceMixResult["status"] = hasReferenceProfile ? "accepted-aimix-reference" : "accepted-sweet-no-reference";
  if (settings.mode === "reference-then-spatial-auto" && settings.autoTrySpatial) {
    const spatial = applyAimixSpatialToProject(aimixReference, SPATIAL_AUTO_PRESET, {
      peaksByFileId: waveformPeaks,
      referenceProfile: mixDoctorReport.referenceProfile ?? null,
      referenceDelta: mixDoctorReport.referenceDelta ?? null,
      stemFeatureReports: mixDoctorReport.stemFeatureReports ?? [],
    });
    spatialReport = spatial.report;
    const spatialMetrics = measureProject(spatial.project, waveformPeaks);
    const validation = validateSpatialAutoV2(aimixMetrics, spatialMetrics, mixDoctorReport.referenceProfile ?? null, settings);
    decisions.push(...spatial.report.actions.slice(0, 6));
    decisions.push(...validation.decisions);
    if (!settings.acceptSpatialOnlyIfImproved || validation.accepted) {
      after = spatial.project;
      status = hasReferenceProfile ? "accepted-spatial-auto" : "accepted-sweet-no-reference-spatial";
    } else {
      after = aimixReference;
      status = hasReferenceProfile ? "reverted-spatial-auto" : "reverted-sweet-no-reference-spatial";
      decisions.push("Spatial Auto: LUFS低下またはReference幅から遠ざかったためAIMIX Reference結果へ戻しました。");
    }
  }

  const afterMetrics = measureProject(after, waveformPeaks);
  const cleanDecisions = cleanDecisionMessages(decisions);
  return {
    ok: true,
    status,
    before,
    after: {
      ...after,
      updatedAt: new Date().toISOString(),
    },
    aimixReference,
    mixDoctorReport,
    lowEndKingReport: mixDoctorReport.lowEndKingReport ?? null,
    peakCulpritReport: mixDoctorReport.peakCulpritReport ?? null,
    alignment,
    spatialReport,
    beforeMetrics,
    aimixMetrics,
    afterMetrics,
    decisions: cleanDecisions,
    message: buildCompletionMessage(status, alignment, beforeMetrics, afterMetrics, cleanDecisions),
    vocalClarityGate,
  };
}

function applyAimixReferencePreset(
  project: Project,
  waveformPeaks: Record<string, PeakSummary>,
  report: MixDoctorReport,
  beforeMetrics: AutoReferenceMixMetrics,
) {
  const reference = report.referenceProfile ?? null;
  const referenceDelta = report.referenceDelta ?? null;
  const densityResult = buildReferenceDensityMaster(project.master, beforeMetrics, reference);
  const referenceGainMove = getReferenceGainMove(beforeMetrics, reference);
  const trimOwner = reference ? "reference-match" : "sweet-no-reference";
  const computed = computeAiMix(
    project,
    "magic-pro-polish",
    "strong",
    "none",
    "pop",
    "balanced",
    buildAnalysisFromMetrics(beforeMetrics),
    {
      workflow: "doctor-touchup",
      referenceDelta,
      referenceCrestFactorDb: reference?.crestFactorDb ?? null,
      referenceCrestFollow: Boolean(reference),
      allowReferenceProcessing: false,
    },
  );

  const next: Project = {
    ...project,
    tracks: computed.tracks.map((track) => track.role === "reference" ? cloneTrack(project.tracks.find((source) => source.id === track.id) ?? track) : track),
    master: {
      ...densityResult.master,
      eq: applyReferenceDeltaToMasterEq(densityResult.master.eq, referenceDelta),
      finalOutputTrimDb: round2(clamp((densityResult.master.finalOutputTrimDb ?? 0) + referenceGainMove, -18, 2)),
      finalOutputTrimOwner: trimOwner,
      exportNormalizePeak: false,
      exportPeakTargetDb: Math.min(project.master.exportPeakTargetDb ?? -1.2, -1.2),
    },
    updatedAt: new Date().toISOString(),
  };

  return {
    project: preservePanAndClipAutomation(next, project),
    decisions: [
      reference
        ? `Reference Gain: final output trim ${formatSignedDb(referenceGainMove)} from Reference LUFS.`
        : "Sweet No-Reference Base: applied AIMIX with internal tonal and density targets; Reference audio is not required.",
      ...densityResult.decisions,
    ],
  };
}

function finalizeAimixReferenceTarget(
  project: Project,
  waveformPeaks: Record<string, PeakSummary>,
  referenceProfile: ReferenceProfile | null,
) {
  const decisions: string[] = [];
  if (!referenceProfile) {
    return finalizeSweetNoReferenceTarget(project, waveformPeaks);
  }
  if (!referenceProfile) {
    return { project, decisions: ["AIMIX Reference: Reference profileがないため最終追従をスキップしました。"] };
  }

  const metrics = measureProject(project, waveformPeaks);
  let next = project;
  const targetLufs = finite(referenceProfile.integratedLufsApprox, metrics.integratedLufs);
  const rawLufsMove = clamp(targetLufs - metrics.integratedLufs, -9, 9);
  const lufsMove = limitGainByTruePeak(metrics, rawLufsMove, -1.2);
  if (Math.abs(lufsMove) > 0.2) {
    next = {
      ...next,
      master: {
        ...next.master,
        finalOutputTrimDb: round2(clamp((next.master.finalOutputTrimDb ?? 0) + lufsMove, -18, 2)),
        finalOutputTrimOwner: "reference-match",
      },
      updatedAt: new Date().toISOString(),
    };
    decisions.push(`AIMIX Reference Gain: Reference LUFSへfinal output trimで${formatSignedDb(lufsMove)}調整しました。`);
    if (rawLufsMove > lufsMove + 0.05) {
      decisions.push(`AIMIX Reference Gain: True Peak headroom limited direct gain from ${formatSignedDb(rawLufsMove)} to ${formatSignedDb(lufsMove)}.`);
    }
  } else {
    decisions.push("AIMIX Reference Gain: Reference LUFSとの差が小さいため追加gainは不要です。");
  }

  const afterGainMetrics = measureProject(next, waveformPeaks);
  const referenceSub = averageReferenceBands(referenceProfile, ["20-35", "35-60"]);
  const currentSub = afterGainMetrics.sub2060Db;
  const subExcess = currentSub - referenceSub;
  const referenceUltraAir = averageReferenceBands(referenceProfile, ["9000-12000", "12000-16000", "16000-20000"]);
  const ultraAirGap = referenceUltraAir - afterGainMetrics.ultraAir1000020000Db;
  const referenceBody = averageReferenceBands(referenceProfile, ["250-500"]);
  const bodyExcess = afterGainMetrics.body250500Db - referenceBody;
  const referenceNasal = averageReferenceBands(referenceProfile, ["500-900", "900-1500"]);
  const nasalExcess = afterGainMetrics.mid5002000Db - referenceNasal;
  const initialClarityGate = evaluateVocalClarityGate(afterGainMetrics, referenceProfile);

  const focusRepair = applyVocalClarityTrackFocus(next, waveformPeaks, initialClarityGate);
  if (focusRepair.changed) {
    next = focusRepair.project;
    decisions.push(...focusRepair.decisions);
  }
  const focusedGate = evaluateVocalClarityGate(measureProject(next, waveformPeaks), referenceProfile);
  const masterFocus = applyMasterVocalClarityFocus(next, focusedGate);
  if (masterFocus.changed) {
    next = masterFocus.project;
    decisions.push(...masterFocus.decisions);
  }
  let clarityGate = evaluateVocalClarityGate(measureProject(next, waveformPeaks), referenceProfile);
  if (!clarityGate.passed && (clarityGate.midShortageDb > 1.2 || clarityGate.presenceShortageDb > 1.0)) {
    const finalFocus = applyMasterVocalClarityFocus(next, clarityGate, 3.5);
    if (finalFocus.changed) {
      next = finalFocus.project;
      decisions.push(...finalFocus.decisions);
      clarityGate = evaluateVocalClarityGate(measureProject(next, waveformPeaks), referenceProfile);
    }
  }

  let eq = next.master.eq;
  let eqChanged = false;
  if (subExcess > 2) {
    eq = cloneEq(eq);
    eq.enabled = true;
    applyPeakingToSlot(eq, "reference_match", "auto_ref_sub_guard_48", 48, -clamp(subExcess * 0.22, 0.2, 0.8), 0.85);
    eqChanged = true;
    decisions.push(`AIMIX Reference Sub: 20-60Hz excess ${round2(subExcess)}dB was trimmed before Air recovery.`);
  }
  if (ultraAirGap > 2 && clarityGate.airLayerAllowed) {
    eq = eqChanged ? eq : cloneEq(eq);
    eq.enabled = true;
    applyPeakingToSlot(eq, "reference_match", "auto_ref_air_10500", 10500, clamp(ultraAirGap * 0.07, 0.12, 0.5), 1.1);
    applyShelfGainToSlot(eq, "highshelf", "reference_match", "auto_ref_gloss_12000", 12000, clamp(ultraAirGap * 0.035, 0, 0.18), 0.75);
    applyPeakingToSlot(eq, "reference_match", "auto_ref_sheen_16500", 16500, clamp(ultraAirGap * 0.02, 0.02, 0.18), 0.9);
    eqChanged = true;
    decisions.push(`AIMIX Reference Air: added conservative 9-14kHz gloss first, with 14-20kHz capped after Vocal Clarity Gate passed (${round2(ultraAirGap)}dB gap).`);
  } else if (ultraAirGap > 2) {
    decisions.push("AIMIX Reference Air: held back because 2-10kHz clarity or sub masking is not solved yet.");
  }
  if (bodyExcess > 0.5) {
    eq = eqChanged ? eq : cloneEq(eq);
    eq.enabled = true;
    applyPeakingToSlot(eq, "reference_match", "auto_ref_body_control_360", 360, -clamp(bodyExcess * 0.35, 0.2, 1.0), 0.9);
    eqChanged = true;
    decisions.push(`AIMIX Reference Body: 250-500Hzの増えすぎを${round2(bodyExcess)}dB検出し、軽く整理しました。`);
  }
  if (nasalExcess > 0.5) {
    eq = eqChanged ? eq : cloneEq(eq);
    eq.enabled = true;
    applyPeakingToSlot(eq, "reference_match", "auto_ref_nasal_control_850", 850, -clamp(nasalExcess * 0.28, 0.15, 0.8), 1.0);
    eqChanged = true;
    decisions.push(`AIMIX Reference Nasal: 500Hz-1.5kHzのこもりを${round2(nasalExcess)}dB検出し、軽く整理しました。`);
  }
  if (eqChanged) {
    next = {
      ...next,
      master: {
        ...next.master,
        eq,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  const finalMetrics = measureProject(next, waveformPeaks);
  const postTrimDb = computeReferencePostTrim(finalMetrics, targetLufs, -1.2);
  if (postTrimDb < -0.01) {
    next = {
      ...next,
      master: {
        ...next.master,
        finalOutputTrimDb: round2(clamp((next.master.finalOutputTrimDb ?? 0) + postTrimDb, -18, 2)),
        finalOutputTrimOwner: "reference-match",
      },
      updatedAt: new Date().toISOString(),
    };
    decisions.push(`AIMIX Reference Post Trim: Reference loudness/True Peak guard applied ${formatSignedDb(postTrimDb)}.`);
  }
  const densityMetrics = measureProject(next, waveformPeaks);
  const remainingLufsShortfallDb = round2(targetLufs - densityMetrics.integratedLufs);
  if (remainingLufsShortfallDb > 0.8 && densityMetrics.truePeakDb > -1.5) {
    const densityGuard = applyAimixDensityGuard(next, remainingLufsShortfallDb);
    if (densityGuard.changed) {
      next = densityGuard.project;
      decisions.push(...densityGuard.decisions);
    }
    decisions.push(`AIMIX Density: LUFS is still ${formatSignedDb(remainingLufsShortfallDb)} below Reference while True Peak is near the ceiling; improve crest/density before adding master gain.`);
  }
  const catchUpMetrics = measureProject(next, waveformPeaks);
  const catchUpDb = computeReferenceCatchUp(catchUpMetrics, targetLufs, -1.2);
  if (catchUpDb > 0.05) {
    next = applyReferenceGainMove(next, catchUpDb);
    decisions.push(`AIMIX Reference Catch-Up: True Peak headroom allowed ${formatSignedDb(catchUpDb)} toward Reference LUFS.`);
  }
  if (measureProject(next, waveformPeaks).truePeakDb > -1.2) {
    decisions.push("AIMIX Reference Safety: True Peak estimate is above -1.2dBTP. Turn on Hard Limit only if needed after fixing density and peaks.");
  }

  return { project: next, decisions };
}

function finalizeSweetNoReferenceTarget(
  project: Project,
  waveformPeaks: Record<string, PeakSummary>,
) {
  const metrics = measureProject(project, waveformPeaks);
  let next = project;
  const decisions: string[] = [
    "Sweet No-Reference Finish: no Reference Mix was loaded, so Sweet DAW used an internal pro-safe target.",
  ];

  let eq = cloneEq(next.master.eq);
  let eqChanged = false;
  eq.enabled = true;
  setHighpass(eq, 28);
  eqChanged = true;

  const subExcess = Math.max(
    metrics.sub2060Db - metrics.low120250Db - 1.4,
    metrics.sub2060Db - metrics.body250500Db - 2.2,
  );
  if (subExcess > 0.5) {
    const subCutDb = clamp(subExcess * 0.36, 0.35, 1.35);
    applyPeakingToSlot(eq, "sweet_no_reference", "sweet_no_ref_sub_45", 45, -subCutDb, 0.85);
    decisions.push(`Sweet No-Reference Low Guard: 20-60Hz was kept controlled (${formatSignedDb(-subCutDb)} around 45Hz).`);
  }

  const bodyMask = metrics.body250500Db - Math.max(metrics.mid5002000Db, metrics.presence20005000Db) - 1.2;
  if (bodyMask > 0.4) {
    applyPeakingToSlot(eq, "sweet_no_reference", "sweet_no_ref_body_360", 360, -clamp(bodyMask * 0.32, 0.25, 1.1), 0.9);
    decisions.push("Sweet No-Reference Muffle Guard: 250-500Hz body was trimmed before adding brightness.");
  }

  const nasalMask = metrics.mid5002000Db - metrics.presence20005000Db - 3.2;
  if (nasalMask > 0.4) {
    applyPeakingToSlot(eq, "sweet_no_reference", "sweet_no_ref_nasal_920", 920, -clamp(nasalMask * 0.22, 0.2, 0.75), 1.0);
    decisions.push("Sweet No-Reference Muffle Guard: 500Hz-2kHz buildup was eased lightly.");
  }

  const presenceShort = metrics.mid5002000Db - metrics.presence20005000Db;
  if (presenceShort > 2.4) {
    applyPeakingToSlot(eq, "sweet_no_reference", "sweet_no_ref_focus_3400", 3400, clamp((presenceShort - 2.4) * 0.22, 0.22, 0.75), 1.05);
    decisions.push("Sweet No-Reference Focus: 2-5kHz presence was restored gently for lead image.");
  }

  const clarityShort = metrics.presence20005000Db - metrics.air500010000Db;
  if (clarityShort > 5.2) {
    applyPeakingToSlot(eq, "sweet_no_reference", "sweet_no_ref_clarity_7600", 7600, clamp((clarityShort - 5.2) * 0.12, 0.15, 0.45), 1.2);
    decisions.push("Sweet No-Reference Clarity: 5-10kHz detail was lifted only after mid focus checks.");
  }

  const fakeAirRisk = computeNoReferenceFakeAirRisk(metrics);
  const sideHighRisk = computeNoReferenceSideHighRisk(metrics);
  const ultraOverSideLike = metrics.ultraAir1000020000Db - metrics.air500010000Db;
  if (ultraOverSideLike > 2.4) {
    applyShelfGainToSlot(eq, "highshelf", "sweet_no_reference", "sweet_no_ref_air_clamp_14000", 14000, -clamp((ultraOverSideLike - 2.4) * 0.12, 0.12, 0.45), 0.7);
    decisions.push("Sweet No-Reference Air Guard: 14kHz+ was clamped to avoid hiss or brittle AI sheen.");
  } else if (clarityShort < 4.2 && metrics.air500010000Db - metrics.ultraAir1000020000Db > 6.5) {
    if (fakeAirRisk < 0.65 && sideHighRisk < 0.65) {
      applyPeakingToSlot(eq, "sweet_no_reference", "sweet_no_ref_gloss_11200", 11200, 0.12, 1.0);
      decisions.push("Sweet No-Reference Gloss: a tiny 11.2kHz gloss lift was allowed; 14-20kHz air/noise boost stays blocked without Reference.");
    } else {
      decisions.push("Sweet No-Reference Sheen: blocked because side-high or fake-air risk was already elevated.");
    }
  }

  if (eqChanged) {
    next = {
      ...next,
      master: {
        ...next.master,
        eq,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  const placed = applySweetNoReferencePlacement(next);
  if (placed.changed) {
    next = placed.project;
    decisions.push(...placed.decisions);
  }

  const afterToneMetrics = measureProject(next, waveformPeaks);
  const targetLufs = resolveSweetNoReferenceTargetLufs(afterToneMetrics);
  const rawLufsMove = clamp(targetLufs - afterToneMetrics.integratedLufs, -4, 4);
  const lufsMove = limitGainByTruePeak(afterToneMetrics, rawLufsMove, -1.2);
  const crestNeedsDensity = afterToneMetrics.crestDb > 15.2 || rawLufsMove > lufsMove + 0.6;
  const masterGainDb = next.master.gainDb ?? 0;
  next = {
    ...next,
    master: {
      ...next.master,
      gainDb: round2(clamp(masterGainDb, -18, 2)),
      compressor: crestNeedsDensity
        ? {
            ...next.master.compressor,
            enabled: true,
            threshold: round2(Math.min(next.master.compressor.threshold, -16.5)),
            ratio: round2(clamp(Math.max(next.master.compressor.ratio, 1.32), 1.1, 1.58)),
            attack: Math.min(next.master.compressor.attack, 0.014),
            release: Math.max(next.master.compressor.release, 0.16),
            knee: Math.max(next.master.compressor.knee, 18),
            makeupGainDb: clamp(next.master.compressor.makeupGainDb, -1, 0),
          }
        : next.master.compressor,
      limiterEnabled: true,
      exportNormalizePeak: false,
      exportPeakTargetDb: Math.min(next.master.exportPeakTargetDb ?? -1.2, -1.2),
      finalOutputTrimDb: round2(clamp((next.master.finalOutputTrimDb ?? 0) + lufsMove, -18, 2)),
      finalOutputTrimOwner: "sweet-no-reference",
    },
    updatedAt: new Date().toISOString(),
  };
  if (masterGainDb > 2) decisions.push("Sweet No-Reference Safety: master gain was capped before the limiter path.");
  if (Math.abs(lufsMove) > 0.05) decisions.push(`Sweet No-Reference Gain: final output trim ${formatSignedDb(lufsMove)} toward ${targetLufs.toFixed(1)} LUFS with -1.2dBTP guard.`);
  if (rawLufsMove > lufsMove + 0.05) decisions.push(`Sweet No-Reference Peak Guard: gain was limited from ${formatSignedDb(rawLufsMove)} to ${formatSignedDb(lufsMove)} by true-peak headroom.`);
  if (crestNeedsDensity) decisions.push("Sweet No-Reference Density: gentle master compression was enabled instead of pushing limiter gain.");

  return { project: next, decisions };
}

function resolveSweetNoReferenceTargetLufs(metrics: AutoReferenceMixMetrics) {
  if (metrics.integratedLufs > -12.8) return -13.2;
  if (metrics.integratedLufs < -17.2) return -14.8;
  if (metrics.integratedLufs < -15.2) return -14.4;
  return clamp(metrics.integratedLufs, -14.4, -13.6);
}

function computeNoReferenceFakeAirRisk(metrics: AutoReferenceMixMetrics) {
  const ultraVsPresence = metrics.ultraAir1000020000Db - metrics.presence20005000Db;
  const ultraVsAir = metrics.ultraAir1000020000Db - metrics.air500010000Db;
  const weakClarityPenalty = metrics.presence20005000Db - metrics.air500010000Db > 4.5 ? 0.18 : 0;
  return clamp(
    smoothstep(-10, -4, ultraVsPresence) * 0.45
      + smoothstep(0.8, 3.2, ultraVsAir) * 0.35
      + weakClarityPenalty,
    0,
    1,
  );
}

function computeNoReferenceSideHighRisk(metrics: AutoReferenceMixMetrics) {
  const sideTooWide = smoothstep(-8.5, -4.5, metrics.widthDb);
  const ultraFloatsOverAir = smoothstep(0.5, 3.5, metrics.ultraAir1000020000Db - metrics.air500010000Db);
  return clamp(sideTooWide * 0.65 + ultraFloatsOverAir * 0.35, 0, 1);
}

function applySweetNoReferencePlacement(project: Project) {
  let changed = false;
  const decisions: string[] = [];
  let supportIndex = 0;
  const tracks = project.tracks.map((track) => {
    if (track.role === "reference" || track.referenceAssist || track.aimixSpatial?.isAimixSpatialGenerated || track.mute) return track;
    if (Math.abs(track.pan ?? 0) > 0.025) return track;
    if (!project.clips.some((clip) => clip.trackId === track.id)) return track;
    if (track.role === "vocal" || track.role === "bass" || track.role === "drums") return track;
    const pan = sweetNoReferencePanForRole(track.role, supportIndex);
    supportIndex += 1;
    if (Math.abs(pan) <= 0.01) return track;
    changed = true;
    return { ...track, pan: round2(pan) };
  });
  if (changed) {
    decisions.push("Sweet No-Reference Placement: support stems received small L/R pan moves while vocal, drums, and bass stayed centered.");
  }
  return {
    changed,
    project: changed ? { ...project, tracks, updatedAt: new Date().toISOString() } : project,
    decisions,
  };
}

function sweetNoReferencePanForRole(role: StemRole, index: number) {
  const sign = index % 2 === 0 ? -1 : 1;
  if (role === "guitar" || role === "keys") return sign * 0.18;
  if (role === "synth" || role === "music") return sign * 0.14;
  if (role === "fx" || role === "other" || role === "loop") return sign * 0.22;
  if (role === "backingVocal") return sign * 0.1;
  return sign * 0.12;
}

function evaluateVocalClarityGate(metrics: AutoReferenceMixMetrics, referenceProfile: ReferenceProfile | null): VocalClarityGate {
  if (!referenceProfile) {
    const subExcessDb = round2(Math.max(
      metrics.sub2060Db - metrics.low120250Db - 1.4,
      metrics.sub2060Db - metrics.body250500Db - 2.2,
      0,
    ));
    const bodyMaskDb = round2(Math.max(0, metrics.body250500Db - Math.max(metrics.mid5002000Db, metrics.presence20005000Db) - 1.2));
    const nasalMaskDb = round2(Math.max(0, metrics.mid5002000Db - metrics.presence20005000Db - 3.2));
    const presenceShortageDb = round2(Math.max(0, metrics.mid5002000Db - metrics.presence20005000Db - 2.4));
    const airShortageDb = round2(Math.max(0, metrics.presence20005000Db - metrics.air500010000Db - 5.2));
    const ultraAirExcessDb = round2(Math.max(0, metrics.ultraAir1000020000Db - metrics.air500010000Db - 2.4));
    const ultraAirShortageDb = round2(Math.max(0, metrics.air500010000Db - metrics.ultraAir1000020000Db - 6.5));
    const sideShortfallDb = round2(Math.max(0, -12 - metrics.widthDb));
    const fakeAirRisk = computeNoReferenceFakeAirRisk(metrics);
    const sideHighRisk = computeNoReferenceSideHighRisk(metrics);
    const fakeAirStatus: VocalClarityGateStatus = fakeAirRisk > 0.75 ? "fail" : fakeAirRisk > 0.55 ? "warn" : "pass";
    const sideHighStatus: VocalClarityGateStatus = sideHighRisk > 0.75 ? "fail" : sideHighRisk > 0.55 ? "warn" : "pass";
    const items: VocalClarityGateItem[] = [
      gateItem("sub_20_60", "20-60Hz", excessStatus(subExcessDb, 0.8, 1.6), subExcessDb, "Internal low-risk excess: " + formatSignedDb(subExcessDb)),
      gateItem("mid_500_2000", "500Hz-2kHz", excessStatus(Math.max(bodyMaskDb, nasalMaskDb), 0.8, 1.4), Math.max(bodyMaskDb, nasalMaskDb), "Internal muffle risk body " + formatSignedDb(bodyMaskDb) + " / nasal " + formatSignedDb(nasalMaskDb)),
      gateItem("presence_2000_5000", "2kHz-5kHz", shortageStatus(presenceShortageDb, 0.7, 1.2), presenceShortageDb, "Internal focus shortage: " + formatSignedDb(presenceShortageDb)),
      gateItem("air_5000_10000", "5kHz-10kHz", fakeAirStatus === "fail" ? "fail" : shortageStatus(airShortageDb, 0.8, 1.4), airShortageDb, "Internal clarity shortage " + formatSignedDb(airShortageDb) + " / fake-air risk " + round2(fakeAirRisk)),
      gateItem("ultra_air_10000_20000", "10kHz-20kHz", ultraAirExcessDb > 1.4 || fakeAirStatus === "fail" ? "fail" : ultraAirExcessDb > 0.8 || fakeAirStatus === "warn" ? "warn" : shortageStatus(ultraAirShortageDb, 1.8, 99), ultraAirExcessDb > 0 ? ultraAirExcessDb : ultraAirShortageDb, "Internal ultra-air excess " + formatSignedDb(ultraAirExcessDb) + " / shortage " + formatSignedDb(ultraAirShortageDb)),
      gateItem("side_mid", "Side/Mid", sideHighStatus, sideShortfallDb, "Internal side-high risk " + round2(sideHighRisk) + " / width " + formatSignedDb(metrics.widthDb)),
    ];
    const passed = !items.some((item) => item.status === "fail");
    const airLayerAllowed = passed
      && airShortageDb > 1.1
      && ultraAirExcessDb < 0.8
      && fakeAirRisk < 0.55
      && sideHighRisk < 0.55;
    const warnings = items
      .filter((item) => item.status !== "pass")
      .map((item) => item.label + ": " + item.status.toUpperCase() + " (" + item.detail + ")");
    if (!airLayerAllowed) {
      warnings.push("Stem Air Layer held by No-Reference Gate until mid clarity, fake-air, and side-high risk are safe.");
    }
    const statusById = (id: VocalClarityGateItem["id"]) => items.find((item) => item.id === id)?.status ?? "pass";
    const summary = (passed ? "PASS" : "HOLD")
      + " / 20-60 " + statusById("sub_20_60")
      + " / 500-2k " + statusById("mid_500_2000")
      + " / 2-5k " + statusById("presence_2000_5000")
      + " / 5-10k " + statusById("air_5000_10000")
      + " / 10-20k " + statusById("ultra_air_10000_20000")
      + " / Side " + statusById("side_mid");
    return {
      passed,
      airLayerAllowed,
      stemAirLayer: "bypassed",
      items,
      summary: "No-Reference Gate " + summary,
      warnings,
      subExcessDb,
      midShortageDb: Math.max(bodyMaskDb, nasalMaskDb),
      presenceShortageDb,
      airShortageDb,
      ultraAirExcessDb,
      ultraAirShortageDb,
      sideShortfallDb,
      decisions: [
        "No-Reference Gate: " + summary + ".",
        "No-Reference Gate: Fake Air risk " + round2(fakeAirRisk) + " / side-high risk " + round2(sideHighRisk) + " / Stem Air Layer " + (airLayerAllowed ? "allowed" : "blocked") + ".",
      ],
    };
  }
  const referenceSub = averageReferenceBands(referenceProfile, ["20-35", "35-60"]);
  const referenceMid = averageReferenceBands(referenceProfile, ["500-900", "900-1500", "1500-3000"]);
  const referencePresence = averageReferenceBands(referenceProfile, ["1500-3000", "3000-5000"]);
  const referenceAir = averageReferenceBands(referenceProfile, ["5000-9000", "9000-12000"]);
  const referenceUltra = averageReferenceBands(referenceProfile, ["9000-12000", "12000-16000", "16000-20000"]);
  const subExcessDb = round2(metrics.sub2060Db - referenceSub);
  const midShortageDb = round2(referenceMid - metrics.mid5002000Db);
  const presenceShortageDb = round2(referencePresence - metrics.presence20005000Db);
  const airShortageDb = round2(referenceAir - metrics.air500010000Db);
  const ultraAirExcessDb = round2(metrics.ultraAir1000020000Db - referenceUltra);
  const ultraAirShortageDb = round2(referenceUltra - metrics.ultraAir1000020000Db);
  const sideShortfallDb = round2(referenceProfile.sideMidRatioDb - metrics.widthDb);
  const falseAirSuccess = ultraAirExcessDb > 0.5 && (midShortageDb > 1.2 || presenceShortageDb > 1.0 || airShortageDb > 1.0);
  const items: VocalClarityGateItem[] = [
    gateItem("sub_20_60", "20-60Hz", excessStatus(subExcessDb, 1.0, 2.0), subExcessDb, "Candidate vs Reference: " + formatSignedDb(subExcessDb)),
    gateItem("mid_500_2000", "500Hz-2kHz", shortageStatus(midShortageDb, 0.8, 1.2), midShortageDb, "Shortage vs Reference: " + formatSignedDb(midShortageDb)),
    gateItem("presence_2000_5000", "2kHz-5kHz", shortageStatus(presenceShortageDb, 0.6, 1.0), presenceShortageDb, "Shortage vs Reference: " + formatSignedDb(presenceShortageDb)),
    gateItem("air_5000_10000", "5kHz-10kHz", shortageStatus(airShortageDb, 0.8, 1.0), airShortageDb, "Shortage vs Reference: " + formatSignedDb(airShortageDb)),
    gateItem("ultra_air_10000_20000", "10kHz-20kHz", shortageStatus(ultraAirShortageDb, 1.5, 99), ultraAirShortageDb, "Shortage vs Reference: " + formatSignedDb(ultraAirShortageDb)),
    gateItem("side_mid", "Side/Mid", shortageStatus(sideShortfallDb, 0.8, 1.5), sideShortfallDb, "Shortfall vs Reference: " + formatSignedDb(sideShortfallDb)),
  ];
  if (falseAirSuccess) {
    const airItem = items.find((item) => item.id === "air_5000_10000");
    if (airItem && airItem.status === "pass") {
      airItem.status = "warn";
      airItem.detail = airItem.detail + "; 10-20kHz is not counted as clarity while 2-10kHz is weak";
    }
  }
  const passed = !items.some((item) => item.status === "fail") && !falseAirSuccess;
  const warnings = items
    .filter((item) => item.status !== "pass")
    .map((item) => item.label + ": " + item.status.toUpperCase() + " (" + item.detail + ")");
  if (falseAirSuccess) warnings.push("10-20kHz is available, but 500Hz-10kHz focus is still short. Air recovery is held.");
  const statusById = (id: VocalClarityGateItem["id"]) => items.find((item) => item.id === id)?.status ?? "pass";
  const summary = (passed ? "PASS" : "HOLD")
    + " / 20-60 " + statusById("sub_20_60")
    + " / 500-2k " + statusById("mid_500_2000")
    + " / 2-5k " + statusById("presence_2000_5000")
    + " / 5-10k " + statusById("air_5000_10000")
    + " / 10-20k " + statusById("ultra_air_10000_20000")
    + " / Side " + statusById("side_mid");
  const decisions = [
    "Vocal Clarity Gate: " + summary + ".",
    "Vocal Clarity Gate: Sub " + formatSignedDb(subExcessDb) + " / Mid shortage " + formatSignedDb(midShortageDb) + " / Presence shortage " + formatSignedDb(presenceShortageDb) + " / Air shortage " + formatSignedDb(airShortageDb) + " / Ultra Air shortage " + formatSignedDb(ultraAirShortageDb) + " / Side shortfall " + formatSignedDb(sideShortfallDb) + ".",
  ];
  if (midShortageDb > 1.2) decisions.push("Vocal Clarity Gate: 500Hz-2kHz is too far below Reference; prioritize vocal body/image before Air.");
  if (presenceShortageDb > 1.0) decisions.push("Vocal Clarity Gate: 2-5kHz presence is too far below Reference; prioritize image focus before Air.");
  if (airShortageDb > 1.0) decisions.push("Vocal Clarity Gate: 5-10kHz is still low; do not count 10-20kHz Air as clarity.");
  if (subExcessDb > 2) decisions.push("Vocal Clarity Gate: 20-60Hz is masking clarity; trim sub before adding Air.");
  if (falseAirSuccess) decisions.push("Vocal Clarity Gate: 10-20kHz is already high but 2-10kHz is weak, so Air recovery is not considered successful.");
  if (ultraAirShortageDb > 1.5 && passed) decisions.push("Vocal Clarity Gate: 10-20kHz can be recovered lightly because 500Hz-10kHz focus already passed.");
  return {
    passed,
    airLayerAllowed: passed,
    stemAirLayer: "bypassed",
    items,
    summary,
    warnings,
    subExcessDb,
    midShortageDb,
    presenceShortageDb,
    airShortageDb,
    ultraAirExcessDb,
    ultraAirShortageDb,
    sideShortfallDb,
    decisions,
  };
}

function gateItem(id: VocalClarityGateItem["id"], label: string, status: VocalClarityGateStatus, deltaDb: number, detail: string): VocalClarityGateItem {
  return { id, label, status, deltaDb: round2(deltaDb), detail };
}

function excessStatus(value: number, warnAt: number, failAt: number): VocalClarityGateStatus {
  if (value > failAt) return "fail";
  if (value > warnAt) return "warn";
  return "pass";
}

function shortageStatus(value: number, warnAt: number, failAt: number): VocalClarityGateStatus {
  if (value > failAt) return "fail";
  if (value > warnAt) return "warn";
  return "pass";
}

function withStemAirLayerStatus(gate: VocalClarityGate, stemAirLayer: StemAirLayerStatus): VocalClarityGateReport {
  return {
    passed: gate.passed,
    stemAirLayer,
    items: gate.items,
    summary: gate.summary,
    warnings: gate.warnings,
  };
}

function applyVocalClarityTrackFocus(project: Project, waveformPeaks: Record<string, PeakSummary>, gate: VocalClarityGate) {
  const decisions: string[] = [];
  let changed = false;
  const lowCutDb = gate.subExcessDb > 2 ? clamp(1.0 + (gate.subExcessDb - 2) * 0.35, 1.0, 2.5) : 0;
  const vocalMidBoost = gate.midShortageDb > 0.8 ? clamp(0.55 + (gate.midShortageDb - 0.8) * 0.34, 0.55, 1.8) : 0;
  const vocalPresenceBoost = gate.presenceShortageDb > 0.6 ? clamp(0.65 + (gate.presenceShortageDb - 0.6) * 0.34, 0.65, 2.0) : 0;
  const vocalAirBoost = gate.airShortageDb > 0.8 ? clamp(0.3 + (gate.airShortageDb - 0.8) * 0.18, 0.3, 0.95) : 0;
  const supportLowMidCut = gate.subExcessDb > 1.2 ? clamp(0.25 + (gate.subExcessDb - 1.2) * 0.14, 0.25, 0.9) : 0;
  const supportBodyCut = gate.midShortageDb > 1.2 ? clamp(0.3 + (gate.midShortageDb - 1.2) * 0.16, 0.3, 0.9) : 0;
  const supportPresenceCut = gate.presenceShortageDb < -0.8 ? clamp(0.18 + Math.abs(gate.presenceShortageDb) * 0.08, 0.18, 0.45) : 0;
  const harshLikely = gate.airShortageDb < -1 || gate.ultraAirExcessDb > 1.5;
  const lowTargets: string[] = [];
  const vocalTargets: string[] = [];
  const supportTargets: string[] = [];

  const tracks = project.tracks.map((track) => {
    if (track.role === "reference" || track.aimixSpatial?.isAimixSpatialGenerated || track.referenceAssist) return track;
    let next = track;
    if (lowCutDb > 0 && isLowMaskingTrack(project, track, waveformPeaks)) {
      next = cloneTrack(next);
      const eq = cloneEq(next.eq);
      eq.enabled = true;
      applyPeakingToSlot(eq, "reference_match", "auto_ref_track_sub_45", 45, -lowCutDb, 0.85);
      if (track.role === "drums") applyPeakingToSlot(eq, "reference_match", "auto_ref_track_sub_72", 72, -clamp(lowCutDb * 0.45, 0.4, 1.0), 0.9);
      next.eq = eq;
      changed = true;
      lowTargets.push(track.name);
    }
    if ((track.role === "vocal" || track.role === "backingVocal") && (vocalMidBoost > 0 || vocalPresenceBoost > 0 || vocalAirBoost > 0)) {
      next = next === track ? cloneTrack(next) : next;
      const eq = cloneEq(next.eq);
      eq.enabled = true;
      if (vocalMidBoost > 0) applyPeakingToSlot(eq, "reference_match", "auto_ref_vocal_body_2000", 2000, vocalMidBoost, 1.0);
      if (vocalPresenceBoost > 0) applyPeakingToSlot(eq, "reference_match", "auto_ref_vocal_presence_3800", 3800, vocalPresenceBoost, 1.05);
      if (vocalAirBoost > 0) applyPeakingToSlot(eq, "reference_match", "auto_ref_vocal_clarity_6500", 6500, vocalAirBoost, 1.25);
      next.eq = eq;
      next.insertChain = softenVocalDeEssers(next.insertChain, harshLikely);
      changed = true;
      vocalTargets.push(track.name);
    }
    if ((supportLowMidCut > 0 || supportBodyCut > 0 || supportPresenceCut > 0) && isSupportMaskingTrack(project, track, waveformPeaks, gate)) {
      next = next === track ? cloneTrack(next) : next;
      const eq = cloneEq(next.eq);
      eq.enabled = true;
      if (supportLowMidCut > 0) applyPeakingToSlot(eq, "reference_match", "auto_ref_support_mud_430", 430, -supportLowMidCut, 0.9);
      if (supportBodyCut > 0) applyPeakingToSlot(eq, "reference_match", "auto_ref_support_body_mask_1050", 1050, -supportBodyCut, 1.0);
      if (supportPresenceCut > 0) applyPeakingToSlot(eq, "reference_match", "auto_ref_support_presence_mask_3100", 3100, -supportPresenceCut, 1.15);
      next.eq = eq;
      changed = true;
      supportTargets.push(track.name);
    }
    return next;
  });

  if (lowTargets.length > 0) decisions.push(`Sub / Low Masking: ${lowTargets.join(", ")} received ${formatSignedDb(-lowCutDb)} around 20-60Hz before Air recovery.`);
  if (vocalTargets.length > 0) decisions.push(`Vocal Clarity: ${vocalTargets.join(", ")} received small 2kHz / 3.8kHz / 6.5kHz focus boosts and safer De-Esser mix.`);
  if (supportTargets.length > 0) decisions.push(`Support Masking: ${supportTargets.join(", ")} received small 430Hz / 1.05kHz / 3.1kHz cuts so vocal clarity is restored before Air.`);

  return {
    changed,
    decisions,
    project: changed ? { ...project, tracks, updatedAt: new Date().toISOString() } : project,
  };
}

function applyMasterVocalClarityFocus(project: Project, gate: VocalClarityGate, intensity = 1) {
  const decisions: string[] = [];
  let eq = project.master.eq;
  let changed = false;
  const midLift = gate.midShortageDb > 0.8 ? clamp(gate.midShortageDb * 0.42 * intensity, 0.22, 2.05) : 0;
  const presenceLift = gate.presenceShortageDb > 0.6 ? clamp(gate.presenceShortageDb * 0.5 * intensity, 0.28, 2.25) : 0;
  const airLift = gate.airShortageDb > 0.8 ? clamp(gate.airShortageDb * 0.22 * intensity, 0.15, 0.95) : 0;

  if (midLift > 0 || presenceLift > 0 || airLift > 0) {
    eq = cloneEq(eq);
    eq.enabled = true;
    if (midLift > 0) applyReferencePeaking(eq, "auto_ref_image_body_1200", 1200, midLift, 0.95, 2.4);
    if (presenceLift > 0) applyReferencePeaking(eq, "auto_ref_image_focus_3200", 3200, presenceLift, 1.05, 2.6);
    if (airLift > 0) applyReferencePeaking(eq, "auto_ref_image_air_7200", 7200, airLift, 1.2, 1.2);
    changed = true;
    decisions.push(`AIMIX Image Focus: Master received ${intensity > 1 ? "second-pass " : ""}gentle 1.7k/3.6k/7.2k lift before any 10k+ Air layer.`);
  }

  return {
    changed,
    decisions,
    project: changed ? { ...project, master: { ...project.master, eq }, updatedAt: new Date().toISOString() } : project,
  };
}

function applyReferencePeaking(eq: ParametricEQState, slotId: string, frequency: number, gainDb: number, q: number, maxGainDb: number) {
  const applied = applyPeakingToSlot(eq, "reference_match", slotId, frequency, gainDb, q, { maxGainDb });
  if (applied) return;
  eq.bands.push({
    id: createId("eq"),
    type: "peaking",
    frequency: round1(clamp(frequency, 20, 20000)),
    gainDb: round1(clamp(gainDb, -3, maxGainDb)),
    q: round2(clamp(q, 0.2, 12)),
    enabled: true,
    solo: false,
    aimixOwner: "reference_match",
    aimixSlotId: slotId,
  });
}

function isSupportMaskingTrack(project: Project, track: Track, waveformPeaks: Record<string, PeakSummary>, gate: VocalClarityGate) {
  if (!isSupportRole(track.role)) return false;
  const body = trackBandAverage(project, track, waveformPeaks, ["250-500", "500-900", "900-1500"]);
  const presence = trackBandAverage(project, track, waveformPeaks, ["1500-3000", "3000-5000"]);
  const lowMask = gate.subExcessDb > 1.2 && body > -66;
  const bodyMask = gate.midShortageDb > 1.2 && body > -68;
  const presenceMask = gate.presenceShortageDb > 1.0 && presence > -70;
  return lowMask || bodyMask || presenceMask;
}

function isSupportRole(role: StemRole) {
  return role === "guitar" || role === "synth" || role === "keys" || role === "music" || role === "loop" || role === "other" || role === "fx";
}
function isLowMaskingTrack(project: Project, track: Track, waveformPeaks: Record<string, PeakSummary>) {
  if (track.role === "bass" || track.role === "drums") return true;
  if (track.role !== "music" && track.role !== "other" && track.role !== "loop") return false;
  const sub = trackBandAverage(project, track, waveformPeaks, ["20-35", "35-60"]);
  const presence = trackBandAverage(project, track, waveformPeaks, ["1500-3000", "3000-5000"]);
  return sub > -58 && sub > presence - 6;
}

function trackBandAverage(project: Project, track: Track, waveformPeaks: Record<string, PeakSummary>, bands: string[]) {
  const values = project.clips
    .filter((clip) => clip.trackId === track.id)
    .map((clip) => waveformPeaks[clip.fileId])
    .filter((summary): summary is PeakSummary => Boolean(summary))
    .map((summary) => averageDb(bands.map((entry) => band(summary, entry))));
  return values.length > 0 ? averageDb(values) : -90;
}

function softenVocalDeEssers(chain: Track["insertChain"], harshLikely: boolean): Track["insertChain"] {
  return chain.map((plugin) => {
    if (plugin.pluginId !== "sweet-de-esser") return plugin;
    const currentMix = typeof plugin.params.mix === "number" ? plugin.params.mix : 0.45;
    const currentAmount = typeof plugin.params.amount === "number" ? plugin.params.amount : 0.35;
    return {
      ...plugin,
      enabled: plugin.enabled,
      params: {
        ...plugin.params,
        mix: harshLikely ? clamp(currentMix, 0.35, 0.5) : clamp(currentMix, 0.35, 0.45),
        amount: harshLikely ? clamp(currentAmount, 0.22, 0.45) : clamp(currentAmount, 0.18, 0.36),
      },
      updatedAt: new Date().toISOString(),
    };
  });
}

function computeReferencePostTrim(metrics: AutoReferenceMixMetrics, targetLufs: number, truePeakCeilingDb: number) {
  const lufsOvershootDb = metrics.integratedLufs - targetLufs;
  const peakOvershootDb = metrics.truePeakDb - truePeakCeilingDb;
  let trimDb = 0;
  if (lufsOvershootDb > 0.5) {
    trimDb -= lufsOvershootDb - 0.3;
  }
  if (peakOvershootDb > 0) {
    trimDb -= peakOvershootDb;
  }
  return round2(clamp(trimDb, -18, 0));
}

function computeReferenceCatchUp(metrics: AutoReferenceMixMetrics, targetLufs: number, truePeakCeilingDb: number) {
  const lufsShortfallDb = targetLufs - metrics.integratedLufs;
  if (lufsShortfallDb <= 0.35) return 0;
  const peakHeadroomDb = truePeakCeilingDb - metrics.truePeakDb;
  if (peakHeadroomDb <= 0.1) return 0;
  return round2(clamp(Math.min(lufsShortfallDb - 0.15, peakHeadroomDb - 0.05), 0, 3));
}

function applyReferenceGainMove(project: Project, gainDb: number): Project {
  return {
    ...project,
    master: {
      ...project.master,
      finalOutputTrimDb: round2(clamp((project.master.finalOutputTrimDb ?? 0) + gainDb, -18, 2)),
      finalOutputTrimOwner: "reference-match",
      exportPeakTargetDb: Math.min(project.master.exportPeakTargetDb ?? -1.2, -1.2),
    },
    updatedAt: new Date().toISOString(),
  };
}

function applyAimixDensityGuard(project: Project, lufsShortfallDb: number) {
  const densityTargets: string[] = [];
  const tracks = project.tracks.map((track) => {
    if (track.role === "reference" || track.aimixSpatial?.isAimixSpatialGenerated || track.referenceAssist) return track;
    if (!isDensityGuardRole(track.role)) return track;
    if (!project.clips.some((clip) => clip.trackId === track.id)) return track;
    const next = cloneTrack(track);
    const current = next.compressor;
    const drumLike = track.role === "drums";
    next.compressor = {
      enabled: true,
      threshold: round2(Math.min(current.threshold, drumLike ? -18 : -20)),
      ratio: round2(clamp(Math.max(current.ratio, drumLike ? 1.45 : 1.25 + Math.min(0.12, lufsShortfallDb * 0.03)), 1.05, drumLike ? 1.65 : 1.45)),
      attack: drumLike ? Math.min(current.attack, 0.006) : Math.min(current.attack, 0.012),
      release: drumLike ? Math.max(current.release, 0.1) : Math.max(current.release, 0.14),
      knee: Math.max(current.knee, 18),
      makeupGainDb: clamp(current.makeupGainDb, -1, 0.2),
    };
    densityTargets.push(track.name);
    return next;
  });
  return {
    changed: densityTargets.length > 0,
    project: densityTargets.length > 0 ? { ...project, tracks, updatedAt: new Date().toISOString() } : project,
    decisions: densityTargets.length > 0
      ? [`AIMIX Density Guard: ${densityTargets.join(", ")} received gentle compressor settings to reduce peak spikes without a loud master limiter.`]
      : [],
  };
}

function isDensityGuardRole(role: StemRole) {
  return role === "drums" || role === "guitar" || role === "synth" || role === "keys" || role === "music" || role === "loop" || role === "other" || role === "fx";
}
function maybeAddReferenceAirGlue(
  project: Project,
  waveformPeaks: Record<string, PeakSummary>,
  referenceProfile: ReferenceProfile | null,
  currentMetrics: AutoReferenceMixMetrics,
  alignmentDelayMs: number,
) {
  const decisions: string[] = [];
  if (!referenceProfile) return { project, decisions: ["Reference Air Glue: Reference profileがないためスキップしました。"] };
  const ultraGap = (referenceProfile.bandEnergyDb["12000-16000"] + referenceProfile.bandEnergyDb["16000-20000"]) / 2 - currentMetrics.ultraAir1000020000Db;
  const widthGap = referenceProfile.sideMidRatioDb - currentMetrics.widthDb;
  if (ultraGap < 1.2 && widthGap < 0.8) {
    return { project, decisions: ["Reference Air Glue: Air/Side不足が小さいため追加しません。"] };
  }

  const referenceTrack = project.tracks.find((track) => track.role === "reference");
  if (!referenceTrack) return { project, decisions: ["Reference Air Glue: Reference trackが見つかりません。"] };
  const sourceClips = project.clips.filter((clip) => clip.trackId === referenceTrack.id);
  if (sourceClips.length === 0) return { project, decisions: ["Reference Air Glue: Reference clipが見つかりません。"] };

  const existingTrackIds = new Set(project.tracks.filter((track) => track.referenceAssist?.type === "air-glue").map((track) => track.id));
  const cleanedProject = existingTrackIds.size > 0
    ? {
        ...project,
        tracks: project.tracks.filter((track) => !existingTrackIds.has(track.id)),
        clips: project.clips.filter((clip) => !existingTrackIds.has(clip.trackId)),
      }
    : project;

  const createdAt = new Date().toISOString();
  const metadata: ReferenceAssistMetadata = {
    isReferenceAssist: true,
    type: "air-glue",
    sourceReferenceTrackId: referenceTrack.id,
    alignmentDelayMs: round1(alignmentDelayMs),
    createdAt,
    removable: true,
  };
  const track = createTrack("Reference Air Glue", cleanedProject.tracks.length, "fx", "fx");
  track.gainDb = clamp(-28 + clamp(ultraGap * 0.55 + widthGap * 0.28, 0, 6), -28, -22);
  track.pan = 0;
  track.color = referenceTrack.color;
  track.referenceAssist = metadata;
  track.eq = buildReferenceAirGlueEq();
  const deEsser = createPluginInstance("sweet-de-esser", "track");
  track.insertChain = [{
    ...deEsser,
    enabled: true,
    params: {
      ...deEsser.params,
      frequency: 9200,
      amount: 0.18,
      sharpness: 0.66,
      mix: 0.35,
    },
    updatedAt: createdAt,
  }];

  const clips: Clip[] = sourceClips.map((clip) => ({
    ...clip,
    id: createId("clip"),
    trackId: track.id,
    role: "fx",
    gainDb: 0,
    sourceStartSec: clip.sourceStartSec,
    timelineStartSec: Math.max(0, clip.timelineStartSec + alignmentDelayMs / 1000),
    fadeInSec: Math.max(clip.fadeInSec, 0.01),
    fadeOutSec: Math.max(clip.fadeOutSec, 0.01),
    insertChain: [],
    createdBy: "referenceAssist",
    movementLocked: true,
    referenceAssist: metadata,
    actionHistory: [
      createClipHistoryItem("referenceAssist", "Reference Air Glue layer", {
        sourceReferenceTrackId: referenceTrack.id,
        alignmentDelayMs: round1(alignmentDelayMs),
      }),
      ...(clip.actionHistory ?? []),
    ].slice(0, 40),
  }));

  decisions.push(`Reference Air Glue: 10-20kHz/Side補助を${track.gainDb.toFixed(1)}dBで追加しました。`);
  return {
    project: {
      ...cleanedProject,
      tracks: [...cleanedProject.tracks, track],
      clips: [...cleanedProject.clips, ...clips],
      updatedAt: new Date().toISOString(),
    },
    decisions,
  };
}

function buildReferenceAirGlueEq(): ParametricEQState {
  return {
    enabled: true,
    analyzerEnabled: true,
    analyzerMode: "post",
    bands: [
      { id: createId("eq"), type: "highpass", frequency: 6800, gainDb: 0, q: 0.8, enabled: true, solo: false },
      { id: createId("eq"), type: "lowshelf", frequency: 1000, gainDb: -12, q: 0.7, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 9500, gainDb: -0.5, q: 2.2, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 12000, gainDb: 0.3, q: 1.0, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 15000, gainDb: 0.2, q: 1.0, enabled: true, solo: false },
      { id: createId("eq"), type: "highshelf", frequency: 12000, gainDb: 0.4, q: 0.7, enabled: true, solo: false },
      { id: createId("eq"), type: "lowpass", frequency: 18800, gainDb: 0, q: 0.7, enabled: true, solo: false },
    ],
  };
}

export function maybeAddStemAirLayer(
  project: Project,
  waveformPeaks: Record<string, PeakSummary>,
  referenceProfile: ReferenceProfile | null,
  clarityGate?: VocalClarityGate,
) {
  const decisions: string[] = [];
  if (!referenceProfile) return { project, decisions: ["Stem Air Layer: Reference profileがないためスキップしました。"], stemAirLayer: "bypassed" as StemAirLayerStatus };

  const currentMetrics = measureProject(project, waveformPeaks);
  const activeGate = clarityGate ?? evaluateVocalClarityGate(currentMetrics, referenceProfile);
  if (!activeGate.airLayerAllowed) {
    return { project, decisions: ["Stem Air Layer: held back because Vocal Clarity Gate did not pass; 500Hz-10kHz clarity must pass before 10kHz+ air recovery.", ...activeGate.decisions], stemAirLayer: "bypassed" as StemAirLayerStatus };
  }
  const referenceUltraAir = averageReferenceBands(referenceProfile, ["9000-12000", "12000-16000", "16000-20000"]);
  const referenceAir = averageReferenceBands(referenceProfile, ["5000-9000", "9000-12000"]);
  const ultraAirGap = referenceUltraAir - currentMetrics.ultraAir1000020000Db;
  const airGap = referenceAir - currentMetrics.air500010000Db;
  const widthGap = referenceProfile.sideMidRatioDb - currentMetrics.widthDb;
  if (activeGate.ultraAirExcessDb > 0.5) {
    return { project, decisions: ["Stem Air Layer: 10-20kHz already meets or exceeds the Reference, so extra air/noise bed is bypassed."], stemAirLayer: "bypassed" as StemAirLayerStatus };
  }
  if (ultraAirGap < 1.6 && airGap < 1.0 && widthGap < 0.8) {
    return { project, decisions: ["Stem Air Layer: Air/Side不足が小さいため追加しません。"], stemAirLayer: "bypassed" as StemAirLayerStatus };
  }
  if (ultraAirGap < 2.2 && widthGap < 1.4) {
    return { project, decisions: ["Stem Air Layer: 14-20kHz gap is too small for synthetic air; keeping gloss recovery inside EQ only."], stemAirLayer: "bypassed" as StemAirLayerStatus };
  }

  const existingTrackIds = new Set(project.tracks.filter((track) => track.referenceAssist?.type === "stem-air").map((track) => track.id));
  const cleanedProject: Project = existingTrackIds.size > 0
    ? {
        ...project,
        tracks: project.tracks.filter((track) => !existingTrackIds.has(track.id)),
        clips: project.clips.filter((clip) => !existingTrackIds.has(clip.trackId)),
      }
    : project;

  const sourceTracks = selectStemAirSourceTracks(cleanedProject, waveformPeaks);
  if (sourceTracks.length === 0) {
    return { project: cleanedProject, decisions: ["Stem Air Layer: 艶成分に使えるsupport stemが見つからないため追加しません。"], stemAirLayer: "bypassed" as StemAirLayerStatus };
  }

  const sourceTrackIds = sourceTracks.map((entry) => entry.track.id);
  const sourceTrackIdSet = new Set(sourceTrackIds);
  const referenceTrackId = cleanedProject.tracks.find((track) => track.role === "reference")?.id ?? "reference";
  const createdAt = new Date().toISOString();
  const metadata: ReferenceAssistMetadata = {
    isReferenceAssist: true,
    type: "stem-air",
    sourceReferenceTrackId: referenceTrackId,
    sourceTrackIds,
    createdAt,
    removable: true,
  };
  const ultraSideExcess = currentMetrics.ultraAir1000020000Db - referenceUltraAir;
  const airGainReduction = ultraSideExcess > 5 ? clamp((ultraSideExcess - 5) * 0.35, 0, 2.5) : 0;
  const airGainDb = clamp(-24 + clamp(ultraAirGap * 0.4 + Math.max(0, airGap) * 0.1 + Math.max(0, widthGap) * 0.08, 0, 3) - airGainReduction, -24, -20);
  const track = createTrack("Stem Air Layer", cleanedProject.tracks.length, "fx", "fx");
  track.gainDb = round2(airGainDb);
  track.pan = 0;
  track.color = "#9be7ff";
  track.referenceAssist = metadata;
  track.eq = buildStemAirLayerEq(ultraAirGap);
  track.character = {
    enabled: false,
    mode: "brightExciter",
    amount: 0.18,
    tone: 0.7,
    mix: 0.08,
  };
  const airExciter = createPluginInstance("sweet-air-exciter", "track");
  const deEsser = createPluginInstance("sweet-de-esser", "track");
  const widener = createPluginInstance("sweet-support-widener", "track");
  track.insertChain = [
    {
      ...airExciter,
      enabled: true,
      params: {
        ...airExciter.params,
        amount: clamp(0.14 + ultraAirGap * 0.022, 0.14, 0.34),
        tone: clamp(0.52 + Math.max(0, ultraAirGap) * 0.012, 0.52, 0.62),
        focusHz: 11200,
        highPassHz: 6800,
        postHighPassHz: 9000,
        lowPassHz: 18600,
        harshGuard: clamp(0.74 + Math.max(0, airGap) * 0.035, 0.74, 0.92),
        // Keep automatic air recovery source-derived. A generated noise bed can
        // sound like a constant hiss after mastering, especially on headphones.
        syntheticAirBed: false,
        airBedLevel: 0,
        airBedKeyHz: 3000,
        airBedFollow: 0.68,
        dryLevel: 0.5,
        mix: clamp(0.03 + ultraAirGap * 0.006, 0.03, 0.058),
        outputDb: -1.0,
      },
      updatedAt: createdAt,
    },
    {
      ...deEsser,
      enabled: true,
      params: {
        ...deEsser.params,
        frequency: 8200,
        amount: 0.14,
        sharpness: 0.58,
        mix: 0.16,
      },
      updatedAt: createdAt,
    },
    {
      ...widener,
      enabled: true,
      params: {
        ...widener.params,
        width: 0.08,
        mix: clamp(0.025 + Math.max(0, widthGap) * 0.006, 0.025, 0.04),
        delayMs: 6,
        highPassHz: 9000,
        lowPassHz: 18600,
        lowMonoHz: 120,
        tone: 0.6,
        monoSafety: true,
      },
      updatedAt: createdAt,
    },
  ];

  const clips: Clip[] = cleanedProject.clips
    .filter((clip) => sourceTrackIdSet.has(clip.trackId))
    .map((clip) => ({
      ...clip,
      id: createId("clip"),
      trackId: track.id,
      role: "fx",
      gainDb: 0,
      fadeInSec: Math.max(clip.fadeInSec, 0.01),
      fadeOutSec: Math.max(clip.fadeOutSec, 0.01),
      insertChain: [],
      createdBy: "referenceAssist",
      movementLocked: true,
      referenceAssist: metadata,
      actionHistory: [
        createClipHistoryItem("referenceAssist", "Stem Air Layer", {
          sourceTrackId: clip.trackId,
          ultraAirGapDb: round2(ultraAirGap),
        }),
        ...(clip.actionHistory ?? []),
      ].slice(0, 40),
    }));

  decisions.push(`Stem Air Layer: Referenceより不足しているGloss/Airを、stem由来の成分で薄く追加しました (${track.gainDb.toFixed(1)}dB)。`);
  decisions.push("Stem Air Layer: 14-20kHzのノイズ床を増やしすぎないようSynthetic Air Bedは大きな不足時だけ有効にします。");
  decisions.push(`Stem Air Layer: source ${sourceTracks.map((entry) => entry.track.name).join(", ")} / Reference音声は混ぜていません。`);
  return {
    project: {
      ...cleanedProject,
      tracks: [...cleanedProject.tracks, track],
      clips: [...cleanedProject.clips, ...clips],
      updatedAt: new Date().toISOString(),
    },
    decisions,
    stemAirLayer: (airGainReduction > 0.05 ? "reduced" : "enabled") as StemAirLayerStatus,
  };
}

function buildStemAirLayerEq(ultraAirGap: number): ParametricEQState {
  const glossLift = clamp(ultraAirGap * 0.045, 0.04, 0.24);
  const topLift = clamp(ultraAirGap * 0.018, 0.02, 0.12);
  return {
    enabled: true,
    analyzerEnabled: true,
    analyzerMode: "post",
    bands: [
      { id: createId("eq"), type: "highpass", frequency: 6800, gainDb: 0, q: 0.8, enabled: true, solo: false },
      { id: createId("eq"), type: "lowshelf", frequency: 2400, gainDb: -22, q: 0.7, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 7900, gainDb: -1.4, q: 2.5, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 11000, gainDb: glossLift, q: 1.1, enabled: true, solo: false },
      { id: createId("eq"), type: "highshelf", frequency: 12800, gainDb: topLift, q: 0.7, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 16500, gainDb: topLift * 0.45, q: 0.9, enabled: true, solo: false },
      { id: createId("eq"), type: "lowpass", frequency: 18800, gainDb: 0, q: 0.7, enabled: true, solo: false },
    ],
  };
}

function selectStemAirSourceTracks(project: Project, waveformPeaks: Record<string, PeakSummary>) {
  const rejectedRoles = new Set<StemRole>(["vocal", "bass", "reference", "loop"]);
  const tracks = project.tracks
    .filter((track) => !track.mute && !track.aimixSpatial?.isAimixSpatialGenerated && !track.referenceAssist && !rejectedRoles.has(track.role))
    .map((track) => {
      const summaries = project.clips
        .filter((clip) => clip.trackId === track.id)
        .map((clip) => waveformPeaks[clip.fileId])
        .filter((summary): summary is PeakSummary => Boolean(summary));
      if (summaries.length === 0) return null;
      const ultraAirDb = averageDb(summaries.map((summary) => averageDb([
        band(summary, "9000-12000"),
        band(summary, "12000-16000"),
        band(summary, "16000-20000"),
      ])));
      const airDb = averageDb(summaries.map((summary) => averageDb([
        band(summary, "5000-9000"),
        band(summary, "9000-12000"),
      ])));
      const sideDb = averageDb(summaries.map((summary) => summary.sideMidRatioDb ?? -24));
      const roleBonus = track.role === "synth" || track.role === "keys" || track.role === "guitar" || track.role === "music" || track.role === "other" ? 2 : 0;
      const score = ultraAirDb + airDb * 0.15 + Math.max(-18, sideDb) * 0.08 + roleBonus;
      return { track, score, ultraAirDb };
    })
    .filter((entry): entry is { track: Track; score: number; ultraAirDb: number } => entry !== null && entry.ultraAirDb > -88)
    .sort((a, b) => b.score - a.score);
  return tracks.slice(0, 3);
}

function validateSpatialAutoV2(
  before: AutoReferenceMixMetrics,
  after: AutoReferenceMixMetrics,
  referenceProfile: ReferenceProfile | null,
  settings: AutoReferenceMixSettings,
) {
  const decisions: string[] = [];
  const reference = referenceProfileToQualityMetrics(referenceProfile, before);
  const gate = validateSpatialAutoCandidate(
    reference,
    autoMetricsToQualityMetrics(before, referenceProfile?.lrCorrelation),
    autoMetricsToQualityMetrics(after, referenceProfile?.lrCorrelation),
  );
  const lufsDrop = before.integratedLufs - after.integratedLufs;
  const sideImprovement = Math.abs(before.widthDb - reference.sideMidDb) - Math.abs(after.widthDb - reference.sideMidDb);
  const ultraAirDrop = before.ultraAir1000020000Db - after.ultraAir1000020000Db;
  const midMudRise = Math.max(0, after.body250500Db - before.body250500Db, after.mid5002000Db - before.mid5002000Db);
  const accepted = gate.passed &&
    lufsDrop <= settings.maxSpatialLufsDrop &&
    sideImprovement >= -0.1 &&
    ultraAirDrop <= 0.8 &&
    midMudRise <= 0.8;

  decisions.push(`Spatial Auto validation: LUFS drop ${round2(lufsDrop)}LU / Side-Mid move ${round2(sideImprovement)}dB / Air drop ${round2(ultraAirDrop)}dB / Mud rise ${round2(midMudRise)}dB / gate ${gate.passed ? "PASS" : "FAIL"}.`);
  decisions.push(...gate.warnings.map((warning) => `Spatial Gate: ${warning}`));
  decisions.push(
    accepted
      ? "Spatial Auto: 採用しました。AIMIX Referenceの音圧/帯域を再加工せず、固定Track Panだけを調整しています。"
      : "Spatial Auto: 採用せずAIMIX Referenceへ戻しました。音量低下、Side/Mid低下、Air低下、または中域の増えすぎを検出しました。",
  );
  return { accepted, decisions };
}

function autoMetricsToQualityMetrics(metrics: AutoReferenceMixMetrics, lrCorrelation?: number | null): ReferenceQualityMetrics {
  return {
    integratedLufs: metrics.integratedLufs,
    truePeakDb: metrics.truePeakDb,
    rmsDb: metrics.rmsDb,
    crestDb: metrics.crestDb,
    sideMidDb: metrics.widthDb,
    lrCorrelation: Number.isFinite(lrCorrelation) ? Number(lrCorrelation) : estimateCorrelationFromWidth(metrics.widthDb),
    bandEnergyDb: {
      sub_20_60: metrics.sub2060Db,
      lowMid_120_250: metrics.low120250Db,
      body_250_500: metrics.body250500Db,
      mid_500_2000: metrics.mid5002000Db,
      presence_2000_5000: metrics.presence20005000Db,
      air_5000_10000: metrics.air500010000Db,
      ultraAir_10000_20000: metrics.ultraAir1000020000Db,
    },
  };
}

function referenceProfileToQualityMetrics(profile: ReferenceProfile | null, fallback: AutoReferenceMixMetrics): ReferenceQualityMetrics {
  if (!profile) return autoMetricsToQualityMetrics(fallback);
  return {
    integratedLufs: finite(profile.integratedLufsApprox, fallback.integratedLufs),
    truePeakDb: finite(profile.truePeakApproxDb, -1),
    rmsDb: finite(profile.rmsDb, fallback.rmsDb),
    crestDb: finite(profile.crestFactorDb, fallback.crestDb),
    sideMidDb: finite(profile.sideMidRatioDb, fallback.widthDb),
    lrCorrelation: finite(profile.lrCorrelation, estimateCorrelationFromWidth(fallback.widthDb)),
    bandEnergyDb: {
      sub_20_60: averageReferenceBands(profile, ["20-35", "35-60"]),
      lowMid_120_250: averageReferenceBands(profile, ["120-250"]),
      body_250_500: averageReferenceBands(profile, ["250-500"]),
      mid_500_2000: averageReferenceBands(profile, ["500-900", "900-1500", "1500-3000"]),
      presence_2000_5000: averageReferenceBands(profile, ["1500-3000", "3000-5000"]),
      air_5000_10000: averageReferenceBands(profile, ["5000-9000", "9000-12000"]),
      ultraAir_10000_20000: averageReferenceBands(profile, ["9000-12000", "12000-16000", "16000-20000"]),
    },
  };
}

function estimateCorrelationFromWidth(widthDb: number) {
  return round2(clamp(1 - Math.max(0, widthDb + 24) / 48, 0.62, 0.99));
}

function legacyValidateSpatialAutoV2(
  before: AutoReferenceMixMetrics,
  after: AutoReferenceMixMetrics,
  referenceProfile: ReferenceProfile | null,
  settings: AutoReferenceMixSettings,
) {
  const decisions: string[] = [];
  const lufsDrop = before.integratedLufs - after.integratedLufs;
  const sideBeforeDistance = referenceProfile ? Math.abs(before.widthDb - referenceProfile.sideMidRatioDb) : 0;
  const sideAfterDistance = referenceProfile ? Math.abs(after.widthDb - referenceProfile.sideMidRatioDb) : Math.max(0, before.widthDb - after.widthDb);
  const sideImprovement = referenceProfile ? sideBeforeDistance - sideAfterDistance : after.widthDb - before.widthDb;
  const referenceWidthAllowance = referenceProfile ? referenceProfile.sideMidRatioDb - before.widthDb + 0.7 : 0;
  const widthDidNotCollapse = after.widthDb >= before.widthDb - 0.35;
  const widthMovedTowardReference = sideImprovement >= settings.minSideMidImprovementDb || referenceWidthAllowance > 0.4;
  const ultraAirDrop = before.ultraAir1000020000Db - after.ultraAir1000020000Db;
  const midMudRise = Math.max(0, after.body250500Db - before.body250500Db, after.mid5002000Db - before.mid5002000Db);
  const accepted =
    lufsDrop <= settings.maxSpatialLufsDrop &&
    widthDidNotCollapse &&
    widthMovedTowardReference &&
    ultraAirDrop <= 0.8 &&
    midMudRise <= 0.8 &&
    after.truePeakDb <= Math.max(-0.2, before.truePeakDb + 1.5);

  decisions.push(`Spatial Auto validation: LUFS drop ${round2(lufsDrop)}LU / Side-Mid move ${round2(sideImprovement)}dB / Air drop ${round2(ultraAirDrop)}dB / Mud rise ${round2(midMudRise)}dB.`);
  decisions.push(
    accepted
      ? "Spatial Auto: 採用しました。AIMIX Referenceの音圧/帯域を保ち、Track Pan / Clip Panだけを調整しています。"
      : "Spatial Auto: 採用せずAIMIX Referenceへ戻しました。音量低下、Side低下、Air低下、または中域の増えすぎを検出しました。",
  );
  return { accepted, decisions };
}

function validateSpatialAuto(
  before: AutoReferenceMixMetrics,
  after: AutoReferenceMixMetrics,
  referenceProfile: ReferenceProfile | null,
  settings: AutoReferenceMixSettings,
) {
  const decisions: string[] = [];
  const lufsDrop = before.integratedLufs - after.integratedLufs;
  const sideBeforeDistance = referenceProfile ? Math.abs(before.widthDb - referenceProfile.sideMidRatioDb) : 0;
  const sideAfterDistance = referenceProfile ? Math.abs(after.widthDb - referenceProfile.sideMidRatioDb) : Math.max(0, before.widthDb - after.widthDb);
  const sideImprovement = referenceProfile ? sideBeforeDistance - sideAfterDistance : after.widthDb - before.widthDb;
  const ultraAirDrop = before.ultraAir1000020000Db - after.ultraAir1000020000Db;
  const accepted =
    lufsDrop <= settings.maxSpatialLufsDrop &&
    sideImprovement >= settings.minSideMidImprovementDb &&
    ultraAirDrop <= 1 &&
    after.truePeakDb <= Math.max(0, before.truePeakDb + 1.5);
  decisions.push(`Spatial Auto validation: LUFS drop ${round2(lufsDrop)}LU / Side-Mid improvement ${round2(sideImprovement)}dB / Air drop ${round2(ultraAirDrop)}dB.`);
  decisions.push(accepted ? "Spatial Auto: 採用しました。" : "Spatial Auto: 悪化防止のため自動棄却しました。");
  return { accepted, decisions };
}

export function measureProject(project: Project, peaksByFileId: Record<string, PeakSummary>): AutoReferenceMixMetrics {
  const finalOutputTrimDb = project.master.finalOutputTrimDb ?? 0;
  const values = project.clips
    .map((clip) => {
      const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
      const summary = peaksByFileId[clip.fileId];
      if (!track || !summary || track.mute || track.role === "reference") return null;
      const gainDb = (track.gainDb ?? 0) + (clip.gainDb ?? 0) + (project.master.gainDb ?? 0);
      const peak = summary.max.reduce((max, value, index) => Math.max(max, Math.abs(value), Math.abs(summary.min[index] ?? 0)), 0);
      const rmsDb = estimateSummaryRms(summary) + gainDb;
      const bandEnergy = mapBandEnergyEnergy(track, summary);
      const trackSubEqDb = estimateEqGainAtHz(track.eq, 45);
      const trackLowEqDb = estimateEqGainAtHz(track.eq, 180);
      const trackBodyEqDb = estimateEqGainAtHz(track.eq, 360);
      const trackMidEqDb = estimateEqGainAtHz(track.eq, 1200);
      const trackPresenceEqDb = estimateEqGainAtHz(track.eq, 3200);
      const trackAirEqDb = estimateEqGainAtHz(track.eq, 8000);
      const trackUltraAirEqDb = estimateEqGainAtHz(track.eq, 14000);
      return {
        peakDb: ampToDb(peak) + gainDb,
        rmsDb,
        sub2060Db: averageDb([bandEnergy["20-35"], bandEnergy["35-60"]]) + gainDb + trackSubEqDb,
        low120250Db: bandEnergy["120-250"] + gainDb + trackLowEqDb,
        body250500Db: bandEnergy["250-500"] + gainDb + trackBodyEqDb,
        mid5002000Db: averageDb([
          bandEnergy["500-900"],
          bandEnergy["900-1500"],
          bandEnergy["1500-3000"],
        ]) + gainDb + trackMidEqDb,
        presence20005000Db: averageDb([
          bandEnergy["1500-3000"],
          bandEnergy["3000-5000"],
        ]) + gainDb + trackPresenceEqDb,
        air500010000Db: averageDb([
          bandEnergy["5000-9000"],
          bandEnergy["9000-12000"],
        ]) + gainDb + trackAirEqDb,
        ultraAir1000020000Db: averageDb([
          bandEnergy["9000-12000"],
          bandEnergy["12000-16000"],
          bandEnergy["16000-20000"],
        ]) + gainDb + trackUltraAirEqDb,
        widthDb: (summary.sideMidRatioDb ?? -24) + estimatePanWidthDb(track.pan),
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (values.length === 0) {
    return {
      peakDb: -60,
      truePeakDb: -59.8,
      rmsDb: -60,
      integratedLufs: -61.2,
      crestDb: 0,
      lowMidDb: -60,
      presenceDb: -60,
      airDb: -60,
      widthDb: -24,
      sub2060Db: -60,
      low120250Db: -60,
      body250500Db: -60,
      mid5002000Db: -60,
      presence20005000Db: -60,
      air500010000Db: -60,
      ultraAir1000020000Db: -60,
    };
  }

  const peakDb = Math.max(...values.map((value) => value.peakDb));
  const rmsDb = averageDbAsPower(values.map((value) => value.rmsDb));
  const sub2060Db = averageDbAsPower(values.map((value) => value.sub2060Db)) + estimateEqGainAtHz(project.master.eq, 45);
  const low120250Db = averageDbAsPower(values.map((value) => value.low120250Db)) + estimateEqGainAtHz(project.master.eq, 180);
  const body250500Db = averageDbAsPower(values.map((value) => value.body250500Db)) + estimateEqGainAtHz(project.master.eq, 360);
  const mid5002000Db = averageDbAsPower(values.map((value) => value.mid5002000Db)) + estimateEqGainAtHz(project.master.eq, 950);
  const presence20005000Db = averageDbAsPower(values.map((value) => value.presence20005000Db)) + estimateEqGainAtHz(project.master.eq, 3200);
  const air500010000Db = averageDbAsPower(values.map((value) => value.air500010000Db)) + estimateEqGainAtHz(project.master.eq, 8000);
  const ultraAir1000020000Db = averageDbAsPower(values.map((value) => value.ultraAir1000020000Db)) + estimateEqGainAtHz(project.master.eq, 14000);
  return {
    peakDb: round1(peakDb + finalOutputTrimDb),
    truePeakDb: round1(peakDb + finalOutputTrimDb + 0.2),
    rmsDb: round1(rmsDb + finalOutputTrimDb),
    integratedLufs: round1(estimateIntegratedLufsApproxFromRms(rmsDb) + finalOutputTrimDb),
    crestDb: round1(peakDb - rmsDb),
    lowMidDb: round1(averageDbAsPower([low120250Db, body250500Db]) + finalOutputTrimDb),
    presenceDb: round1(averageDbAsPower([presence20005000Db, mid5002000Db]) + finalOutputTrimDb),
    airDb: round1(averageDbAsPower([air500010000Db, ultraAir1000020000Db]) + finalOutputTrimDb),
    widthDb: round1(averageDb(values.map((value) => value.widthDb))),
    sub2060Db: round1(sub2060Db + finalOutputTrimDb),
    low120250Db: round1(low120250Db + finalOutputTrimDb),
    body250500Db: round1(body250500Db + finalOutputTrimDb),
    mid5002000Db: round1(mid5002000Db + finalOutputTrimDb),
    presence20005000Db: round1(presence20005000Db + finalOutputTrimDb),
    air500010000Db: round1(air500010000Db + finalOutputTrimDb),
    ultraAir1000020000Db: round1(ultraAir1000020000Db + finalOutputTrimDb),
  };
}

function applyReferenceDeltaToMasterEq(eq: ParametricEQState, delta: ReferenceDelta | null) {
  const next = cloneEq(eq);
  next.enabled = true;
  const lowMove = delta ? clamp(delta.lowEndDeltaDb * 0.18, -0.8, 0.45) : 0;
  const bodyMove = delta ? clamp(delta.bodyDeltaDb * 0.16, -0.8, 0.55) : -0.15;
  const presenceMove = delta ? clamp(delta.presenceDeltaDb * 0.14, -0.55, 0.85) : 0.1;
  const airMove = delta ? clamp(delta.airDeltaDb * 0.08, 0, 0.4) : 0.05;
  setHighpass(next, 28);
  applyPeakingToSlot(next, "reference_match", "auto_ref_low_90", 90, lowMove, 0.9);
  applyPeakingToSlot(next, "reference_match", "auto_ref_body_320", 320, bodyMove, 0.9);
  applyPeakingToSlot(next, "reference_match", "auto_ref_presence_3500", 3500, presenceMove, 1.0);
  applyShelfGainToSlot(next, "highshelf", "reference_match", "auto_ref_air_12000", 12000, airMove, 0.7);
  return next;
}

function preservePanAndClipAutomation(project: Project, source: Project): Project {
  const panByTrackId = new Map(source.tracks.map((track) => [track.id, track.pan]));
  const clipPanById = new Map(source.clips.map((clip) => [clip.id, clip.panAutomation]));
  return {
    ...project,
    tracks: project.tracks.map((track) => panByTrackId.has(track.id) ? { ...track, pan: panByTrackId.get(track.id) ?? track.pan } : track),
    clips: project.clips.map((clip) => clipPanById.has(clip.id) ? { ...clip, panAutomation: clipPanById.get(clip.id) } : clip),
  };
}

function getReferenceGainMove(metrics: AutoReferenceMixMetrics, reference: ReferenceProfile | null) {
  if (!reference || !Number.isFinite(reference.integratedLufsApprox)) return 0;
  return limitGainByTruePeak(metrics, clamp(reference.integratedLufsApprox - metrics.integratedLufs, -6, 6), -1.2);
}

function limitGainByTruePeak(metrics: AutoReferenceMixMetrics, gainDb: number, truePeakCeilingDb: number) {
  if (gainDb <= 0) return gainDb;
  const peakHeadroomDb = truePeakCeilingDb - metrics.truePeakDb;
  return round2(clamp(Math.min(gainDb, peakHeadroomDb - 0.05), 0, gainDb));
}

function buildAnalysisFromMetrics(metrics: AutoReferenceMixMetrics): MagicPolishAnalysis {
  return {
    lowEnergy: normalizeBand(metrics.low120250Db),
    lowMidEnergy: normalizeBand(metrics.lowMidDb),
    presenceEnergy: normalizeBand(metrics.presenceDb),
    airEnergy: normalizeBand(metrics.air500010000Db),
    ultraAirEnergy: normalizeBand(metrics.ultraAir1000020000Db),
    topAirEnergy: normalizeBand(metrics.ultraAir1000020000Db),
    crestFactorDb: metrics.crestDb,
    stereoWidth: clamp((metrics.widthDb + 24) / 24, 0, 1),
  };
}

function buildCompletionMessage(
  status: AutoReferenceMixResult["status"],
  alignment: AutoReferenceMixResult["alignment"],
  before: AutoReferenceMixMetrics,
  after: AutoReferenceMixMetrics,
  decisions: string[],
) {
  const noReference = decisions.some((decision) => decision.startsWith("Sweet No-Reference"));
  const baseLabel = noReference ? "Sweet No-Reference Finish" : "AIMIX Reference";
  const spatial = status === "accepted-spatial-auto" || status === "accepted-sweet-no-reference-spatial"
    ? noReference ? "Sweet No-Reference Spatial accepted" : "Spatial Auto accepted"
    : status === "reverted-spatial-auto" || status === "reverted-sweet-no-reference-spatial"
      ? noReference ? "Sweet No-Reference Spatial reverted" : "Spatial Auto reverted"
      : `${baseLabel} accepted`;
  const air = decisions.find((decision) => decision.startsWith("Stem Air Layer")) ?? decisions.find((decision) => decision.startsWith("Reference Air Glue")) ?? "Stem Air Layer: no change";
  return `Auto Reference Mix completed: ${spatial}. Alignment ${alignment.globalLagMs.toFixed(1)}ms / drift ${alignment.driftMs.toFixed(1)}ms. LUFS ${before.integratedLufs.toFixed(1)} -> ${after.integratedLufs.toFixed(1)}. Crest ${before.crestDb.toFixed(1)} -> ${after.crestDb.toFixed(1)}. ${air}`;
}

function buildDecisionLayerDecisionLines(report: MixDoctorReport) {
  const lines: string[] = [];
  const lowEnd = report.lowEndKingReport;
  const peak = report.peakCulpritReport;
  if (lowEnd?.recommendations[0]) {
    lines.push(`Low-End King: ${lowEnd.recommendations[0].replace(/^Low-End King:\s*/i, "")}`);
  }
  if (peak?.topCulprits[0]) {
    const culprit = peak.topCulprits[0];
    lines.push(`Peak Culprit: ${culprit.trackName} is the top limiter stress source. Action: ${culprit.action.replace(/_/g, " ")}.`);
  } else if (peak?.recommendations[0]) {
    lines.push(`Peak Culprit: ${peak.recommendations[0].replace(/^Peak Culprit:\s*/i, "")}`);
  }
  return lines.slice(0, 2);
}

function buildReferenceClarityGapDecisionLines(report: MixDoctorReport) {
  const gap = report.referenceClarityGap;
  if (!gap || gap.status === "pass") return [];
  const lines = [
    `Reference Clarity: 2-5kHz ${gap.presenceGapDb.toFixed(1)}dB / 5-10kHz ${gap.clarityGapDb.toFixed(1)}dB below Reference. Mastering cuts will be softened before Air.`,
  ];
  if (gap.falseAirRisk) {
    lines.push("Reference Clarity: false Air risk. Restore 2-10kHz first; do not solve muffle with only 12kHz+ shine.");
  }
  return lines;
}

function getReferenceLufsShortfallDb(metrics: AutoReferenceMixMetrics, reference: ReferenceProfile | null) {
  if (!reference || !Number.isFinite(reference.integratedLufsApprox)) return 0;
  return reference.integratedLufsApprox - metrics.integratedLufs;
}

const MOJIBAKE_MARKER_RE = /[\u90b5\uff7a\u90e2\uff67\u96b4\uff6b\u9677\u5d0e\u53c9\u9b2f\uff6e\u96b0\u82d3\u68d4\u83a0\u6b49\u7e3a\u8b41\u8768\u87fe\u880e\u8b17\u9015\u7e67\u8b6b\u870d\u8373\u9b2e\u879f\u4e9f]/u;

function hasMojibakeMarker(message: string) {
  return MOJIBAKE_MARKER_RE.test(message);
}

function cleanDecisionMessages(messages: string[]) {
  return messages.map(normalizeDecisionMessage);
}

function normalizeDecisionMessage(message: string) {
  if (!message) return message;
  if (!hasMojibakeMarker(message)) return message;
  if (message.startsWith("Reference Mix")) {
    return "Reference Mixを読み込むと、自動でAIMIX Referenceを実行します。";
  }
  if (message.startsWith("Reference") && message.includes("stem")) {
    return "Referenceとstemが揃うまで待機しています。";
  }
  if (message.startsWith("Reference") && message.includes("Direct")) {
    return "Reference解析: Direct WAVのLUFS / Crest / Tonal / Sideを読み取りました。";
  }
  if (message.startsWith("Reference Air Glue")) {
    return "Reference Air Glue: 既定ではOFFです。Reference音声そのものはexportへ混ぜません。";
  }
  if (message.startsWith("Stem Air Layer")) {
    return "Stem Air Layer: Reference音声を混ぜず、stem由来の高域だけを薄く追加します。";
  }
  if (message.startsWith("Reference Backbone")) {
    return "Reference Backbone: 実験機能のため既定ではOFFです。";
  }
  if (message.startsWith("Spatial Auto")) {
    return "Spatial Auto: Quality Gateで確認しました。条件を満たさない場合はAIMIX Referenceへ戻します。";
  }
  return "AIMIX: 内部メッセージを整理しました。";
}

function legacyNormalizeDecisionMessage(message: string) {
  if (!message) return message;
  if (!hasMojibakeMarker(message)) return message;
  if (message.startsWith("Reference Mix")) {
    return "Reference Mixを読み込むと、自動でAIMIX Referenceを実行します。";
  }
  if (message.startsWith("Reference") && message.includes("stem")) {
    return "Referenceとstemが揃うまで待機しています。";
  }
  if (message.startsWith("Reference") && message.includes("Direct")) {
    return "Reference解析: Direct WAVのLUFS / Crest / Tonal / Sideを読み取りました。";
  }
  if (message.startsWith("Reference Air Glue")) {
    return "Reference Air Glue: 既定ではOFFです。Reference音声はexportへ混ぜません。";
  }
  if (message.startsWith("Stem Air Layer")) {
    return "Stem Air Layer: Reference音声を混ぜず、stem由来の高域だけを薄く追加します。";
  }
  if (message.startsWith("Reference Backbone")) {
    return "Reference Backbone: Experimentalのため既定OFFです。";
  }
  if (message.startsWith("Spatial Auto")) {
    return "Spatial Auto: 採用せずAIMIX Referenceへ戻しました。音量低下またはSide/Mid低下を検出しました。";
  }
  return "AIMIX: 内部メッセージを整理しました。";
}

function waitingResult(project: Project, metrics: AutoReferenceMixMetrics, message: string): AutoReferenceMixResult {
  const cleanMessage = normalizeDecisionMessage(message);
  return {
    ok: false,
    status: "waiting-for-files",
    before: project,
    after: project,
    aimixReference: project,
    mixDoctorReport: null,
    lowEndKingReport: null,
    peakCulpritReport: null,
    alignment: { ok: false, globalLagMs: 0, driftMs: 0, confidence: 0, mode: "warning", message: cleanMessage },
    spatialReport: null,
    beforeMetrics: metrics,
    aimixMetrics: metrics,
    afterMetrics: metrics,
    decisions: [cleanMessage],
    message: cleanMessage,
  };
}

function idleResult(project: Project, metrics: AutoReferenceMixMetrics, message: string): AutoReferenceMixResult {
  return {
    ...waitingResult(project, metrics, message),
    status: "idle",
  };
}

function cloneProject(project: Project): Project {
  return JSON.parse(JSON.stringify(project)) as Project;
}

function cloneTrack(track: Track): Track {
  return JSON.parse(JSON.stringify(track)) as Track;
}

function cloneEq(eq: ParametricEQState): ParametricEQState {
  return JSON.parse(JSON.stringify(eq)) as ParametricEQState;
}

function setHighpass(eq: ParametricEQState, cutoffHz: number) {
  const band = eq.bands.find((candidate) => candidate.type === "highpass");
  if (!band) return;
  band.enabled = true;
  band.frequency = cutoffHz;
  band.gainDb = 0;
}

function estimateSummaryRms(summary: PeakSummary) {
  const bins = Math.max(1, Math.min(summary.min.length, summary.max.length));
  let sum = 0;
  for (let index = 0; index < bins; index += 1) {
    const value = Math.max(Math.abs(summary.min[index] ?? 0), Math.abs(summary.max[index] ?? 0));
    sum += value * value * 0.5;
  }
  return ampToDb(Math.sqrt(sum / bins));
}

function band(summary: PeakSummary, id: string) {
  return summary.bandEnergyDb?.[id] ?? -60;
}

function averageDb(values: number[]) {
  if (values.length === 0) return -60;
  const powers = values.filter(Number.isFinite).map((value) => 10 ** (value / 10));
  if (powers.length === 0) return -60;
  return 10 * Math.log10(Math.max(1e-12, powers.reduce((sum, value) => sum + value, 0) / powers.length));
}

function estimatePanWidthDb(pan: number) {
  return Math.abs(Number.isFinite(pan) ? pan : 0) * 3.5;
}

function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(1e-9, Math.abs(value)));
}

function normalizeBand(value: number) {
  return clamp((value + 48) / 42, 0, 1);
}

function estimateEqGainAtHz(eq: ParametricEQState, frequencyHz: number) {
  if (!eq.enabled) return 0;
  return eq.bands.reduce((sum, band) => {
    if (!band.enabled) return sum;
    const frequency = clamp(band.frequency, 20, 20000);
    const octaves = Math.log2(Math.max(20, frequencyHz) / frequency);
    if (band.type === "highpass") {
      return sum + (frequencyHz < frequency ? -clamp(Math.abs(octaves) * 12, 0, 18) : 0);
    }
    if (band.type === "lowpass") {
      return sum + (frequencyHz > frequency ? -clamp(Math.abs(octaves) * 12, 0, 18) : 0);
    }
    if (band.type === "lowshelf") {
      return sum + band.gainDb * clamp(1 - Math.max(0, octaves) / 1.6, 0, 1);
    }
    if (band.type === "highshelf") {
      return sum + band.gainDb * clamp(1 + Math.min(0, octaves) / 1.6, 0, 1);
    }
    const width = Math.max(0.25, 1 / Math.max(0.3, band.q));
    const influence = Math.exp(-0.5 * (octaves / width) ** 2);
    return sum + band.gainDb * influence;
  }, 0);
}

function averageReferenceBands(profile: ReferenceProfile, keys: string[]) {
  const values = keys
    .map((key) => profile.bandEnergyDb?.[key as keyof typeof profile.bandEnergyDb])
    .filter((value): value is number => Number.isFinite(value));
  if (values.length === 0) return -18;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finite(value: number | undefined | null, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatSignedDb(value: number) {
  const rounded = round2(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(2)}dB`;
}
