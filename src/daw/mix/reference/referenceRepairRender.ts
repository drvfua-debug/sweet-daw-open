import { buildPeakSummary } from "@/audio/analysis/PeakBuilder";
import { audioBufferRegistry, type AudioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { renderProjectOffline } from "@/audio/engine/OfflineRenderer";
import { STABLE_EXPORT_SAMPLE_RATE } from "@/daw/export/ExportConsistency";
import type { MasterState, Project, StemRole, Track } from "@/daw/model/Project";
import { createTrack, roleToTrackType } from "@/daw/model/Project";
import type { ReferenceRepairDiagnosis, ReferenceRepairMetricSet } from "../mixDoctorTypes";
import { ampToDb, clamp, dbToAmp, makeStemFeatureReport, round1, round2 } from "../mixDoctorAnalysisUtils";
import { buildReferenceRepairDiagnosisFromMetrics, buildReferenceRepairMarkdown } from "./referenceRepair";

export type ReferenceRepairRenderOptions = {
  sampleRate?: 44100 | 48000;
  renderPaddingSec?: number;
  maxDurationSec?: number;
};

export type ReferenceRepairRenderReport = {
  version: "reference-repair-render-v1";
  createdAt: string;
  sampleRate: number;
  durationSec: number;
  referenceTrackIds: string[];
  stemTrackIds: string[];
  rmsMatchGainDb: number;
  peakSafeGainDb: number;
  smartPeakClip: {
    ceilingDb: number;
    beforePeakDb: number;
    afterPeakDb: number;
    appliedGainDb: number;
  };
  diagnosis: ReferenceRepairDiagnosis;
};

export type ReferenceRepairRenderArtifacts = {
  diagnosis: ReferenceRepairDiagnosis;
  report: ReferenceRepairRenderReport;
  markdown: string;
  sampleRate: number;
  stemSumChannels: Float32Array[];
  rmsMatchedStemSumChannels: Float32Array[];
  repairedStemSumChannels: Float32Array[];
  residualChannels: Float32Array[];
};

export async function renderReferenceRepairArtifacts(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: ReferenceRepairRenderOptions = {},
): Promise<ReferenceRepairRenderArtifacts> {
  const referenceTracks = project.tracks.filter(isReferenceTrack);
  const stemTracks = project.tracks.filter((track) => !isReferenceTrack(track));
  if (referenceTracks.length === 0) {
    throw new Error("Reference Repair needs at least one Reference track.");
  }
  if (stemTracks.length === 0) {
    throw new Error("Reference Repair needs at least one non-reference stem track.");
  }

  const sampleRate = options.sampleRate ?? STABLE_EXPORT_SAMPLE_RATE;
  const renderOptions = {
    sampleRate,
    renderPaddingSec: options.renderPaddingSec ?? 0.05,
    maxDurationSec: options.maxDurationSec,
  };
  const referenceProject = cloneProjectForReferenceRender(project, referenceTracks.map((track) => track.id), true);
  const stemProject = cloneProjectForReferenceRender(project, stemTracks.map((track) => track.id), false);

  const [directBuffer, stemSumBuffer] = await Promise.all([
    renderProjectOffline(referenceProject, registry, renderOptions),
    renderProjectOffline(stemProject, registry, renderOptions),
  ]);

  const direct = metricSetFromBuffer(directBuffer, "Direct WAV Reference", "reference");
  const stemSum = metricSetFromBuffer(stemSumBuffer, "Rendered Stem Sum", "music");
  const preliminary = buildReferenceRepairDiagnosisFromMetrics(direct, stemSum);
  const rmsMatchGainDb = round1(clamp(preliminary.rmsDiffDb, -6, 6));
  const peakSafeGainDb = round1(clamp(direct.peakDb - stemSum.peakDb - 0.2, -6, 6));
  const stemSumChannels = audioBufferToStereoChannels(stemSumBuffer);
  const rmsMatchedStemSumChannels = applyGainToChannels(stemSumChannels, rmsMatchGainDb);
  const residualChannels = subtractBuffersToStereoChannels(directBuffer, stemSumBuffer, rmsMatchGainDb);
  const residualBuffer = createBufferFromChannels(residualChannels, sampleRate);
  const residualMetrics = metricSetFromBuffer(residualBuffer, "Rendered Residual", "other");

  const clipCeilingDb = round1(clamp(Math.min(-3, direct.peakDb + 1), -4, -2.5));
  const clippedStemChannels = smartPeakClipChannels(stemSumChannels, clipCeilingDb, 0.72);
  const clippedMetrics = measureChannels(clippedStemChannels);
  const repairedGainDb = round1(clamp(Math.min(rmsMatchGainDb, Math.min(-1, direct.peakDb + 1) - clippedMetrics.peakDb), -6, 6));
  const repairedStemSumChannels = applyGainToChannels(clippedStemChannels, repairedGainDb);
  const repairedMetrics = measureChannels(repairedStemSumChannels);

  const diagnosis = buildReferenceRepairDiagnosisFromMetrics(direct, stemSum, {
    residual: {
      estimated: false,
      gainMatchDb: rmsMatchGainDb,
      residualRmsDb: residualMetrics.rmsDb,
      residualPeakDb: residualMetrics.peakDb,
      residualToDirectDb: round1(residualMetrics.rmsDb - direct.rmsDb),
      residualSideMidRatioDb: residualMetrics.sideMidRatioDb,
    },
  });
  const report: ReferenceRepairRenderReport = {
    version: "reference-repair-render-v1",
    createdAt: new Date().toISOString(),
    sampleRate,
    durationSec: Math.max(directBuffer.duration, stemSumBuffer.duration),
    referenceTrackIds: referenceTracks.map((track) => track.id),
    stemTrackIds: stemTracks.map((track) => track.id),
    rmsMatchGainDb,
    peakSafeGainDb,
    smartPeakClip: {
      ceilingDb: clipCeilingDb,
      beforePeakDb: stemSum.peakDb,
      afterPeakDb: repairedMetrics.peakDb,
      appliedGainDb: repairedGainDb,
    },
    diagnosis,
  };

  return {
    diagnosis,
    report,
    markdown: appendRenderedRepairMarkdown(buildReferenceRepairMarkdown(diagnosis), report),
    sampleRate,
    stemSumChannels,
    rmsMatchedStemSumChannels,
    repairedStemSumChannels,
    residualChannels,
  };
}

function isReferenceTrack(track: Track) {
  return track.role === "reference" || track.type === "reference";
}

function cloneProjectForReferenceRender(project: Project, trackIds: string[], renderReferenceAsMusic: boolean): Project {
  const trackSet = new Set(trackIds);
  const tracks = project.tracks
    .filter((track) => trackSet.has(track.id))
    .map((track) => ({
      ...track,
      role: renderReferenceAsMusic && isReferenceTrack(track) ? "music" as StemRole : track.role,
      type: renderReferenceAsMusic && isReferenceTrack(track) ? "music" as Track["type"] : track.type,
      mute: false,
      solo: false,
    }));
  const renderTrackSet = new Set(tracks.map((track) => track.id));

  return {
    ...project,
    tracks,
    clips: project.clips.filter((clip) => renderTrackSet.has(clip.trackId)),
    master: createNeutralMaster(project.master),
  };
}

function createNeutralMaster(master: MasterState): MasterState {
  return {
    ...master,
    gainDb: 0,
    eq: {
      ...master.eq,
      enabled: false,
    },
    compressor: {
      ...master.compressor,
      enabled: false,
      makeupGainDb: 0,
    },
    limiterEnabled: false,
    vocalImageLayer: {
      enabled: false,
    },
    insertChain: [],
    exportNormalizePeak: false,
    exportPeakTargetDb: -1,
  };
}

function metricSetFromBuffer(buffer: AudioBuffer, label: string, role: StemRole): ReferenceRepairMetricSet {
  const summary = buildPeakSummary(buffer, 4096);
  const track = createTrack(label, 0, roleToTrackType(role), role);
  const report = makeStemFeatureReport(track, summary, 0);
  return {
    label,
    rmsDb: report.rmsDb,
    peakDb: report.peakDb,
    truePeakApproxDb: report.truePeakApproxDb,
    crestFactorDb: report.crestFactorDb,
    integratedLufsApprox: report.integratedLufsApprox,
    lrCorrelation: report.lrCorrelation,
    sideMidRatioDb: report.sideMidRatioDb,
    bandEnergyDb: report.bandEnergyDb,
  };
}

function audioBufferToStereoChannels(buffer: AudioBuffer) {
  const length = buffer.length;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const sourceLeft = buffer.getChannelData(0);
  const sourceRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
  left.set(sourceLeft);
  right.set(sourceRight);
  return [left, right];
}

function subtractBuffersToStereoChannels(direct: AudioBuffer, stem: AudioBuffer, stemGainDb: number) {
  const length = Math.max(direct.length, stem.length);
  const gain = dbToAmp(stemGainDb);
  const directLeft = direct.getChannelData(0);
  const directRight = direct.numberOfChannels > 1 ? direct.getChannelData(1) : directLeft;
  const stemLeft = stem.getChannelData(0);
  const stemRight = stem.numberOfChannels > 1 ? stem.getChannelData(1) : stemLeft;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    left[index] = (directLeft[index] ?? 0) - (stemLeft[index] ?? 0) * gain;
    right[index] = (directRight[index] ?? directLeft[index] ?? 0) - (stemRight[index] ?? stemLeft[index] ?? 0) * gain;
  }
  return [left, right];
}

