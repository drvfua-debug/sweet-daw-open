import { isBuiltinPluginId, type BuiltinPluginId, type PluginInstance, type PluginParams } from "./Plugin.ts";
import {
  createDefaultAimixUnmaskState,
  sanitizeAimixUnmaskState,
  type SweetAimixUnmaskState,
} from "../aimixUnmask/aimixUnmaskTypes.ts";
import {
  createDefaultRepairViewState,
  sanitizeRepairRegions,
  sanitizeRepairViewState,
  type RepairViewState,
  type SpectralRepairRegion,
} from "../repair/repairTypes.ts";
import {
  createDefaultSweetMasterPolish2Params,
  sanitizeSweetMasterPolish2Params,
  type SweetMasterPolish2Params,
} from "../../lib/audio/masterPolishTypes.ts";
import {
  sanitizeSweetExportProcessingReports,
  sanitizeSweetPersistedAnalysisCacheSummary,
  type SweetExportProcessingReport,
  type SweetPersistedAnalysisCacheSummary,
} from "../../lib/audio/exportProcessingTypes.ts";

export type TrackType =
  | "vocal"
  | "backingVocal"
  | "drums"
  | "bass"
  | "guitar"
  | "synth"
  | "keys"
  | "music"
  | "other"
  | "loop"
  | "oneshot"
  | "fx"
  | "reference";

export type StemRole =
  | "vocal"
  | "backingVocal"
  | "drums"
  | "bass"
  | "guitar"
  | "synth"
  | "keys"
  | "fx"
  | "music"
  | "loop"
  | "other"
  | "reference";


export type EQBandType =
  | "highpass"
  | "lowpass"
  | "lowshelf"
  | "highshelf"
  | "peaking"
  | "notch";

export type AimixEqSlotOwner =
  | "role_enhancement"
  | "shared_magic_policy"
  | "manual_adjustment"
  | "spectral_restore"
  | "dynamic_vocal_duck"
  | "reference_match"
  | "sweet_no_reference"
  | "final_polish"
  | "safety"
  | "legacy";

export type EQBand = {
  id: string;
  type: EQBandType;
  frequency: number;
  gainDb: number;
  q: number;
  enabled: boolean;
  solo: boolean;
  aimixOwner?: AimixEqSlotOwner;
  aimixSlotId?: string;
};

export type ParametricEQState = {
  enabled: boolean;
  bands: EQBand[];
  analyzerEnabled: boolean;
  analyzerMode: "pre" | "post";
};

export type CompressorState = {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  makeupGainDb: number;
};

export type CharacterPluginMode =
  | "drumPunch"
  | "drumAir"
  | "bassTight"
  | "bassDrive"
  | "vocalShine"
  | "vocalWarm"
  | "synthTransform"
  | "synthWide"
  | "loFiColor"
  | "warmTape"
  | "brightExciter";

export type CharacterPluginState = {
  enabled: boolean;
  mode: CharacterPluginMode;
  amount: number;
  tone: number;
  mix: number;
};

export type VocalImageDistance = "close" | "natural" | "wide";

export type VocalImageTrackState = {
  enabled: boolean;
  amount: number;
  distance: VocalImageDistance;
  monoSafety: boolean;
};

export type VocalImageMasterState = {
  enabled: boolean;
};

export type SendState = {
  id: string;
  targetBusId: string;
  gainDb: number;
  enabled: boolean;
};

export type MeterState = {
  peakDb: number;
  rmsDb: number;
  clipping: boolean;
};

export type TrackAnalysis = {
  onsetsSec: number[];
  analyzedAt?: string;
  analysisVersion?: string;
};

export type AimixSpatialMetadata = {
  isAimixSpatialGenerated: true;
  aimixVersion: "spatial-v1";
  aimixType: "spatial-left" | "spatial-right" | "clean" | "scatter" | "depth";
  sourceTrackId?: string;
  sourceClipId?: string;
  createdBy: "AIMIX Spatial";
  removable: true;
};

export type ReferenceAssistMetadata = {
  isReferenceAssist: true;
  type: "air-glue" | "side-glue" | "backbone" | "stem-air";
  sourceReferenceTrackId: string;
  sourceTrackIds?: string[];
  alignmentDelayMs?: number;
  createdAt: string;
  removable: true;
};

export type AimixSpatialPanMode = "clean" | "spatial" | "clean-spatial" | "full";

export type AimixSpatialPanTrackState = {
  isAimixSpatialPanApplied: true;
  previousPan: number;
  createdAt: string;
  mode: AimixSpatialPanMode;
};

export type AimixSpatialPanClipState = {
  isAimixSpatialPanApplied: true;
  previousPanAutomation?: ClipPanAutomation;
  createdAt: string;
  mode: AimixSpatialPanMode;
};

export type Track = {
  id: string;
  name: string;
  type: TrackType;
  role: StemRole;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  color: string;
  eq: ParametricEQState;
  character: CharacterPluginState;
  vocalImage: VocalImageTrackState;
  compressor: CompressorState;
  insertChain: PluginInstance[];
  sends: SendState[];
  meter: MeterState;
  analysis: TrackAnalysis;
  aimixSpatial?: AimixSpatialMetadata;
  aimixSpatialPan?: AimixSpatialPanTrackState;
  referenceAssist?: ReferenceAssistMetadata;
};

export type Clip = {
  id: string;
  trackId: string;
  fileId: string;
  clipKind?: "audio" | "artifact" | "smart-gap-fill";
  role: StemRole;
  intentTags: string[];
  actionHistory: ClipActionHistory[];
  timelineStartSec: number;
  sourceStartSec: number;
  durationSec: number;
  gainDb: number;
  fadeInSec: number;
  fadeOutSec: number;
  reverse: boolean;
  stretchRatio: number | null;
  pitchShiftSemitones: number | null;
  lockedToGrid: boolean;
  movementLocked: boolean;
  insertChain: PluginInstance[];
  artifact?: ArtifactClipState;
  patch?: PatchClipState;
  panAutomation?: ClipPanAutomation;
  frozenRenderFileId?: string;
  isFrozen?: boolean;
  createdBy?: "import" | "split" | "duplicate" | "render" | "bounce" | "aimixSpatial" | "artifact" | "smart-gap-fill" | "referenceAssist";
  frozenState?: FrozenClipState;
  aimixSpatial?: AimixSpatialMetadata;
  aimixSpatialPan?: AimixSpatialPanClipState;
  referenceAssist?: ReferenceAssistMetadata;
};

