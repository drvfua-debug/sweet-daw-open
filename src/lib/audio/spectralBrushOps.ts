import { applyRepairOperationsToChannels, type RepairProcessSegment } from "@/audio/repair/repairProcessors";
import type { Clip } from "@/daw/model/Project";
import { createSpectralRepairRegion, type RepairOperation, type RepairProblemType, type SpectralRepairRegion } from "@/daw/repair/repairTypes";
import type { RepairAnalysisResult } from "@/audio/repair/repairAnalysis";
import { clamp, copyChannels, dbToGain, sanitizeFloat32 } from "@/audio/repair/dspMath";
import type {
  SweetSpectralBrushOperation,
  SweetSpectralBrushOperationKind,
  SweetSpectralBrushProcessResult,
  SweetSpectralProblemHeatmapFrame,
  SweetSpectralProblemScoreMap,
  SweetSpectralSelection,
} from "./spectralEditorTypes";
import { createSweetSpectralSelection, selectionFrequencyRange } from "./spectralSelection";

export type BrushRegionContext = {
  clip: Clip;
  fileId: string;
  trackId: string;
};

export function createSpectralBrushOperation(input: Partial<SweetSpectralBrushOperation> & { kind: SweetSpectralBrushOperationKind; selection: SweetSpectralSelection }): SweetSpectralBrushOperation {
  return {
    id: input.id ?? createBrushOperationId(),
    kind: input.kind,
    selection: createSweetSpectralSelection(input.selection),
    amount: clamp(input.amount ?? defaultAmountForBrush(input.kind), 0, 1),
    fixed: Boolean(input.fixed),
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    createdAt: input.createdAt ?? Date.now(),
    label: input.label,
    warnings: Array.isArray(input.warnings) ? input.warnings.filter((warning): warning is string => typeof warning === "string") : [],
  };
}

export function brushOperationToRepairRegion(operation: SweetSpectralBrushOperation, context: BrushRegionContext): SpectralRepairRegion {
  const selection = createSweetSpectralSelection(operation.selection);
  const { minHz, maxHz } = selectionFrequencyRange(selection);
  const mapped = mapBrushKindToRepair(operation.kind, minHz, maxHz, operation.amount);
  return createSpectralRepairRegion({
    id: `brush_${operation.id}`,
    fileId: context.fileId,
    clipId: context.clip.id,
    trackId: context.trackId,
    targetLayer: operation.kind === "low-end-tighten" ? "side" : "mix",
    transformHint: selection.shape === "time-range" ? "waveform" : "stft",
    problemType: mapped.problemType,
    operation: mapped.operation,
    startSec: selection.startSec,
    endSec: selection.endSec,
    lowHz: mapped.lowHz,
    highHz: mapped.highHz,
    amountDb: mapped.amountDb,
    strength: operation.amount,
    confidence: 0.72,
    featherTimeMs: selection.featherTimeSec * 1000,
    featherFreqHz: selection.featherHz,
    enabled: operation.enabled,
    fixed: operation.fixed,
    protectVocal: operation.kind === "chirp-soften" || operation.kind === "harsh-soften" || operation.kind === "tone-reduce" ? true : undefined,
    protectDrumAttack: operation.kind === "click-smooth" ? true : undefined,
  });
}

export function brushOperationToRepairSegment(operation: SweetSpectralBrushOperation, sampleRate: number, length: number): RepairProcessSegment {
  const selection = createSweetSpectralSelection(operation.selection);
  const { minHz, maxHz } = selectionFrequencyRange(selection);
  const mapped = mapBrushKindToRepair(operation.kind, minHz, maxHz, operation.amount);
  const endSec = Math.min(selection.endSec, Math.max(selection.startSec + 0.001, length / Math.max(1, sampleRate)));
  return {
    regionId: operation.id,
    operation: mapped.operation,
    startLocalSec: selection.startSec,
    endLocalSec: endSec,
    lowHz: mapped.lowHz,
    highHz: mapped.highHz,
    amountDb: mapped.amountDb,
    strength: operation.enabled ? operation.amount : 0,
    featherTimeSec: selection.featherTimeSec,
    protectVocal: operation.kind === "chirp-soften" || operation.kind === "harsh-soften" || operation.kind === "tone-reduce" ? true : undefined,
    protectDrumAttack: operation.kind === "click-smooth" ? true : undefined,
  };
}