function createBufferFromChannels(channels: Float32Array[], sampleRate: number) {
  const length = Math.max(1, Math.max(...channels.map((channel) => channel.length)));
  const OfflineAudioContextCtor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  if (!OfflineAudioContextCtor) {
    throw new Error("This browser does not support OfflineAudioContext.");
  }
  const context = new OfflineAudioContextCtor(channels.length, length, sampleRate);
  const buffer = context.createBuffer(channels.length, length, sampleRate);
  channels.forEach((channel, index) => {
    const copy = new Float32Array(channel);
    buffer.copyToChannel(copy, index);
  });
  return buffer;
}

function applyGainToChannels(channels: Float32Array[], gainDb: number) {
  const gain = dbToAmp(gainDb);
  return channels.map((channel) => {
    const next = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      next[index] = (channel[index] ?? 0) * gain;
    }
    return next;
  });
}

function smartPeakClipChannels(channels: Float32Array[], ceilingDb: number, softness: number) {
  const ceiling = dbToAmp(ceilingDb);
  const curve = clamp(softness, 0.05, 1);
  return channels.map((channel) => {
    const next = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      const value = channel[index] ?? 0;
      const abs = Math.abs(value);
      if (abs <= ceiling) {
        next[index] = value;
        continue;
      }
      const normalizedExcess = (abs - ceiling) / Math.max(0.000001, 1 - ceiling);
      const softened = ceiling + Math.tanh(normalizedExcess * (1.2 + curve * 2.8)) * (1 - ceiling) * 0.24;
      next[index] = Math.sign(value) * Math.min(ceiling, softened);
    }
    return next;
  });
}

