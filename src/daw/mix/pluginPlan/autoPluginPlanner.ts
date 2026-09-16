import type {
  ABCompareReport,
  AutoMixPlan,
  AutoPluginPlan,
  AutoPluginTrackPlan,
  AmbienceSeatPlan,
  BusProcessingPlan,
  ComponentSafeOperation,
  DamageGuardReport,
  ExportModePlan,
  KickBassRoleReport,
  LowEndKingReport,
  LoudnessMatchReport,
  PeakCulpritReport,
  PerceptualScoreReport,
  ReferenceClarityGapReport,
  PluginInsertPlan,
  ReferenceDelta,
  StemContaminationReport,
  StemFeatureReport,
  StemPurityReport,
} from "../mixDoctorTypes";
import { clamp, round1, round2 } from "../mixDoctorAnalysisUtils";
import { evaluateDamageGuard } from "../damageGuard";
import { applyPluginQualityGuards } from "../../../audio/plugins/pluginQualityGuards";
import { isBuiltinPluginId, type PluginInstance } from "../../model/Plugin";

type AutoPluginPlannerInput = {
  featureReports: StemFeatureReport[];
  autoMixPlan: AutoMixPlan;
  stemPurityReports: StemPurityReport[];
  contaminationReports: StemContaminationReport[];
  referenceDelta: ReferenceDelta | null;
  referenceClarityGap?: ReferenceClarityGapReport | null;
  loudnessMatchReport: LoudnessMatchReport | null;
  kickBassRoleReport: KickBassRoleReport | null;
  lowEndKingReport: LowEndKingReport | null;
  peakCulpritReport: PeakCulpritReport | null;
  ambienceSeatPlan?: AmbienceSeatPlan | null;
};