export function applySpectralBrushOperationsToChannels(inputChannels: Float32Array[], sampleRate: number, operations: SweetSpectralBrushOperation[]): SweetSpectralBrushProcessResult {
  const enabled = operations.filter((operation) => operation.enabled && operation.amount > 0);
  const warnings: string[] = [];
  const channels = copyChannels(inputChannels);
  if (enabled.length === 0) {
    return { channels, removed: createSilentLike(inputChannels), appliedOperationIds: [], warnings: ["No enabled brush operations."] };
  }

  const lightOps = enabled.filter((operation) => operation.kind === "attenuate" || operation.kind === "sustain-shorten" || operation.kind === "click-smooth");
  const spectralOps = enabled.filter((operation) => !lightOps.includes(operation));

  const lightApplied: string[] = [];
  for (const operation of lightOps) {
    if (operation.kind === "click-smooth") {
      applyClickSmooth(channels, sampleRate, operation, warnings);
    } else {
      applyTimeAttenuation(channels, sampleRate, operation);
    }
    lightApplied.push(operation.id);
  }

  const segments = spectralOps.map((operation) => brushOperationToRepairSegment(operation, sampleRate, channels[0]?.length ?? 0));
  const repaired = segments.length > 0 ? applyRepairOperationsToChannels(channels, sampleRate, segments) : { channels, appliedRegionIds: [], warnings: [] };
  const processed = repaired.channels;
  const removed = subtractChannels(inputChannels, processed);
  return {
    channels: processed,
    removed,
    appliedOperationIds: [...lightApplied, ...repaired.appliedRegionIds],
    warnings: [...warnings, ...repaired.warnings, ...buildBrushSafetyWarnings(enabled)],
  };
}

export function buildSpectralProblemHeatmapFrames(analysis: RepairAnalysisResult): SweetSpectralProblemHeatmapFrame[] {
  return analysis.frames.map((frame) => {
    const scores: SweetSpectralProblemScoreMap = {
      clipRisk: clamp(Math.max(frame.scores.clipping ?? 0, Math.max(0, (frame.peak ?? 0) - 0.92) * 8), 0, 1),
      clickRisk: clamp(Math.max(frame.scores.click ?? 0, frame.scores.crackle ?? 0), 0, 1),
      chirpRisk: clamp(frame.scores.chirp ?? 0, 0, 1),
      harshRisk: clamp(Math.max(frame.scores.harshness ?? 0, frame.scores.sibilance ?? 0), 0, 1),
      mudRisk: clamp(Math.max(frame.scores.low_mud ?? 0, frame.scores.low_sub ?? 0) * 0.85, 0, 1),
      sideLowRisk: clamp(Math.max(frame.scores.low_side ?? 0, frame.scores.phase_risk ?? 0), 0, 1),
      reverbSmearRisk: clamp((frame.scores.crackle ?? 0) * 0.25 + (frame.scores.low_mud ?? 0) * 0.3 + (frame.scores.chirp ?? 0) * 0.18, 0, 1),
      maskingRisk: clamp((frame.scores.low_mud ?? 0) * 0.42 + (frame.scores.harshness ?? 0) * 0.34 + (frame.scores.sibilance ?? 0) * 0.2, 0, 1),
    };
    return { startSec: frame.startSec, endSec: frame.endSec, scores, peakHz: frame.peakHz };
  });
}

function mapBrushKindToRepair(kind: SweetSpectralBrushOperationKind, minHz: number, maxHz: number, amount: number): { problemType: RepairProblemType; operation: RepairOperation; lowHz: number; highHz: number; amountDb: number } {
  const depth = -clamp(1.2 + amount * 8, 0.8, 9.5);
  if (kind === "click-smooth") return { problemType: "click", operation: "declick_lite", lowHz: minHz, highHz: maxHz, amountDb: Math.min(-4, depth) };
  if (kind === "tone-reduce") return { problemType: "metallic_high", operation: "dechirp_lite", lowHz: Math.max(500, minHz), highHz: Math.min(18000, maxHz), amountDb: Math.max(-7, depth) };
  if (kind === "chirp-soften") return { problemType: "metallic_high", operation: "dechirp_lite", lowHz: Math.max(5500, minHz), highHz: Math.min(16000, maxHz), amountDb: Math.max(-6, depth) };
  if (kind === "harsh-soften") return { problemType: "metallic_high", operation: "deharsh_lite", lowHz: Math.max(1800, minHz), highHz: Math.min(9000, maxHz), amountDb: Math.max(-5, depth) };
  if (kind === "low-end-tighten") return { problemType: "low_end_blur", operation: "lowend_tighten_lite", lowHz: 20, highHz: Math.min(180, maxHz), amountDb: Math.max(-4, depth) };
  if (kind === "band-attenuate") return { problemType: maxHz < 600 ? "mud" : "metallic_high", operation: maxHz < 600 ? "attenuate" : "deharsh_lite", lowHz: minHz, highHz: maxHz, amountDb: Math.max(-6, depth) };
  return { problemType: "mud", operation: "attenuate", lowHz: minHz, highHz: maxHz, amountDb: Math.max(-8, depth) };
}

