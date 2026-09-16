import type { Project } from "@/daw/model/Project";

export const STABLE_EXPORT_SAMPLE_RATE = 48000 as const;
export type StableExportSampleRate = 44100 | 48000;

export function coerceExportSampleRateSetting(value: unknown): StableExportSampleRate {
  return value === 44100 || value === "44100" ? 44100 : STABLE_EXPORT_SAMPLE_RATE;
}

export function resolveStableExportSampleRate(project: Pick<Project, "master" | "sampleRate">): StableExportSampleRate {
  return coerceExportSampleRateSetting(project.master.exportSampleRate);
}

export function describeStableExportSampleRate(sampleRate: StableExportSampleRate) {
  return sampleRate === STABLE_EXPORT_SAMPLE_RATE
    ? "48 kHz stable export"
    : "44.1 kHz explicit export";
}