export type ArtifactReason =
  | "noise"
  | "vocal_leak"
  | "harsh_cymbal"
  | "thin_bass"
  | "phase_issue"
  | "artifact"
  | "other";

export type ArtifactClipState = {
  originalClipId: string;
  label?: string;
  reason: ArtifactReason;
  isMuted: boolean;
  repairQueue: boolean;
  createdAt: string;
};

export type PatchClipState = {
  targetTrackId: string;
  targetStartSec: number;
  targetEndSec: number;
  sourceTrackId: string;
  sourceClipId?: string;
  sourceStartSec: number;
  sourceEndSec: number;
  fadeInMs: number;
  fadeOutMs: number;
  crossfadeMs: number;
  gainDb: number;
  score: number;
  candidateRank: number;
  analysisSummary?: {
    timbreSimilarity: number;
    energySimilarity: number;
    rhythmSimilarity: number;
    harmonicSimilarity: number;
    boundarySmoothness: number;
  };
  locked: boolean;
  isBypassed: boolean;
  createdAt: string;
};

export type PanAnchorPoint = {
  id: string;
  time: number;
  pan: number;
  curve: "linear" | "smooth" | "hold" | "easeInOut";
};

export type ClipPanAutomation = {
  enabled: boolean;
  anchorPoints: PanAnchorPoint[];
  depth: number;
  smoothingMs: number;
  bypassed: boolean;
};

export type ClipActionHistory = {
  id: string;
  type: string;
  label: string;
  createdAt: string;
  details: Record<string, string | number | boolean>;
};

export type FrozenClipState = {
  originalFileId: string;
  originalSourceStartSec: number;
  originalDurationSec: number;
  originalInserts: PluginInstance[];
  originalGainDb: number;
  originalFadeInSec: number;
  originalFadeOutSec: number;
};

export type AudioFileRef = {
  id: string;
  name: string;
  originalName: string;
  role: StemRole;
  mimeType: string;
  durationSec: number;
  sampleRate: number;
  channelCount: number;
  byteLength: number;
  storageKey: string;
  peakCacheKey?: string;
  hash?: string;
  createdAt: string;
};

export type ExportBitDepth = "pcm16" | "pcm24" | "float32";
export type ExportSampleRate = "project" | 44100 | 48000;

export type Marker = {
  id: string;
  label: string;
  timeSec: number;
};

export type Region = {
  id: string;
  label: string;
  startSec: number;
  endSec: number;
};

export type ProjectAnalysis = {
  importedAt?: string;
  userAgent?: string;
  notes: string[];
};

export type MasterTargetProfileId =
  | "reference-match"
  | "streaming-safe"
  | "balanced-master"
  | "loud-demo"
  | "custom";

export type MasterTargetAnalysisSummary = {
  analyzedAt: string;
  analysisVersion: string;
  durationSec: number;
  preMasterIntegratedLufs: number | null;
  preMasterTruePeakDbtp: number | null;
  preMasterSamplePeakDbfs: number | null;
  predictedGainToTargetDb: number | null;
  recommendedHeadroomTrimDb: number;
  warnings: string[];
};

export type MasterTargetState = {
  enabled: boolean;
  profileId: MasterTargetProfileId;
  targetIntegratedLufs: number;
  truePeakCeilingDbtp: number;
  preMasterPeakCeilingDbfs: number;
  preMasterLoudnessHintLufs: number;
  toleranceLu: number;
  headroomMode: "off" | "analysis" | "auto-trim";
  lastAnalysis?: MasterTargetAnalysisSummary;
};

export type MasterState = {
  gainDb: number;
  mixBusTrimDb: number;
  finalOutputTrimDb?: number;
  finalOutputTrimOwner?: "reference-match" | "sweet-no-reference" | "single-wav-polish" | "manual" | "safety";
  eq: ParametricEQState;
  compressor: CompressorState;
  limiterEnabled: boolean;
  target: MasterTargetState;
  vocalImageLayer: VocalImageMasterState;
  insertChain: PluginInstance[];
  exportNormalizePeak: boolean;
  exportPeakTargetDb: number;
  exportBitDepth: ExportBitDepth;
  exportDither: boolean;
  exportSampleRate: ExportSampleRate;
  masterPolish2: SweetMasterPolish2Params;
};

export type ProjectStorageMeta = {
  saveMode: "indexeddb" | "opfs" | "json" | "package" | "unknown";
  lastSavedAt?: string;
  assetCount: number;
  estimatedBytes?: number;
  storageWarning?: string;
};

export type PluginPreset = {
  id: string;
  name: string;
  pluginId: string;
  params: Record<string, unknown>;
};

export type RenderCacheRef = {
  id: string;
  fileId: string;
  sourceClipId?: string;
  createdAt: string;
};

export type Project = {
  schemaVersion: 4;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sampleRate: number;
  bpm: number | null;
  timeSignature: [number, number];
  downbeatOffsetSec: number;
  snapMode: "off" | "beat" | "bar";
  master: MasterState;
  tracks: Track[];
  clips: Clip[];
  files: AudioFileRef[];
  markers: Marker[];
  sections: Marker[];
  regions: Region[];
  pluginPresets: PluginPreset[];
  renderCache: RenderCacheRef[];
  repairRegions: SpectralRepairRegion[];
  repairViewState: RepairViewState;
  aimixUnmaskState: SweetAimixUnmaskState;
  exportReports: SweetExportProcessingReport[];
  analysisCacheSummary: SweetPersistedAnalysisCacheSummary | null;
  storage: ProjectStorageMeta;
  analysis: ProjectAnalysis;
};

