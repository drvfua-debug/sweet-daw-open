import type { SingleFileMasteringSettings } from "./singleFileMastering";

export type ReferenceTonalSnapshot = {
  presence: number;
  air: number;
  gloss: number;
  ultra: number;
  sheen: number;
};

export type ReferenceMasterPlan = {
  presenceDb: number;
  presenceFocusDb: number;
  airDb: number;
  glossDb: number;
  sheenDb: number;
  glossMidOnly: boolean;
  sheenMidOnly: boolean;
  tonalMoveBudgetDb: number;
  reasons: string[];
};

export type ReferenceMasterPlanOptions = {
  blockHighShelfBoost: boolean;
  preferMidOnlySheen: boolean;
};

export function buildReferenceMasterPlan(
  settings: SingleFileMasteringSettings,
  snapshot: ReferenceTonalSnapshot,
  options: ReferenceMasterPlanOptions,
): ReferenceMasterPlan | null {
  if (settings.mode !== "referenceCatchUp" || settings.referenceClarityMode !== "catchUp") return null;

  const target = {
    presence: finiteOptional(settings.referencePresenceDb),
    air: finiteOptional(settings.referenceAirDb),
    gloss: finiteOptional(settings.referenceGlossDb),
    ultra: finiteOptional(settings.referenceUltraAirDb),
    sheen: finiteOptional(settings.referenceSheenDb),
  };
  if (target.presence == null && target.air == null && target.gloss == null && target.ultra == null && target.sheen == null) {
    return null;
  }

  const reasons: string[] = [];
  let presenceDb = 0;
  let presenceFocusDb = 0;
  let airDb = 0;
  let glossDb = 0;
  let sheenDb = 0;
  let glossMidOnly = false;
  let sheenMidOnly = false;

  if (target.presence != null) {
    const gapDb = target.presence - snapshot.presence;
    const excessDb = snapshot.presence - target.presence;
    if (gapDb > 1.05) {
      presenceDb = clamp((gapDb - 0.65) * (settings.falseAirRisk ? 0.36 : 0.28), 0.12, settings.falseAirRisk ? 0.95 : 0.68);
      if (gapDb > 1.65) presenceFocusDb = clamp((gapDb - 1.35) * 0.14, 0.06, settings.falseAirRisk ? 0.28 : 0.2);
      reasons.push("presence below reference");
    } else if (excessDb > 1.15) {
      presenceDb = -clamp((excessDb - 0.7) * 0.36, 0.12, 0.72);
      reasons.push("presence above reference");
    }
  }

  if (target.air != null) {
    const gapDb = target.air - snapshot.air;
    const excessDb = snapshot.air - target.air;
    if (gapDb > 1.25 && !options.blockHighShelfBoost) {
      airDb = clamp((gapDb - 0.95) * 0.07, 0.04, 0.18);
      reasons.push("air below reference");
    } else if (excessDb > 1.35) {
      airDb = -clamp((excessDb - 0.9) * 0.18, 0.08, 0.42);
      reasons.push("air above reference");
    }
  }

  if (target.gloss != null) {
    const gapDb = target.gloss - snapshot.gloss;
    const excessDb = snapshot.gloss - target.gloss;
    if (gapDb > 1.25) {
      glossDb = clamp((gapDb - 0.95) * (options.blockHighShelfBoost ? 0.2 : 0.12), 0.08, options.blockHighShelfBoost ? 0.72 : 0.36);
      glossMidOnly = options.blockHighShelfBoost;
      reasons.push(glossMidOnly ? "gloss below reference with high-side protection" : "gloss below reference");
    } else if (excessDb > 1.2) {
      glossDb = -clamp((excessDb - 0.8) * 0.24, 0.1, 0.62);
      reasons.push("gloss above reference");
    }
  }

  if (target.ultra != null || target.sheen != null) {
    const ultraGapDb = target.ultra == null ? 0 : target.ultra - snapshot.ultra;
    const sheenGapDb = target.sheen == null ? 0 : target.sheen - snapshot.sheen;
    const requestedDb = Math.max(ultraGapDb - 1.35, sheenGapDb - 1.8);
    if (requestedDb > 0.1) {
      sheenDb = clamp(requestedDb * (options.preferMidOnlySheen ? 0.46 : 0.22), 0.08, options.preferMidOnlySheen ? 1.2 : 0.5);
      sheenMidOnly = options.preferMidOnlySheen;
      reasons.push(sheenMidOnly ? "sheen below reference with mid-only protection" : "sheen below reference");
    }
  }

  if ((settings.referenceMidGlossShiftDb ?? 0) > 0.05) {
    if (glossDb > 0) glossDb = Math.min(glossDb, 0.32);
    if (sheenMidOnly && sheenDb > 0) sheenDb = Math.min(sheenDb, 0.65);
    reasons.push("measured mid-gloss move already reserved");
  }

  return {
    presenceDb,
    presenceFocusDb,
    airDb,
    glossDb,
    sheenDb,
    glossMidOnly,
    sheenMidOnly,
    tonalMoveBudgetDb: round2(Math.abs(presenceDb) + Math.abs(presenceFocusDb) + Math.abs(airDb) + Math.abs(glossDb) + Math.abs(sheenDb)),
    reasons,
  };
}

export function capReferenceMasterPlan(plan: ReferenceMasterPlan, maxMoveDb: number): ReferenceMasterPlan {
  const capMove = (value: number) => clamp(value, -maxMoveDb, maxMoveDb);
  const presenceDb = capMove(plan.presenceDb);
  const presenceFocusDb = capMove(plan.presenceFocusDb);
  const airDb = capMove(plan.airDb);
  const glossDb = capMove(plan.glossDb);
  const sheenDb = capMove(plan.sheenDb);
  return {
    ...plan,
    presenceDb,
    presenceFocusDb,
    airDb,
    glossDb,
    sheenDb,
    tonalMoveBudgetDb: round2(Math.abs(presenceDb) + Math.abs(presenceFocusDb) + Math.abs(airDb) + Math.abs(glossDb) + Math.abs(sheenDb)),
  };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function finiteOptional(value: number | null | undefined) {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
