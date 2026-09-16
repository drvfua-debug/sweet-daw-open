import { DEFAULT_SWEET_MASTER_TARGET_PROFILE_ID, getSweetMasterTargetProfile, isSweetMasterTargetProfileId, type SweetMasterTargetProfileId } from "./targetProfiles.ts";

export interface SweetMasterPolish2Params {
  enabled: boolean;
  profileId: SweetMasterTargetProfileId;
  targetLufsApprox: number;
  ceilingDbTpEstimate: number;
  headroomPrepAmount: number;
  lowEndControlAmount: number;
  deHarshAmount: number;
  deChirpAmount: number;
  stereoGuardAmount: number;
  peakRestoreAmount: number;
  limiterDrive: number;
  equalLoudnessAB: boolean;
  safeMode: boolean;
}

export interface SweetMasterPolish2Report {
  beforeLufsApprox: number;
  afterLufsApprox: number;
  beforeTruePeakEstimate: number;
  afterTruePeakEstimate: number;
  gainReductionPeakDb: number;
  lowEndRiskBefore: number;
  lowEndRiskAfter: number;
  harshRiskBefore: number;
  harshRiskAfter: number;
  warnings: string[];
}

export function createDefaultSweetMasterPolish2Params(profileId: SweetMasterTargetProfileId = DEFAULT_SWEET_MASTER_TARGET_PROFILE_ID): SweetMasterPolish2Params {
  const profile = getSweetMasterTargetProfile(profileId);
  return {
    enabled: false,
    profileId: profile.id,
    targetLufsApprox: profile.targetLufsApprox,
    ceilingDbTpEstimate: profile.ceilingDbTpEstimate,
    headroomPrepAmount: 0.42,
    lowEndControlAmount: 0.46,
    deHarshAmount: 0.34,
    deChirpAmount: 0.28,
    stereoGuardAmount: 0.4,
    peakRestoreAmount: 0.22,
    limiterDrive: 0.36,
    equalLoudnessAB: true,
    safeMode: true,
  };
}

export function sanitizeSweetMasterPolish2Params(value: unknown): SweetMasterPolish2Params {
  const fallback = createDefaultSweetMasterPolish2Params();
  if (!isRecord(value)) return fallback;
  const profileId = isSweetMasterTargetProfileId(value.profileId) ? value.profileId : fallback.profileId;
  const profile = getSweetMasterTargetProfile(profileId);
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    profileId,
    targetLufsApprox: clampNumber(numberOr(value.targetLufsApprox, profile.targetLufsApprox), -24, -6),
    ceilingDbTpEstimate: clampNumber(numberOr(value.ceilingDbTpEstimate, profile.ceilingDbTpEstimate), -6, -0.1),
    headroomPrepAmount: clampNumber(numberOr(value.headroomPrepAmount, fallback.headroomPrepAmount), 0, 1),
    lowEndControlAmount: clampNumber(numberOr(value.lowEndControlAmount, fallback.lowEndControlAmount), 0, 1),
    deHarshAmount: clampNumber(numberOr(value.deHarshAmount, fallback.deHarshAmount), 0, 1),
    deChirpAmount: clampNumber(numberOr(value.deChirpAmount, fallback.deChirpAmount), 0, 1),
    stereoGuardAmount: clampNumber(numberOr(value.stereoGuardAmount, fallback.stereoGuardAmount), 0, profile.maxStereoWiden > 0.16 ? 1 : 0.72),
    peakRestoreAmount: clampNumber(numberOr(value.peakRestoreAmount, fallback.peakRestoreAmount), 0, 1),
    limiterDrive: clampNumber(numberOr(value.limiterDrive, fallback.limiterDrive), 0, 1),
    equalLoudnessAB: typeof value.equalLoudnessAB === "boolean" ? value.equalLoudnessAB : fallback.equalLoudnessAB,
    safeMode: value.safeMode !== false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