export type ProjectMigrationIssue = {
  level: "info" | "warning" | "error";
  path: string;
  message: string;
};

export const TRACK_COLORS = [
  "#4dd9ff",
  "#65f0a4",
  "#f4c95d",
  "#ff6fa8",
  "#b48cff",
  "#ff8f5f",
  "#6ea8ff",
  "#b8f56a",
];

export const STEM_ROLES: StemRole[] = [
  "vocal",
  "backingVocal",
  "drums",
  "bass",
  "guitar",
  "synth",
  "keys",
  "fx",
  "music",
  "loop",
  "other",
  "reference",
];


const ROLE_PATTERNS: Array<[StemRole, RegExp]> = [
  ["reference", /\b(ref|reference)\b/i],
  ["backingVocal", /\b(backing[_-\s]?vocals?|backing|bgv|bv|choir|chorus[_-\s]?vocals?|harmony)\b/i],
  ["vocal", /\b(vocals?|vox|lead[_-\s]?(?:vocals?|vox)|leadvox|voice|main[_-\s]?(?:vocals?|vox)|mainvox)\b/i],
  ["drums", /\b(drum|drums|kick|snare|perc|percussion|beat)\b/i],
  ["bass", /\b(bass|sub|808|low)\b/i],
  ["guitar", /\b(guitar|gt|gtr|riff|strum)\b/i],
  ["synth", /\b(synth|pad|lead|arp|sequence)\b/i],
  ["keys", /\b(keys|piano|organ|rhodes|epiano)\b/i],
  ["fx", /\b(fx|impact|riser|sweep|noise|downlifter|uplifter)\b/i],
  ["loop", /\b(loop|loops)\b/i],
  ["music", /\b(music|instrumental|inst)\b/i],
];

export function isStemRole(value: unknown): value is StemRole {
  return typeof value === "string" && STEM_ROLES.includes(value as StemRole);
}

export function inferStemRole(name = "", fallback: StemRole = "other"): StemRole {
  const normalized = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  return ROLE_PATTERNS.find(([, pattern]) => pattern.test(normalized))?.[0] ?? fallback;
}

export function roleToTrackType(role: StemRole): TrackType {
  if (role === "backingVocal") return "backingVocal";
  if (role === "guitar") return "guitar";
  if (role === "synth") return "synth";
  if (role === "keys") return "keys";
  return role;
}

