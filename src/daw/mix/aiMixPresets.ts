import type { StemRole } from "@/daw/model/Project";

export type MixStrength = "light" | "medium" | "strong";

export type PresetId =
  | "magic-pro-polish"
  | "clean-stem-mix"
  | "vocal-forward"
  | "dark-pop-open"
  | "club-tight"
  | "hook-style-wide-lift";

export interface PresetDescriptor {
  id: PresetId;
  name: string;
  description: string;
}

export const AI_MIX_PRESETS: PresetDescriptor[] = [
  {
    id: "magic-pro-polish",
    name: "AIMIX",
    description: "Safe AIMIX flow: preserve stems, clean low-mid buildup, protect vocal tone, and keep the master safe.",
  },
];

export type LoudnessTarget = "none" | "spotify" | "apple-music" | "soundcloud";

export interface LoudnessTargetDescriptor {
  id: LoudnessTarget;
  name: string;
  description: string;
}

export const LOUDNESS_TARGETS: LoudnessTargetDescriptor[] = [
  {
    id: "none",
    name: "None",
    description: "No extra loudness target. AIMIX modes already control gain and ceiling.",
  },
  {
    id: "spotify",
    name: "Spotify",
    description: "Legacy target for older presets. AIMIX ignores this to avoid double processing.",
  },
  {
    id: "apple-music",
    name: "Apple Music",
    description: "Legacy target for older presets. AIMIX ignores this to avoid double processing.",
  },
  {
    id: "soundcloud",
    name: "SoundCloud",
    description: "Legacy target for older presets. Use Dense mode instead when more level is needed.",
  },
];

export type MagicPolishGenre = "pop" | "rock" | "club" | "acoustic";
export type MagicPolishMode = "safe" | "balanced" | "loud";
export type MagicPolishTargetPreset = "apple_music" | "spotify" | "soundcloud" | "reference" | "custom";

export type MagicPolishTargetSettings = {
  label: string;
  targetIntegratedLufs: number | null;
  truePeakCeilingDb: number | null;
  maxAllowedTruePeakDb: number;
  loudMasterTruePeakCeilingDb?: number;
  loudMasterThresholdLufs?: number;
  tonalMatchStrength: number;
  spatialMatchStrength: number;
  densityMatchStrength: number;
  notes: string;
};

export const MAGIC_POLISH_TARGET_LABELS: Record<MagicPolishTargetPreset, string> = {
  apple_music: "Apple Music",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  reference: "Reference",
  custom: "Custom",
};

export const MAGIC_POLISH_TARGETS: Record<MagicPolishTargetPreset, MagicPolishTargetSettings> = {
  apple_music: {
    label: "Apple Music",
    targetIntegratedLufs: -16,
    truePeakCeilingDb: -1,
    maxAllowedTruePeakDb: -1,
    tonalMatchStrength: 0.35,
    spatialMatchStrength: 0.25,
    densityMatchStrength: 0.35,
    notes: "Apple Sound Check向けの安全な初期値です。",
  },
  spotify: {
    label: "Spotify",
    targetIntegratedLufs: -14,
    truePeakCeilingDb: -1,
    maxAllowedTruePeakDb: -1,
    tonalMatchStrength: 0.35,
    spatialMatchStrength: 0.25,
    densityMatchStrength: 0.4,
    notes: "Spotify向けの目安です。-14 LUFS / -1 dBTPを基準にします。",
  },
  soundcloud: {
    label: "SoundCloud",
    targetIntegratedLufs: -14,
    truePeakCeilingDb: -1,
    maxAllowedTruePeakDb: -1,
    loudMasterTruePeakCeilingDb: -2,
    loudMasterThresholdLufs: -14,
    tonalMatchStrength: 0.4,
    spatialMatchStrength: 0.25,
    densityMatchStrength: 0.45,
    notes: "SoundCloud向けの目安です。Loud設定では-2 dBTP寄りに保護します。",
  },
  reference: {
    label: "Reference",
    targetIntegratedLufs: null,
    truePeakCeilingDb: null,
    maxAllowedTruePeakDb: -1,
    tonalMatchStrength: 0.45,
    spatialMatchStrength: 0.35,
    densityMatchStrength: 0.5,
    notes: "読み込まれたReferenceのLUFS、帯域、空間、密度を安全範囲で参照します。",
  },
  custom: {
    label: "Custom",
    targetIntegratedLufs: -13.5,
    truePeakCeilingDb: -1,
    maxAllowedTruePeakDb: -1,
    tonalMatchStrength: 0.35,
    spatialMatchStrength: 0.25,
    densityMatchStrength: 0.35,
    notes: "任意のTarget LUFSとTrue Peak Ceilingを指定します。",
  },
};