export function buildAutoPluginPlan(input: AutoPluginPlannerInput): AutoPluginPlan {
  const featureByTrackId = new Map(input.featureReports.map((report) => [report.trackId, report]));
  const purityByTrackId = new Map(input.stemPurityReports.map((report) => [report.trackId, report]));
  const contaminationByTrackId = new Map(input.contaminationReports.map((report) => [report.trackId, report]));

  const rawTrackPlans: AutoPluginTrackPlan[] = input.autoMixPlan.trackPlans.map((trackPlan) => {
    const feature = featureByTrackId.get(trackPlan.trackId);
    const purity = purityByTrackId.get(trackPlan.trackId);
    const contamination = contaminationByTrackId.get(trackPlan.trackId);
    const insertPlans = buildInsertPlans(trackPlan, feature, purity, contamination, input.referenceDelta, input.lowEndKingReport, input.peakCulpritReport, input.autoMixPlan.mode);
    const sendPlans = buildSendPlans(trackPlan, contamination, input.lowEndKingReport, input.peakCulpritReport, input.ambienceSeatPlan, input.autoMixPlan.mode);
    const busPlans = buildBusPlans(trackPlan, insertPlans, sendPlans);

    return {
      trackId: trackPlan.trackId,
      trackName: trackPlan.trackName,
      role: trackPlan.role,
      purityScore: purity?.purityScore ?? 100,
      insertPlans,
      sendPlans,
      busPlans,
      notes: [
        trackPlan.reason,
        ...buildVocalStemOrderNotes(trackPlan.role, insertPlans),
        ...(contamination?.warnings ?? []),
        purity ? `Purity ${purity.purityScore.toFixed(1)}` : "Purity not measured.",
      ],
    };
  });
  const parallelGuard = applyParallelDensityCaps(rawTrackPlans, input.autoMixPlan.mode);
  const trackPlans = parallelGuard.trackPlans;

  const masterPlan = buildMasterPlan(input.autoMixPlan, input.loudnessMatchReport, input.referenceDelta, input.peakCulpritReport);
  const masterInsertPlans = buildMasterInsertPlans(input.autoMixPlan, input.referenceDelta, input.referenceClarityGap ?? null, input.lowEndKingReport, input.peakCulpritReport);
  const exportModePlan = buildExportModePlan(input.autoMixPlan, masterPlan);
  const beforeScore = buildPerceptualScoreReport(input.featureReports);
  const afterScore = predictAfterScore(beforeScore, input.autoMixPlan, trackPlans, input.referenceDelta);
  const damageGuardReport = evaluateDamageGuard(beforeScore, afterScore, trackPlans.map((plan) => plan.trackId));
  const guardedTrackPlans = applyDamageGuardToTrackPlans(trackPlans, damageGuardReport);
  const abCompareReport: ABCompareReport = {
    beforeLabel: "Current Mix",
    afterLabel: "Planned Mix",
    loudnessMatched: Boolean(input.loudnessMatchReport && Math.abs(input.loudnessMatchReport.afterMatchDiffDb) <= 0.75),
    gainCompensationDb: input.loudnessMatchReport?.appliedGainDb ?? 0,
    notes: [
      "The planner keeps the A/B loudness matched before judgment.",
      ...(input.referenceDelta?.advisory ?? []),
    ],
  };

  return {
    id: `auto-plugin-plan-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    sourceAutoMixPlanId: input.autoMixPlan.id,
    mode: input.autoMixPlan.mode,
    target: input.autoMixPlan.target,
    trackPlans: guardedTrackPlans,
    masterPlan,
    masterInsertPlans,
    exportModePlan,
    damageGuardReport,
    abCompareReport,
    notes: [
      "Reverb is routed conceptually as sends first, insert fallback second.",
      "Lead vocal, kick, bass, and snare body stay center protected.",
      damageGuardReport.allowed
        ? "Plan stays reversible and can be bypassed per plugin."
        : "Damage Guard weakened risky plugin moves before the plan is shown.",
      input.lowEndKingReport?.status === "fail"
        ? "Low-End King guarded the plan: sub boosts, low ambience, and widening stay conservative until one low-end owner is chosen."
        : "Low-End King did not require extra low-end guard.",
      input.peakCulpritReport?.status === "fail"
        ? "Peak Culprit guarded the plan: master gain and parallel compression stay conservative until ceiling hits are controlled."
        : "Peak Culprit did not require extra limiter-load guard.",
      input.referenceClarityGap && input.referenceClarityGap.status !== "pass"
        ? "Reference Clarity Catch-Up: mild bright correction is allowed because the output is darker than Reference."
        : "Reference Clarity did not require extra muffle guard.",
      input.ambienceSeatPlan?.recommendations[0] ?? "Ambience Seat not available.",
      ...parallelGuard.notes,
      masterInsertPlans.length > 0 ? "Master Tilt EQ is proposed as a broad balance move, not a loudness shortcut." : "Master Tilt EQ was not needed.",
    ],
  };
}

function applyParallelDensityCaps(trackPlans: AutoPluginTrackPlan[], mode: AutoMixPlan["mode"]) {
  const maxParallel = mode === "strong" ? 6 : mode === "balanced" ? 4 : 0;
  const mixScale = mode === "strong" ? 0.82 : 0.68;
  const candidates = trackPlans
    .flatMap((trackPlan) =>
      trackPlan.insertPlans
        .filter((insert) => insert.pluginId === "sweet-parallel-comp")
        .map((insert) => ({ trackPlan, insert, score: getParallelRolePriority(trackPlan.role) + insert.confidence + insert.strength })),
    )
    .filter((candidate) => candidate.trackPlan.role !== "vocal")
    .sort((a, b) => b.score - a.score);
  const keep = new Set(candidates.slice(0, maxParallel).map((candidate) => candidate.insert.id));
  let removed = 0;
  let kept = 0;
  let protectedLeadVocal = 0;

  const cappedTrackPlans = trackPlans.map((trackPlan) => {
    const nextInserts = trackPlan.insertPlans.flatMap((insert) => {
      if (insert.pluginId !== "sweet-parallel-comp") return [insert];
      if (trackPlan.role === "vocal") {
        protectedLeadVocal += 1;
        return [];
      }
      if (!keep.has(insert.id)) {
        removed += 1;
        return [];
      }
      kept += 1;
      return [{
        ...insert,
        params: {
          ...insert.params,
          mix: round2(clamp(Number(insert.params.mix ?? 0) * mixScale, 0.02, mode === "strong" ? 0.12 : 0.09)),
          autoDensityGuard: mode === "strong" ? "dense-cap-6" : "balanced-cap-4",
        },
        reason: `${insert.reason} Density Guard capped automatic parallel compression for this mode.`,
      }];
    });
    return {
      ...trackPlan,
      insertPlans: nextInserts,
      notes: [
        ...trackPlan.notes,
        ...(trackPlan.insertPlans.length !== nextInserts.length ? ["Density Guard removed excess automatic parallel compression from this track."] : []),
      ],
    };
  });

  const notes = [
    mode === "light"
      ? "Density Guard: Safe/Light mode inserts no automatic parallel compression."
      : `Density Guard: ${mode === "strong" ? "Dense/Strong" : "Balanced"} kept ${kept}/${kept + removed + protectedLeadVocal} automatic parallel comp plan(s); lead vocal protected ${protectedLeadVocal}.`,
  ];
  return { trackPlans: cappedTrackPlans, notes };
}

function getParallelRolePriority(role: AutoPluginTrackPlan["role"]) {
  if (role === "drums") return 10;
  if (role === "bass") return 9;
  if (role === "music" || role === "loop") return 8;
  if (role === "backingVocal") return 7;
  if (role === "guitar" || role === "keys" || role === "synth") return 5;
  return 3;
}

function buildInsertPlans(
  trackPlan: AutoMixPlan["trackPlans"][number],
  feature: StemFeatureReport | undefined,
  purity: StemPurityReport | undefined,
  contamination: StemContaminationReport | undefined,
  referenceDelta: ReferenceDelta | null,
  lowEndKingReport: LowEndKingReport | null,
  peakCulpritReport: PeakCulpritReport | null,
  mode: AutoMixPlan["mode"],
): PluginInsertPlan[] {
  if (!feature || !purity) return [];

  const plans: PluginInsertPlan[] = [];
  const safeMode = mode === "light";
  const lowPurity = purity.purityScore < 75;
  const veryLowPurity = purity.purityScore < 45;
  const highPresence = Boolean(contamination && contamination.vocalBleedScore > 58);
  const highAir = Boolean(contamination && contamination.cymbalMetallicScore > 58);
  const harshReference = referenceDelta ? referenceDelta.airDeltaDb > 0.75 || referenceDelta.presenceDeltaDb > 0.75 : false;
  const strength = clamp(trackPlan.width + trackPlan.depth + Math.abs(trackPlan.volumeTrimDb) * 0.2, 0.1, 1);
  const confidence = clamp(0.55 + purity.purityScore / 220, 0.45, 0.93);
  const canUseParallel = !safeMode && !veryLowPurity && purity.purityScore >= 55;
  const lowEndConflict = lowEndKingReport?.status === "fail";
  const peakStress = peakCulpritReport?.status === "fail";
  const peakCulprit = peakCulpritReport?.topCulprits.find((item) => item.trackId === trackPlan.trackId) ?? null;
  const peakCulpritForTrack = Boolean(peakCulprit);

  if (trackPlan.role === "vocal" || trackPlan.role === "backingVocal") {
    const isLeadVocal = trackPlan.role === "vocal";
    const fakeAirRisk = hasVocalFakeAirRisk(feature, contamination, referenceDelta);
    const vocalDeEssNeeded = highPresence || highAir || harshReference || lowPurity || fakeAirRisk;
    const inputTrimDb = round2(clamp(trackPlan.volumeTrimDb, -6, 2));
    if (Math.abs(inputTrimDb) > 0.15 && !veryLowPurity) {
      plans.push(buildPluginPlan("sweet-utility", "Vocal Input Trim", "track", {
        gainDb: inputTrimDb,
        width: 1,
        mono: false,
        vocalMixStage: "01-input-gain",
        vocalMixOrder: 1,
        inputTrimConsumesFader: true,
      }, "Stage 1 Input Gain: normalize vocal working level before de-essing, compression, or Glow; this is not a loudness push.", confidence, Math.min(0.3, Math.abs(inputTrimDb) / 6), "Vocal input trim"));
    }
    if (!veryLowPurity) {
      plans.push(buildPluginPlan("sweet-filter", "Vocal Corrective HPF", "track", {
        type: "highpass",
        frequency: isLeadVocal ? 72 : 92,
        q: 0.72,
        gainDb: 0,
        vocalMixStage: "03-corrective-eq",
        vocalMixOrder: 3,
      }, "Stage 3 Corrective EQ: remove vocal rumble before de-essing, compression, or air recovery; 10kHz+ is not boosted here.", confidence, strength * 0.32, "Vocal corrective HPF"));
    }
    if (vocalDeEssNeeded) {
      plans.push(buildPluginPlan("sweet-de-esser", "Sweet De-Esser", "track", {
        frequency: fakeAirRisk ? 7800 : 7100,
        amount: clamp((Math.max(contamination?.vocalBleedScore ?? 28, contamination?.cymbalMetallicScore ?? 0) + (fakeAirRisk ? 18 : 0)) / 210, 0.08, 0.34),
        sharpness: fakeAirRisk ? 0.62 : 0.5,
        mix: fakeAirRisk ? 0.5 : 0.42,
        vocalMixStage: "04-de-esser-harshness-guard",
        vocalMixOrder: 4,
        blocksLaterAir: fakeAirRisk,
      }, fakeAirRisk ? "Stage 4 Harshness Guard: fake-air risk blocks later air/exciter stages and controls brittle AI highs first." : "Stage 4 De-Esser: only reduce harsh sibilance when needed; do not recolor the vocal.", confidence, strength * 0.55, "Light vocal de-ess"));
    }
    if (canUseParallel) {
      plans.push(buildPluginPlan("sweet-parallel-comp", "Sweet Parallel Comp", "track", {
        preset: isLeadVocal ? "Vocal Level" : "Vocal Thick",
        mix: isLeadVocal ? 0.045 : 0.075,
        crush: isLeadVocal ? 22 : 30,
        attackMs: isLeadVocal ? 24 : 20,
        releaseMs: isLeadVocal ? 150 : 165,
        tone: fakeAirRisk ? -18 : -12,
        outputDb: -0.2,
        wetHpfHz: isLeadVocal ? 120 : 140,
        wetLpfHz: fakeAirRisk ? 8200 : 10000,
        autoGain: true,
        vocalMixStage: "05-compressor-leveler",
        vocalMixOrder: 5,
      }, isLeadVocal ? "Stage 5 Leveler: gentle vocal leveling after cleanup, preserving consonants and avoiding loudness-only compression." : "Stage 5 Backing Leveler: add low-mix density while keeping the lead vocal protected.", confidence, strength * (isLeadVocal ? 0.34 : 0.42), isLeadVocal ? "Lead vocal leveler" : "Backing vocal density"));
    }
    if (!safeMode && !fakeAirRisk && !highAir) {
      plans.push(buildPluginPlan("sweet-aimix-glow", "AIMIX Glow", "track", {
        preset: "aiStemRescue",
        amount: isLeadVocal ? 34 : 30,
        recover: isLeadVocal ? 30 : 24,
        gloss: isLeadVocal ? 18 : 16,
        air: isLeadVocal ? 12 : 10,
        tame: harshReference ? 60 : 52,
        mix: isLeadVocal ? 0.24 : 0.2,
        outputDb: -0.4,
        vocalMixStage: "06-tone-glow-harmonic-recovery",
        vocalMixOrder: 6,
        splitHighBands: "clarity_5_10k_gloss_9_14k_sheen_14_20k",
        broadHighShelfAllowed: false,
      }, "Stage 6 Tone / AIMIX Glow: add controlled presence, gloss, and air only after corrective EQ, de-essing, and leveling; no broad high shelf.", confidence, strength * 0.36, "Vocal controlled glow"));
    } else if (fakeAirRisk || highAir) {
      const guardMarker = buildPluginPlan("sweet-utility", "Vocal Air Guard Marker", "track", {
        gainDb: 0,
        width: 1,
        mono: false,
        vocalMixStage: "06-tone-glow-harmonic-recovery",
        vocalMixOrder: 6,
        guardOnly: true,
        blockedStage: "air-recovery",
      }, "Stage 6 Tone Guard: AIMIX Glow / Air recovery is intentionally blocked because side-high or fake-air risk is present.", confidence, 0.08, "Vocal air recovery blocked");
      plans.push({
        ...guardMarker,
        enabled: false,
      });
    }
  } else if (trackPlan.role === "bass") {
    const subCeiling = lowEndConflict ? 0.15 : lowEndKingReport?.owner === "kick" ? 0.12 : 0.28;
    if (!safeMode) {
      plans.push(buildPluginPlan("sweet-bass-enhancer", "Sweet Bass Translator", "track", {
        sub: clamp(0.12 + Math.max(0, -feature.bandEnergyDb["60-120"]) / 180, 0.06, subCeiling),
        harmonics: clamp(0.2 + Math.max(0, 12 - feature.crestFactorDb) / 120, 0.18, 0.46),
        tight: clamp(0.42 + (contamination?.lowEndContaminationScore ?? 0) / 600, 0.36, 0.56),
        tone: 0.44,
        mix: lowEndConflict ? 0.12 : 0.22,
      }, lowEndConflict ? "Low-End King found sub conflict; translate bass audibility without extra sub push." : "Translate bass audibility with harmonics and tightness instead of boosting sub bass.", confidence, strength * 0.65, "Light bass translate"));
    }
    if (!safeMode && shouldAddLowEndTranslator(feature, purity, contamination, lowEndKingReport, peakCulpritForTrack)) {
      plans.push(buildPluginPlan("sweet-low-end-translator", "Sweet Low-End Translator", "track", {
        mode: feature.bandEnergyDb["20-35"] > -12 ? "808Audibility" : "subToBass",
        amount: 0.2,
        drive: 0.16,
        sourceLowHz: 58,
        translateHz: 112,
        upperHarmonicHz: 185,
        lowCutHz: 30,
        subGuardHz: 55,
        subGuardDb: -0.7,
        mix: 0.16,
        outputDb: -0.4,
        monoSafe: true,
      }, "Translate sub energy into audible bass harmonics without pushing 20-60Hz.", confidence, strength * 0.42, "Bass audibility translate"));
    }
    if (canUseParallel) {
      plans.push(buildPluginPlan("sweet-parallel-comp", "Sweet Parallel Comp", "track", {
        preset: "Bass Hold",
        mix: peakStress || peakCulpritForTrack ? 0.06 : 0.1,
        crush: peakStress || peakCulpritForTrack ? 34 : 44,
        attackMs: 30,
        releaseMs: 180,
        tone: -20,
        outputDb: 0,
        wetHpfHz: 25,
        wetLpfHz: 8000,
        autoGain: true,
      }, "Hold bass sustain with parallel compression instead of sub boosting.", confidence, strength * 0.48, "Bass hold density"));
    }
    if (shouldAddBassClipper(feature, lowEndKingReport, peakCulpritForTrack) && canUseParallel) {
      plans.push(buildPluginPlan("sweet-clipper", "Sweet Clipper", "track", {
        mode: "soft",
        driveDb: lowEndConflict ? 0.6 : 0.8,
        ceilingDb: -1.2,
        knee: 0.55,
        hardness: 0.35,
        mix: lowEndConflict ? 0.26 : 0.35,
        outputDb: -0.3,
        autoTrim: true,
      }, "Soften bass peaks without boosting sub; keep low-end owner stable before limiter.", confidence, strength * 0.38, "Bass peak soften"));
    }
  } else if (trackPlan.role === "drums") {
    if (!veryLowPurity) {
      plans.push(buildPluginPlan("sweet-transient-shaper", "Sweet Transient Shaper", "track", {
        attack: clamp(0.36 + (feature.crestFactorDb - 8) / 50, 0.28, 0.5),
        sustain: clamp(0.18 + (contamination?.roomWashScore ?? 0) / 520, 0.1, 0.3),
        tone: 0.54,
        mix: 0.24,
      }, "Add a small amount of punch without flattening the drum stem.", confidence, strength * 0.65, "Light drum shape"));
      if (shouldAddDrumClipper(feature, peakCulpritForTrack)) {
        const transientOnly = peakCulprit?.action === "transient_shape";
        plans.push(buildPluginPlan("sweet-clipper", "Sweet Clipper", "track", {
          mode: "soft",
          driveDb: transientOnly ? 0.9 : 1.5,
          ceilingDb: -1,
          knee: 0.45,
          hardness: transientOnly ? 0.35 : 0.42,
          mix: transientOnly ? 0.35 : 0.55,
          outputDb: -0.4,
          autoTrim: true,
        }, "Shape drum peaks before master limiting; keep attack but reduce limiter stress.", confidence, strength * 0.46, "Drum peak clip"));
      }
      plans.push(buildPluginPlan("sweet-parallel-comp", "Sweet Parallel Comp", "track", {
        preset: "Drum Smash",
        mix: peakStress || peakCulpritForTrack ? 0.07 : 0.14,
        crush: peakStress || peakCulpritForTrack ? 38 : 56,
        attackMs: 6,
        releaseMs: 95,
        tone: highAir ? -8 : 0,
        outputDb: -1,
        wetHpfHz: 60,
        wetLpfHz: 14000,
        autoGain: true,
      }, "Add controlled drum density without driving the whole mix into the limiter.", confidence, strength * 0.5, "Drum parallel density"));
    }
  } else {
    if (!veryLowPurity) {
      plans.push(buildPluginPlan("sweet-vocal-duck-eq", "Sweet Vocal Duck EQ", "track", {
        preset: "AIMIX Vocal Pocket",
        frequencyHz: trackPlan.role === "guitar" ? 2300 : trackPlan.role === "synth" || trackPlan.role === "keys" ? 2800 : 2500,
        q: trackPlan.role === "synth" || trackPlan.role === "keys" ? 1.25 : 1.1,
        maxReductionDb: clamp(0.8 + strength * 0.9, 0.7, 1.7),
        threshold: 0.035,
        attackMs: 35,
        releaseMs: 190,
        mix: clamp(0.55 + strength * 0.35, 0.55, 0.9),
        autoInserted: true,
      }, "Duck only the vocal presence pocket while the vocal is active; preserve support tone when the vocal is not singing.", confidence, strength * 0.48, "Dynamic vocal pocket"));
    }
    if (shouldAddSupportClipper(trackPlan.role, feature, peakCulpritForTrack) && !veryLowPurity) {
      plans.push(buildPluginPlan("sweet-clipper", "Sweet Clipper", "track", {
        mode: "soft",
        driveDb: 0.8,
        ceilingDb: -1.2,
        knee: 0.6,
        hardness: 0.3,
        mix: 0.25,
        outputDb: -0.3,
        autoTrim: true,
      }, "Round support peaks before limiter gain without making the stem louder.", confidence, strength * 0.28, "Support peak soften"));
    }
    if (!safeMode && !veryLowPurity) {
      plans.push(buildPluginPlan("sweet-support-widener", "Sweet Support Widener", "track", {
        width: clamp(trackPlan.width, 0.06, 0.32),
        delayMs: Math.round(4 + trackPlan.width * 6),
        tone: 0.58,
        mix: clamp(0.06 + trackPlan.width * 0.08, 0.04, 0.14),
        highPassHz: 2500,
        lowPassHz: 16000,
        lowMonoHz: 120,
        monoSafety: true,
      }, "Apply a small high-side width move only to support content; low band stays out of the wide path.", confidence, strength * (lowEndConflict ? 0.45 : 0.55), "Light support width"));
    }
    if (canUseParallel) {
      plans.push(buildPluginPlan("sweet-parallel-comp", "Sweet Parallel Comp", "track", {
        preset: trackPlan.role === "music" || trackPlan.role === "loop" ? "Music Density" : "Glue Light",
        mix: (trackPlan.role === "music" || trackPlan.role === "loop" ? 0.08 : 0.06) * (peakStress ? 0.55 : 1),
        crush: (trackPlan.role === "music" || trackPlan.role === "loop" ? 42 : 30) * (peakStress ? 0.72 : 1),
        attackMs: trackPlan.role === "music" || trackPlan.role === "loop" ? 14 : 25,
        releaseMs: trackPlan.role === "music" || trackPlan.role === "loop" ? 150 : 220,
        tone: -12,
        outputDb: trackPlan.role === "music" || trackPlan.role === "loop" ? -1 : 0,
        wetHpfHz: 120,
        wetLpfHz: 11000,
        autoGain: true,
      }, "Add a small amount of support density without filling the vocal center.", confidence, strength * 0.38, "Support parallel density"));
    }
    if (!safeMode && (trackPlan.role === "fx" || trackPlan.role === "music" || trackPlan.role === "loop")) {
      plans.push(buildPluginPlan("sweet-reverb-lite", "Sweet Reverb Lite", "track", {
        mode: trackPlan.role === "fx" ? "tail" : "room",
        room: clamp(0.12 + trackPlan.depth * 0.22, 0.1, 0.28),
        damp: 0.72,
        preDelayMs: trackPlan.role === "fx" ? 14 : 18,
        decaySec: trackPlan.role === "fx" ? 1.35 : 0.62,
        lowCutHz: trackPlan.role === "fx" ? 260 : 180,
        highCutHz: trackPlan.role === "fx" ? 11000 : 9000,
        width: trackPlan.role === "fx" ? 0.42 : 0.3,
        ducking: 0.18,
        mix: clamp(0.025 + trackPlan.depth * 0.04, 0.02, 0.07),
        sendPreferred: true,
      }, "Use a very small shared space only for support content.", confidence, strength * 0.45, "Light support space"));
    }
  }

  if (veryLowPurity) {
    plans.splice(0, plans.length, buildPluginPlan("sweet-filter", "Sweet Filter", "track", {
      type: "highpass",
      frequency: trackPlan.role === "bass" ? 25 : 35,
      q: 0.8,
      gainDb: 0,
      componentSafe: true,
    }, "Use a conservative cleanup filter until the stem is cleaned up.", confidence * 0.8, strength * 0.6, "Component-safe cleanup"));
  }

  return plans;
}

function shouldAddDrumClipper(feature: StemFeatureReport, peakCulpritForTrack: boolean) {
  return peakCulpritForTrack || feature.truePeakApproxDb > -1.5 || feature.crestFactorDb > 11;
}

function buildVocalStemOrderNotes(role: AutoMixPlan["trackPlans"][number]["role"], insertPlans: PluginInsertPlan[]) {
  if (role !== "vocal" && role !== "backingVocal") return [];
  const stageList = insertPlans
    .filter((insert) => typeof insert.params.vocalMixOrder === "number")
    .slice()
    .sort((a, b) => Number(a.params.vocalMixOrder) - Number(b.params.vocalMixOrder))
    .map((insert) => `${insert.params.vocalMixStage}: ${insert.enabled ? insert.name : `blocked ${insert.name}`}`);
  return [
    "Vocal Stem Order: Input/Fader -> Repair Guard -> Corrective EQ -> De-Esser -> Leveler -> Glow/Tone -> Vocal Forward -> Spatial Send -> Final Safety.",
    "Vocal Repair Guard: confidence-limited issues stay as review tags/repair queue metadata; original audio is not muted automatically.",
    "Vocal Spatial: lead dry stays centered; ambience should be send-style and high-passed/de-harsh when used.",
    stageList.length > 0 ? `Vocal planned stages: ${stageList.join(" / ")}` : "Vocal planned stages: no insert stages were needed beyond fader and review metadata.",
  ];
}

function hasVocalFakeAirRisk(
  feature: StemFeatureReport,
  contamination: StemContaminationReport | undefined,
  referenceDelta: ReferenceDelta | null,
) {
  const clarity = Math.max(feature.bandEnergyDb["5000-9000"], feature.bandEnergyDb["9000-12000"]);
  const sheen = Math.max(feature.bandEnergyDb["12000-16000"], feature.bandEnergyDb["16000-20000"]);
  const sideHighRisk = feature.sideMidRatioDb > -6.5 && sheen > clarity - 1.2;
  const brittleTop = sheen - clarity > 2.2;
  const contaminationRisk = (contamination?.cymbalMetallicScore ?? 0) > 62 || (contamination?.artifactScore ?? 0) > 64;
  const referenceWarnsAgainstAir = referenceDelta ? referenceDelta.airDeltaDb < -0.5 && referenceDelta.presenceDeltaDb <= 0.35 : false;
  return brittleTop || sideHighRisk || contaminationRisk || referenceWarnsAgainstAir;
}

function shouldAddBassClipper(feature: StemFeatureReport, lowEndKingReport: LowEndKingReport | null, peakCulpritForTrack: boolean) {
  return (
    peakCulpritForTrack ||
    (lowEndKingReport?.owner === "bass" && feature.truePeakApproxDb > -1.2 && feature.crestFactorDb > 10)
  );
}

function shouldAddLowEndTranslator(
  feature: StemFeatureReport,
  purity: StemPurityReport,
  contamination: StemContaminationReport | undefined,
  lowEndKingReport: LowEndKingReport | null,
  peakCulpritForTrack: boolean,
) {
  if (feature.role !== "bass") return false;
  if (purity.purityScore < 55) return false;
  if (lowEndKingReport?.status === "fail" || lowEndKingReport?.owner === "kick") return false;
  if (peakCulpritForTrack) return false;
  if ((contamination?.lowEndContaminationScore ?? 0) >= 62) return false;
  const subStrong = Math.max(feature.bandEnergyDb["20-35"], feature.bandEnergyDb["35-60"]) > -15;
  const bassAudibilityWeak = feature.bandEnergyDb["120-250"] < -8 || feature.bandEnergyDb["250-500"] < -10;
  return subStrong && bassAudibilityWeak;
}

function shouldAddSupportClipper(
  role: AutoMixPlan["trackPlans"][number]["role"],
  feature: StemFeatureReport,
  peakCulpritForTrack: boolean,
) {
  if (role === "vocal" || role === "backingVocal" || role === "bass" || role === "drums") return false;
  return peakCulpritForTrack || (feature.truePeakApproxDb > -1 && feature.crestFactorDb > 12);
}

function buildSendPlans(
  trackPlan: AutoMixPlan["trackPlans"][number],
  contamination: StemContaminationReport | undefined,
  lowEndKingReport: LowEndKingReport | null,
  peakCulpritReport: PeakCulpritReport | null,
  ambienceSeatPlan?: AmbienceSeatPlan | null,
  mode?: AutoMixPlan["mode"],
) {
  if (mode === "light") return [];

  const ambienceSeat = ambienceSeatPlan?.tracks.find((track) => track.trackId === trackPlan.trackId);
  if (ambienceSeat) {
    if (ambienceSeat.seat === "no_send" || ambienceSeat.sendDb <= -30) return [];
    const peakBlocked = peakCulpritReport?.status === "fail" && peakCulpritReport.topCulprits.some((item) => item.trackId === trackPlan.trackId);
    const gainDb = peakBlocked ? Math.min(ambienceSeat.sendDb, -28) : ambienceSeat.sendDb;
    return [
      {
        id: `send-${trackPlan.trackId}-ambience`,
        sourceTrackId: trackPlan.trackId,
        sourceTrackName: trackPlan.trackName,
        targetBusId: "bus-ambience",
        targetBusName: "Ambience Bus",
        gainDb: round1(gainDb),
        enabled: !peakBlocked && ambienceSeat.seat !== "dry_anchor",
        reason: `${ambienceSeat.reason} Ambience Seat uses ${ambienceSeat.seat.replace(/_/g, " ")} at ${round1(gainDb)}dB.`,
      },
    ];
  }

  if (trackPlan.role === "bass" || trackPlan.role === "drums" || trackPlan.role === "vocal") return [];
  const lowEndConflict = lowEndKingReport?.status === "fail";
  const sendAmount = clamp(trackPlan.depth * (lowEndConflict ? 0.045 : 0.08), 0.01, lowEndConflict ? 0.045 : 0.08);
  if (sendAmount <= 0.025) return [];

  return [
    {
      id: `send-${trackPlan.trackId}-ambience`,
      sourceTrackId: trackPlan.trackId,
      sourceTrackName: trackPlan.trackName,
      targetBusId: "bus-ambience",
      targetBusName: "Ambience Bus",
      gainDb: round1(-24 + sendAmount * 45),
      enabled: contamination?.roomWashScore ? contamination.roomWashScore < 58 : true,
      reason: lowEndConflict
        ? "Low-End King found low-end risk, so ambience stays extra low and the low band remains dry."
        : "Use only a small shared ambience path; keep lead vocal and low end dry.",
    },
  ];
}

function buildBusPlans(trackPlan: AutoMixPlan["trackPlans"][number], insertPlans: PluginInsertPlan[], sendPlans: AutoPluginTrackPlan["sendPlans"]) {
  if (sendPlans.length === 0 && insertPlans.every((plan) => plan.routePreference !== "send")) return [];

  const reverbPlan = insertPlans.filter((plan) => plan.pluginId === "sweet-reverb-lite" || plan.pluginId === "sweet-delay-lite");
  if (reverbPlan.length === 0) return [];

  const busPlan: BusProcessingPlan = {
    id: `bus-${trackPlan.trackId}-ambience`,
    busId: "bus-ambience",
    busName: "Ambience Bus",
    pluginPlans: reverbPlan,
    reason: "Shared space processing keeps the stem cleaner than direct inserts.",
  };
  return [busPlan];
}

function buildMasterPlan(autoMixPlan: AutoMixPlan, loudnessMatchReport: LoudnessMatchReport | null, referenceDelta: ReferenceDelta | null, peakCulpritReport: PeakCulpritReport | null) {
  const mode: ExportModePlan["mode"] = autoMixPlan.target === "reference_polish" ? "mix_for_mastering" : "preview_loud";
  const referenceDrivenCeiling = loudnessMatchReport ? -1.0 : autoMixPlan.masterPlan.limiterCeilingDb;
  const airBias = referenceDelta?.airDeltaDb ?? 0;
  const peakGuardActive = peakCulpritReport?.status === "fail";
  return {
    mode,
    limiterCeilingDb: referenceDrivenCeiling,
    maxGainPushDb: peakGuardActive || mode === "mix_for_mastering" ? 0 : clamp(autoMixPlan.masterPlan.maxGainPushDb, 0, 0.55),
    tone: airBias > 0.7 ? "bright" : airBias < -0.7 ? "dark" : autoMixPlan.masterPlan.tone,
    notes: [
      ...autoMixPlan.masterPlan.notes,
      loudnessMatchReport ? "Reference match is advisory before mastering and is not copied directly." : "No reference track loaded.",
      referenceDelta ? "Reference delta should stay within safe bounds." : "Reference delta unavailable.",
      peakGuardActive ? "Peak Culprit guard: resolve stem peaks before adding master gain." : "Peak Culprit guard did not block master gain.",
    ],
  };
}

function buildMasterInsertPlans(
  autoMixPlan: AutoMixPlan,
  referenceDelta: ReferenceDelta | null,
  referenceClarityGap: ReferenceClarityGapReport | null,
  lowEndKingReport: LowEndKingReport | null,
  peakCulpritReport: PeakCulpritReport | null,
): PluginInsertPlan[] {
  const plans: PluginInsertPlan[] = [];
  if (autoMixPlan.target !== "reference_polish" && autoMixPlan.target !== "streaming_safe") return [];
  const safetyGuardActive = lowEndKingReport?.status === "fail" || peakCulpritReport?.status === "fail";

  if (referenceClarityGap && referenceClarityGap.status !== "pass") {
    const tiltDb = clamp((Math.max(0, referenceClarityGap.presenceGapDb) + Math.max(0, referenceClarityGap.clarityGapDb)) * 0.18, 0.25, 0.8);
    plans.push(buildPluginPlan("sweet-tilt-eq", "Reference Clarity Catch-Up", "master", {
      tiltDb: round2(safetyGuardActive ? Math.min(tiltDb, 0.65) : tiltDb),
      pivotHz: 1600,
      lowShape: 0.55,
      highShape: 0.7,
      mix: referenceClarityGap.falseAirRisk ? 0.65 : 0.75,
      outputDb: -0.2,
    }, "Mild bright tilt allowed despite safety guards because the output is darker than the Reference.", 0.76, Math.min(0.6, tiltDb / 1.4), "Reference clarity catch-up"));
  }

  if (!referenceDelta) return plans;
  if (safetyGuardActive) return plans;

  const tonalNeed = Math.abs(referenceDelta.airDeltaDb) + Math.abs(referenceDelta.bodyDeltaDb);
  if (tonalNeed < 1.1) return plans;
  const tiltDb = clamp(referenceDelta.airDeltaDb * 0.35 - referenceDelta.bodyDeltaDb * 0.18, -1.2, 1.2);
  if (Math.abs(tiltDb) < 0.25) return plans;

  plans.push(buildPluginPlan("sweet-tilt-eq", "Sweet Tilt EQ", "master", {
      tiltDb: round2(tiltDb),
      pivotHz: 1000,
      lowShape: 0.7,
      highShape: 0.7,
      mix: 0.85,
      outputDb: 0,
    }, "Broad reference-balance tilt only; no limiter push or surgical master EQ.", 0.72, Math.min(0.55, Math.abs(tiltDb) / 1.5), "Master tilt balance"));

  return plans;
}

function buildExportModePlan(autoMixPlan: AutoMixPlan, masterPlan: ReturnType<typeof buildMasterPlan>): ExportModePlan {
  if (autoMixPlan.target === "reference_polish") {
    return {
      mode: "mix_for_mastering",
      limiterEnabled: false,
      normalizePeak: false,
      bitDepth: "pcm24",
      sampleRate: "project",
      notes: [
        "Use this when sending the mix to an external mastering stage.",
        "Limiter is disabled so the export stays mastering-safe.",
        "Reference track is advisory and must stay excluded from final export.",
      ],
    };
  }

  if (autoMixPlan.mode === "strong") {
    return {
      mode: "preview_loud",
      limiterEnabled: true,
      normalizePeak: true,
      bitDepth: "pcm16",
      sampleRate: "project",
      notes: ["Loud preview is intended for quick audition only."],
    };
  }

  return {
    mode: "stem_export",
    limiterEnabled: masterPlan.limiterCeilingDb > -1.15,
    normalizePeak: false,
    bitDepth: "pcm24",
    sampleRate: "project",
    notes: ["Stem export keeps starts and endings aligned and leaves reference out of the package."],
  };
}

export function buildPerceptualScoreReport(featureReports: StemFeatureReport[]): PerceptualScoreReport {
  if (featureReports.length === 0) {
    return {
      overall: 0,
      clarity: 0,
      body: 0,
      vocalFocus: 0,
      lowEndTightness: 0,
      stereoImage: 0,
      harshness: 0,
      mud: 0,
      reverbCleanliness: 0,
      aiArtifact: 0,
      peakSafety: 0,
      notes: ["Import stems before running Mix Doctor."],
    };
  }

  const avg = (selector: (report: StemFeatureReport) => number) =>
    featureReports.reduce((sum, report) => sum + selector(report), 0) / featureReports.length;

  const clarity = clamp(100 - avg((report) => Math.max(report.bandEnergyDb["250-500"], report.bandEnergyDb["500-900"]) * -2.5), 0, 100);
  const body = clamp(100 + avg((report) => report.bandEnergyDb["120-250"] + report.bandEnergyDb["250-500"]) * 2.2, 0, 100);
  const vocalFocus = clamp(100 + avg((report) => report.bandEnergyDb["1500-3000"] + report.bandEnergyDb["3000-5000"]) * 2.0, 0, 100);
  const lowEndTightness = clamp(100 + avg((report) => report.bandEnergyDb["60-120"] + report.bandEnergyDb["120-250"]) * 2.5, 0, 100);
  const stereoImage = clamp(40 + avg((report) => Math.abs(report.sideMidRatioDb) * 4 + report.stereoWidthScore * 0.45), 0, 100);
  const harshness = clamp(100 + avg((report) => report.bandEnergyDb["5000-9000"] + report.bandEnergyDb["9000-12000"]) * 2.1, 0, 100);
  const mud = clamp(100 + avg((report) => report.bandEnergyDb["250-500"] + report.bandEnergyDb["500-900"]) * 2.25, 0, 100);
  const reverbCleanliness = clamp(100 - avg((report) => Math.max(0, 10 - report.crestFactorDb) * 6), 0, 100);
  const aiArtifact = clamp(100 - avg((report) => (100 - report.spectralFlatness * 100) * 0.35), 0, 100);
  const peakSafety = clamp(100 - avg((report) => Math.max(0, report.truePeakApproxDb + 1) * 12), 0, 100);
  const overall = round1((clarity + body + vocalFocus + lowEndTightness + stereoImage + harshness + mud + reverbCleanliness + aiArtifact + peakSafety) / 10);

  return {
    overall,
    clarity: round1(clarity),
    body: round1(body),
    vocalFocus: round1(vocalFocus),
    lowEndTightness: round1(lowEndTightness),
    stereoImage: round1(stereoImage),
    harshness: round1(harshness),
    mud: round1(mud),
    reverbCleanliness: round1(reverbCleanliness),
    aiArtifact: round1(aiArtifact),
    peakSafety: round1(peakSafety),
    notes: [
      "Perceptual scores are intentionally conservative.",
      "Reference and dirty-stem checks can override a score if safety is at risk.",
    ],
  };
}

function predictAfterScore(
  before: PerceptualScoreReport,
  autoMixPlan: AutoMixPlan,
  trackPlans: AutoPluginTrackPlan[],
  referenceDelta: ReferenceDelta | null,
): PerceptualScoreReport {
  const widthLift = trackPlans.reduce((sum, plan) => sum + plan.insertPlans.filter((insert) => insert.pluginId === "sweet-stereo-widener" || insert.pluginId === "sweet-support-widener").length, 0);
  const deEssLift = trackPlans.reduce((sum, plan) => sum + plan.insertPlans.filter((insert) => insert.pluginId === "sweet-de-esser").length, 0);
  const reverbLift = trackPlans.reduce((sum, plan) => sum + plan.insertPlans.filter((insert) => insert.routePreference === "send" || insert.pluginId === "sweet-reverb-lite").length, 0);
  const bassLift = trackPlans.reduce((sum, plan) => sum + plan.insertPlans.filter((insert) => insert.pluginId === "sweet-bass-enhancer" || insert.pluginId === "sweet-low-end-translator").length, 0);
  const compLift = trackPlans.reduce((sum, plan) => sum + plan.insertPlans.filter((insert) => insert.pluginId === "sweet-multiband-comp" || insert.pluginId === "sweet-parallel-comp").length, 0);

  const clarity = clamp(before.clarity + deEssLift * 3 + bassLift * 0.5 - reverbLift * 1.2, 0, 100);
  const body = clamp(before.body + bassLift * 2.2 - widthLift * 0.5, 0, 100);
  const vocalFocus = clamp(before.vocalFocus + deEssLift * 2.1 + (referenceDelta?.presenceDeltaDb ?? 0) * 0.6, 0, 100);
  const lowEndTightness = clamp(before.lowEndTightness + compLift * 1.8 + bassLift * 0.8, 0, 100);
  const stereoImage = clamp(before.stereoImage + widthLift * 3.2 + reverbLift * 1.2, 0, 100);
  const harshness = clamp(before.harshness - deEssLift * 3.2 - (referenceDelta?.airDeltaDb ?? 0) * 0.4, 0, 100);
  const mud = clamp(before.mud - compLift * 1.2 - bassLift * 0.5, 0, 100);
  const reverbCleanliness = clamp(before.reverbCleanliness - reverbLift * 1.2, 0, 100);
  const aiArtifact = clamp(before.aiArtifact + deEssLift * 1.1 - reverbLift * 0.5, 0, 100);
  const peakSafety = clamp(before.peakSafety - autoMixPlan.masterPlan.maxGainPushDb * 5 + clamp(3 - reverbLift, -1, 3), 0, 100);
  const overall = round1((clarity + body + vocalFocus + lowEndTightness + stereoImage + harshness + mud + reverbCleanliness + aiArtifact + peakSafety) / 10);

  return {
    overall,
    clarity: round1(clarity),
    body: round1(body),
    vocalFocus: round1(vocalFocus),
    lowEndTightness: round1(lowEndTightness),
    stereoImage: round1(stereoImage),
    harshness: round1(harshness),
    mud: round1(mud),
    reverbCleanliness: round1(reverbCleanliness),
    aiArtifact: round1(aiArtifact),
    peakSafety: round1(peakSafety),
    notes: [
      `Mode ${autoMixPlan.mode} with ${trackPlans.length} track plan(s).`,
      "Predicted after state is conservative and can be weaked by Damage Guard if needed.",
    ],
  };
}

function buildPluginPlan(
  pluginId: string,
  name: string,
  target: PluginInsertPlan["target"],
  params: Record<string, unknown>,
  reason: string,
  confidence: number,
  strength: number,
  undoLabel: string,
): PluginInsertPlan {
  const rawParams = {
    ...params,
    planReason: reason,
    planConfidence: round2(clamp(confidence, 0, 1)),
    planStrength: round2(clamp(strength, 0, 1)),
    planUndoLabel: undoLabel,
  };
  const guarded = applyQualityGuardToPlan(pluginId, target, name, rawParams);
  const guardedReason = guarded.warnings.length > 0
    ? `${reason} Quality Guard kept this insert safe: ${guarded.warnings.slice(0, 2).join(" ")}`
    : reason;

  return {
    id: `plan-${pluginId}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId,
    name,
    target,
    params: guarded.params,
    reason: guardedReason,
    confidence: round2(clamp(confidence, 0, 1)),
    strength: round2(clamp(strength, 0, 1)),
    enabled: true,
    bypassable: true,
    undoLabel,
    routePreference: pluginId === "sweet-reverb-lite" || pluginId === "sweet-delay-lite" ? "send" : "insert",
  };
}