function measureChannels(channels: Float32Array[]) {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  const left = channels[0] ?? new Float32Array(0);
  const right = channels[1] ?? left;
  let midSquares = 0;
  let sideSquares = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  let cross = 0;
  const length = Math.max(left.length, right.length);
  const step = Math.max(1, Math.floor(length / 220000));
  let stereoCount = 0;
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSquares += l * l + r * r;
    count += 2;
    if (index % step === 0) {
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      midSquares += mid * mid;
      sideSquares += side * side;
      leftSquares += l * l;
      rightSquares += r * r;
      cross += l * r;
      stereoCount += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  return {
    peakDb: round1(ampToDb(peak)),
    rmsDb: round1(ampToDb(rms)),
    sideMidRatioDb: round1(ampToDb(Math.sqrt(sideSquares / Math.max(1, stereoCount))) - ampToDb(Math.sqrt(midSquares / Math.max(1, stereoCount)))),
    lrCorrelation: round2(clamp(cross / Math.max(1e-12, Math.sqrt(leftSquares * rightSquares)), -1, 1)),
  };
}

function appendRenderedRepairMarkdown(markdown: string, report: ReferenceRepairRenderReport) {
  return `${markdown}
## Rendered Repair Artifacts
- Render sample rate: ${report.sampleRate} Hz
- Render duration: ${report.durationSec.toFixed(2)} sec
- RMS match gain: ${formatSigned(report.rmsMatchGainDb)} dB
- Peak-safe gain: ${formatSigned(report.peakSafeGainDb)} dB
- Smart Peak Clip ceiling: ${report.smartPeakClip.ceilingDb.toFixed(1)} dBFS
- Repaired Stem Sum peak: ${report.smartPeakClip.afterPeakDb.toFixed(1)} dBFS

Generated files:
1. stem_sum.wav
2. rms_matched_stem_sum.wav
3. residual.wav
4. repaired_stem_sum.wav
5. reference_repair_report.json

`;
}

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