export function trackTypeToRole(type: TrackType): StemRole {
  if (type === "oneshot") return "other";
  return type;
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDefaultEqState(): ParametricEQState {
  return {
    enabled: false,
    analyzerEnabled: true,
    analyzerMode: "post",
    bands: [
      { id: createId("eq"), type: "highpass", frequency: 30, gainDb: 0, q: 0.7, enabled: true, solo: false },
      { id: createId("eq"), type: "lowshelf", frequency: 120, gainDb: 0, q: 0.7, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 250, gainDb: 0, q: 1, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 1000, gainDb: 0, q: 1, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 3500, gainDb: 0, q: 1, enabled: true, solo: false },
      { id: createId("eq"), type: "peaking", frequency: 7500, gainDb: 0, q: 1, enabled: true, solo: false },
      { id: createId("eq"), type: "highshelf", frequency: 12000, gainDb: 0, q: 0.7, enabled: true, solo: false },
      { id: createId("eq"), type: "lowpass", frequency: 19000, gainDb: 0, q: 0.7, enabled: true, solo: false },
    ],
  };
}

export function createDefaultCompressor(enabled = false): CompressorState {
  return {
    enabled,
    threshold: -18,
    ratio: 2,
    attack: 0.015,
    release: 0.18,
    knee: 12,
    makeupGainDb: 0,
  };
}

export function createDefaultCharacterState(type: TrackType = "other"): CharacterPluginState {
  if (type === "drums") {
    return {
      enabled: false,
      mode: "drumPunch",
      amount: 0.55,
      tone: 0.65,
      mix: 0.35,
    };
  }

  if (type === "bass") {
    return {
      enabled: false,
      mode: "bassTight",
      amount: 0.5,
      tone: 0.45,
      mix: 0.32,
    };
  }

  if (type === "vocal") {
    return {
      enabled: false,
      mode: "vocalShine",
      amount: 0.38,
      tone: 0.62,
      mix: 0.28,
    };
  }

  if (type === "fx" || type === "guitar" || type === "synth" || type === "keys") {
    return {
      enabled: false,
      mode: "loFiColor",
      amount: 0.42,
      tone: 0.5,
      mix: 0.28,
    };
  }

  return {
    enabled: false,
    mode: "synthTransform",
    amount: 0.45,
    tone: 0.55,
    mix: 0.3,
  };
}

export function createDefaultVocalImageTrackState(): VocalImageTrackState {
  return {
    enabled: false,
    amount: 20,
    distance: "natural",
    monoSafety: true,
  };
}

export function createDefaultVocalImageMasterState(): VocalImageMasterState {
  return {
    enabled: false,
  };
}

export function createDefaultMasterTargetState(): MasterTargetState {
  return {
    enabled: true,
    profileId: "balanced-master",
    targetIntegratedLufs: -12,
    truePeakCeilingDbtp: -1,
    preMasterPeakCeilingDbfs: -6,
    preMasterLoudnessHintLufs: -18,
    toleranceLu: 0.5,
    headroomMode: "analysis",
  };
}

export function createTrack(name: string, index: number, type: TrackType = "other", role: StemRole = trackTypeToRole(type)): Track {
  return {
    id: createId("track"),
    name,
    type,
    role,
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    eq: createDefaultEqState(),
    character: createDefaultCharacterState(type),
    vocalImage: createDefaultVocalImageTrackState(),
    compressor: createDefaultCompressor(false),
    insertChain: [],
    sends: [],
    meter: {
      peakDb: -Infinity,
      rmsDb: -Infinity,
      clipping: false,
    },
    analysis: {
      onsetsSec: [],
    },
  };
}

export function createEmptyProject(): Project {
  const now = new Date().toISOString();

  return {
    schemaVersion: 4,
    id: createId("project"),
    title: "Untitled Sweet DAW project",
    createdAt: now,
    updatedAt: now,
    sampleRate: 48000,
    bpm: null,
    timeSignature: [4, 4],
    downbeatOffsetSec: 0,
    snapMode: "beat",
    master: {
      gainDb: 0,
      mixBusTrimDb: 0,
      finalOutputTrimDb: 0,
      finalOutputTrimOwner: undefined,
      eq: createDefaultEqState(),
      compressor: createDefaultCompressor(true),
      limiterEnabled: true,
      target: createDefaultMasterTargetState(),
      vocalImageLayer: createDefaultVocalImageMasterState(),
      insertChain: [],
      exportNormalizePeak: true,
      exportPeakTargetDb: -1,
      exportBitDepth: "pcm16",
      exportDither: true,
      exportSampleRate: 48000,
      masterPolish2: createDefaultSweetMasterPolish2Params(),
    },
    tracks: [],
    clips: [],
    files: [],
    markers: [],
    sections: [],
    regions: [],
    pluginPresets: [],
    renderCache: [],
    repairRegions: [],
    repairViewState: createDefaultRepairViewState(),
    aimixUnmaskState: createDefaultAimixUnmaskState(),
    exportReports: [],
    analysisCacheSummary: null,
    storage: {
      saveMode: "unknown",
      assetCount: 0,
    },
    analysis: {
      notes: [],
    },
  };
}

export function migrateProject(raw: unknown): Project {
  return migrateProjectWithReport(raw).project;
}

export function migrateProjectWithReport(raw: unknown): { project: Project; issues: ProjectMigrationIssue[] } {
  const issues: ProjectMigrationIssue[] = [];
  const fallback = createEmptyProject();
  if (!isRecord(raw)) {
    issues.push({
      level: "error",
      path: "$",
      message: "Project data was not an object. A new empty project was created.",
    });
    return { project: fallback, issues };
  }

  const now = new Date().toISOString();
  const projectId = stringOr(raw.id, fallback.id);
  const legacyFiles = Array.isArray(raw.files) ? raw.files.filter(isRecord) : [];
  const files: AudioFileRef[] = legacyFiles.map((file, index) => {
    const id = stringOr(file.id, createId("file"));
    const name = stringOr(file.name, stringOr(file.originalName, `Audio ${index + 1}`));
    const role = isStemRole(file.role) ? file.role : inferStemRole(name);
    return {
      id,
      name,
      originalName: stringOr(file.originalName, name),
      role,
      mimeType: stringOr(file.mimeType, "audio/unknown"),
      durationSec: numberOr(file.durationSec, 0),
      sampleRate: numberOr(file.sampleRate, 48000),
      channelCount: numberOr(file.channelCount, 2),
      byteLength: numberOr(file.byteLength, 0),
      storageKey: stringOr(file.storageKey, `memory:${id}`),
      peakCacheKey: typeof file.peakCacheKey === "string" ? file.peakCacheKey : `peaks:${id}`,
      hash: typeof file.hash === "string" ? file.hash : undefined,
      createdAt: stringOr(file.createdAt, now),
    };
  });

  const tracks: Track[] = (Array.isArray(raw.tracks) ? raw.tracks.filter(isRecord) : []).map((track, index) => {
    const name = stringOr(track.name, `Track ${index + 1}`);
    const role = isStemRole(track.role)
      ? track.role
      : isStemRole(track.type)
        ? track.type
        : inferStemRole(name);
    const type = isTrackType(track.type) ? track.type : roleToTrackType(role);
    return {
      ...createTrack(name, index, type, role),
      id: stringOr(track.id, createId("track")),
      name,
      type,
      role,
      gainDb: numberOr(track.gainDb, 0),
      pan: numberOr(track.pan, 0),
      mute: Boolean(track.mute),
      solo: Boolean(track.solo),
      color: stringOr(track.color, TRACK_COLORS[index % TRACK_COLORS.length]),
      eq: sanitizeEqState(track.eq),
      character: isRecord(track.character) ? (track.character as CharacterPluginState) : createDefaultCharacterState(type),
      vocalImage: sanitizeVocalImageTrackState(track.vocalImage),
      compressor: isRecord(track.compressor) ? (track.compressor as CompressorState) : createDefaultCompressor(false),
      insertChain: sanitizePluginChain(track.insertChain, "track", `tracks[${index}].insertChain`, issues),
      sends: Array.isArray(track.sends) ? (track.sends as SendState[]) : [],
      meter: isRecord(track.meter)
        ? (track.meter as MeterState)
        : { peakDb: -Infinity, rmsDb: -Infinity, clipping: false },
      analysis: isRecord(track.analysis) ? (track.analysis as TrackAnalysis) : { onsetsSec: [] },
      aimixSpatial: sanitizeAimixSpatialMetadata(track.aimixSpatial),
      aimixSpatialPan: sanitizeAimixSpatialPanTrackState(track.aimixSpatialPan),
      referenceAssist: sanitizeReferenceAssistMetadata(track.referenceAssist),
    };
  });

  const filesById = new Map(files.map((file) => [file.id, file]));
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const clips: Clip[] = (Array.isArray(raw.clips) ? raw.clips.filter(isRecord) : []).flatMap((clip, index) => {
    const rawTrackId = stringOr(clip.trackId, "");
    const rawFileId = stringOr(clip.fileId, "");
    const track = tracksById.get(rawTrackId);
    const file = filesById.get(rawFileId);
    if (!track || !file) {
      issues.push({
        level: "warning",
        path: `clips[${index}]`,
        message: `Clip removed because it references a missing ${!track ? "track" : "file"} (${!track ? rawTrackId : rawFileId}).`,
      });
      return [];
    }
    const role = track?.role ?? (isStemRole(clip.role) ? clip.role : file?.role ?? "other");
    return [{
      id: stringOr(clip.id, createId("clip")),
      trackId: track.id,
      fileId: file.id,
      role,
      clipKind: isClipKind(clip.clipKind) ? clip.clipKind : "audio",
      intentTags: sanitizeStringArray(clip.intentTags),
      actionHistory: sanitizeClipActionHistory(clip.actionHistory),
      timelineStartSec: numberOr(clip.timelineStartSec, 0),
      sourceStartSec: numberOr(clip.sourceStartSec, 0),
      durationSec: numberOr(clip.durationSec, file?.durationSec ?? 0),
      gainDb: numberOr(clip.gainDb, 0),
      fadeInSec: numberOr(clip.fadeInSec, 0),
      fadeOutSec: numberOr(clip.fadeOutSec, 0),
      reverse: Boolean(clip.reverse),
      stretchRatio: typeof clip.stretchRatio === "number" ? clip.stretchRatio : null,
      pitchShiftSemitones: typeof clip.pitchShiftSemitones === "number" ? clip.pitchShiftSemitones : null,
      lockedToGrid: typeof clip.lockedToGrid === "boolean" ? clip.lockedToGrid : true,
      movementLocked: typeof clip.movementLocked === "boolean" ? clip.movementLocked : true,
      insertChain: sanitizePluginChain(clip.insertChain ?? clip.inserts, "clip", `clips[${index}].insertChain`, issues),
      artifact: sanitizeArtifactClipState(clip.artifact),
      patch: sanitizePatchClipState(clip.patch),
      panAutomation: sanitizeClipPanAutomation(clip.panAutomation),
      frozenRenderFileId: typeof clip.frozenRenderFileId === "string" ? clip.frozenRenderFileId : undefined,
      isFrozen: typeof clip.isFrozen === "boolean" ? clip.isFrozen : undefined,
      createdBy: isCreatedBy(clip.createdBy) ? clip.createdBy : undefined,
      frozenState: isRecord(clip.frozenState) ? (clip.frozenState as FrozenClipState) : undefined,
      aimixSpatial: sanitizeAimixSpatialMetadata(clip.aimixSpatial),
      aimixSpatialPan: sanitizeAimixSpatialPanClipState(clip.aimixSpatialPan),
      referenceAssist: sanitizeReferenceAssistMetadata(clip.referenceAssist),
    }];
  });

  const masterRecord = isRecord(raw.master) ? raw.master : {};
  const master = {
    ...fallback.master,
    ...(masterRecord as Partial<MasterState>),
    mixBusTrimDb:
      typeof masterRecord.mixBusTrimDb === "number" && Number.isFinite(masterRecord.mixBusTrimDb)
        ? Math.min(0, Math.max(-24, masterRecord.mixBusTrimDb))
        : fallback.master.mixBusTrimDb,
    target: sanitizeMasterTargetState(masterRecord.target),
    eq: sanitizeEqState(masterRecord.eq),
    vocalImageLayer: sanitizeVocalImageMasterState(masterRecord.vocalImageLayer),
    insertChain: sanitizePluginChain(masterRecord.insertChain, "master", "master.insertChain", issues),
    exportPeakTargetDb:
      typeof masterRecord.exportPeakTargetDb === "number" && Number.isFinite(masterRecord.exportPeakTargetDb)
        ? Math.min(-0.3, Math.max(-3, masterRecord.exportPeakTargetDb))
        : fallback.master.exportPeakTargetDb,
    exportBitDepth: isExportBitDepth(masterRecord.exportBitDepth) ? masterRecord.exportBitDepth : fallback.master.exportBitDepth,
    exportDither: typeof masterRecord.exportDither === "boolean" ? masterRecord.exportDither : fallback.master.exportDither,
    exportSampleRate: masterRecord.exportSampleRate === 44100 ? 44100 as const : 48000 as const,
    finalOutputTrimDb:
      typeof masterRecord.finalOutputTrimDb === "number" && Number.isFinite(masterRecord.finalOutputTrimDb)
        ? Math.min(6, Math.max(-18, masterRecord.finalOutputTrimDb))
        : fallback.master.finalOutputTrimDb,
    finalOutputTrimOwner:
      masterRecord.finalOutputTrimOwner === "reference-match" ||
      masterRecord.finalOutputTrimOwner === "sweet-no-reference" ||
      masterRecord.finalOutputTrimOwner === "single-wav-polish" ||
      masterRecord.finalOutputTrimOwner === "manual" ||
      masterRecord.finalOutputTrimOwner === "safety"
        ? masterRecord.finalOutputTrimOwner
        : fallback.master.finalOutputTrimOwner,
    masterPolish2: sanitizeSweetMasterPolish2Params(masterRecord.masterPolish2),
  };

  const migratedProject: Project = {
    schemaVersion: 4,
    id: projectId,
    title: stringOr(raw.title, fallback.title),
    createdAt: stringOr(raw.createdAt, now),
    updatedAt: stringOr(raw.updatedAt, now),
    sampleRate: numberOr(raw.sampleRate, fallback.sampleRate),
    bpm: typeof raw.bpm === "number" ? raw.bpm : fallback.bpm,
    timeSignature: isTimeSignature(raw.timeSignature) ? raw.timeSignature : fallback.timeSignature,
    downbeatOffsetSec: numberOr(raw.downbeatOffsetSec, 0),
    snapMode: raw.snapMode === "off" || raw.snapMode === "bar" || raw.snapMode === "beat" ? raw.snapMode : "beat",
    master,
    tracks,
    clips,
    files,
    markers: Array.isArray(raw.markers) ? (raw.markers as Marker[]) : [],
    sections: Array.isArray(raw.sections) ? (raw.sections as Marker[]) : [],
    regions: Array.isArray(raw.regions) ? (raw.regions as Region[]) : [],
    pluginPresets: Array.isArray(raw.pluginPresets) ? (raw.pluginPresets as PluginPreset[]) : [],
    renderCache: Array.isArray(raw.renderCache) ? (raw.renderCache as RenderCacheRef[]) : [],
    repairRegions: sanitizeRepairRegions(raw.repairRegions),
    repairViewState: sanitizeRepairViewState(raw.repairViewState),
    aimixUnmaskState: sanitizeAimixUnmaskState(raw.aimixUnmaskState),
    exportReports: sanitizeSweetExportProcessingReports(raw.exportReports),
    analysisCacheSummary: sanitizeSweetPersistedAnalysisCacheSummary(raw.analysisCacheSummary),
    storage: {
      saveMode: "unknown",
      assetCount: files.length,
      estimatedBytes: files.reduce((sum, file) => sum + file.byteLength, 0),
      ...(isRecord(raw.storage) ? (raw.storage as Partial<ProjectStorageMeta>) : {}),
    },
    analysis: sanitizeProjectAnalysis(raw.analysis, issues),
  };

  return { project: migratedProject, issues };
}

export function createClipHistoryItem(
  type: string,
  label: string,
  details: Record<string, string | number | boolean> = {},
): ClipActionHistory {
  return {
    id: createId("history"),
    type,
    label,
    createdAt: new Date().toISOString(),
    details,
  };
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()))).slice(0, 16);
}

