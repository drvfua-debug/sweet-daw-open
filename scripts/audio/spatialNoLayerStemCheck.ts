import fs from "node:fs";
import path from "node:path";
import type { StemRole } from "../../src/daw/model/Project.ts";
import { validateAimixReferenceCandidate, validateSpatialAutoCandidate, type ReferenceQualityMetrics } from "../../src/daw/mix/reference/referenceQualityGate.ts";
import { analyzeWavFile, calculateWavMetrics, readWavFile, writeWavPcm16, type WavAudioData, type WavMetrics } from "./wavMetrics.ts";

type Args = {
  reference: string;
  stems: string;
  out: string;
  label: string;
};

const args = parseArgs(process.argv.slice(2));
fs.mkdirSync(args.out, { recursive: true });

const stemFiles = listStemFiles(args.stems);
if (stemFiles.length === 0) {
  throw new Error(`No WAV stems found: ${args.stems}`);
}

const referenceMetrics = analyzeWavFile(args.reference);
const panByFile = buildNoLayerPanMap(stemFiles, referenceMetrics);

const rawStemSum = mixStemFiles(stemFiles, () => 0);
const spatialStemSum = mixStemFiles(stemFiles, (filePath) => panByFile.get(filePath) ?? 0);
const matchedStemSum = matchLoudnessWithPeakGuard(rawStemSum, referenceMetrics.integratedLufsApprox, -1);
const matchedSpatialSum = matchLoudnessWithPeakGuard(spatialStemSum, referenceMetrics.integratedLufsApprox, -1);

const stemSumPath = path.join(args.out, `${args.label}_stem_sum_reference_matched.wav`);
const spatialPath = path.join(args.out, `${args.label}_spatial_v2_no_layers.wav`);
writeWavPcm16(stemSumPath, matchedStemSum.audio);
writeWavPcm16(spatialPath, matchedSpatialSum.audio);

const stemMetrics = analyzeWavFile(stemSumPath);
const spatialMetrics = analyzeWavFile(spatialPath);
const aimixReference = validateAimixReferenceCandidate(toQuality(referenceMetrics), toQuality(stemMetrics));
const spatialAuto = validateSpatialAutoCandidate(toQuality(referenceMetrics), toQuality(stemMetrics), toQuality(spatialMetrics));

const output = {
  label: args.label,
  reference: referenceMetrics,
  stemSum: stemMetrics,
  spatialV2NoLayers: spatialMetrics,
  stemGainDb: matchedStemSum.appliedGainDb,
  spatialGainDb: matchedSpatialSum.appliedGainDb,
  generatedTracks: 0,
  generatedClips: 0,
  pannedTracks: Array.from(panByFile.values()).filter((pan) => Math.abs(pan) > 0.005).length,
  pannedClips: 0,
  outputFiles: {
    stemSumPath,
    spatialPath,
  },
  validation: {
    aimixReference,
    spatialAuto,
  },
};

console.log(JSON.stringify(output, null, 2));

function buildNoLayerPanMap(stemFiles: string[], referenceMetrics: WavMetrics) {
  const panByFile = new Map<string, number>();
  const roles = stemFiles.map((filePath) => inferRoleFromFilename(path.basename(filePath)));
  const roleCounts = new Map<StemRole, number>();
  const roleIndexes = new Map<StemRole, number>();
  const referenceScale = getReferencePanScale(referenceMetrics);
  for (const role of roles) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  for (let index = 0; index < stemFiles.length; index += 1) {
    const role = roles[index]!;
    const roleIndex = roleIndexes.get(role) ?? 0;
    roleIndexes.set(role, roleIndex + 1);
    panByFile.set(stemFiles[index]!, computeNoLayerPan(role, index, roleIndex, roleCounts.get(role) ?? 1, referenceScale));
  }
  return panByFile;
}

function computeNoLayerPan(role: StemRole, trackIndex: number, roleIndex: number, roleCount: number, referenceScale: number) {
  if (role === "vocal" || role === "bass" || role === "drums" || role === "reference") return 0;
  const side = roleCount <= 1 ? (trackIndex % 2 === 0 ? -1 : 1) : roleIndex % 2 === 0 ? -1 : 1;
  const limit = getRolePanLimit(role);
  return clamp(side * limit * 0.42 * referenceScale, -limit, limit);
}

function getReferencePanScale(referenceMetrics: WavMetrics) {
  let scale = 1;
  if (referenceMetrics.lrCorrelation < 0.65) scale *= 0.72;
  else if (referenceMetrics.lrCorrelation < 0.75) scale *= 0.9;
  if (referenceMetrics.sideMidDb > -7) scale *= 0.92;
  return clamp(scale, 0.62, 1);
}

function getRolePanLimit(role: StemRole) {
  if (role === "backingVocal") return 0.22;
  if (role === "guitar") return 0.48;
  if (role === "synth") return 0.52;
  if (role === "keys") return 0.36;
  if (role === "fx") return 0.72;
  if (role === "music" || role === "loop" || role === "other") return 0.34;
  return 0.3;
}

