import {
  type EQBand,
  type Clip,
  type ParametricEQState,
  type Project,
  type StemRole,
  type Track,
} from "../model/Project";
import { DEFAULT_AIMIX_SPATIAL_OPTIONS, type AimixSpatialApplyContext, type AimixSpatialMode, type AimixSpatialOptions, type AimixSpatialReport, type SpatialPanScene } from "./aimixSpatialTypes";
import { applySpatialPanDesignToProject, restoreClipSpatialPan, restoreTrackSpatialPan } from "./spatialPanDesign";

type ApplyContext = {
  options: AimixSpatialOptions;
  actions: string[];
  warnings: string[];
};

export function applyAimixSpatialToProject(
  project: Project,
  rawOptions: Partial<AimixSpatialOptions> = {},
  applyContext: AimixSpatialApplyContext = {},
): { project: Project; report: AimixSpatialReport } {
  const options = normalizeAimixSpatialOptions(rawOptions);
  const context: ApplyContext = { options, actions: [], warnings: [] };
  const removed = options.removePreviousAimixLayers
    ? removeAimixSpatialLayersFromProject(project, options.resetPreviousSpatialPan)
    : { project, removedTracks: 0, removedClips: 0, restoredPannedTracks: 0, restoredPannedClips: 0 };

  const baseProject = removed.project;
  const cleanEnabled = options.mode === "clean" || options.mode === "clean-spatial" || options.mode === "full";
  const spatialEnabled = options.mode === "spatial" || options.mode === "clean-spatial" || options.mode === "full";
  const targetTracks = getAimixSpatialTargetTracks(baseProject);
  const targetTrackIds = new Set(targetTracks.map((track) => track.id));
  const tracksAfterClean = cleanEnabled
    ? baseProject.tracks.map((track) =>
        targetTrackIds.has(track.id) ? applyCleanAndCenterProtect(track, context) : { ...track },
      )
    : baseProject.tracks.map((track) => ({ ...track }));

  let nextProject: Project = {
    ...baseProject,
    tracks: tracksAfterClean,
    analysis: {
      ...baseProject.analysis,
      notes: [
        ...baseProject.analysis.notes,
        `AIMIX Spatial ${options.mode} applied at ${new Date().toISOString()}`,
      ].slice(-80),
    },
    updatedAt: new Date().toISOString(),
  };

  const panEnabled = options.panMode !== "off";
  const panDesign = panEnabled
    ? applySpatialPanDesignToProject(nextProject, options, applyContext, new Date().toISOString())
    : {
        project: nextProject,
        pannedTracks: 0,
        pannedClips: 0,
        restoredPannedTracks: 0,
        restoredPannedClips: 0,
        actions: [],
        warnings: [],
      };
  nextProject = panDesign.project;
  context.actions.push(...panDesign.actions);
  context.warnings.push(...panDesign.warnings);

  if (spatialEnabled) {
    context.actions.push("Spatial v2: adjusted existing track/clip placement only; no audio layers were created.");
  }

  const totalPannedClips = panDesign.pannedClips;
  if (panEnabled) {
    context.actions.push(`Pan Mode: ${options.panMode}`);
    context.actions.push(`Track Pan: ${panDesign.pannedTracks} tracks`);
    context.actions.push(`Clip Pan: ${totalPannedClips} clips`);
    if (panDesign.pannedTracks === 0 && totalPannedClips === 0) {
      context.warnings.push("Pan Mix: no eligible targets. Check clips, roles, and pan mode.");
    }
  }

  if (options.gainMatch && spatialEnabled) {
    context.actions.push("Gain Match: no duplicate audio was added; master gain was not pushed.");
  }

  if (options.monoSafe) {
    context.actions.push("Mono Safe: low-end placement is protected and kick/bass remain center.");
  }

  const spatialValidation = buildSpatialValidationActions(baseProject, nextProject, applyContext, options);
  context.actions.push(...spatialValidation.actions);
  context.warnings.push(...spatialValidation.warnings);

  return {
    project: nextProject,
    report: {
      ok: true,
      mode: options.mode,
      cleanedTracks: cleanEnabled ? targetTracks.length : 0,
      generatedTracks: 0,
      generatedClips: 0,
      removedTracks: removed.removedTracks,
      removedClips: removed.removedClips,
      pannedTracks: panDesign.pannedTracks,
      pannedClips: totalPannedClips,
      restoredPannedTracks: removed.restoredPannedTracks + panDesign.restoredPannedTracks,
      restoredPannedClips: removed.restoredPannedClips + panDesign.restoredPannedClips,
      warnings: context.warnings,
      actions: context.actions,
    },
  };
}

