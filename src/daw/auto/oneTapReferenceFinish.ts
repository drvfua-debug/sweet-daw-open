import type { Project } from "@/daw/model/Project";
import type { AutoReferenceMixRuntime, AutoReferenceMixSettings } from "./autoReferenceMixTypes";

export type OneTapReferenceFinishStatus =
  | "missing-stems"
  | "missing-reference"
  | "ready"
  | "running"
  | "done"
  | "warning"
  | "error";

export type OneTapReferenceFinishState = {
  status: OneTapReferenceFinishStatus;
  title: string;
  message: string;
  primaryLabel: string;
  disabled: boolean;
  canRun: boolean;
  referenceTrackCount: number;
  workTrackCount: number;
  workClipCount: number;
  lastResultStatus?: string;
  warnings: string[];
};

const RUNNING_STATUSES = new Set([
  "analyzing-reference",
  "aligning-reference",
  "applying-aimix-reference",
  "trying-spatial-auto",
]);

export function buildOneTapReferenceFinishState(
  project: Project,
  runtime: AutoReferenceMixRuntime,
  settings: AutoReferenceMixSettings,
): OneTapReferenceFinishState {
  const referenceTrackCount = project.tracks.filter((track) => track.role === "reference" || track.type === "reference").length;
  const workTrackIds = new Set(
    project.tracks
      .filter((track) => track.role !== "reference" && track.type !== "reference")
      .map((track) => track.id),
  );
  const workTrackCount = workTrackIds.size;
  const workClipCount = project.clips.filter((clip) => workTrackIds.has(clip.trackId)).length;
  const warnings = runtime.vocalClarityGate?.warnings.slice(0, 3) ?? [];
  const hasReference = referenceTrackCount > 0;
  const title = hasReference ? "Reference One-Tap Finish" : "One-Tap Finish";

  if (workTrackCount === 0 || workClipCount === 0) {
    return {
      status: "missing-stems",
      title,
      message: "Import at least one stem or work WAV first.",
      primaryLabel: "Import stems",
      disabled: true,
      canRun: false,
      referenceTrackCount,
      workTrackCount,
      workClipCount,
      lastResultStatus: runtime.status,
      warnings,
    };
  }

  if (!hasReference && settings.requireReference) {
    return {
      status: "missing-reference",
      title,
      message: "This mode requires a Reference WAV. Turn off Require Reference to use Sweet No-Reference Finish.",
      primaryLabel: "Import Reference",
      disabled: true,
      canRun: false,
      referenceTrackCount,
      workTrackCount,
      workClipCount,
      lastResultStatus: runtime.status,
      warnings,
    };
  }

  if (RUNNING_STATUSES.has(runtime.status)) {
    return {
      status: "running",
      title,
      message: runtime.message ?? "One-Tap Finish is running.",
      primaryLabel: "Processing...",
      disabled: true,
      canRun: false,
      referenceTrackCount,
      workTrackCount,
      workClipCount,
      lastResultStatus: runtime.status,
      warnings,
    };
  }

  if (runtime.status === "error") {
    return {
      status: "error",
      title,
      message: runtime.message ?? "One-Tap Finish failed.",
      primaryLabel: "Run again",
      disabled: false,
      canRun: true,
      referenceTrackCount,
      workTrackCount,
      workClipCount,
      lastResultStatus: runtime.status,
      warnings,
    };
  }

  if (runtime.status === "warning") {
    return {
      status: "warning",
      title,
      message: runtime.message ?? "One-Tap Finish completed with warnings. Check Advanced details if needed.",
      primaryLabel: "Run again",
      disabled: false,
      canRun: true,
      referenceTrackCount,
      workTrackCount,
      workClipCount,
      lastResultStatus: runtime.status,
      warnings,
    };
  }

  if (
    runtime.status === "accepted-aimix-reference" ||
    runtime.status === "accepted-sweet-no-reference" ||
    runtime.status === "accepted-spatial-auto" ||
    runtime.status === "accepted-sweet-no-reference-spatial" ||
    runtime.status === "reverted-spatial-auto" ||
    runtime.status === "reverted-sweet-no-reference-spatial"
  ) {
    return {
      status: "done",
      title,
      message: runtime.message ?? (hasReference
        ? "Reference-based finish was applied. Continue to export after checking A/B."
        : "Sweet No-Reference Finish was applied. Continue to export after checking A/B."),
      primaryLabel: hasReference ? "Run Reference Finish again" : "Run No-Reference Finish again",
      disabled: false,
      canRun: true,
      referenceTrackCount,
      workTrackCount,
      workClipCount,
      lastResultStatus: runtime.status,
      warnings,
    };
  }

  return {
    status: "ready",
    title,
    message: hasReference
      ? "Reference is loaded. One-Tap will align loudness, tonal balance, density, and spatial safety toward the Reference."
      : "No Reference is loaded. One-Tap will use Sweet DAW's internal pro-safe target for clearer, safer stem output.",
    primaryLabel: hasReference ? "Run Reference Finish" : "Run No-Reference Finish",
    disabled: false,
    canRun: true,
    referenceTrackCount,
    workTrackCount,
    workClipCount,
    lastResultStatus: runtime.status,
    warnings,
  };
}