function mixStemFiles(stemFiles: string[], panForFile: (filePath: string) => number): WavAudioData {
  let sampleRate = 0;
  let left: Float32Array | null = null;
  let right: Float32Array | null = null;

  for (const filePath of stemFiles) {
    const audio = readWavFile(filePath);
    if (sampleRate === 0) sampleRate = audio.sampleRate;
    if (audio.sampleRate !== sampleRate) throw new Error(`Sample rate mismatch: ${filePath}`);
    const frames = audio.channels[0]?.length ?? 0;
    if (!left || !right) {
      left = new Float32Array(frames);
      right = new Float32Array(frames);
    }
    if (frames !== left.length) throw new Error(`Stem length mismatch: ${filePath}`);
    const pan = panForFile(filePath);
    const gains = panGains(pan);
    const sourceLeft = audio.channels[0]!;
    const sourceRight = audio.channels[1] ?? sourceLeft;
    for (let index = 0; index < frames; index += 1) {
      left[index] += (sourceLeft[index] ?? 0) * gains.left;
      right[index] += (sourceRight[index] ?? sourceLeft[index] ?? 0) * gains.right;
    }
  }

  if (!left || !right || sampleRate === 0) throw new Error("No stems mixed.");
  const stemScale = 1 / Math.max(1, Math.sqrt(stemFiles.length) * 0.72);
  for (let index = 0; index < left.length; index += 1) {
    left[index] *= stemScale;
    right[index] *= stemScale;
  }
  return { sampleRate, channels: [left, right], durationSec: left.length / sampleRate };
}

function matchLoudnessWithPeakGuard(audio: WavAudioData, targetLufs: number, truePeakCeilingDb: number) {
  const metrics = calculateWavMetrics(audio);
  let gainDb = targetLufs - metrics.integratedLufsApprox;
  let gain = dbToAmp(gainDb);
  let peak = scanPeak(audio) * gain;
  const sampleCeiling = dbToAmp(truePeakCeilingDb - 0.2);
  if (peak > sampleCeiling) {
    const safetyGain = sampleCeiling / Math.max(1e-9, peak);
    gain *= safetyGain;
    gainDb += ampToDb(safetyGain);
    peak = scanPeak(audio) * gain;
  }

  const channels = audio.channels.map((channel) => {
    const next = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) next[index] = clamp((channel[index] ?? 0) * gain, -1, 1);
    return next;
  });
  return {
    audio: { ...audio, channels },
    appliedGainDb: Math.round(gainDb * 100) / 100,
    peakAfter: peak,
  };
}

function listStemFiles(directory: string) {
  return fs.readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(".wav") && !name.startsWith("._"))
    .sort((a, b) => getLeadingNumber(a) - getLeadingNumber(b) || a.localeCompare(b))
    .map((name) => path.join(directory, name));
}

function inferRoleFromFilename(name: string): StemRole {
  const lower = name.toLowerCase();
  if (lower.includes("backing")) return "backingVocal";
  if (lower.includes("vocal")) return "vocal";
  if (lower.includes("drum") || lower.includes("percussion")) return "drums";
  if (lower.includes("bass")) return "bass";
  if (lower.includes("guitar")) return "guitar";
  if (lower.includes("keyboard") || lower.includes("keys") || lower.includes("piano")) return "keys";
  if (lower.includes("strings") || lower.includes("brass") || lower.includes("woodwind")) return "music";
  if (lower.includes("synth")) return "synth";
  if (lower.includes("fx")) return "fx";
  return "other";
}

function toQuality(metrics: WavMetrics): ReferenceQualityMetrics {
  return {
    integratedLufs: metrics.integratedLufsApprox,
    truePeakDb: metrics.truePeakApproxDb,
    rmsDb: metrics.rmsDb,
    crestDb: metrics.crestDb,
    plrDb: metrics.plrDb,
    sideMidDb: metrics.sideMidDb,
    lrCorrelation: metrics.lrCorrelation,
    bandEnergyDb: {
      sub_20_60: metrics.bandEnergyDb.sub_20_60,
      low_60_120: metrics.bandEnergyDb.low_60_120,
      lowMid_120_250: metrics.bandEnergyDb.lowMid_120_250,
      body_250_500: metrics.bandEnergyDb.body_250_500,
      mid_500_2000: metrics.bandEnergyDb.mid_500_2000,
      presence_2000_5000: metrics.bandEnergyDb.presence_2000_5000,
      air_5000_10000: metrics.bandEnergyDb.air_5000_10000,
      gloss_9000_14000: metrics.bandEnergyDb.gloss_9000_14000,
      ultraAir_10000_20000: metrics.bandEnergyDb.ultraAir_10000_20000,
      sheen_14000_20000: metrics.bandEnergyDb.sheen_14000_20000,
    },
    bandSideMidDb: metrics.bandSideMidDb,
    bandCorrelation: metrics.bandCorrelation,
  };
}

function parseArgs(argv: string[]): Args {
  const parsed: Partial<Args> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reference") parsed.reference = argv[++index];
    else if (arg === "--stems") parsed.stems = argv[++index];
    else if (arg === "--out") parsed.out = argv[++index];
    else if (arg === "--label") parsed.label = argv[++index];
  }
  if (!parsed.reference || !parsed.stems || !parsed.out) {
    throw new Error("Usage: spatialNoLayerStemCheck --reference <wav> --stems <dir> --out <dir> [--label name]");
  }
  return {
    reference: parsed.reference,
    stems: parsed.stems,
    out: parsed.out,
    label: parsed.label ?? "sweet_daw",
  };
}

function getLeadingNumber(name: string) {
  const match = name.match(/^\s*(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function panGains(pan: number) {
  const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return { left: Math.cos(angle), right: Math.sin(angle) };
}

function scanPeak(audio: WavAudioData) {
  let peak = 0;
  for (const channel of audio.channels) {
    for (let index = 0; index < channel.length; index += 1) peak = Math.max(peak, Math.abs(channel[index] ?? 0));
  }
  return peak;
}

function dbToAmp(db: number) {
  return 10 ** (db / 20);
}

function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(1e-9, Math.abs(value)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
