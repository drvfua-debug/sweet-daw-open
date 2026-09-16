import { getSweetStemRoleProfile, normalizeSweetStemRole } from "./stemRoleProfiles";
import { getSweetMasterTargetProfile, type SweetMasterTargetProfile, type SweetMasterTargetProfileId } from "./targetProfiles";

export type SweetStemRole =
  | "lead-vocal"
  | "backing-vocal"
  | "drums"
  | "kick"
  | "snare"
  | "bass"
  | "guitar"
  | "keys"
  | "synth"
  | "pad"
  | "fx"
  | "other"
  | "master";

export interface SweetBandRange {
  id: string;
  label: string;
  minHz: number;
  maxHz: number;
}

export interface SweetReferenceBandDelta {
  bandId: string;
  centerHz: number;
  currentDb: number;
  referenceDb: number;
  deltaDb: number;
  boundedDeltaDb: number;
  confidence: number;
}

export interface SweetReferenceDeltaReport {
  id: string;
  source: "reference-wav" | "direct-wav" | "mix-doctor" | "current-mix";
  createdAt: number;
  sampleRate: number;
  durationSec: number;
  role?: SweetStemRole;
  analysisWindowCount: number;
  bands: SweetReferenceBandDelta[];
  warnings: string[];
}

export interface SweetAimixReferenceDeltaHints {
  available: boolean;
  source: SweetReferenceDeltaReport["source"];
  confidence: number;
  maxProposalReductionDb: number;
  tonalTiltDb: number;
  bassWeightDeltaDb: number;
  vocalPresenceDeltaDb: number;
  harshnessDeltaDb: number;
  airDeltaDb: number;
  warnings: string[];
}

export interface SweetMasterPolishTargetHints {
  profileId: SweetMasterTargetProfileId;
  targetLufsApprox: number;
  ceilingDbTpEstimate: number;
  maxReferenceDeltaDb: number;
  maxHighBoostDb: number;
  maxLowBoostDb: number;
  maxStereoWiden: number;
  allowExciter: boolean;
  boundedBandDeltas: SweetReferenceBandDelta[];
  warnings: string[];
}

export interface SweetBandEnergySource {
  role?: string;
  sampleRate?: number;
  durationSec?: number;
  analysisWindowCount?: number;
  bandEnergyDb: Partial<Record<string, number>>;
}

export interface BuildSweetReferenceDeltaReportOptions {
  id?: string;
  source?: SweetReferenceDeltaReport["source"];
  createdAt?: number;
  sampleRate?: number;
  durationSec?: number;
  analysisWindowCount?: number;
  role?: SweetStemRole | string;
  currentBands: Partial<Record<string, number>>;
  referenceBands: Partial<Record<string, number>>;
  profile?: SweetMasterTargetProfile;
  profileId?: SweetMasterTargetProfileId;
  hasStems?: boolean;
  bands?: SweetBandRange[];
}

export interface BuildSweetReferenceDeltaFromFeaturesOptions {
  id?: string;
  source?: SweetReferenceDeltaReport["source"];
  reference: SweetBandEnergySource | null | undefined;
  features: SweetBandEnergySource[];
  profile?: SweetMasterTargetProfile;
  profileId?: SweetMasterTargetProfileId;
  role?: SweetStemRole | string;
}

export const SWEET_REFERENCE_BANDS: SweetBandRange[] = [
  { id: "20-35", label: "Sub Floor", minHz: 20, maxHz: 35 },
  { id: "35-60", label: "Sub Weight", minHz: 35, maxHz: 60 },
  { id: "60-120", label: "Bass Core", minHz: 60, maxHz: 120 },
  { id: "120-250", label: "Low Body", minHz: 120, maxHz: 250 },
  { id: "250-500", label: "Mud / Body", minHz: 250, maxHz: 500 },
  { id: "500-900", label: "Box / Nasal", minHz: 500, maxHz: 900 },
  { id: "900-1500", label: "Vocal Body", minHz: 900, maxHz: 1500 },
  { id: "1500-3000", label: "Presence Low", minHz: 1500, maxHz: 3000 },
  { id: "3000-5000", label: "Presence", minHz: 3000, maxHz: 5000 },
  { id: "5000-9000", label: "Clarity / Harsh", minHz: 5000, maxHz: 9000 },
  { id: "9000-12000", label: "Gloss", minHz: 9000, maxHz: 12000 },
  { id: "12000-16000", label: "Sheen", minHz: 12000, maxHz: 16000 },
  { id: "16000-20000", label: "Air Noise", minHz: 16000, maxHz: 20000 },
];

