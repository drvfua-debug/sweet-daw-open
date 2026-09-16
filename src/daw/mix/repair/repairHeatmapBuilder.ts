import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Clip, Project, StemRole } from "@/daw/model/Project";
import type {
  ArtifactProblem,
  MixDoctorBandId,
  MixDoctorMode,
  RepairHeatmapCell,
  RepairVisualSummary,
  SpectralEditOp,
  SpectralEditOperation,
  StemContaminationReport,
  StemFeatureReport,
  StemPurityReport,
} from "../mixDoctorTypes";

export type BuildRepairHeatmapInput = {
  project?: Project;
  problems: ArtifactProblem[];
  featureReports?: StemFeatureReport[];
  contaminationReports?: StemContaminationReport[];
  stemPurityReports?: StemPurityReport[];
  peaksByFileId?: Record<string, PeakSummary>;
  ops?: SpectralEditOp[];
  mode: MixDoctorMode;
  detail?: "overview" | "detail";
};

export type BuildRepairHeatmapResult = {
  cells: RepairHeatmapCell[];
  beforeSummary: RepairVisualSummary;
  afterPreviewSummary: RepairVisualSummary;
  notes: string[];
};

type RepairBand = {
  id: MixDoctorBandId;
  low: number;
  high: number;
};

type RepairTimeRange = {
  start: number;
  end: number;
  confidenceScale: number;
  confidenceBoost: number;
  reasonSuffix: string;
};

const REPAIR_BANDS: RepairBand[] = [
  { id: "20-35", low: 20, high: 35 },
  { id: "35-60", low: 35, high: 60 },
  { id: "60-120", low: 60, high: 120 },
  { id: "120-250", low: 120, high: 250 },
  { id: "250-500", low: 250, high: 500 },
  { id: "500-900", low: 500, high: 900 },
  { id: "900-1500", low: 900, high: 1500 },
  { id: "1500-3000", low: 1500, high: 3000 },
  { id: "3000-5000", low: 3000, high: 5000 },
  { id: "5000-9000", low: 5000, high: 9000 },
  { id: "9000-12000", low: 9000, high: 12000 },
  { id: "12000-16000", low: 12000, high: 16000 },
  { id: "16000-20000", low: 16000, high: 20000 },
];

const OPERATION_EFFICIENCY: Record<SpectralEditOperation, number> = {
  reduce: 0.45,
  mute: 0.3,
  smooth: 0.35,
  deess: 0.56,
  deharsh: 0.52,
  derumble: 0.62,
  declick: 0.5,
  protect: 0,
  restore: 0,
};

export function buildRepairHeatmap(input: BuildRepairHeatmapInput): BuildRepairHeatmapResult {
  const modeLimit = input.mode === "strong" ? 24 : input.mode === "balanced" ? 18 : 12;
  const problemCells = input.problems.flatMap((problem, index) => problemToCells(problem, index, input));
  const opCells = input.ops?.map((op, index) => opToCell(op, index)) ?? [];
  const byId = new Map<string, RepairHeatmapCell>();

  for (const cell of [...problemCells, ...opCells]) {
    const existing = byId.get(cell.id);
    if (!existing || cell.beforeScore > existing.beforeScore) byId.set(cell.id, cell);
  }

  const maxCells = input.detail === "detail" ? 3200 : 1200;
  const cells = Array.from(byId.values())
    .sort((a, b) => b.beforeScore - a.beforeScore || a.startTime - b.startTime)
    .slice(0, Math.min(maxCells, Math.max(modeLimit, problemCells.length + opCells.length)));

  const beforeSummary = summarizeRepairCells(cells, "before");
  const afterPreviewSummary = summarizeRepairCells(cells, "after");
  const notes = [
    `${beforeSummary.hotCells} hot repair area(s) mapped over time and log-frequency.`,
    "After/Difference are predicted until a rendered preview is generated.",
    "Apply Selected Regions stores fixed non-destructive repair regions used by export.",
  ];

  return { cells, beforeSummary, afterPreviewSummary, notes };
}

