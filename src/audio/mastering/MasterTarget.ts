import type { MasterTargetProfileId, MasterTargetState } from "@/daw/model/Project";

export type MasterTargetPreset = Pick<
  MasterTargetState,
  | "profileId"
  | "targetIntegratedLufs"
  | "truePeakCeilingDbtp"
  | "preMasterPeakCeilingDbfs"
  | "preMasterLoudnessHintLufs"
  | "toleranceLu"
  | "headroomMode"
> & {
  label: string;
  description: string;
};

export const MASTER_TARGET_PRESETS: Record<MasterTargetProfileId, MasterTargetPreset> = {
  "reference-match": {
    profileId: "reference-match",
    label: "Reference Match",
    description: "Use the analyzed reference as the final loudness and peak guide.",
    targetIntegratedLufs: -14,
    truePeakCeilingDbtp: -1,
    preMasterPeakCeilingDbfs: -6,
    preMasterLoudnessHintLufs: -18,
    toleranceLu: 0.5,
    headroomMode: "analysis",
  },
  "streaming-safe": {
    profileId: "streaming-safe",
    label: "Streaming Safe",
    description: "Conservative master target with safe true-peak headroom.",
    targetIntegratedLufs: -14,
    truePeakCeilingDbtp: -1,
    preMasterPeakCeilingDbfs: -6,
    preMasterLoudnessHintLufs: -18,
    toleranceLu: 0.5,
    headroomMode: "analysis",
  },
  "balanced-master": {
    profileId: "balanced-master",
    label: "Balanced Master",
    description: "Default Sweet DAW target for a clear but not over-processed finish.",
    targetIntegratedLufs: -12,
    truePeakCeilingDbtp: -1,
    preMasterPeakCeilingDbfs: -6,
    preMasterLoudnessHintLufs: -18,
    toleranceLu: 0.5,
    headroomMode: "analysis",
  },
  "loud-demo": {
    profileId: "loud-demo",
    label: "Loud Demo",
    description: "Louder demo target. Warnings should win over forcing the target.",
    targetIntegratedLufs: -9,
    truePeakCeilingDbtp: -0.8,
    preMasterPeakCeilingDbfs: -6,
    preMasterLoudnessHintLufs: -17,
    toleranceLu: 0.7,
    headroomMode: "analysis",
  },
  custom: {
    profileId: "custom",
    label: "Custom",
    description: "User-defined target values.",
    targetIntegratedLufs: -12,
    truePeakCeilingDbtp: -1,
    preMasterPeakCeilingDbfs: -6,
    preMasterLoudnessHintLufs: -18,
    toleranceLu: 0.5,
    headroomMode: "analysis",
  },
};

export function resolveMasterTargetPreset(profileId: MasterTargetProfileId) {
  return MASTER_TARGET_PRESETS[profileId] ?? MASTER_TARGET_PRESETS["balanced-master"];
}