function sanitizeClipActionHistory(value: unknown): ClipActionHistory[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    id: stringOr(item.id, createId("history")),
    type: stringOr(item.type, "action"),
    label: stringOr(item.label, "Edited clip"),
    createdAt: stringOr(item.createdAt, new Date().toISOString()),
    details: isRecord(item.details) ? sanitizeHistoryDetails(item.details) : {},
  }));
}

function sanitizeArtifactClipState(value: unknown): ArtifactClipState | undefined {
  if (!isRecord(value)) return undefined;
  return {
    originalClipId: stringOr(value.originalClipId, ""),
    label: typeof value.label === "string" ? value.label : undefined,
    reason: isArtifactReason(value.reason) ? value.reason : "artifact",
    isMuted: Boolean(value.isMuted),
    repairQueue: Boolean(value.repairQueue),
    createdAt: stringOr(value.createdAt, new Date().toISOString()),
  };
}

function sanitizePatchClipState(value: unknown): PatchClipState | undefined {
  if (!isRecord(value)) return undefined;
  const summary = isRecord(value.analysisSummary) ? value.analysisSummary : null;
  return {
    targetTrackId: stringOr(value.targetTrackId, ""),
    targetStartSec: numberOr(value.targetStartSec, 0),
    targetEndSec: numberOr(value.targetEndSec, 0),
    sourceTrackId: stringOr(value.sourceTrackId, ""),
    sourceClipId: typeof value.sourceClipId === "string" ? value.sourceClipId : undefined,
    sourceStartSec: numberOr(value.sourceStartSec, 0),
    sourceEndSec: numberOr(value.sourceEndSec, 0),
    fadeInMs: numberOr(value.fadeInMs, 20),
    fadeOutMs: numberOr(value.fadeOutMs, 20),
    crossfadeMs: numberOr(value.crossfadeMs, 40),
    gainDb: clampNumber(numberOr(value.gainDb, 0), -24, 12),
    score: clampNumber(numberOr(value.score, 0), 0, 100),
    candidateRank: Math.max(1, Math.round(numberOr(value.candidateRank, 1))),
    analysisSummary: summary
      ? {
          timbreSimilarity: clampNumber(numberOr(summary.timbreSimilarity, 0), 0, 100),
          energySimilarity: clampNumber(numberOr(summary.energySimilarity, 0), 0, 100),
          rhythmSimilarity: clampNumber(numberOr(summary.rhythmSimilarity, 0), 0, 100),
          harmonicSimilarity: clampNumber(numberOr(summary.harmonicSimilarity, 0), 0, 100),
          boundarySmoothness: clampNumber(numberOr(summary.boundarySmoothness, 0), 0, 100),
        }
      : undefined,
    locked: typeof value.locked === "boolean" ? value.locked : true,
    isBypassed: Boolean(value.isBypassed),
    createdAt: stringOr(value.createdAt, new Date().toISOString()),
  };
}