export type MagicPolishModeSettings = {
  mode: MagicPolishMode;
  label: string;
  loudnessLabel: string;
  ceilingDb: number;
  limiterPushDb: number;
  toneScale: number;
  airScale: number;
  lowScale: number;
  widthScale: number;
  warning?: string;
};

export const MAGIC_POLISH_MODE_SETTINGS: Record<MagicPolishMode, MagicPolishModeSettings> = {
  safe: {
    mode: "safe",
    label: "Safe",
    loudnessLabel: "-13 to -12 LUFS",
    ceilingDb: -1.2,
    limiterPushDb: 0.16,
    toneScale: 0.32,
    airScale: 0.24,
    lowScale: 0.25,
    widthScale: 0.3,
  },
  balanced: {
    mode: "balanced",
    label: "Balanced",
    loudnessLabel: "-11.5 to -10.8 LUFS",
    ceilingDb: -1,
    limiterPushDb: 0.34,
    toneScale: 0.48,
    airScale: 0.32,
    lowScale: 0.38,
    widthScale: 0.48,
  },
  loud: {
    mode: "loud",
    label: "Dense",
    loudnessLabel: "density lift",
    ceilingDb: -1,
    limiterPushDb: 0.58,
    toneScale: 0.62,
    airScale: 0.46,
    lowScale: 0.52,
    widthScale: 0.65,
    warning: "Dense adds light contrast and parallel density. It is not a limiter-crush mode; use Balanced first.",
  },
};

export const MAGIC_POLISH_MODES = Object.values(MAGIC_POLISH_MODE_SETTINGS);

export interface MagicPolishGenreDescriptor {
  id: MagicPolishGenre;
  name: string;
  description: string;
}

export const MAGIC_POLISH_GENRES: MagicPolishGenreDescriptor[] = [
  {
    id: "pop",
    name: "Pop / Vocal",
    description: "Protect the lead vocal and add only very small clarity moves.",
  },
  {
    id: "rock",
    name: "Rock / Band",
    description: "Lightly tighten drums and guitars while keeping the vocal natural.",
  },
  {
    id: "club",
    name: "Club / Dance",
    description: "Clean low-end buildup without boosting 20-35Hz or widening bass.",
  },
  {
    id: "acoustic",
    name: "Acoustic / Jazz",
    description: "Keep transients and space natural with minimal compression.",
  },
];

export function getStrengthFactor(strength: MixStrength): number {
  switch (strength) {
    case "light":
      return 0.25;
    case "medium":
      return 0.45;
    case "strong":
      return 0.7;
  }
}

export function getBaseRoleGain(role: StemRole): number {
  switch (role) {
    case "vocal":
      return 0.45;
    case "backingVocal":
      return -2.4;
    case "drums":
      return -0.5;
    case "bass":
      return -1.2;
    case "guitar":
      return -2.6;
    case "synth":
      return -3.4;
    case "keys":
      return -3.0;
    case "fx":
      return -7.5;
    case "loop":
      return -2.4;
    case "music":
      return -3.0;
    case "reference":
      return -15.0;
    case "other":
    default:
      return -3.2;
  }
}

export function getBaseRolePan(role: StemRole, index: number): number {
  const side = index % 2 === 0 ? -1 : 1;
  switch (role) {
    case "vocal":
    case "drums":
    case "bass":
    case "reference":
      return 0;
    case "backingVocal":
      return side * 0.3;
    case "guitar":
      return side * 0.28;
    case "synth":
      return side * 0.26;
    case "keys":
      return side * 0.2;
    case "fx":
      return side * 0.38;
    case "loop":
      return side * 0.18;
    case "music":
    case "other":
    default:
      return side * 0.12;
  }
}