export function removeAimixSpatialLayersFromProject(project: Project, resetPreviousSpatialPan = true) {
  const generatedTrackIds = new Set(
    project.tracks.filter((track) => track.aimixSpatial?.isAimixSpatialGenerated).map((track) => track.id),
  );
  const removedTracks = generatedTrackIds.size;
  const removedClips = project.clips.filter((clip) => generatedTrackIds.has(clip.trackId) || clip.aimixSpatial?.isAimixSpatialGenerated).length;
  let restoredPannedTracks = 0;
  let restoredPannedClips = 0;

  const tracks = project.tracks
    .filter((track) => !generatedTrackIds.has(track.id))
    .map((track) => {
      const restored = restoreTrackSpatialPan(track, { resetPreviousSpatialPan });
      if (restored.restored) restoredPannedTracks += 1;
      return restored.track;
    });

  const clips = project.clips
    .filter((clip) => !generatedTrackIds.has(clip.trackId) && !clip.aimixSpatial?.isAimixSpatialGenerated)
    .map((clip) => {
      const restored = restoreClipSpatialPan(clip, { resetPreviousSpatialPan });
      if (restored.restored) restoredPannedClips += 1;
      return restored.clip;
    });

  return {
    project: {
      ...project,
      tracks,
      clips,
      updatedAt: new Date().toISOString(),
    },
    removedTracks,
    removedClips,
    restoredPannedTracks,
    restoredPannedClips,
  };
}

export function normalizeAimixSpatialOptions(raw: Partial<AimixSpatialOptions> = {}): AimixSpatialOptions {
  const mode: AimixSpatialMode =
    raw.mode === "clean" || raw.mode === "spatial" || raw.mode === "clean-spatial" || raw.mode === "full"
      ? raw.mode
      : DEFAULT_AIMIX_SPATIAL_OPTIONS.mode;
  const panMode = raw.panMode === "off" || raw.panMode === "track" || raw.panMode === "clip" || raw.panMode === "track-clip" || raw.panMode === "reference-plus"
    ? raw.panMode
    : DEFAULT_AIMIX_SPATIAL_OPTIONS.panMode;
  const panScene: SpatialPanScene =
    raw.panScene === "pro-balanced" ||
    raw.panScene === "wide-hook" ||
    raw.panScene === "vocal-focus" ||
    raw.panScene === "cinematic-wide" ||
    raw.panScene === "manual"
      ? raw.panScene
      : DEFAULT_AIMIX_SPATIAL_OPTIONS.panScene;

  return {
    ...DEFAULT_AIMIX_SPATIAL_OPTIONS,
    ...raw,
    mode,
    panMode,
    panScene,
    clarity: clampPercent(raw.clarity ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.clarity),
    smooth: clampPercent(raw.smooth ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.smooth),
    space: clampPercent(raw.space ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.space),
    depth: clampPercent(raw.depth ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.depth),
    motion: clampPercent(raw.motion ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.motion),
    centerProtect: clampPercent(raw.centerProtect ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.centerProtect),
    panAmount: clampPercent(raw.panAmount ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.panAmount),
    trackPanAmount: clampPercent(raw.trackPanAmount ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.trackPanAmount),
    clipPanAmount: clampPercent(raw.clipPanAmount ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.clipPanAmount),
    gainMatch: raw.gainMatch ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.gainMatch,
    monoSafe: raw.monoSafe ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.monoSafe,
    editableLayers: raw.editableLayers ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.editableLayers,
    removePreviousAimixLayers: raw.removePreviousAimixLayers ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.removePreviousAimixLayers,
    referencePanFollow: raw.referencePanFollow ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.referencePanFollow,
    protectLeadVocalPan: raw.protectLeadVocalPan ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.protectLeadVocalPan,
    protectLowEndPan: raw.protectLowEndPan ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.protectLowEndPan,
    resetPreviousSpatialPan: raw.resetPreviousSpatialPan ?? DEFAULT_AIMIX_SPATIAL_OPTIONS.resetPreviousSpatialPan,
  };
}

function getAimixSpatialTargetTracks(project: Project) {
  const clipTrackIds = new Set(project.clips.map((clip) => clip.trackId));
  return project.tracks.filter((track) =>
    !track.mute &&
    track.role !== "reference" &&
    !track.aimixSpatial?.isAimixSpatialGenerated &&
    clipTrackIds.has(track.id),
  );
}

