export type SweetMasterTargetProfileId =
  | "safe-streaming-ish"
  | "balanced-ai-master"
  | "loud-modern"
  | "club-low-end"
  | "vocal-forward"
  | "custom";

export interface SweetMasterTargetProfile {
  id: SweetMasterTargetProfileId;
  label: string;
  description: string;
  targetLufsApprox: number;
  ceilingDbTpEstimate: number;
  maxReferenceDeltaDb: number;
  maxHighBoostDb: number;
  maxLowBoostDb: number;
  maxStereoWiden: number;
  allowExciter: boolean;
  warnings: string[];
}

export const SWEET_MASTER_TARGET_PROFILES: SweetMasterTargetProfile[] = [
  {
    id: "safe-streaming-ish",
    label: "Safe",
    description: "Referenceを安全な目安に留め、音色変化と音圧上昇を控えめにします。",
    targetLufsApprox: -14,
    ceilingDbTpEstimate: -1,
    maxReferenceDeltaDb: 1.5,
    maxHighBoostDb: 0.8,
    maxLowBoostDb: 0.7,
    maxStereoWiden: 0.12,
    allowExciter: false,
    warnings: ["Referenceは100%一致ではなく、安全上限付きの提案として扱います。"],
  },
  {
    id: "balanced-ai-master",
    label: "Balanced",
    description: "Sweet DAW標準。AI stemを壊しにくい範囲でReference傾向を取り入れます。",
    targetLufsApprox: -11,
    ceilingDbTpEstimate: -1,
    maxReferenceDeltaDb: 2,
    maxHighBoostDb: 1.1,
    maxLowBoostDb: 0.9,
    maxStereoWiden: 0.2,
    allowExciter: true,
    warnings: ["8kHz以上の持ち上げはAI artifactを強調しない範囲に制限します。"],
  },
  {
    id: "loud-modern",
    label: "Loud",
    description: "現代的な音圧を狙いますが、Reference差分のEQ量は強くしすぎません。",
    targetLufsApprox: -9,
    ceilingDbTpEstimate: -0.8,
    maxReferenceDeltaDb: 1.5,
    maxHighBoostDb: 0.8,
    maxLowBoostDb: 0.6,
    maxStereoWiden: 0.14,
    allowExciter: false,
    warnings: ["音圧優先時は質感補正を控えめにし、Limiterで潰しすぎないでください。"],
  },
  {
    id: "club-low-end",
    label: "Club Low-End",
    description: "低域の所有者整理を優先します。低域boostはReferenceが示しても慎重に制限します。",
    targetLufsApprox: -9.5,
    ceilingDbTpEstimate: -1,
    maxReferenceDeltaDb: 1.8,
    maxHighBoostDb: 0.9,
    maxLowBoostDb: 0.45,
    maxStereoWiden: 0.1,
    allowExciter: false,
    warnings: ["Kick/Bass競合とSide低域整理を優先し、20-120Hzの単純boostは抑制します。"],
  },
  {
    id: "vocal-forward",
    label: "Vocal Forward",
    description: "Vocalの前後関係を優先し、Other duckingとpresence整理の目安を作ります。",
    targetLufsApprox: -11.5,
    ceilingDbTpEstimate: -1,
    maxReferenceDeltaDb: 1.8,
    maxHighBoostDb: 1,
    maxLowBoostDb: 0.7,
    maxStereoWiden: 0.16,
    allowExciter: true,
    warnings: ["Vocal帯域は単純boostではなく、他トラックのmasking整理を優先してください。"],
  },
  {
    id: "custom",
    label: "Custom",
    description: "ユーザー調整用。初期値はBalanced相当ですが、UI側で編集可能です。",
    targetLufsApprox: -11,
    ceilingDbTpEstimate: -1,
    maxReferenceDeltaDb: 2,
    maxHighBoostDb: 1.1,
    maxLowBoostDb: 0.9,
    maxStereoWiden: 0.2,
    allowExciter: true,
    warnings: ["Custom値もReference Delta計算では安全上限として扱います。"],
  },
];

export const DEFAULT_SWEET_MASTER_TARGET_PROFILE_ID: SweetMasterTargetProfileId = "balanced-ai-master";

export function getSweetMasterTargetProfile(id: SweetMasterTargetProfileId | string | null | undefined): SweetMasterTargetProfile {
  return SWEET_MASTER_TARGET_PROFILES.find((profile) => profile.id === id) ?? SWEET_MASTER_TARGET_PROFILES.find((profile) => profile.id === DEFAULT_SWEET_MASTER_TARGET_PROFILE_ID)!;
}

export function isSweetMasterTargetProfileId(value: unknown): value is SweetMasterTargetProfileId {
  return typeof value === "string" && SWEET_MASTER_TARGET_PROFILES.some((profile) => profile.id === value);
}