function sanitizeClipPanAutomation(value: unknown): ClipPanAutomation | undefined {
  if (!isRecord(value)) return undefined;
  const anchorPoints = Array.isArray(value.anchorPoints)
    ? value.anchorPoints
        .filter(isRecord)
        .map((point) => ({
          id: stringOr(point.id, createId("pan")),
          time: Math.max(0, numberOr(point.time, 0)),
          pan: clampNumber(numberOr(point.pan, 0), -1, 1),
          curve: isPanCurve(point.curve) ? point.curve : "smooth",
        }))
        .sort((a, b) => a.time - b.time)
        .slice(0, 24)
    : [];
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : true,
    anchorPoints,
    depth: clampNumber(numberOr(value.depth, 1), 0, 1),
    smoothingMs: clampNumber(numberOr(value.smoothingMs, 35), 0, 500),
    bypassed: Boolean(value.bypassed),
  };
}

function sanitizeAimixSpatialMetadata(value: unknown): AimixSpatialMetadata | undefined {
  if (!isRecord(value) || value.isAimixSpatialGenerated !== true) return undefined;
  const aimixType = isAimixSpatialType(value.aimixType) ? value.aimixType : "depth";
  return {
    isAimixSpatialGenerated: true,
    aimixVersion: "spatial-v1",
    aimixType,
    sourceTrackId: typeof value.sourceTrackId === "string" ? value.sourceTrackId : undefined,
    sourceClipId: typeof value.sourceClipId === "string" ? value.sourceClipId : undefined,
    createdBy: "AIMIX Spatial",
    removable: true,
  };
}

function sanitizeReferenceAssistMetadata(value: unknown): ReferenceAssistMetadata | undefined {
  if (!isRecord(value) || value.isReferenceAssist !== true) return undefined;
  const type = value.type === "air-glue" || value.type === "side-glue" || value.type === "backbone" || value.type === "stem-air" ? value.type : "air-glue";
  const sourceReferenceTrackId = typeof value.sourceReferenceTrackId === "string" ? value.sourceReferenceTrackId : "";
  if (!sourceReferenceTrackId) return undefined;
  return {
    isReferenceAssist: true,
    type,
    sourceReferenceTrackId,
    sourceTrackIds: Array.isArray(value.sourceTrackIds) ? value.sourceTrackIds.filter((entry): entry is string => typeof entry === "string") : undefined,
    alignmentDelayMs: typeof value.alignmentDelayMs === "number" && Number.isFinite(value.alignmentDelayMs) ? value.alignmentDelayMs : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    removable: true,
  };
}