export function buildSweetReferenceDeltaReport(options: BuildSweetReferenceDeltaReportOptions): SweetReferenceDeltaReport {
  const profile = options.profile ?? getSweetMasterTargetProfile(options.profileId);
  const bands = options.bands ?? SWEET_REFERENCE_BANDS;
  const role = normalizeSweetStemRole(typeof options.role === "string" ? options.role : options.role ?? "master");
  const roleProfile = getSweetStemRoleProfile(role);
  const durationSec = finiteOr(options.durationSec, 0);
  const sampleRate = Math.max(1, Math.round(finiteOr(options.sampleRate, 44100)));
  const analysisWindowCount = Math.max(1, Math.round(finiteOr(options.analysisWindowCount, inferWindowCountFromDuration(durationSec))));
  const hasStems = options.hasStems !== false;
  const warnings = new Set<string>(profile.warnings);

  if (!hasStems && role !== "master") warnings.add("Role別Deltaはstemがある場合だけ有効です。master-onlyでは広い音色目標に留めます。");
  if (!roleProfile.allowRoleDelta) warnings.add(roleProfile.warning ?? "Master-only analysis should stay broad and bounded.");
  if (durationSec > 0 && durationSec < 12) warnings.add("Referenceが短いためconfidenceを下げています。");

  const deltas = bands.map((band) => {
    const currentDb = readBandDb(options.currentBands, band.id);
    const referenceDb = readBandDb(options.referenceBands, band.id);
    const centerHz = Math.sqrt(band.minHz * band.maxHz);
    const deltaDb = round2(referenceDb - currentDb);
    const bounded = boundReferenceDelta(deltaDb, centerHz, profile, warnings);
    const confidence = computeBandConfidence({ currentDb, referenceDb, durationSec, analysisWindowCount, role, hasStems, roleAllowsDelta: roleProfile.allowRoleDelta });
    return {
      bandId: band.id,
      centerHz: Math.round(centerHz),
      currentDb: round2(currentDb),
      referenceDb: round2(referenceDb),
      deltaDb,
      boundedDeltaDb: bounded,
      confidence,
    };
  });

  if (deltas.some((band) => Math.abs(band.deltaDb - band.boundedDeltaDb) > 0.05)) {
    warnings.add("Reference差分は100%適用せず、Target Profileの安全上限でbounded delta化しています。");
  }
  if (deltas.some((band) => band.centerHz >= 8000 && band.boundedDeltaDb > 0.05)) {
    warnings.add("8kHz以上のboostはAI artifactを強調しない範囲に制限しています。");
  }
  if (deltas.some((band) => band.centerHz < 120 && band.boundedDeltaDb > 0.05)) {
    warnings.add("20-120HzのboostはKick/Bass整理を優先するため強く制限しています。");
  }

  return {
    id: options.id ?? `sweet-ref-delta-${Math.round(options.createdAt ?? Date.now())}`,
    source: options.source ?? "mix-doctor",
    createdAt: options.createdAt ?? Date.now(),
    sampleRate,
    durationSec,
    role,
    analysisWindowCount,
    bands: deltas,
    warnings: [...warnings],
  };
}

export function buildSweetReferenceDeltaReportFromFeatures(options: BuildSweetReferenceDeltaFromFeaturesOptions): SweetReferenceDeltaReport | null {
  if (!options.reference || !options.reference.bandEnergyDb) return null;
  const workFeatures = options.features.filter((feature) => normalizeSweetStemRole(feature.role) !== "master");
  if (workFeatures.length === 0) return null;
  const currentBands = averageBandEnergy(workFeatures.map((feature) => feature.bandEnergyDb));
  const sampleRate = options.reference.sampleRate ?? workFeatures.find((feature) => feature.sampleRate)?.sampleRate ?? 44100;
  const durationSec = Math.max(options.reference.durationSec ?? 0, ...workFeatures.map((feature) => feature.durationSec ?? 0));
  const analysisWindowCount = Math.max(1, options.reference.analysisWindowCount ?? Math.max(...workFeatures.map((feature) => feature.analysisWindowCount ?? 1)));
  return buildSweetReferenceDeltaReport({
    id: options.id,
    source: options.source ?? "mix-doctor",
    sampleRate,
    durationSec,
    role: options.role ?? "master",
    analysisWindowCount,
    currentBands,
    referenceBands: options.reference.bandEnergyDb,
    profile: options.profile,
    profileId: options.profileId,
    hasStems: workFeatures.length > 0,
  });
}

