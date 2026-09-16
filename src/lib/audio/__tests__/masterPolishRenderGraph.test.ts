import { describe, expect, it } from "vitest";
import { createEmptyProject, migrateProject } from "@/daw/model/Project";
import { buildSweetReferenceDeltaReport } from "../referenceDelta";
import { buildSweetUnifiedRenderGraph, applySweetMasterPolish2ToChannels, resolveSweetMasterPolish2Params } from "../masterPolishRenderGraph";

const SAMPLE_RATE = 48000;

describe("Master Polish 2 / Unified Render Graph v0.8", () => {
  it("describes the expected render order without skipping terminal export stages", () => {
    const graph = buildSweetUnifiedRenderGraph();
    expect(graph.id).toBe("sweet-unified-render-graph-v0.8");
    expect(graph.stages.map((stage) => stage.id)).toEqual([
      "source-clip-edit",
      "repair-region-pre-cleanup",
      "track-plugins",
      "track-gain-pan-routing",
      "aimix-unmask-priority-ducking",
      "track-summing",
      "master-repair-safety-pass",
      "master-polish-2",
      "limiter-ceiling-export-normalization",
      "wav-export-swtd-save",
    ]);
    expect(graph.stages.find((stage) => stage.id === "wav-export-swtd-save")?.previewUsesSameDsp).toBe(false);
    expect(graph.stages.filter((stage) => stage.id !== "wav-export-swtd-save").every((stage) => stage.previewUsesSameDsp && stage.exportUsesSameDsp)).toBe(true);
  });

  it("marks Master Polish 2 and Final Repair Modules as not connected when actual export wiring does not use them", () => {
    const graph = buildSweetUnifiedRenderGraph([], {
      repairRegions: true,
      aimixUnmask: true,
      masterRepairSafetyPass: false,
      masterPolish2: false,
      limiterCeilingExportNormalization: true,
    });
    const repairStage = graph.stages.find((stage) => stage.id === "master-repair-safety-pass");
    const polishStage = graph.stages.find((stage) => stage.id === "master-polish-2");

    expect(repairStage?.connected).toBe(false);
    expect(repairStage?.exportUsesSameDsp).toBe(false);
    expect(repairStage?.warnings.join(" ")).toContain("not connected");
    expect(polishStage?.connected).toBe(false);
    expect(polishStage?.exportUsesSameDsp).toBe(false);
    expect(polishStage?.warnings.join(" ")).toContain("not connected");
  });

  it("bypasses audio when disabled", () => {
    const input = mixedTone(0.35, 0.12);
    const result = applySweetMasterPolish2ToChannels(input, SAMPLE_RATE, { enabled: false });
    expect(maxAbsDiff(input[0]!, result.channels[0]!)).toBeLessThan(1e-8);
    expect(result.report.afterLufsApprox).toBe(result.report.beforeLufsApprox);
    expect(result.actions).toContain("Master Polish 2 bypassed");
    expect(result.graph.stages.find((stage) => stage.id === "master-polish-2")?.connected).toBe(false);
  });

  it("uses target profile and reference delta hints while keeping true peak under the ceiling estimate", () => {
    const input = transientHeavyMix(0.7);
    const referenceDelta = buildSweetReferenceDeltaReport({
      currentBands: {
        "20-35": -28,
        "35-60": -20,
        "60-120": -18,
        "5000-9000": -34,
        "9000-12000": -38,
        "12000-16000": -44,
        "16000-20000": -52,
      },
      referenceBands: {
        "20-35": -32,
        "35-60": -24,
        "60-120": -20,
        "5000-9000": -31,
        "9000-12000": -35,
        "12000-16000": -40,
        "16000-20000": -48,
      },
      profileId: "balanced-ai-master",
      durationSec: 32,
    });
    const params = resolveSweetMasterPolish2Params({
      enabled: true,
      profileId: "balanced-ai-master",
      targetLufsApprox: -12,
      ceilingDbTpEstimate: -1,
      lowEndControlAmount: 0.65,
      deHarshAmount: 0.35,
      deChirpAmount: 0.3,
      stereoGuardAmount: 0.55,
      peakRestoreAmount: 0.25,
      limiterDrive: 0.35,
      safeMode: true,
    });
    const result = applySweetMasterPolish2ToChannels(input, SAMPLE_RATE, params, { referenceDelta });
    expect(result.channels[0]).toHaveLength(input[0]!.length);
    expect(result.report.afterTruePeakEstimate).toBeLessThanOrEqual(params.ceilingDbTpEstimate + 0.35);
    expect(result.report.lowEndRiskAfter).toBeLessThanOrEqual(result.report.lowEndRiskBefore + 0.05);
    expect(result.targetHints.boundedBandDeltas.length).toBeGreaterThan(0);
    expect(result.actions.some((action) => action.includes("Master Polish 2"))).toBe(true);
  });

  it("stores and migrates Master Polish 2 params in the project master state", () => {
    const project = createEmptyProject();
    project.master.masterPolish2 = resolveSweetMasterPolish2Params({
      enabled: true,
      profileId: "loud-modern",
      targetLufsApprox: -9,
      limiterDrive: 0.9,
      safeMode: false,
    });
    const migrated = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(migrated.master.masterPolish2.enabled).toBe(true);
    expect(migrated.master.masterPolish2.profileId).toBe("loud-modern");
    expect(migrated.master.masterPolish2.targetLufsApprox).toBe(-9);
    expect(migrated.master.masterPolish2.limiterDrive).toBe(0.9);

    const fallback = migrateProject({ ...project, master: { ...project.master, masterPolish2: { targetLufsApprox: 99, limiterDrive: 5 } } });
    expect(fallback.master.masterPolish2.targetLufsApprox).toBeLessThanOrEqual(-6);
    expect(fallback.master.masterPolish2.limiterDrive).toBeLessThanOrEqual(1);
  });
});

function mixedTone(seconds = 0.5, gain = 0.08) {
  const length = Math.floor(SAMPLE_RATE * seconds);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    left[index] = (
      Math.sin(2 * Math.PI * 80 * t) * 0.45 +
      Math.sin(2 * Math.PI * 800 * t) * 0.35 +
      Math.sin(2 * Math.PI * 7200 * t) * 0.18
    ) * gain;
    right[index] = (
      Math.sin(2 * Math.PI * 90 * t) * 0.42 +
      Math.sin(2 * Math.PI * 1200 * t) * 0.38 +
      Math.sin(2 * Math.PI * 8500 * t) * 0.16
    ) * gain;
  }
  return [left, right];
}

function transientHeavyMix(seconds = 0.5) {
  const [left, right] = mixedTone(seconds, 0.18);
  for (let index = 0; index < left.length; index += Math.floor(SAMPLE_RATE * 0.07)) {
    left[index] = Math.min(0.92, (left[index] ?? 0) + 0.65);
    right[index] = Math.max(-0.9, (right[index] ?? 0) - 0.58);
  }
  return [left, right];
}

function maxAbsDiff(a: Float32Array, b: Float32Array) {
  let peak = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    peak = Math.max(peak, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
  }
  return peak;
}
