import type { RepairOperation } from "@/daw/repair/repairTypes";

export type RepairPresetId =
  | "ai_artifact_clean_safe"
  | "ai_chirp_reducer"
  | "mix_deharsh_safe"
  | "vocal_deess_safe"
  | "click_cleanup_safe"
  | "lowend_tighten_safe";

export type RepairPreset = {
  id: RepairPresetId;
  label: string;
  description: string;
  operation: RepairOperation;
  lowHz: number;
  highHz: number;
  amountDb: number;
  strength: number;
  protectVocal?: boolean;
  protectDrumAttack?: boolean;
};

export const REPAIR_PRESETS: RepairPreset[] = [
  {
    id: "ai_artifact_clean_safe",
    label: "AI Artifact Clean Safe",
    description: "Small De-Chirp pass for metallic AI grain. Safe for preview before FIX.",
    operation: "dechirp_lite",
    lowHz: 6000,
    highHz: 12000,
    amountDb: -2.5,
    strength: 0.35,
    protectVocal: true,
    protectDrumAttack: true,
  },
  {
    id: "ai_chirp_reducer",
    label: "AI Chirp Reducer",
    description: "Targets narrow 7-14kHz whistle/chirp artifacts without adding air.",
    operation: "dechirp_lite",
    lowHz: 7000,
    highHz: 14000,
    amountDb: -3.5,
    strength: 0.45,
    protectVocal: true,
    protectDrumAttack: true,
  },
  {
    id: "mix_deharsh_safe",
    label: "Mix De-Harsh Safe",
    description: "Softens painful 2.5-6.5kHz peaks. Does not scoop the full band heavily.",
    operation: "deharsh_lite",
    lowHz: 2500,
    highHz: 6500,
    amountDb: -2,
    strength: 0.35,
    protectVocal: true,
  },
  {
    id: "vocal_deess_safe",
    label: "Vocal De-Ess Safe",
    description: "Light de-ess for short sibilant bursts while preserving vocal clarity.",
    operation: "deess_lite",
    lowHz: 4500,
    highHz: 9500,
    amountDb: -3,
    strength: 0.4,
    protectVocal: true,
  },
  {
    id: "click_cleanup_safe",
    label: "Click Cleanup Safe",
    description: "Conservative short-window click repair for digital spikes.",
    operation: "declick_lite",
    lowHz: 1200,
    highHz: 18000,
    amountDb: -6,
    strength: 0.35,
    protectDrumAttack: true,
  },
  {
    id: "lowend_tighten_safe",
    label: "Low-End Tighten Safe",
    description: "Analysis-first low-side/sub cleanup. No low-end boost.",
    operation: "lowend_tighten_lite",
    lowHz: 20,
    highHz: 140,
    amountDb: -2,
    strength: 0.35,
  },
];