function applyQualityGuardToPlan(
  pluginId: string,
  target: PluginInsertPlan["target"],
  name: string,
  params: Record<string, unknown>,
): { params: Record<string, unknown>; warnings: string[] } {
  if (!isBuiltinPluginId(pluginId)) return { params, warnings: [] };
  const instance: PluginInstance = {
    id: `plan-preview-${pluginId}`,
    pluginId,
    name,
    enabled: true,
    target,
    params,
    createdAt: "plan",
    updatedAt: "plan",
  };
  const guarded = applyPluginQualityGuards(instance);
  return {
    params: guarded.warnings.length > 0
      ? {
          ...guarded.instance.params,
          qualityGuardWarnings: guarded.warnings,
        }
      : guarded.instance.params,
    warnings: guarded.warnings,
  };
}

function applyDamageGuardToTrackPlans(trackPlans: AutoPluginTrackPlan[], report: DamageGuardReport): AutoPluginTrackPlan[] {
  if (report.allowed) return trackPlans;
  const weakenTargets = new Set(report.actions.filter((action) => action.type === "weaken").map((action) => action.targetId));
  const bypassTargets = new Set(report.actions.filter((action) => action.type === "bypass").map((action) => action.targetId));
  const isPeakRisk = report.warnings.some((warning) => /peak safety/i.test(warning));
  const isHarshRisk = report.warnings.some((warning) => /harshness/i.test(warning));
  const isBodyRisk = report.warnings.some((warning) => /body/i.test(warning));
  const isMudRisk = report.warnings.some((warning) => /mud/i.test(warning));

  return trackPlans.map((trackPlan) => {
    if (!weakenTargets.has(trackPlan.trackId) && !bypassTargets.has(trackPlan.trackId)) return trackPlan;

    return {
      ...trackPlan,
      insertPlans: trackPlan.insertPlans.map((insert) =>
        weakenPluginInsert(insert, {
          bypass: bypassTargets.has(trackPlan.trackId),
          peak: isPeakRisk,
          harsh: isHarshRisk,
          body: isBodyRisk,
          mud: isMudRisk,
        }),
      ),
      sendPlans: trackPlan.sendPlans.map((send) => ({
        ...send,
        gainDb: round1(Math.min(send.gainDb, -18)),
        enabled: !isMudRisk && send.enabled,
        reason: `${send.reason} Damage Guard kept ambience conservative.`,
      })),
      notes: [
        ...trackPlan.notes,
        "Damage Guard weakened this track plan because the predicted after-state was risky.",
      ],
    };
  });
}