export function estimateBandEnergyDbFromPcm(channels: Float32Array[], sampleRate: number, bands: SweetBandRange[] = SWEET_REFERENCE_BANDS): Partial<Record<string, number>> {
  const length = Math.min(...channels.filter((channel) => channel.length > 0).map((channel) => channel.length));
  if (!Number.isFinite(length) || length <= 0 || sampleRate <= 0) return {};
  const windowSize = Math.min(length, Math.max(1024, Math.floor(sampleRate * 4)));
  const windowStarts = createAnalysisWindowStarts(length, windowSize);
  return bands.reduce((acc, band) => {
    let powerSum = 0;
    let count = 0;
    for (const frequency of createBandFrequencyPoints(band, sampleRate)) {
      for (const startFrame of windowStarts) {
        const magnitude = estimateToneMagnitude(channels, sampleRate, startFrame, windowSize, frequency);
        powerSum += magnitude * magnitude;
        count += 1;
      }
    }
    const rmsMagnitude = Math.sqrt(powerSum / Math.max(1, count));
    acc[band.id] = round2(20 * Math.log10(Math.max(1e-8, rmsMagnitude)));
    return acc;
  }, {} as Partial<Record<string, number>>);
}

export function toAimixReferenceDeltaHints(report: SweetReferenceDeltaReport | null | undefined, profile: SweetMasterTargetProfile): SweetAimixReferenceDeltaHints {
  if (!report) {
    return {
      available: false,
      source: "current-mix",
      confidence: 0,
      maxProposalReductionDb: 0,
      tonalTiltDb: 0,
      bassWeightDeltaDb: 0,
      vocalPresenceDeltaDb: 0,
      harshnessDeltaDb: 0,
      airDeltaDb: 0,
      warnings: ["Reference Delta report is not available."],
    };
  }
  const bass = averageBounded(report, ["35-60", "60-120"]);
  const lowBody = averageBounded(report, ["120-250", "250-500"]);
  const presence = averageBounded(report, ["1500-3000", "3000-5000"]);
  const harsh = averageBounded(report, ["5000-9000"]);
  const air = averageBounded(report, ["9000-12000", "12000-16000", "16000-20000"]);
  return {
    available: true,
    source: report.source,
    confidence: round2(average(report.bands.map((band) => band.confidence))),
    maxProposalReductionDb: round2(Math.min(2.5, 0.8 + profile.maxReferenceDeltaDb * 0.45)),
    tonalTiltDb: round2(air - lowBody),
    bassWeightDeltaDb: bass,
    vocalPresenceDeltaDb: presence,
    harshnessDeltaDb: harsh,
    airDeltaDb: air,
    warnings: report.warnings,
  };
}

export function toMasterPolishTargetHints(report: SweetReferenceDeltaReport | null | undefined, profile: SweetMasterTargetProfile): SweetMasterPolishTargetHints {
  return {
    profileId: profile.id,
    targetLufsApprox: profile.targetLufsApprox,
    ceilingDbTpEstimate: profile.ceilingDbTpEstimate,
    maxReferenceDeltaDb: profile.maxReferenceDeltaDb,
    maxHighBoostDb: profile.maxHighBoostDb,
    maxLowBoostDb: profile.maxLowBoostDb,
    maxStereoWiden: profile.maxStereoWiden,
    allowExciter: profile.allowExciter,
    boundedBandDeltas: report ? report.bands : [],
    warnings: [...profile.warnings, ...(report?.warnings ?? [])],
  };
}

export function averageBandEnergy(bandMaps: Array<Partial<Record<string, number>>>): Partial<Record<string, number>> {
  const keys = new Set<string>();
  bandMaps.forEach((map) => Object.keys(map).forEach((key) => keys.add(key)));
  const result: Partial<Record<string, number>> = {};
  keys.forEach((key) => {
    const values = bandMaps.map((map) => map[key]).filter((value): value is number => Number.isFinite(value));
    if (values.length === 0) return;
    const energy = values.reduce((sum, value) => sum + 10 ** (value / 10), 0) / values.length;
    result[key] = round2(10 * Math.log10(Math.max(1e-12, energy)));
  });
  return result;
}

