import type { StemContaminationReport, StemFeatureReport, StemPurityReport, VirtualComponent } from "../mixDoctorTypes";
import { clamp, round1 } from "../mixDoctorAnalysisUtils";
import { analyzeStemContamination } from "./contaminationAnalyzer";

export function analyzeStemPurity(feature: StemFeatureReport): { purityReport: StemPurityReport; contaminationReport: StemContaminationReport } {
  const contaminationReport = analyzeStemContamination(feature);
  const artifactExcess = Math.max(0, contaminationReport.artifactScore - 50);
  const roomWashExcess = Math.max(0, contaminationReport.roomWashScore - 50);
  const purityScore = round1(clamp(100 - artifactExcess * 1.05 - roomWashExcess * 0.2, 0, 100));
  const mode: StemPurityReport["mode"] =
    purityScore >= 75 ? "normal_track_processing_allowed" : purityScore >= 45 ? "component_safe_processing_only" : "manual_review_or_de_bleed_first";
  const dominantComponents = getDominantComponents(feature, contaminationReport);
  const protectedComponents = getProtectedComponents(feature.role);
  const notes = [...contaminationReport.warnings];

  if (mode === "component_safe_processing_only") {
    notes.push("Use component-safe processing only until the bleed is cleaned up.");
  }
  if (mode === "manual_review_or_de_bleed_first") {
    notes.push("This stem should be reviewed before broad EQ, compression, or widening.");
  }

  return {
    contaminationReport,
    purityReport: {
      stemId: feature.stemId,
      trackId: feature.trackId,
      trackName: feature.trackName,
      role: feature.role,
      purityScore,
      mode,
      dominantComponents,
      protectedComponents,
      notes,
    },
  };
}

function getDominantComponents(feature: StemFeatureReport, contamination: StemContaminationReport): VirtualComponent[] {
  const components: VirtualComponent[] = [];
  if (feature.role === "drums") {
    components.push("kick_like", "snare_like", "cymbal_like");
  } else if (feature.role === "bass") {
    components.push("kick_like", "residual");
  } else if (feature.role === "vocal" || feature.role === "backingVocal") {
    components.push("vocal_bleed_like", "tonal_bleed_like");
  } else {
    components.push("tonal_bleed_like", "residual");
  }

  if (contamination.roomWashScore > 58) components.push("room_wash_like");
  if (contamination.cymbalMetallicScore > 58) components.push("cymbal_like");
  if (contamination.vocalBleedScore > 58) components.push("vocal_bleed_like");
  if (contamination.lowEndContaminationScore > 58) components.push("tonal_bleed_like");

  return Array.from(new Set(components));
}

function getProtectedComponents(role: StemFeatureReport["role"]): VirtualComponent[] {
  if (role === "vocal" || role === "backingVocal") return ["vocal_bleed_like"];
  if (role === "drums") return ["kick_like", "snare_like"];
  if (role === "bass") return ["kick_like"];
  return ["residual"];
}
