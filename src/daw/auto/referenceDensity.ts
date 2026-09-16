import type { Project } from "../model/Project";
import type { ReferenceProfile } from "../mix/mixDoctorTypes";
import type { AutoReferenceMixMetrics } from "./autoReferenceMixTypes";

export function buildReferenceDensityMaster(
  master: Project["master"],
  metrics: AutoReferenceMixMetrics,
  reference: ReferenceProfile | null,
) {
  const nextMaster: Project["master"] = cloneMaster(master);
  if (!reference || !Number.isFinite(reference.crestFactorDb) || !Number.isFinite(reference.integratedLufsApprox)) {
    return {
      master: nextMaster,
      amount: 0,
      crestGapDb: 0,
      lufsGapDb: 0,
      decisions: ["Reference Density: ReferenceのCrest/LUFSが不足しているため変更しません。"],
    };
  }

  const crestGapDb = round2(metrics.crestDb - reference.crestFactorDb);
  const lufsGapDb = round2(reference.integratedLufsApprox - metrics.integratedLufs);
  const referenceTruePeakDb = Number.isFinite(reference.truePeakApproxDb) ? reference.truePeakApproxDb : -1;
  const peakGapDb = round2(metrics.truePeakDb - referenceTruePeakDb);
  const needsDensity = crestGapDb > 2.2 && (lufsGapDb > 0.6 || peakGapDb > 1.5);
  if (!needsDensity) {
    return {
      master: nextMaster,
      amount: 0,
      crestGapDb,
      lufsGapDb,
      peakGapDb,
      decisions: [`Reference Density: Crest差 ${formatSignedDb(crestGapDb)} / LUFS差 ${formatSignedDb(lufsGapDb)} / Peak差 ${formatSignedDb(peakGapDb)} のため追加圧縮なし。`],
    };
  }

  const amount = clamp(
    (crestGapDb - 1.2) / 5 +
      Math.max(0, lufsGapDb - 0.2) / 6 +
      Math.max(0, peakGapDb - 1) / 7,
    0,
    1,
  );
  nextMaster.compressor = {
    ...nextMaster.compressor,
    enabled: true,
    threshold: round2(-14.2 - amount * 5.8),
    ratio: round2(1.2 + amount * 0.6),
    attack: round2(0.03 - amount * 0.012),
    release: round2(0.22 - amount * 0.055),
    knee: round2(16 - amount * 3),
    makeupGainDb: 0,
  };
  nextMaster.limiterEnabled = nextMaster.limiterEnabled || amount > 0.45 || peakGapDb > 2;
  nextMaster.exportPeakTargetDb = Math.min(nextMaster.exportPeakTargetDb ?? -1, -1.2);

  return {
    master: nextMaster,
    amount: round2(amount),
    crestGapDb,
    lufsGapDb,
    peakGapDb,
    decisions: [
      `Reference Density: Crest差 ${formatSignedDb(crestGapDb)} / LUFS差 ${formatSignedDb(lufsGapDb)} / Peak差 ${formatSignedDb(peakGapDb)} を検出。`,
      `Reference Density: master glue ${nextMaster.compressor.ratio}:1 / threshold ${nextMaster.compressor.threshold}dB / makeup kept at 0.00dB for true-peak safety.`,
    ],
  };
}

function cloneMaster(master: Project["master"]): Project["master"] {
  return JSON.parse(JSON.stringify(master)) as Project["master"];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatSignedDb(value: number) {
  const rounded = round2(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(2)}dB`;
}