function boundReferenceDelta(deltaDb: number, centerHz: number, profile: SweetMasterTargetProfile, warnings: Set<string>) {
  let positiveCap = profile.maxReferenceDeltaDb;
  if (centerHz < 120) positiveCap = Math.min(positiveCap, profile.maxLowBoostDb);
  if (centerHz >= 8000) positiveCap = Math.min(positiveCap, profile.maxHighBoostDb);
  if (centerHz >= 16000) positiveCap = Math.min(positiveCap, Math.max(0.35, profile.maxHighBoostDb * 0.65));
  const negativeCap = profile.maxReferenceDeltaDb;
  const bounded = deltaDb >= 0 ? Math.min(deltaDb, positiveCap) : Math.max(deltaDb, -negativeCap);
  if (deltaDb > bounded + 0.05 && centerHz >= 8000) warnings.add("High boost was capped by the target profile.");
  if (deltaDb > bounded + 0.05 && centerHz < 120) warnings.add("Low boost was capped by the target profile.");
  return round2(bounded);
}

function computeBandConfidence(args: { currentDb: number; referenceDb: number; durationSec: number; analysisWindowCount: number; role: SweetStemRole; hasStems: boolean; roleAllowsDelta: boolean }) {
  let confidence = 0.92;
  if (args.durationSec > 0 && args.durationSec < 12) confidence -= 0.22;
  if (args.durationSec > 0 && args.durationSec < 5) confidence -= 0.18;
  if (args.analysisWindowCount <= 1 && args.durationSec >= 12) confidence -= 0.06;
  if (args.analysisWindowCount >= 3) confidence += 0.03;
  if (args.currentDb < -72 || args.referenceDb < -72) confidence -= 0.28;
  if (args.role === "master") confidence -= 0.05;
  if (!args.hasStems && args.role !== "master") confidence -= 0.25;
  if (!args.roleAllowsDelta) confidence -= 0.1;
  return round2(clamp(confidence, 0.05, 1));
}

function inferWindowCountFromDuration(durationSec: number) {
  if (durationSec >= 24) return 3;
  if (durationSec >= 12) return 2;
  return 1;
}

function createAnalysisWindowStarts(length: number, windowSize: number) {
  if (length <= windowSize) return [0];
  const windowCount = Math.min(5, Math.max(2, Math.floor(length / Math.max(1, windowSize))));
  return Array.from({ length: windowCount }, (_, index) => {
    const position = windowCount === 1 ? 0 : index / (windowCount - 1);
    return Math.round((length - windowSize) * position);
  });
}

function createBandFrequencyPoints(band: SweetBandRange, sampleRate: number) {
  const nyquist = sampleRate * 0.5;
  const minHz = clamp(band.minHz, 20, nyquist * 0.92);
  const maxHz = clamp(band.maxHz, minHz + 1, nyquist * 0.92);
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);
  return [0.25, 0.5, 0.75]
    .map((position) => Math.exp(logMin + (logMax - logMin) * position))
    .filter((frequency) => frequency > 0 && frequency < nyquist * 0.95);
}

function estimateToneMagnitude(channels: Float32Array[], sampleRate: number, startFrame: number, windowSize: number, frequency: number) {
  const omega = (2 * Math.PI * frequency) / Math.max(1, sampleRate);
  const stride = Math.max(1, Math.ceil(windowSize / 32768));
  const endFrame = startFrame + windowSize;
  let real = 0;
  let imag = 0;
  let count = 0;
  for (let frame = startFrame; frame < endFrame; frame += stride) {
    let sample = 0;
    for (const channel of channels) sample += channel[frame] ?? 0;
    sample /= Math.max(1, channels.length);
    const angle = omega * frame;
    real += sample * Math.cos(angle);
    imag -= sample * Math.sin(angle);
    count += 1;
  }
  return Math.sqrt(real * real + imag * imag) / Math.max(1, count);
}

function readBandDb(map: Partial<Record<string, number>>, key: string) {
  const value = map[key];
  return Number.isFinite(value) ? Number(value) : -90;
}

function averageBounded(report: SweetReferenceDeltaReport, keys: string[]) {
  const values = report.bands.filter((band) => keys.includes(band.bandId)).map((band) => band.boundedDeltaDb);
  return round2(average(values));
}

function average(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
