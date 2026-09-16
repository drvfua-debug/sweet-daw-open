import { describe, expect, it } from "vitest";
import {
  capPeakMaximizerOversample,
  resolveEngineProcessingBudget,
  resolveEngineQualityMode,
} from "./EngineQualityMode";

describe("EngineQualityMode", () => {
  it("detects mobile export from iPhone-like runtime hints", () => {
    expect(resolveEngineQualityMode(undefined, {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Mobile",
      preferExport: true,
    })).toBe("mobile-export");
  });

  it("keeps desktop export as the highest browser-safe budget", () => {
    const budget = resolveEngineProcessingBudget("desktop-export");

    expect(budget.loudnessQuality).toBe("offline-best");
    expect(budget.truePeakOversample).toBe(4);
    expect(budget.peakMaxOversampleCap).toBe("4x");
    expect(budget.allowHeavySpectral).toBe(true);
  });

  it("caps mobile export PeakMax oversampling to keep memory predictable", () => {
    const budget = resolveEngineProcessingBudget("mobile-export");

    expect(capPeakMaximizerOversample("4x", budget.peakMaxOversampleCap)).toBe("2x");
    expect(budget.allowCandidateRender).toBe(false);
  });

  it("keeps analysis-only lightweight and non-destructive", () => {
    const budget = resolveEngineProcessingBudget("analysis-only");

    expect(budget.loudnessQuality).toBe("fast");
    expect(budget.peakMaxOversampleCap).toBe("off");
    expect(budget.allowHeavySpectral).toBe(false);
    expect(budget.allowCandidateRender).toBe(false);
  });
});
