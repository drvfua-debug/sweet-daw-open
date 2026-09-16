import type { StemContaminationReport, StemFeatureReport } from "../mixDoctorTypes";
import { clamp, round1 } from "../mixDoctorAnalysisUtils";

export function analyzeStemContamination(feature: StemFeatureReport): StemContaminationReport {
  const presenceEnergy = averageBands(feature, ["1500-3000", "3000-5000"]);
  const airEnergy = averageBands(feature, ["5000-9000", "9000-12000", "12000-16000"]);
  const lowEnergy = averageBands(feature, ["20-35", "35-60", "60-120"]);
  const bodyEnergy = averageBands(feature, ["120-250", "250-500"]);
  const harshnessEnergy = averageBands(feature, ["5000-9000", "9000-12000"]);
  const metallicEnergy = averageBands(feature, ["9000-12000", "12000-16000"]);
  const vocalBleedScore = scoreFromEnergy(presenceEnergy + airEnergy * 0.35 + (feature.role === "drums" ? 8 : 0) + (feature.sideMidRatioDb < 0 ? 6 : 0));
  const cymbalMetallicScore = scoreFromEnergy(metallicEnergy + harshnessEnergy * 0.35 + (feature.role === "drums" ? 12 : 0));
  const roomWashScore = scoreFromEnergy((80 - feature.crestFactorDb) * 0.8 + (feature.spectralFlatness * 80) + (feature.role === "drums" ? 8 : 0));
  const lowEndContaminationEnergy = feature.role === "bass"
    ? lowEnergy - 14
    : lowEnergy + 8 - bodyEnergy * 0.2;
  const lowEndContaminationScore = scoreFromEnergy(lowEndContaminationEnergy);
  const artifactScore = round1(clamp((vocalBleedScore + cymbalMetallicScore + roomWashScore + lowEndContaminationScore) / 4, 0, 100));

  const warnings: string[] = [];
  if (vocalBleedScore > 58) warnings.push("Vocal bleed is high. Avoid broad presence boosts.");
  if (cymbalMetallicScore > 58) warnings.push("Cymbal metallic energy is high. Avoid bright air boosts.");
  if (roomWashScore > 58) warnings.push("Room wash is high. Avoid extra compression and reverb.");
  if (lowEndContaminationScore > 58) warnings.push("Low-end contamination is high. Keep sub work conservative.");

  return {
    stemId: feature.stemId,
    trackId: feature.trackId,
    trackName: feature.trackName,
    role: feature.role,
    vocalBleedScore: round1(vocalBleedScore),
    cymbalMetallicScore: round1(cymbalMetallicScore),
    roomWashScore: round1(roomWashScore),
    lowEndContaminationScore: round1(lowEndContaminationScore),
    artifactScore,
    warnings,
  };
}

function averageBands(feature: StemFeatureReport, bands: Array<keyof StemFeatureReport["bandEnergyDb"]>) {
  const total = bands.reduce((sum, band) => sum + feature.bandEnergyDb[band], 0);
  return total / Math.max(1, bands.length);
}

function scoreFromEnergy(energyDb: number) {
  return round1(clamp(50 + (energyDb + 25) * 2, 0, 100));
}
