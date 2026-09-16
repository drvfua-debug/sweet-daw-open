import type { SweetStemRole } from "./referenceDelta";

export interface SweetStemRoleProfile {
  role: SweetStemRole;
  label: string;
  allowRoleDelta: boolean;
  centerProtected: boolean;
  priorityBands: string[];
  warning?: string;
}

export const SWEET_STEM_ROLE_PROFILES: SweetStemRoleProfile[] = [
  { role: "lead-vocal", label: "Lead Vocal", allowRoleDelta: true, centerProtected: true, priorityBands: ["500-900", "900-1500", "1500-3000", "3000-5000"] },
  { role: "backing-vocal", label: "Backing Vocal", allowRoleDelta: true, centerProtected: false, priorityBands: ["900-1500", "1500-3000", "3000-5000"] },
  { role: "drums", label: "Drums", allowRoleDelta: true, centerProtected: true, priorityBands: ["60-120", "3000-5000", "5000-9000"] },
  { role: "kick", label: "Kick", allowRoleDelta: true, centerProtected: true, priorityBands: ["35-60", "60-120"] },
  { role: "snare", label: "Snare", allowRoleDelta: true, centerProtected: true, priorityBands: ["1500-3000", "3000-5000", "5000-9000"] },
  { role: "bass", label: "Bass", allowRoleDelta: true, centerProtected: true, priorityBands: ["35-60", "60-120", "120-250"] },
  { role: "guitar", label: "Guitar", allowRoleDelta: true, centerProtected: false, priorityBands: ["250-500", "900-1500", "1500-3000"] },
  { role: "keys", label: "Keys", allowRoleDelta: true, centerProtected: false, priorityBands: ["120-250", "250-500", "1500-3000"] },
  { role: "synth", label: "Synth", allowRoleDelta: true, centerProtected: false, priorityBands: ["250-500", "1500-3000", "5000-9000"] },
  { role: "pad", label: "Pad", allowRoleDelta: true, centerProtected: false, priorityBands: ["500-900", "900-1500", "5000-9000"] },
  { role: "fx", label: "FX", allowRoleDelta: true, centerProtected: false, priorityBands: ["3000-5000", "5000-9000", "9000-12000"] },
  { role: "other", label: "Other", allowRoleDelta: true, centerProtected: false, priorityBands: ["500-900", "1500-3000"] },
  { role: "master", label: "Master", allowRoleDelta: false, centerProtected: true, priorityBands: [], warning: "Master-only analysis should stay broad and should not invent stem separation." },
];

export function getSweetStemRoleProfile(role: SweetStemRole | string | null | undefined): SweetStemRoleProfile {
  return SWEET_STEM_ROLE_PROFILES.find((profile) => profile.role === role) ?? SWEET_STEM_ROLE_PROFILES.find((profile) => profile.role === "other")!;
}

export function normalizeSweetStemRole(role: string | null | undefined): SweetStemRole {
  if (!role) return "other";
  const value = role.replace(/_/g, "-").toLowerCase();
  if (value === "vocal" || value === "lead" || value === "lead-vocals") return "lead-vocal";
  if (value === "backingvocal" || value === "backing-vocals" || value === "backing-vocal") return "backing-vocal";
  if (value === "music" || value === "main-instrument") return "other";
  if (value === "piano" || value === "keyboard") return "keys";
  if (value === "reference") return "master";
  if (isSweetStemRole(value)) return value;
  return "other";
}

function isSweetStemRole(value: string): value is SweetStemRole {
  return ["lead-vocal", "backing-vocal", "drums", "kick", "snare", "bass", "guitar", "keys", "synth", "pad", "fx", "other", "master"].includes(value);
}