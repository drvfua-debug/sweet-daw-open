import type { MixPriorityRule, SweetMaskingBand, SweetMaskingBandId, SweetTrackRole } from "./aimixUnmaskTypes";

export const SWEET_MASKING_BANDS: Record<SweetMaskingBandId, SweetMaskingBand> = {
  sub: { id: "sub", label: "Sub", minHz: 20, maxHz: 45, defaultMaxReductionDb: -0.8, hardMaxReductionDb: -1.5, risk: "high" },
  bass_weight: { id: "bass_weight", label: "Bass Weight", minHz: 45, maxHz: 85, defaultMaxReductionDb: -1.2, hardMaxReductionDb: -2.5, risk: "high" },
  bass_punch: { id: "bass_punch", label: "Bass Punch", minHz: 85, maxHz: 160, defaultMaxReductionDb: -1.5, hardMaxReductionDb: -3, risk: "medium" },
  low_mud: { id: "low_mud", label: "Low Mud", minHz: 160, maxHz: 350, defaultMaxReductionDb: -1.2, hardMaxReductionDb: -2.5, risk: "medium" },
  low_mid_body: { id: "low_mid_body", label: "Low-Mid Body", minHz: 350, maxHz: 800, defaultMaxReductionDb: -1, hardMaxReductionDb: -2, risk: "medium" },
  mid_body: { id: "mid_body", label: "Mid Body", minHz: 800, maxHz: 1500, defaultMaxReductionDb: -1, hardMaxReductionDb: -2, risk: "low" },
  presence_low: { id: "presence_low", label: "Presence Low", minHz: 1500, maxHz: 2500, defaultMaxReductionDb: -1.2, hardMaxReductionDb: -2.5, risk: "medium" },
  presence: { id: "presence", label: "Presence", minHz: 2500, maxHz: 5000, defaultMaxReductionDb: -1.5, hardMaxReductionDb: -3.5, risk: "medium" },
  harsh: { id: "harsh", label: "Harsh", minHz: 5000, maxHz: 8000, defaultMaxReductionDb: -1, hardMaxReductionDb: -2, risk: "high" },
  air: { id: "air", label: "Air", minHz: 8000, maxHz: 14000, defaultMaxReductionDb: -0.6, hardMaxReductionDb: -1.2, risk: "high" },
};

export const SWEET_PRIORITY_RULES: Record<SweetTrackRole, MixPriorityRule> = {
  lead_vocal: { role: "lead_vocal", priority: 1, protectPresence: true, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["presence_low", "presence", "harsh"] },
  kick: { role: "kick", priority: 2, protectPresence: false, protectTransient: true, protectLowEnd: true, defaultTargetBands: ["bass_weight", "bass_punch"] },
  snare: { role: "snare", priority: 2, protectPresence: true, protectTransient: true, protectLowEnd: false, defaultTargetBands: ["presence", "harsh"] },
  bass: { role: "bass", priority: 3, protectPresence: false, protectTransient: false, protectLowEnd: true, defaultTargetBands: ["sub", "bass_weight", "bass_punch", "low_mud"] },
  vocal: { role: "vocal", priority: 4, protectPresence: true, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["presence_low", "presence"] },
  drums: { role: "drums", priority: 4, protectPresence: false, protectTransient: true, protectLowEnd: false, defaultTargetBands: ["bass_punch", "presence", "harsh"] },
  main_instrument: { role: "main_instrument", priority: 4, protectPresence: true, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["presence_low", "presence"] },
  backing_vocal: { role: "backing_vocal", priority: 5, protectPresence: true, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["presence_low", "presence", "harsh"] },
  guitar: { role: "guitar", priority: 5, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mid_body", "presence_low", "presence", "harsh"] },
  piano: { role: "piano", priority: 5, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mid_body", "mid_body", "presence_low"] },
  synth: { role: "synth", priority: 5, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mid_body", "mid_body", "presence"] },
  pad: { role: "pad", priority: 6, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mud", "low_mid_body", "mid_body", "presence"] },
  strings: { role: "strings", priority: 6, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mid_body", "mid_body", "presence"] },
  fx: { role: "fx", priority: 6, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["presence", "harsh", "air"] },
  reverb_return: { role: "reverb_return", priority: 6, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mud", "presence", "air"] },
  other: { role: "other", priority: 6, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mud", "low_mid_body", "presence", "harsh"] },
  unknown: { role: "unknown", priority: 6, protectPresence: false, protectTransient: false, protectLowEnd: false, defaultTargetBands: ["low_mud", "presence"] },
};

export function getPriorityForRole(role: SweetTrackRole) {
  return SWEET_PRIORITY_RULES[role] ?? SWEET_PRIORITY_RULES.unknown;
}