function applyTimeAttenuation(channels: Float32Array[], sampleRate: number, operation: SweetSpectralBrushOperation) {
  const selection = createSweetSpectralSelection(operation.selection);
  const start = Math.max(0, Math.floor(selection.startSec * sampleRate));
  const end = Math.max(start + 1, Math.floor(selection.endSec * sampleRate));
  const gain = dbToGain(-1 - operation.amount * 10);
  const strength = operation.kind === "sustain-shorten" ? operation.amount * 0.75 : operation.amount;
  const feather = Math.min(Math.floor(selection.featherTimeSec * sampleRate), Math.floor((end - start) * 0.45));
  for (const channel of channels) {
    for (let index = start; index < end && index < channel.length; index += 1) {
      const fadeIn = feather > 0 ? clamp((index - start) / feather, 0, 1) : 1;
      const fadeOut = feather > 0 ? clamp((end - index) / feather, 0, 1) : 1;
      const blend = Math.min(fadeIn, fadeOut);
      const localGain = 1 + (gain - 1) * strength * blend;
      channel[index] = sanitizeFloat32((channel[index] ?? 0) * localGain);
    }
  }
}

function applyClickSmooth(channels: Float32Array[], sampleRate: number, operation: SweetSpectralBrushOperation, warnings: string[]) {
  const duration = operation.selection.endSec - operation.selection.startSec;
  if (duration > 0.12) warnings.push(`Operation ${operation.id}: click-smooth is intended for short selections; only local spikes are interpolated.`);
  const start = Math.max(1, Math.floor(operation.selection.startSec * sampleRate));
  const end = Math.max(start + 2, Math.floor(operation.selection.endSec * sampleRate));
  const radius = Math.max(1, Math.floor(sampleRate * (0.0006 + operation.amount * 0.0024)));
  for (const channel of channels) {
    let peakIndex = start;
    let peakValue = 0;
    for (let index = start; index < end && index < channel.length - 1; index += 1) {
      const value = Math.abs(channel[index] ?? 0);
      if (value > peakValue) {
        peakValue = value;
        peakIndex = index;
      }
    }
    const left = Math.max(0, peakIndex - radius);
    const right = Math.min(channel.length - 1, peakIndex + radius);
    const leftValue = channel[left] ?? 0;
    const rightValue = channel[right] ?? leftValue;
    for (let index = left; index <= right; index += 1) {
      const t = (index - left) / Math.max(1, right - left);
      const target = leftValue + (rightValue - leftValue) * t;
      channel[index] = sanitizeFloat32((channel[index] ?? 0) * (1 - operation.amount) + target * operation.amount);
    }
  }
}

function buildBrushSafetyWarnings(operations: SweetSpectralBrushOperation[]) {
  const warnings: string[] = [];
  if (operations.some((operation) => operation.kind === "band-attenuate" && (operation.selection.maxHz ?? 20000) - (operation.selection.minHz ?? 20) > 9000)) {
    warnings.push("Wide band-attenuate behaves like broad attenuation; split the region for surgical work.");
  }
  if (operations.some((operation) => operation.kind === "chirp-soften" || operation.kind === "harsh-soften")) {
    warnings.push("Chirp/harsh brushes use existing lite repair DSP and remain non-destructive until FIX/export.");
  }
  return warnings;
}

function subtractChannels(original: Float32Array[], processed: Float32Array[]) {
  return original.map((channel, channelIndex) => {
    const next = new Float32Array(channel.length);
    const after = processed[channelIndex] ?? new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) next[index] = sanitizeFloat32((channel[index] ?? 0) - (after[index] ?? 0));
    return next;
  });
}

function createSilentLike(channels: Float32Array[]) {
  return channels.map((channel) => new Float32Array(channel.length));
}

function defaultAmountForBrush(kind: SweetSpectralBrushOperationKind) {
  if (kind === "click-smooth") return 0.7;
  if (kind === "low-end-tighten") return 0.35;
  if (kind === "chirp-soften" || kind === "harsh-soften") return 0.42;
  return 0.5;
}

function createBrushOperationId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `brushop_${crypto.randomUUID()}`;
  return `brushop_${Math.random().toString(36).slice(2, 10)}`;
}