export function summarizeRepairCells(cells: RepairHeatmapCell[], phase: "before" | "after" = "before"): RepairVisualSummary {
  const scores = cells.map((cell) => (phase === "after" ? cell.afterScore ?? cell.beforeScore : cell.beforeScore));
  const total = scores.length;
  const maxScore = total > 0 ? Math.max(...scores) : 0;
  const averageScore = total > 0 ? scores.reduce((sum, score) => sum + score, 0) / total : 0;
  return {
    totalCells: total,
    hotCells: scores.filter((score) => score >= 55).length,
    maxScore: round1(maxScore),
    averageScore: round1(averageScore),
    improvedCells: cells.filter((cell) => (cell.differenceScore ?? 0) > 2).length,
    worsenedCells: cells.filter((cell) => (cell.differenceScore ?? 0) < -1).length,
    protectedCells: cells.filter((cell) => cell.protectMain || cell.suggestedOperation === "protect").length,
    notes: total > 0 ? [`Max score ${round1(maxScore)}`, `Average score ${round1(averageScore)}`] : ["No repair regions available."],
  };
}

export function cellToSpectralEditOp(
  cell: RepairHeatmapCell,
  createdBy: SpectralEditOp["createdBy"] = "manual",
): SpectralEditOp {
  return {
    id: `spectral-op-${cell.id}-${Date.now().toString(36)}`,
    stemId: cell.stemId || cell.trackId,
    role: cell.role,
    startTime: round2(cell.startTime),
    endTime: round2(Math.max(cell.startTime + 0.02, cell.endTime)),
    lowFreq: Math.round(cell.lowFreq),
    highFreq: Math.round(cell.highFreq),
    operation: cell.protectMain ? "protect" : cell.suggestedOperation,
    gainDb: cell.protectMain ? undefined : clamp(cell.suggestedGainDb, -6, 0),
    strength: clamp(cell.strength, 0, 1),
    softness: clamp(cell.softness, 0, 1),
    protectMain: cell.protectMain,
    createdBy,
    confidence: clamp(cell.confidence, 0, 1),
    reason: cell.reason,
    createdAt: new Date().toISOString(),
  };
}

export function fallbackRepairSummaryFromOps(ops: SpectralEditOp[]): RepairVisualSummary {
  const cells = ops.map((op, index) => opToCell(op, index));
  return summarizeRepairCells(cells);
}

function problemToCells(problem: ArtifactProblem, index: number, input: BuildRepairHeatmapInput): RepairHeatmapCell[] {
  const range = problemRange(problem);
  const trackId = problem.stemId === "mix" ? "mix" : problem.stemId;
  const track = input.project?.tracks.find((candidate) => candidate.id === trackId);
  const fileIds = input.project?.clips.filter((clip) => clip.trackId === trackId).map((clip) => clip.fileId) ?? [];
  const energyBoost = estimateEnergyBoost(fileIds, input.peaksByFileId, range.low, range.high);
  const overlapBands = REPAIR_BANDS.filter((band) => band.high > range.low && band.low < range.high);
  const bands = overlapBands.length > 0 ? overlapBands : [nearestBand(range.low, range.high)];
  const timeRange = resolveProblemTimeRange(problem, input, defaultDurationForProblem(problem));
  const contamination = input.contaminationReports?.find((report) => report.trackId === trackId || report.stemId === problem.stemId);
  const purity = input.stemPurityReports?.find((report) => report.trackId === trackId || report.stemId === problem.stemId);
  const feature = input.featureReports?.find((report) => report.trackId === trackId || report.stemId === problem.stemId);

  return bands.map((band, bandIndex) => {
    const scores = scoreProblem(problem, band, contamination, purity, feature, energyBoost);
    const beforeScore = calculateBeforeScore(scores);
    const suggestedOperation = suggestOperation(problem, band, track?.role ?? problem.role);
    const strength = suggestStrength(problem.score, input.mode, suggestedOperation);
    const suggestedGainDb = suggestGainDb(suggestedOperation, beforeScore);
    const protectMain = shouldProtect(problem.role, band, suggestedOperation);
    const afterScore = predictAfterScore(beforeScore, protectMain ? "protect" : suggestedOperation, strength);
    return {
      id: `repair-cell-${problem.id}-${band.id}-${bandIndex}-${index}`,
      trackId,
      stemId: problem.stemId === "mix" ? "mix" : problem.stemId,
      role: problem.role,
      startTime: round2(timeRange.start),
      endTime: round2(timeRange.end),
      lowFreq: band.low,
      highFreq: band.high,
      artifactScore: scores.artifactScore,
      harshnessScore: scores.harshnessScore,
      mudScore: scores.mudScore,
      rumbleScore: scores.rumbleScore,
      metallicScore: scores.metallicScore,
      vocalBleedScore: scores.vocalBleedScore,
      roomWashScore: scores.roomWashScore,
      beforeScore,
      afterScore,
      differenceScore: round1(beforeScore - afterScore),
      confidence: clamp((0.35 + beforeScore / 180 + (problem.score >= 58 ? 0.18 : 0) + (contamination ? 0.12 : 0) + timeRange.confidenceBoost) * timeRange.confidenceScale, 0, 0.96),
      suggestedOperation: protectMain ? "protect" : suggestedOperation,
      suggestedGainDb,
      strength,
      softness: suggestedSoftness(suggestedOperation),
      protectMain,
      reason: `${problem.reason || problem.suggestedFix} (${band.low}-${band.high}Hz)${timeRange.reasonSuffix}`,
    };
  });
}