function applyCleanAndCenterProtect(track: Track, context: ApplyContext): Track {
  if (track.role === "reference" || track.aimixSpatial?.isAimixSpatialGenerated) return track;

  const clarity = context.options.clarity / 100;
  const smooth = context.options.smooth / 100;
  const smoothCutScale = context.options.mode === "clean-spatial" ? 0.35 : 0.75;
  const nextEq = cloneEq(track.eq);
  nextEq.enabled = true;

  setHighpass(nextEq, getCleanHighpass(track.role, context.options.monoSafe));
  if (!isFoundationRole(track.role)) {
    setPeaking(nextEq, 320, -round1(0.35 + clarity * 0.55), 0.85);
    setPeaking(nextEq, 760, -round1(0.2 + clarity * 0.45), 0.9);
  }
  if (track.role === "vocal" || track.role === "backingVocal") {
    setPeaking(nextEq, 300, -round1(0.2 + clarity * 0.35), 0.8);
    setPeaking(nextEq, 780, -round1(0.15 + clarity * 0.3), 0.9);
    setPeaking(nextEq, 6800, -round1(0.25 + smooth * 0.65), 2.4);
    setPeaking(nextEq, 9500, -round1(0.1 + smooth * 0.35), 1.6);
  } else if (!isFoundationRole(track.role)) {
    setPeaking(nextEq, 3200, -round1((0.06 + smooth * 0.18) * smoothCutScale), 1.2);
    setPeaking(nextEq, 9000, -round1((0.03 + smooth * 0.14) * smoothCutScale), 1.4);
  }

  const pan = track.pan;
  const gainDb = getProtectedGain(track.role, track.gainDb);
  context.actions.push(`Clean: ${track.name} (${track.role}) - no mid boost, light mud/harshness control only`);

  return {
    ...track,
    pan,
    gainDb,
    eq: nextEq,
  };
}

function cloneEq(eq: ParametricEQState): ParametricEQState {
  return {
    ...eq,
    bands: eq.bands.map((band) => ({ ...band })),
  };
}

function setHighpass(eq: ParametricEQState, frequency: number) {
  const band = eq.bands.find((entry) => entry.type === "highpass") ?? eq.bands[0];
  if (!band) return;
  band.enabled = true;
  band.frequency = frequency;
  band.q = 0.7;
}

function setPeaking(eq: ParametricEQState, frequency: number, gainDb: number, q: number) {
  const band = findReusablePeakingBand(eq.bands, frequency);
  if (!band) return;
  band.type = "peaking";
  band.enabled = true;
  band.frequency = frequency;
  band.gainDb = clamp(round1(gainDb), -4, 2);
  band.q = q;
}

function findReusablePeakingBand(bands: EQBand[], frequency: number) {
  return bands.find((band) => band.type === "peaking" && Math.abs(band.frequency - frequency) < 260) ??
    bands.find((band) => band.type === "peaking" && Math.abs(band.gainDb) < 0.05) ??
    bands.find((band) => band.type === "peaking");
}

function getCleanHighpass(role: StemRole, monoSafe: boolean) {
  if (role === "bass" || role === "drums") return monoSafe ? 25 : 20;
  if (role === "vocal" || role === "backingVocal") return 70;
  if (role === "fx") return 120;
  return 35;
}

function getProtectedGain(role: StemRole, currentGainDb: number) {
  if (role === "fx") return round1(currentGainDb - 0.1);
  return round1(currentGainDb);
}

function isFoundationRole(role: StemRole) {
  return role === "vocal" || role === "bass" || role === "drums" || role === "reference";
}

