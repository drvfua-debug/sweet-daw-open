import type { Project } from "../../model/Project";

export type RenderedWavMetrics = {
  integratedLufsApprox?: number;
  integratedLufs?: number;
  truePeakApproxDb?: number;
  truePeakDb?: number;
};

export type RenderLufsMatchResult = {
  project: Project;
  iterations: Array<{
    pass: number;
    candidateLufs: number;
    referenceLufs: number;
    candidateTruePeakDb: number;
    appliedTrimDb: number;
    finalOutputTrimDb: number;
  }>;
  passed: boolean;
  warnings: string[];
};

export async function applyRenderedReferenceLufsMatch(args: {
  project: Project;
  referenceMetrics: RenderedWavMetrics;
  render: (project: Project) => Promise<RenderedWavMetrics>;
  toleranceLu?: number;
  truePeakCeilingDb?: number;
  maxIterations?: number;
}): Promise<RenderLufsMatchResult> {
  const toleranceLu = args.toleranceLu ?? 0.5;
  const truePeakCeilingDb = args.truePeakCeilingDb ?? -1;
  const maxIterations = Math.max(1, Math.floor(args.maxIterations ?? 3));
  const referenceLufs = readLufs(args.referenceMetrics);
  const warnings: string[] = [];
  const iterations: RenderLufsMatchResult["iterations"] = [];
  let project = cloneProject(args.project);
  let passed = false;

  if (!Number.isFinite(referenceLufs)) {
    return {
      project,
      iterations,
      passed: false,
      warnings: ["Reference LUFS is not finite; final output trim was not changed."],
    };
  }

  for (let pass = 1; pass <= maxIterations; pass += 1) {
    const metrics = await args.render(project);
    const candidateLufs = readLufs(metrics);
    const candidateTruePeakDb = readTruePeak(metrics);
    if (!Number.isFinite(candidateLufs) || !Number.isFinite(candidateTruePeakDb)) {
      warnings.push("Rendered candidate metrics are not finite; final output trim stopped.");
      break;
    }

    const lufsDelta = referenceLufs - candidateLufs;
    let appliedTrimDb = 0;

    if (candidateTruePeakDb > truePeakCeilingDb) {
      appliedTrimDb = truePeakCeilingDb - candidateTruePeakDb;
      warnings.push(`True Peak safety trimmed ${round2(appliedTrimDb)}dB before matching LUFS.`);
    } else if (Math.abs(lufsDelta) <= toleranceLu) {
      passed = true;
    } else if (lufsDelta < 0) {
      appliedTrimDb = lufsDelta;
    } else {
      const upwardHeadroomDb = truePeakCeilingDb - candidateTruePeakDb - 0.05;
      if (upwardHeadroomDb <= 0) {
        warnings.push("Reference LUFS is higher, but True Peak headroom blocks upward final trim.");
      } else {
        appliedTrimDb = Math.min(lufsDelta, upwardHeadroomDb);
        if (appliedTrimDb < lufsDelta - 0.05) {
          warnings.push(`Upward trim was limited by True Peak headroom from ${round2(lufsDelta)}dB to ${round2(appliedTrimDb)}dB.`);
        }
      }
    }

    if (Math.abs(appliedTrimDb) > 0.01) {
      project = withFinalOutputTrim(project, appliedTrimDb);
    }

    iterations.push({
      pass,
      candidateLufs: round2(candidateLufs),
      referenceLufs: round2(referenceLufs),
      candidateTruePeakDb: round2(candidateTruePeakDb),
      appliedTrimDb: round2(appliedTrimDb),
      finalOutputTrimDb: round2(project.master.finalOutputTrimDb ?? 0),
    });

    if (passed) break;
    if (Math.abs(appliedTrimDb) <= 0.01) break;
  }

  if (!passed && iterations.length > 0) {
    const finalIteration = iterations[iterations.length - 1];
    passed =
      Math.abs(finalIteration.candidateLufs - finalIteration.referenceLufs) <= toleranceLu &&
      finalIteration.candidateTruePeakDb <= truePeakCeilingDb;
  }

  if (!passed) {
    warnings.push("Rendered LUFS match did not reach target tolerance within the iteration limit.");
  }

  return {
    project,
    iterations,
    passed,
    warnings,
  };
}

function withFinalOutputTrim(project: Project, trimDeltaDb: number): Project {
  return {
    ...project,
    master: {
      ...project.master,
      finalOutputTrimDb: round2(clamp((project.master.finalOutputTrimDb ?? 0) + trimDeltaDb, -18, 3)),
      finalOutputTrimOwner: "reference-match",
    },
    updatedAt: new Date().toISOString(),
  };
}

function readLufs(metrics: RenderedWavMetrics) {
  return finite(metrics.integratedLufsApprox, metrics.integratedLufs, NaN);
}

function readTruePeak(metrics: RenderedWavMetrics) {
  return finite(metrics.truePeakApproxDb, metrics.truePeakDb, NaN);
}

function finite(...values: Array<number | undefined>) {
  return values.find((value) => Number.isFinite(value)) ?? NaN;
}

function cloneProject(project: Project): Project {
  if (typeof structuredClone === "function") return structuredClone(project);
  return JSON.parse(JSON.stringify(project)) as Project;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