function resolveProblemTimeRange(problem: ArtifactProblem, input: BuildRepairHeatmapInput, fallbackDurationSec: number): RepairTimeRange {
  if (typeof problem.startTime === "number" || typeof problem.endTime === "number") {
    const start = clamp(problem.startTime ?? 0, 0, 60 * 60);
    const end = clamp(problem.endTime ?? Math.max(start + fallbackDurationSec, start + 0.25), start + 0.02, 60 * 60);
    return { start, end, confidenceScale: 1, confidenceBoost: 0, reasonSuffix: "" };
  }

  const clips = clipsForProblem(input.project, problem);
  const peakWindow = estimatePeakWindowFromClips(clips, input.peaksByFileId, fallbackDurationSec);
  if (peakWindow) {
    return {
      start: peakWindow.start,
      end: peakWindow.end,
      confidenceScale: 0.82,
      confidenceBoost: 0.1,
      reasonSuffix: " / time range estimated from peak cache",
    };
  }

  if (clips.length > 0) {
    const start = Math.min(...clips.map((clip) => clip.timelineStartSec));
    const end = Math.max(...clips.map((clip) => clip.timelineStartSec + clip.durationSec));
    return {
      start: clamp(start, 0, 60 * 60),
      end: clamp(end, start + 0.02, 60 * 60),
      confidenceScale: 0.65,
      confidenceBoost: 0,
      reasonSuffix: " / time range estimated from track clips",
    };
  }

  const start = 0;
  return {
    start,
    end: Math.max(start + fallbackDurationSec, start + 0.25),
    confidenceScale: 0.55,
    confidenceBoost: 0,
    reasonSuffix: " / time range fallback",
  };
}

function clipsForProblem(project: Project | undefined, problem: ArtifactProblem): Clip[] {
  if (!project) return [];
  const clips = problem.stemId === "mix"
    ? project.clips.filter((clip) => project.tracks.find((track) => track.id === clip.trackId)?.role !== "reference")
    : project.clips.filter((clip) => clip.trackId === problem.stemId);
  return clips.slice().sort((a, b) => a.timelineStartSec - b.timelineStartSec);
}

function estimatePeakWindowFromClips(clips: Clip[], peaksByFileId: Record<string, PeakSummary> | undefined, fallbackDurationSec: number): { start: number; end: number } | null {
  if (!peaksByFileId || clips.length === 0) return null;
  let best: { score: number; start: number; end: number } | null = null;

  for (const clip of clips) {
    const peaks = peaksByFileId[clip.fileId];
    if (!peaks || peaks.bins <= 0 || peaks.max.length === 0 || peaks.durationSec <= 0) continue;
    const startBin = clamp(Math.floor((clip.sourceStartSec / peaks.durationSec) * peaks.bins), 0, Math.max(0, peaks.bins - 1));
    const endBin = clamp(Math.ceil(((clip.sourceStartSec + clip.durationSec) / peaks.durationSec) * peaks.bins), startBin + 1, peaks.bins);
    let bestBin = startBin;
    let bestScore = -1;
    for (let bin = startBin; bin < endBin; bin += 1) {
      const positive = Math.abs(peaks.max[bin] ?? 0);
      const negative = Math.abs(peaks.min[bin] ?? 0);
      const score = Math.max(positive, negative);
      if (score > bestScore) {
        bestScore = score;
        bestBin = bin;
      }
    }
    if (bestScore <= 0) continue;
    const binDuration = peaks.durationSec / Math.max(1, peaks.bins);
    const windowDuration = clamp(Math.max(fallbackDurationSec, binDuration * 4), 0.25, Math.max(0.25, clip.durationSec));
    const sourceTime = bestBin * binDuration;
    const timelineCenter = clip.timelineStartSec + clamp(sourceTime - clip.sourceStartSec, 0, clip.durationSec);
    const start = clamp(timelineCenter - windowDuration / 2, clip.timelineStartSec, clip.timelineStartSec + clip.durationSec - 0.02);
    const end = clamp(start + windowDuration, start + 0.02, clip.timelineStartSec + clip.durationSec);
    if (!best || bestScore > best.score) best = { score: bestScore, start, end };
  }

  return best ? { start: round2(best.start), end: round2(best.end) } : null;
}

