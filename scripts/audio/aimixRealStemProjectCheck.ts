import fs from "node:fs";
import path from "node:path";
import type { PeakSummary } from "../../src/audio/analysis/PeakBuilder.ts";
import { createEmptyProject, createId, createTrack, type AudioFileRef, type Clip, type StemRole, type TrackType } from "../../src/daw/model/Project.ts";
import { validateAimixReferenceCandidate, validateSpatialAutoCandidate, type ReferenceQualityMetrics } from "../../src/daw/mix/reference/referenceQualityGate.ts";
import { measureProject, runAutoReferenceMixPipeline } from "../../src/daw/auto/autoReferenceMixPipeline.ts";
import { analyzeWavFile, type WavMetrics } from "./wavMetrics.ts";

type Args = {
  reference: string;
  stems: string;
  label: string;
  json: boolean;
  noReferenceProject: boolean;
};

const args = parseArgs(process.argv.slice(2));
const { project, peaksByFileId, stemFiles } = buildProject(args.reference, args.stems, args.label, args.noReferenceProject);
const result = runAutoReferenceMixPipeline(project, peaksByFileId, {
  autoTrySpatial: true,
  allowStemAirLayer: true,
  allowReferenceAirGlue: false,
  allowReferenceBackbone: false,
  requireReference: !args.noReferenceProject,
});
const referenceMetrics = analyzeWavFile(args.reference);
const before = measureProject(project, peaksByFileId);
const aimix = result.aimixMetrics;
const after = result.afterMetrics;
const validation = {
  aimixReference: validateAimixReferenceCandidate(toQuality(referenceMetrics), autoToQuality(aimix)),
  spatialAuto: validateSpatialAutoCandidate(toQuality(referenceMetrics), autoToQuality(aimix), autoToQuality(after)),
};

const output = {
  label: args.label,
  noReferenceProject: args.noReferenceProject,
  stemCount: stemFiles.length,
  status: result.status,
  ok: result.ok,
  reference: pickReferenceMetrics(referenceMetrics),
  before,
  aimix,
  after,
  validation,
  vocalClarityGate: result.vocalClarityGate,
  decisions: result.decisions.slice(0, 24),
};

console.log(JSON.stringify(output, null, 2));
if (!args.json) {
  console.log("");
  console.log(`AIMIX Reference: ${validation.aimixReference.passed ? "PASS" : "FAIL"} (${validation.aimixReference.warnings.length} warning(s))`);
  console.log(`Spatial Auto: ${validation.spatialAuto.passed ? "PASS" : "FAIL"} (${validation.spatialAuto.warnings.length} warning(s))`);
}

function buildProject(referencePath: string, stemsDirectory: string, label: string, noReferenceProject: boolean) {
  const project = createEmptyProject();
  project.title = `${label} real stem check`;
  const peaksByFileId: Record<string, PeakSummary> = {};
  const files: AudioFileRef[] = [];
  const clips: Clip[] = [];
  const tracks = [];

  const referenceMetrics = analyzeWavFile(referencePath);
  if (!noReferenceProject) {
    const referenceFileId = createId("file");
    const referenceTrack = createTrack("Reference Mix", 0, "reference", "reference");
    tracks.push(referenceTrack);
    files.push(audioFile(referenceFileId, referencePath, "reference", referenceMetrics));
    peaksByFileId[referenceFileId] = metricsToPeakSummary(referenceMetrics);
    clips.push(audioClip(referenceTrack.id, referenceFileId, "reference", referenceMetrics.durationSec));
  }

  const stemFiles = listStemFiles(stemsDirectory);
  stemFiles.forEach((filePath, index) => {
    const metrics = analyzeWavFile(filePath);
    const role = inferRoleFromFilename(path.basename(filePath));
    const type = roleToTrackType(role);
    const track = createTrack(path.basename(filePath, path.extname(filePath)).replace(/^\d+\s*/, ""), index + (noReferenceProject ? 0 : 1), type, role);
    const fileId = createId("file");
    tracks.push(track);
    files.push(audioFile(fileId, filePath, role, metrics));
    peaksByFileId[fileId] = metricsToPeakSummary(metrics);
    clips.push(audioClip(track.id, fileId, role, metrics.durationSec));
  });

  project.tracks = tracks;
  project.files = files;
  project.clips = clips;
  project.sampleRate = referenceMetrics.sampleRate;
  return { project, peaksByFileId, stemFiles };
}

function metricsToPeakSummary(metrics: WavMetrics): PeakSummary {
  const bins = 512;
  const peak = dbToAmp(metrics.samplePeakDb);
  const rmsShape = dbToAmp(metrics.rmsDb) * Math.SQRT2;
  const min = new Array<number>(bins).fill(-rmsShape);
  const max = new Array<number>(bins).fill(rmsShape);
  min[0] = -peak;
  max[0] = peak;
  return {
    analysisVersion: 2,
    bins,
    min,
    max,
    durationSec: metrics.durationSec,
    lrCorrelation: metrics.lrCorrelation,
    sideMidRatioDb: metrics.sideMidDb,
    spectralCentroidHz: estimateCentroid(metrics),
    spectralFlatness: 0.28,
    bandEnergyDb: expandBands(metrics),
  };
}