function isAimixSpatialType(value: unknown): value is AimixSpatialMetadata["aimixType"] {
  return value === "spatial-left" || value === "spatial-right" || value === "clean" || value === "scatter" || value === "depth";
}

function sanitizeAimixSpatialPanTrackState(value: unknown): AimixSpatialPanTrackState | undefined {
  if (!isRecord(value) || value.isAimixSpatialPanApplied !== true) return undefined;
  return {
    isAimixSpatialPanApplied: true,
    previousPan: clampNumber(numberOr(value.previousPan, 0), -1, 1),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    mode: isAimixSpatialPanMode(value.mode) ? value.mode : "clean-spatial",
  };
}

function sanitizeAimixSpatialPanClipState(value: unknown): AimixSpatialPanClipState | undefined {
  if (!isRecord(value) || value.isAimixSpatialPanApplied !== true) return undefined;
  return {
    isAimixSpatialPanApplied: true,
    previousPanAutomation: sanitizeClipPanAutomation(value.previousPanAutomation),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    mode: isAimixSpatialPanMode(value.mode) ? value.mode : "clean-spatial",
  };
}

function isAimixSpatialPanMode(value: unknown): value is AimixSpatialPanMode {
  return value === "clean" || value === "spatial" || value === "clean-spatial" || value === "full";
}

function sanitizeHistoryDetails(value: Record<string, unknown>): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean"),
  ) as Record<string, string | number | boolean>;
}

function sanitizeEqState(value: unknown): ParametricEQState {
  const fallback = createDefaultEqState();
  if (!isRecord(value)) return fallback;

  const bands = Array.isArray(value.bands)
    ? value.bands.filter(isRecord).map((band, index) => ({
        ...fallback.bands[index % fallback.bands.length],
        id: stringOr(band.id, createId("eq")),
        type: isEqBandType(band.type) ? band.type : fallback.bands[index % fallback.bands.length]?.type ?? "peaking",
        frequency: numberOr(band.frequency, fallback.bands[index % fallback.bands.length]?.frequency ?? 1000),
        gainDb: numberOr(band.gainDb, 0),
        q: numberOr(band.q, fallback.bands[index % fallback.bands.length]?.q ?? 1),
        enabled: typeof band.enabled === "boolean" ? band.enabled : true,
        solo: Boolean(band.solo),
        aimixOwner: isAimixEqSlotOwner(band.aimixOwner) ? band.aimixOwner : undefined,
        aimixSlotId: typeof band.aimixSlotId === "string" ? band.aimixSlotId : undefined,
      }))
    : fallback.bands;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    bands: bands.length > 0 ? bands : fallback.bands,
    analyzerEnabled: true,
    analyzerMode: value.analyzerMode === "pre" ? "pre" : "post",
  };
}

export function sanitizeVocalImageTrackState(value: unknown): VocalImageTrackState {
  const fallback = createDefaultVocalImageTrackState();
  if (!isRecord(value)) return fallback;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    amount: clampNumber(numberOr(value.amount, fallback.amount), 0, 100),
    distance: isVocalImageDistance(value.distance) ? value.distance : fallback.distance,
    monoSafety: typeof value.monoSafety === "boolean" ? value.monoSafety : fallback.monoSafety,
  };
}

function sanitizeMasterTargetState(value: unknown): MasterTargetState {
  const fallback = createDefaultMasterTargetState();
  if (!isRecord(value)) return fallback;
  const lastAnalysis = sanitizeMasterTargetAnalysisSummary(value.lastAnalysis);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    profileId: isMasterTargetProfileId(value.profileId) ? value.profileId : fallback.profileId,
    targetIntegratedLufs: clampNumber(numberOr(value.targetIntegratedLufs, fallback.targetIntegratedLufs), -24, -6),
    truePeakCeilingDbtp: clampNumber(numberOr(value.truePeakCeilingDbtp, fallback.truePeakCeilingDbtp), -6, -0.1),
    preMasterPeakCeilingDbfs: clampNumber(numberOr(value.preMasterPeakCeilingDbfs, fallback.preMasterPeakCeilingDbfs), -24, -1),
    preMasterLoudnessHintLufs: clampNumber(numberOr(value.preMasterLoudnessHintLufs, fallback.preMasterLoudnessHintLufs), -30, -8),
    toleranceLu: clampNumber(numberOr(value.toleranceLu, fallback.toleranceLu), 0.1, 2),
    headroomMode: isMasterTargetHeadroomMode(value.headroomMode) ? value.headroomMode : fallback.headroomMode,
    ...(lastAnalysis ? { lastAnalysis } : {}),
  };
}

function sanitizeMasterTargetAnalysisSummary(value: unknown): MasterTargetAnalysisSummary | undefined {
  if (!isRecord(value)) return undefined;
  return {
    analyzedAt: stringOr(value.analyzedAt, new Date().toISOString()),
    analysisVersion: stringOr(value.analysisVersion, "master-target-v1"),
    durationSec: Math.max(0, numberOr(value.durationSec, 0)),
    preMasterIntegratedLufs: nullableFiniteNumber(value.preMasterIntegratedLufs),
    preMasterTruePeakDbtp: nullableFiniteNumber(value.preMasterTruePeakDbtp),
    preMasterSamplePeakDbfs: nullableFiniteNumber(value.preMasterSamplePeakDbfs),
    predictedGainToTargetDb: nullableFiniteNumber(value.predictedGainToTargetDb),
    recommendedHeadroomTrimDb: clampNumber(numberOr(value.recommendedHeadroomTrimDb, 0), -24, 6),
    warnings: sanitizeStringArray(value.warnings),
  };
}

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sanitizeVocalImageMasterState(value: unknown): VocalImageMasterState {
  const fallback = createDefaultVocalImageMasterState();
  if (!isRecord(value)) return fallback;

  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
  };
}