function opToCell(op: SpectralEditOp, index: number): RepairHeatmapCell {
  const beforeScore = clamp(58 + op.strength * 42, 0, 100);
  const operation = op.protectMain ? "protect" : op.operation;
  const afterScore = predictAfterScore(beforeScore, operation, op.strength);
  return {
    id: `repair-cell-from-${op.id}-${index}`,
    trackId: op.stemId === "mix" ? "mix" : op.stemId,
    stemId: op.stemId === "mix" ? "mix" : op.stemId,
    role: op.role,
    startTime: op.startTime,
    endTime: op.endTime,
    lowFreq: op.lowFreq,
    highFreq: op.highFreq,
    artifactScore: beforeScore,
    harshnessScore: operation === "deharsh" ? beforeScore : 0,
    mudScore: operation === "reduce" ? beforeScore : 0,
    rumbleScore: operation === "derumble" ? beforeScore : 0,
    metallicScore: operation === "smooth" ? beforeScore : 0,
    vocalBleedScore: 0,
    roomWashScore: operation === "smooth" ? beforeScore * 0.5 : 0,
    beforeScore,
    afterScore,
    differenceScore: round1(beforeScore - afterScore),
    confidence: op.confidence ?? 0.7,
    suggestedOperation: operation,
    suggestedGainDb: op.gainDb ?? 0,
    strength: op.strength,
    softness: op.softness,
    protectMain: op.protectMain,
    reason: op.reason,
  };
}

function scoreProblem(
  problem: ArtifactProblem,
  band: RepairBand,
  contamination: StemContaminationReport | undefined,
  purity: StemPurityReport | undefined,
  feature: StemFeatureReport | undefined,
  energyBoost: number,
) {
  const base = clamp(problem.score + energyBoost, 0, 100);
  const harshnessScore = problem.type === "harshness" || problem.type === "sibilance" || problem.type === "vocal_plastic"
    ? base
    : band.low >= 1500 && band.high <= 9000
      ? base * 0.35
      : 0;
  const metallicScore = problem.type === "metallic_high" ? base : band.low >= 9000 ? base * 0.42 : 0;
  const mudScore = problem.type === "mud" || problem.type === "masking" || problem.type === "low_end_blur"
    ? base
    : band.low >= 120 && band.high <= 900
      ? base * 0.3
      : 0;
  const rumbleScore = problem.type === "rumble" ? base : band.high <= 120 ? base * 0.28 : 0;
  const vocalBleedScore = Math.max(problem.type === "masking" ? base * 0.45 : 0, contamination?.vocalBleedScore ?? 0);
  const roomWashScore = Math.max(problem.type === "reverb_smear" || problem.type === "flatness" ? base * 0.65 : 0, contamination?.roomWashScore ?? 0);
  const artifactScore = Math.max(base, contamination?.artifactScore ?? 0, purity ? 100 - purity.purityScore : 0, feature?.spectralFlatness ? feature.spectralFlatness * 75 : 0);
  return {
    artifactScore: round1(artifactScore),
    harshnessScore: round1(harshnessScore),
    mudScore: round1(mudScore),
    rumbleScore: round1(rumbleScore),
    metallicScore: round1(metallicScore),
    vocalBleedScore: round1(vocalBleedScore),
    roomWashScore: round1(roomWashScore),
  };
}

function calculateBeforeScore(scores: ReturnType<typeof scoreProblem>) {
  const weighted = scores.harshnessScore * 0.22 +
    scores.metallicScore * 0.2 +
    scores.mudScore * 0.18 +
    scores.rumbleScore * 0.16 +
    scores.vocalBleedScore * 0.14 +
    scores.roomWashScore * 0.1 +
    scores.artifactScore * 0.22;
  return round1(clamp(
    Math.max(weighted, scores.artifactScore * 0.82),
    0,
    100,
  ));
}

function suggestOperation(problem: ArtifactProblem, band: RepairBand, role: StemRole | "mix"): SpectralEditOperation {
  if (role === "vocal" && band.low >= 1500 && band.high <= 5000 && (problem.type === "masking" || problem.type === "mud")) return "protect";
  if (role === "bass" && band.low >= 60 && band.high <= 120) return "protect";
  if (problem.type === "rumble" || band.high <= 60) return "derumble";
  if (problem.type === "sibilance" || (band.low >= 5000 && band.high <= 9000 && role === "vocal")) return "deess";
  if (problem.type === "harshness" || problem.type === "vocal_plastic" || (band.low >= 1500 && band.high <= 9000)) return "deharsh";
  if (problem.type === "metallic_high" || band.low >= 9000) return "smooth";
  if (problem.type === "reverb_smear" || problem.type === "flatness") return "smooth";
  return "reduce";
}