function expandBands(metrics: WavMetrics) {
  const bands = metrics.bandEnergyDb;
  const midPresence = averageDb([bands.mid_500_2000, bands.presence_2000_5000]);
  const airUltra = averageDb([bands.air_5000_10000, bands.ultraAir_10000_20000]);
  return {
    "20-35": bands.sub_20_60,
    "35-60": bands.sub_20_60,
    "60-120": bands.low_60_120,
    "120-250": bands.lowMid_120_250,
    "250-500": bands.body_250_500,
    "500-900": bands.mid_500_2000,
    "900-1500": bands.mid_500_2000,
    "1500-3000": midPresence,
    "3000-5000": bands.presence_2000_5000,
    "5000-9000": bands.air_5000_10000,
    "9000-12000": airUltra,
    "12000-16000": bands.ultraAir_10000_20000,
    "16000-20000": bands.ultraAir_10000_20000,
  };
}

function audioFile(id: string, filePath: string, role: StemRole, metrics: WavMetrics): AudioFileRef {
  return {
    id,
    name: path.basename(filePath),
    originalName: path.basename(filePath),
    role,
    mimeType: "audio/wav",
    durationSec: metrics.durationSec,
    sampleRate: metrics.sampleRate,
    channelCount: metrics.channels,
    byteLength: fs.statSync(filePath).size,
    storageKey: `external-readonly:${filePath}`,
    peakCacheKey: `peaks:${id}`,
    createdAt: new Date().toISOString(),
  };
}

function audioClip(trackId: string, fileId: string, role: StemRole, durationSec: number): Clip {
  return {
    id: createId("clip"),
    trackId,
    fileId,
    role,
    intentTags: [],
    actionHistory: [],
    timelineStartSec: 0,
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

function roleToTrackType(role: StemRole): TrackType {
  if (role === "reference") return "reference";
  if (role === "backingVocal") return "vocal";
  if (role === "keys") return "music";
  if (role === "loop") return role;
  return role as TrackType;
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

function autoToQuality(metrics: ReturnType<typeof measureProject>): ReferenceQualityMetrics {
  return {
    integratedLufs: metrics.integratedLufs,
    truePeakDb: metrics.truePeakDb,
    rmsDb: metrics.rmsDb,
    crestDb: metrics.crestDb,
    plrDb: metrics.truePeakDb - metrics.integratedLufs,
    sideMidDb: metrics.widthDb,
    lrCorrelation: 0.77,
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

function pickReferenceMetrics(metrics: WavMetrics) {
  return {
    integratedLufs: metrics.integratedLufsApprox,
    truePeakDb: metrics.truePeakApproxDb,
    crestDb: metrics.crestDb,
    plrDb: metrics.plrDb,
    sideMidDb: metrics.sideMidDb,
    bandEnergyDb: metrics.bandEnergyDb,
    bandSideMidDb: metrics.bandSideMidDb,
    bandCorrelation: metrics.bandCorrelation,
  };
}

function parseArgs(argv: string[]): Args {
  const parsed: Partial<Args> = { json: false, noReferenceProject: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reference") parsed.reference = argv[++index];
    else if (arg === "--stems") parsed.stems = argv[++index];
    else if (arg === "--label") parsed.label = argv[++index];
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--no-reference-project") parsed.noReferenceProject = true;
  }
  if (!parsed.reference || !parsed.stems) {
    throw new Error("Usage: aimixRealStemProjectCheck --reference <wav> --stems <dir> [--label name] [--json]");
  }
  return {
    reference: parsed.reference,
    stems: parsed.stems,
    label: parsed.label ?? "sweet_daw_real_stem",
    json: Boolean(parsed.json),
    noReferenceProject: Boolean(parsed.noReferenceProject),
  };
}

function getLeadingNumber(name: string) {
  const match = name.match(/^\s*(\d+)/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function estimateCentroid(metrics: WavMetrics) {
  const bands = [
    [45, metrics.bandEnergyDb.sub_20_60],
    [90, metrics.bandEnergyDb.low_60_120],
    [185, metrics.bandEnergyDb.lowMid_120_250],
    [375, metrics.bandEnergyDb.body_250_500],
    [1200, metrics.bandEnergyDb.mid_500_2000],
    [3500, metrics.bandEnergyDb.presence_2000_5000],
    [7500, metrics.bandEnergyDb.air_5000_10000],
    [14000, metrics.bandEnergyDb.ultraAir_10000_20000],
  ] as const;
  let weighted = 0;
  let total = 0;
  for (const [frequency, db] of bands) {
    const power = 10 ** (db / 10);
    weighted += frequency * power;
    total += power;
  }
  return total > 0 ? Math.round(weighted / total) : 1000;
}

function averageDb(values: number[]) {
  const powers = values.map((value) => 10 ** (value / 10));
  return 10 * Math.log10(Math.max(1e-12, powers.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)));
}

function dbToAmp(db: number) {
  return 10 ** (db / 20);
}