function sanitizeProjectAnalysis(value: unknown, issues: ProjectMigrationIssue[]): ProjectAnalysis {
  const notes = isRecord(value) && Array.isArray(value.notes)
    ? value.notes.filter((entry): entry is string => typeof entry === "string")
    : [];
  const migrationWarnings = issues
    .filter((issue) => issue.level === "warning" || issue.level === "error")
    .slice(0, 12)
    .map((issue) => `[Migration] ${issue.path}: ${issue.message}`);

  return {
    ...(isRecord(value) ? (value as Partial<ProjectAnalysis>) : {}),
    notes: [...notes, ...migrationWarnings],
  };
}

function sanitizePluginChain(
  value: unknown,
  target: PluginInstance["target"],
  path: string,
  issues: ProjectMigrationIssue[],
): PluginInstance[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((plugin, index) => {
    const now = new Date().toISOString();
    if (!isBuiltinPluginId(plugin.pluginId)) {
      issues.push({
        level: "warning",
        path: `${path}[${index}].pluginId`,
        message: `Unknown plug-in removed: ${String(plugin.pluginId)}`,
      });
      return [];
    }

    return [{
      id: stringOr(plugin.id, createId("plugin")),
      pluginId: plugin.pluginId,
      name: stringOr(plugin.name, plugin.pluginId),
      enabled: typeof plugin.enabled === "boolean" ? plugin.enabled : true,
      target,
      params: sanitizePluginParams(plugin.pluginId, plugin.params, issues, `${path}[${index}].params`),
      createdAt: stringOr(plugin.createdAt, now),
      updatedAt: stringOr(plugin.updatedAt, now),
    }];
  });
}

function sanitizePluginParams(
  _pluginId: BuiltinPluginId,
  rawParams: unknown,
  issues: ProjectMigrationIssue[],
  path: string,
): PluginParams {
  if (!isRecord(rawParams)) return {};
  const params: PluginParams = { ...rawParams };

  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const range = getGenericPluginParamRange(key);
    if (!range) continue;
    const clamped = clampNumber(value, range.min, range.max);
    if (clamped !== value) {
      params[key] = clamped;
      issues.push({
        level: "warning",
        path: `${path}.${key}`,
        message: `Plug-in parameter clamped from ${value} to ${clamped}.`,
      });
    }
  }

  return params;
}

function getGenericPluginParamRange(key: string): { min: number; max: number } | null {
  if (key === "mix" || key === "drive" || key === "tone" || key === "body" || key === "air" || key === "presence") {
    return { min: 0, max: 1 };
  }
  if (key === "feedback") return { min: 0, max: 0.95 };
  if (key === "threshold") return { min: -80, max: 12 };
  if (key === "gainDb" || key === "outputDb") return { min: -24, max: 24 };
  if (key === "frequency" || key === "frequencyHz" || key === "lowCutHz") return { min: 20, max: 20000 };
  if (key === "q" || key === "Q") return { min: 0.1, max: 24 };
  if (key === "timeSec") return { min: 0.001, max: 2 };
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isTimeSignature(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function isMasterTargetProfileId(value: unknown): value is MasterTargetProfileId {
  return (
    value === "reference-match" ||
    value === "streaming-safe" ||
    value === "balanced-master" ||
    value === "loud-demo" ||
    value === "custom"
  );
}

function isMasterTargetHeadroomMode(value: unknown): value is MasterTargetState["headroomMode"] {
  return value === "off" || value === "analysis" || value === "auto-trim";
}

function isTrackType(value: unknown): value is TrackType {
  return (
    typeof value === "string" &&
    [
      "vocal",
      "backingVocal",
      "drums",
      "bass",
      "guitar",
      "synth",
      "keys",
      "music",
      "other",
      "loop",
      "oneshot",
      "fx",
      "reference",
    ].includes(value)
  );
}

function isCreatedBy(value: unknown): value is NonNullable<Clip["createdBy"]> {
  return (
    value === "import" ||
    value === "split" ||
    value === "duplicate" ||
    value === "render" ||
    value === "bounce" ||
    value === "aimixSpatial" ||
    value === "artifact" ||
    value === "smart-gap-fill"
  );
}

function isClipKind(value: unknown): value is NonNullable<Clip["clipKind"]> {
  return value === "audio" || value === "artifact" || value === "smart-gap-fill";
}

function isArtifactReason(value: unknown): value is ArtifactReason {
  return (
    value === "noise" ||
    value === "vocal_leak" ||
    value === "harsh_cymbal" ||
    value === "thin_bass" ||
    value === "phase_issue" ||
    value === "artifact" ||
    value === "other"
  );
}

function isPanCurve(value: unknown): value is PanAnchorPoint["curve"] {
  return value === "linear" || value === "smooth" || value === "hold" || value === "easeInOut";
}

function isEqBandType(value: unknown): value is EQBandType {
  return (
    value === "highpass" ||
    value === "lowpass" ||
    value === "lowshelf" ||
    value === "highshelf" ||
    value === "peaking" ||
    value === "notch"
  );
}

function isExportBitDepth(value: unknown): value is ExportBitDepth {
  return value === "pcm16" || value === "pcm24" || value === "float32";
}

function isExportSampleRate(value: unknown): value is ExportSampleRate {
  return value === "project" || value === 44100 || value === 48000;
}

function isVocalImageDistance(value: unknown): value is VocalImageDistance {
  return value === "close" || value === "natural" || value === "wide";
}


function isAimixEqSlotOwner(value: unknown): value is AimixEqSlotOwner {
  return (
    value === "role_enhancement" ||
    value === "shared_magic_policy" ||
    value === "manual_adjustment" ||
    value === "spectral_restore" ||
    value === "dynamic_vocal_duck" ||
    value === "reference_match" ||
    value === "sweet_no_reference" ||
    value === "final_polish" ||
    value === "safety" ||
    value === "legacy"
  );
}
