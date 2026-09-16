import type { Track } from "@/daw/model/Project";
import { stemRoleToSweetRole, type SweetTrackRole } from "./aimixUnmaskTypes";

export function inferSweetTrackRole(track: Track): { role: SweetTrackRole; confidence: number; reason: string } {
  const text = `${track.name} ${track.role} ${track.type}`.toLowerCase();
  const named = inferFromText(text);
  if (named) return named;
  const role = stemRoleToSweetRole(track.role);
  return { role, confidence: role === "other" || role === "unknown" ? 0.45 : 0.75, reason: `Declared role: ${track.role}` };
}

function inferFromText(text: string): { role: SweetTrackRole; confidence: number; reason: string } | null {
  if (/lead vocal|main vocal|main vox|\bvox\b|vocal|ボーカル|歌/.test(text)) return { role: "lead_vocal", confidence: 0.86, reason: "Name suggests lead vocal" };
  if (/backing|bgv|harmony|chorus vocal/.test(text)) return { role: "backing_vocal", confidence: 0.82, reason: "Name suggests backing vocal" };
  if (/kick|\bbd\b/.test(text)) return { role: "kick", confidence: 0.86, reason: "Name suggests kick" };
  if (/snare|\bsd\b/.test(text)) return { role: "snare", confidence: 0.86, reason: "Name suggests snare" };
  if (/drum|beat|perc/.test(text)) return { role: "drums", confidence: 0.78, reason: "Name suggests drums" };
  if (/bass|sub|808/.test(text)) return { role: "bass", confidence: 0.84, reason: "Name suggests bass" };
  if (/guitar|gtr/.test(text)) return { role: "guitar", confidence: 0.78, reason: "Name suggests guitar" };
  if (/piano|keys|keyboard/.test(text)) return { role: "piano", confidence: 0.76, reason: "Name suggests piano/keys" };
  if (/pad|atmos|atmosphere/.test(text)) return { role: "pad", confidence: 0.74, reason: "Name suggests pad" };
  if (/synth|lead/.test(text)) return { role: "synth", confidence: 0.7, reason: "Name suggests synth" };
  if (/strings|violin|cello/.test(text)) return { role: "strings", confidence: 0.76, reason: "Name suggests strings" };
  if (/fx|riser|sweep|impact/.test(text)) return { role: "fx", confidence: 0.72, reason: "Name suggests FX" };
  if (/reverb|room|ambience/.test(text)) return { role: "reverb_return", confidence: 0.7, reason: "Name suggests ambience return" };
  return null;
}