function buildSpatialValidationActions(
  before: Project,
  after: Project,
  applyContext: AimixSpatialApplyContext,
  options: AimixSpatialOptions,
) {
  const beforeSnapshot = measureSpatialSnapshot(before, applyContext.peaksByFileId);
  const afterSnapshot = measureSpatialSnapshot(after, applyContext.peaksByFileId);
  if (!beforeSnapshot || !afterSnapshot) {
    return {
      actions: ["Spatial Validation: peak cache unavailable; rendered audio is unchanged until export/playback."],
      warnings: [],
    };
  }

  const reference = applyContext.referenceProfile;
  const referenceSideMid = Number.isFinite(reference?.sideMidRatioDb) ? Number(reference?.sideMidRatioDb) : null;
  const referenceCorrelation = Number.isFinite(reference?.lrCorrelation) ? Number(reference?.lrCorrelation) : null;
  const referenceLufs = Number.isFinite(reference?.integratedLufsApprox) ? Number(reference?.integratedLufsApprox) : null;
  const actions = [
    `Spatial Validation: Pan Scene ${options.panScene} / mode ${options.panMode}`,
    `Spatial Validation: Side/Mid ${formatDb(beforeSnapshot.sideMidDb)} -> ${formatDb(afterSnapshot.sideMidDb)}${referenceSideMid == null ? "" : ` / ref ${formatDb(referenceSideMid)}`}`,
    `Spatial Validation: Correlation ${beforeSnapshot.correlation.toFixed(2)} -> ${afterSnapshot.correlation.toFixed(2)}${referenceCorrelation == null ? "" : ` / ref ${referenceCorrelation.toFixed(2)}`}`,
    `Spatial Validation: LUFS proxy ${formatDb(beforeSnapshot.lufsProxyDb)} -> ${formatDb(afterSnapshot.lufsProxyDb)}${referenceLufs == null ? "" : ` / ref ${formatDb(referenceLufs)}`}`,
  ];
  const warnings: string[] = [];
  if (afterSnapshot.sideMidDb < beforeSnapshot.sideMidDb - 0.6) {
    warnings.push("Spatial Validation: Side/Mid fell by more than 0.6dB. Reduce Center Protect or increase Space.");
  }
  if (afterSnapshot.lufsProxyDb < beforeSnapshot.lufsProxyDb - 0.8) {
    warnings.push("Spatial Validation: output may be quieter than before. Keep Gain Match on and review track/clip pan amount.");
  }
  if (afterSnapshot.correlation < 0.65) {
    warnings.push("Spatial Validation: correlation fell below 0.65. This is too wide for Spatial Auto.");
  }
  return { actions, warnings };
}

function measureSpatialSnapshot(
  project: Project,
  peaksByFileId: AimixSpatialApplyContext["peaksByFileId"],
) {
  if (!peaksByFileId) return null;
  const sideMidValues: number[] = [];
  const correlationValues: number[] = [];
  const loudnessValues: number[] = [];

  for (const clip of project.clips) {
    const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
    const summary = peaksByFileId[clip.fileId];
    if (!track || !summary || track.mute || track.role === "reference") continue;
    const gainDb = (track.gainDb ?? 0) + (clip.gainDb ?? 0) + (project.master.gainDb ?? 0);
    const panBoostDb = estimatePanSideBoost(track, clip);
    sideMidValues.push((summary.sideMidRatioDb ?? -24) + panBoostDb);
    correlationValues.push(clamp((summary.lrCorrelation ?? 1) - panBoostDb * 0.055, -1, 1));
    loudnessValues.push(estimateSpatialClipLoudness(summary.bandEnergyDb, gainDb));
  }

  if (loudnessValues.length === 0) return null;
  return {
    sideMidDb: round1(averageDb(sideMidValues)),
    correlation: round2(correlationValues.reduce((sum, value) => sum + value, 0) / correlationValues.length),
    lufsProxyDb: round1(averageDb(loudnessValues) - 10),
  };
}

function estimatePanSideBoost(track: Track, clip: Clip) {
  const trackPan = Math.abs(Number.isFinite(track.pan) ? track.pan : 0);
  const clipPanPoints = clip.panAutomation?.enabled ? clip.panAutomation.anchorPoints ?? [] : [];
  const clipPan = clipPanPoints.length > 0
    ? clipPanPoints.reduce((sum, point) => sum + Math.abs(point.pan), 0) / clipPanPoints.length
    : 0;
  return clamp(trackPan * 4.2 + clipPan * 2.4, 0, 4.5);
}

function estimateSpatialClipLoudness(bands: Record<string, number> | undefined, gainDb: number) {
  if (!bands) return -60 + gainDb;
  return averageDb(["120-250", "250-500", "500-900", "900-1500", "1500-3000", "3000-5000", "5000-9000", "9000-12000"].map((id) => bands[id] ?? -60)) + gainDb;
}

function averageDb(values: number[]) {
  if (values.length === 0) return -60;
  const linear = values.reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length;
  return 10 * Math.log10(Math.max(1e-9, linear));
}

function formatDb(value: number) {
  return `${value.toFixed(1)}dB`;
}

function clampPercent(value: number) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 100);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