function shouldProtect(role: StemRole | "mix", band: RepairBand, operation: SpectralEditOperation) {
  if (operation === "protect") return true;
  if (role === "vocal" && band.low >= 1500 && band.high <= 5000 && operation !== "deess") return true;
  if (role === "bass" && band.low >= 60 && band.high <= 120) return true;
  if (role === "drums" && band.low >= 60 && band.high <= 250 && operation === "reduce") return true;
  return false;
}

function suggestGainDb(operation: SpectralEditOperation, score: number) {
  if (operation === "derumble") return round1(clamp(-1.5 - score / 18, -6, -1.5));
  if (operation === "deess") return round1(clamp(-1 - score / 28, -4, -1));
  if (operation === "deharsh") return round1(clamp(-0.8 - score / 34, -3, -1));
  if (operation === "smooth") return round1(clamp(-0.4 - score / 50, -2, -0.5));
  if (operation === "reduce") return round1(clamp(-0.8 - score / 24, -4.5, -1));
  return 0;
}

function suggestStrength(score: number, mode: MixDoctorMode, operation: SpectralEditOperation) {
  if (operation === "protect") return 0;
  const modeBoost = mode === "strong" ? 0.12 : mode === "balanced" ? 0.06 : 0;
  return round2(clamp(0.2 + score / 170 + modeBoost, 0.15, operation === "reduce" ? 0.75 : 0.7));
}

function suggestedSoftness(operation: SpectralEditOperation) {
  if (operation === "derumble") return 0.72;
  if (operation === "deess") return 0.78;
  if (operation === "deharsh") return 0.82;
  if (operation === "smooth") return 0.9;
  if (operation === "protect") return 1;
  return 0.68;
}

function predictAfterScore(beforeScore: number, operation: SpectralEditOperation, strength: number) {
  const efficiency = OPERATION_EFFICIENCY[operation] ?? 0.35;
  return round1(clamp(beforeScore * (1 - clamp(strength, 0, 1) * efficiency), 0, 100));
}

function problemRange(problem: ArtifactProblem) {
  if (typeof problem.lowFreq === "number" && typeof problem.highFreq === "number") {
    return { low: clamp(problem.lowFreq, 20, 20000), high: clamp(problem.highFreq, 20, 20000) };
  }
  if (problem.type === "rumble") return { low: 20, high: 60 };
  if (problem.type === "mud" || problem.type === "low_end_blur") return { low: 120, high: 500 };
  if (problem.type === "masking" || problem.type === "vocal_plastic") return { low: 900, high: 5000 };
  if (problem.type === "sibilance") return { low: 5000, high: 9000 };
  if (problem.type === "metallic_high") return { low: 9000, high: 16000 };
  if (problem.type === "reverb_smear" || problem.type === "flatness") return { low: 500, high: 12000 };
  return { low: 1500, high: 9000 };
}

function defaultDurationForProblem(problem: ArtifactProblem) {
  if (problem.type === "peak_risk") return 0.5;
  if (problem.type === "sibilance") return 1.5;
  return 4;
}

function nearestBand(low: number, high: number) {
  const center = Math.sqrt(Math.max(20, low) * Math.max(20, high));
  return REPAIR_BANDS.reduce((best, band) => {
    const bandCenter = Math.sqrt(band.low * band.high);
    return Math.abs(bandCenter - center) < Math.abs(Math.sqrt(best.low * best.high) - center) ? band : best;
  }, REPAIR_BANDS[0]!);
}

function estimateEnergyBoost(fileIds: string[], peaksByFileId: Record<string, PeakSummary> | undefined, low: number, high: number) {
  if (!peaksByFileId || fileIds.length === 0) return 0;
  const band = nearestBand(low, high);
  let bestEnergy = -100;
  for (const fileId of fileIds) {
    const energy = peaksByFileId[fileId]?.bandEnergyDb?.[band.id];
    if (typeof energy === "number") bestEnergy = Math.max(bestEnergy, energy);
  }
  if (bestEnergy <= -100) return 0;
  return clamp(100 + bestEnergy * 4, 0, 100) * 0.12;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
