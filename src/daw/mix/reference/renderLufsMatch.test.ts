import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../../model/Project";
import { applyRenderedReferenceLufsMatch } from "./renderLufsMatch";

describe("applyRenderedReferenceLufsMatch", () => {
  it("uses finalOutputTrimDb instead of master gain for rendered LUFS matching", async () => {
    const project = createEmptyProject();
    project.master.gainDb = 1.5;
    const result = await applyRenderedReferenceLufsMatch({
      project,
      referenceMetrics: { integratedLufsApprox: -16, truePeakApproxDb: -2 },
      render: async (candidate) => ({
        integratedLufsApprox: -12 + (candidate.master.finalOutputTrimDb ?? 0),
        truePeakApproxDb: -3 + (candidate.master.finalOutputTrimDb ?? 0),
      }),
    });

    expect(result.passed).toBe(true);
    expect(result.project.master.gainDb).toBe(1.5);
    expect(result.project.master.finalOutputTrimDb).toBeCloseTo(-4, 2);
    expect(result.project.master.finalOutputTrimOwner).toBe("reference-match");
  });

  it("blocks upward trim when true peak has no headroom", async () => {
    const project = createEmptyProject();
    const result = await applyRenderedReferenceLufsMatch({
      project,
      referenceMetrics: { integratedLufsApprox: -10, truePeakApproxDb: -1 },
      render: async (candidate) => ({
        integratedLufsApprox: -14 + (candidate.master.finalOutputTrimDb ?? 0),
        truePeakApproxDb: -1.02 + (candidate.master.finalOutputTrimDb ?? 0),
      }),
      truePeakCeilingDb: -1,
    });

    expect(result.passed).toBe(false);
    expect(result.project.master.finalOutputTrimDb).toBe(0);
    expect(result.warnings.join(" ")).toContain("headroom blocks upward final trim");
  });

  it("prioritizes true peak safety before LUFS tolerance", async () => {
    const project = createEmptyProject();
    const result = await applyRenderedReferenceLufsMatch({
      project,
      referenceMetrics: { integratedLufsApprox: -12, truePeakApproxDb: -2 },
      render: async (candidate) => ({
        integratedLufsApprox: -12 + (candidate.master.finalOutputTrimDb ?? 0),
        truePeakApproxDb: -0.4 + (candidate.master.finalOutputTrimDb ?? 0),
      }),
      truePeakCeilingDb: -1,
    });

    expect(result.project.master.finalOutputTrimDb).toBeLessThanOrEqual(-0.6);
    expect(result.warnings.join(" ")).toContain("True Peak safety");
  });
});