function weakenPluginInsert(
  insert: PluginInsertPlan,
  risk: { bypass: boolean; peak: boolean; harsh: boolean; body: boolean; mud: boolean },
): PluginInsertPlan {
  if (risk.bypass) {
    return {
      ...insert,
      enabled: false,
      reason: `${insert.reason} Bypassed by Damage Guard.`,
      params: {
        ...insert.params,
        damageGuard: "bypassed",
      },
    };
  }

  const params = { ...insert.params };
  if (insert.pluginId === "sweet-stereo-widener" || insert.pluginId === "sweet-support-widener") {
    params.width = scaleNumber(params.width, 0.55);
    params.mix = scaleNumber(params.mix, 0.7);
  }
  if (insert.pluginId === "sweet-reverb-lite" || insert.pluginId === "sweet-delay-lite") {
    params.mix = scaleNumber(params.mix, risk.mud ? 0.45 : 0.65);
    params.room = scaleNumber(params.room, 0.7);
  }
  if (insert.pluginId === "sweet-vocal-fx") {
    params.air = scaleNumber(params.air, risk.harsh ? 0.45 : 0.75);
    params.presence = scaleNumber(params.presence, risk.harsh ? 0.65 : 0.85);
    params.body = risk.body ? Math.max(readNumber(params.body, 0.42), 0.42) : params.body;
  }
  if (insert.pluginId === "sweet-bass-enhancer") {
    params.sub = scaleNumber(params.sub, risk.mud || risk.peak ? 0.55 : 0.75);
    params.mix = scaleNumber(params.mix, 0.75);
  }
  if (insert.pluginId === "sweet-low-end-translator") {
    params.amount = scaleNumber(params.amount, risk.mud || risk.peak ? 0.55 : 0.75);
    params.drive = scaleNumber(params.drive, risk.peak ? 0.6 : 0.8);
    params.mix = scaleNumber(params.mix, 0.7);
    params.outputDb = Math.min(readNumber(params.outputDb, -0.4), -0.4);
  }
  if (insert.pluginId === "sweet-tilt-eq") {
    params.tiltDb = scaleNumber(params.tiltDb, risk.harsh || risk.mud ? 0.55 : 0.75);
    params.mix = scaleNumber(params.mix, 0.8);
  }
  if (insert.pluginId === "sweet-multiband-comp") {
    params.makeupDb = 0;
    params.mix = scaleNumber(params.mix, risk.peak ? 0.65 : 0.8);
  }
  if (insert.pluginId === "sweet-parallel-comp") {
    params.mix = scaleNumber(params.mix, risk.peak || risk.mud ? 0.55 : 0.75);
    params.crush = scaleNumber(params.crush, risk.peak ? 0.7 : 0.85);
    params.outputDb = Math.min(readNumber(params.outputDb, 0), 0);
    if (risk.harsh) params.tone = Math.min(readNumber(params.tone, 0), -10);
  }
  if (insert.pluginId === "sweet-vocal-duck-eq") {
    params.maxReductionDb = scaleNumber(params.maxReductionDb, risk.harsh ? 0.75 : 0.85);
    params.mix = scaleNumber(params.mix, risk.peak || risk.mud ? 0.75 : 0.85);
  }

  return {
    ...insert,
    strength: round2(insert.strength * 0.65),
    reason: `${insert.reason} Weakened by Damage Guard.`,
    params: {
      ...params,
      planStrength: round2(readNumber(params.planStrength, insert.strength) * 0.65),
      damageGuard: "weakened",
    },
  };
}

function scaleNumber(value: unknown, scale: number) {
  return round2(readNumber(value, 0) * scale);
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
