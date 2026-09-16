import type { AimixGlowPresetDefinition, AimixGlowSettings } from "./types";

export const AIMIX_GLOW_PRESET_ORDER = ["cleanGlow", "vocalBreath", "darkGloss", "aiStemRescue", "brightButSafe"] as const;

export const AIMIX_GLOW_PRESETS: Record<(typeof AIMIX_GLOW_PRESET_ORDER)[number], AimixGlowPresetDefinition> = {
  cleanGlow: {
    label: "Clean Glow",
    description: "Small breath, clarity, and gloss lift with conservative guarding.",
    amount: 32,
    vocalKey: 55,
    recover: 24,
    gloss: 16,
    air: 14,
    tame: 38,
    outputMatch: true,
  },
  vocalBreath: {
    label: "Vocal Breath",
    description: "More vocal-keyed presence and breath while keeping sibilance guarded.",
    amount: 45,
    vocalKey: 75,
    recover: 42,
    gloss: 24,
    air: 22,
    tame: 48,
    outputMatch: true,
  },
  darkGloss: {
    label: "Dark Gloss",
    description: "Adds low-key density and gloss without making the top bright.",
    amount: 38,
    vocalKey: 68,
    recover: 30,
    gloss: 28,
    air: 8,
    tame: 60,
    outputMatch: true,
  },
  aiStemRescue: {
    label: "AI Stem Rescue",
    description: "Default safe rescue for AI/Suno stems: clarity before air.",
    amount: 42,
    vocalKey: 65,
    recover: 34,
    gloss: 22,
    air: 18,
    tame: 55,
    outputMatch: true,
  },
  brightButSafe: {
    label: "Bright but Safe",
    description: "More open top-end with stronger fake-air and sibilance guard.",
    amount: 36,
    vocalKey: 58,
    recover: 26,
    gloss: 14,
    air: 30,
    tame: 68,
    outputMatch: true,
  },
};

export const DEFAULT_AIMIX_GLOW_SETTINGS: AimixGlowSettings = {
  enabled: false,
  preset: "aiStemRescue",
  amount: AIMIX_GLOW_PRESETS.aiStemRescue.amount,
  vocalKey: AIMIX_GLOW_PRESETS.aiStemRescue.vocalKey,
  recover: AIMIX_GLOW_PRESETS.aiStemRescue.recover,
  gloss: AIMIX_GLOW_PRESETS.aiStemRescue.gloss,
  air: AIMIX_GLOW_PRESETS.aiStemRescue.air,
  tame: AIMIX_GLOW_PRESETS.aiStemRescue.tame,
  outputMatch: true,
  quality: "offlineHighQuality",
};

export function settingsFromAimixGlowPreset(preset: keyof typeof AIMIX_GLOW_PRESETS): AimixGlowSettings {
  const definition = AIMIX_GLOW_PRESETS[preset];
  return {
    enabled: true,
    preset,
    amount: definition.amount,
    vocalKey: definition.vocalKey,
    recover: definition.recover,
    gloss: definition.gloss,
    air: definition.air,
    tame: definition.tame,
    outputMatch: definition.outputMatch,
    quality: "offlineHighQuality",
  };
}
