import { describe, expect, it } from "vitest";
import { createEmptyProject, migrateProject } from "@/daw/model/Project";
import { createSpectralRepairRegion } from "@/daw/repair/repairTypes";
import { createPluginInstance } from "@/audio/plugins/pluginRegistry";
import type { SweetUnmaskOperation } from "@/daw/aimixUnmask/aimixUnmaskTypes";
import { SweetProcessingQueue } from "../processingJobs";
import {
  collectSweetExportAppliedOperations,
  createSweetExportProcessingReportFromProject,
  createSweetProjectAnalysisCacheSummary,
  runSweetQueuedPcmExport,
} from "../exportQueue";

describe("Export Queue / Analysis Cache / Project Persistence v0.9", () => {
  it("runs a queued PCM export with monotonic progress and preserves samples by default", async () => {
    const queue = new SweetProcessingQueue();
    const left = makeRamp(4800, 0.25);
    const right = makeRamp(4800, -0.25);
    const percents: number[] = [];

    const result = await runSweetQueuedPcmExport({
      jobId: "export-test",
      queue,
      channels: [left, right],
      sampleRate: 4800,
      preferredChunkSeconds: 0.2,
      onProgress: (progress) => percents.push(progress.percent),
    });

    expect(result.jobId).toBe("export-test");
    expect(queue.getJob("export-test")?.status).toBe("done");
    expect(result.channels[0]).toEqual(left);
    expect(result.channels[1]).toEqual(right);
    expect(result.report.durationSec).toBe(1);
    expect(result.report.sampleRate).toBe(4800);
    expect(result.report.channels).toBe(2);
    expect(percents[0]).toBe(0);
    expect(percents.at(-1)).toBe(100);
    for (let index = 1; index < percents.length; index += 1) {
      expect(percents[index]!).toBeGreaterThanOrEqual(percents[index - 1]!);
    }
  });

  it("marks queued exports as cancelled when the signal aborts", async () => {
    const queue = new SweetProcessingQueue();
    const controller = new AbortController();
    let processed = 0;

    await expect(runSweetQueuedPcmExport({
      jobId: "export-cancel",
      queue,
      channels: [makeRamp(5000, 0.1)],
      sampleRate: 1000,
      preferredChunkSeconds: 1,
      signal: controller.signal,
      processChunk: (chunk, channels) => {
        processed += 1;
        if (processed === 2) controller.abort();
        return channels;
      },
    })).rejects.toMatchObject({ name: "AbortError" });

    expect(queue.getJob("export-cancel")?.status).toBe("cancelled");
    expect(processed).toBe(2);
  });

  it("returns processed PCM channels so master WAV export can encode the queued result", async () => {
    const input = new Float32Array([0.2, -0.4, 0.6, -0.8]);
    const result = await runSweetQueuedPcmExport({
      channels: [input],
      sampleRate: 4,
      preferredChunkSeconds: 0.5,
      processChunk: (_chunk, channels) => channels.map((channel) => {
        const output = new Float32Array(channel.length);
        for (let index = 0; index < channel.length; index += 1) {
          output[index] = (channel[index] ?? 0) * 0.5;
        }
        return output;
      }),
    });

    expect(Array.from(result.channels[0] ?? []).map((value) => round3(value))).toEqual([0.1, -0.2, 0.3, -0.4]);
    expect(result.report.truePeakEstimate?.after).toBeLessThan(result.report.truePeakEstimate?.before ?? 0);
  });

  it("can stream processed chunks without retaining a full output buffer", async () => {
    const input = makeRamp(5000, 0.5);
    const streamed: number[] = [];
    const result = await runSweetQueuedPcmExport({
      channels: [input],
      sampleRate: 1000,
      preferredChunkSeconds: 2,
      outputMode: "stream",
      processChunk: (_chunk, channels) => channels.map((channel) => {
        const output = new Float32Array(channel.length);
        for (let index = 0; index < channel.length; index += 1) output[index] = (channel[index] ?? 0) * 0.25;
        return output;
      }),
      onChunkOutput: (_chunk, channels) => {
        streamed.push(channels[0]?.length ?? 0);
      },
    });

    expect(result.channels).toHaveLength(0);
    expect(result.streamed).toBe(true);
    expect(streamed).toEqual([2000, 2000, 1000]);
    expect(result.report.durationSec).toBe(5);
    expect(result.report.channels).toBe(1);
    expect(result.report.truePeakEstimate?.after).toBeLessThan(result.report.truePeakEstimate?.before ?? 0);
    expect(result.report.loudnessApprox?.after).toBeLessThan(result.report.loudnessApprox?.before ?? 0);
  });

  it("throws when stream mode has no output callback", async () => {
    await expect(runSweetQueuedPcmExport({
      channels: [makeRamp(1000, 0.5)],
      sampleRate: 1000,
      outputMode: "stream",
    })).rejects.toThrow(/requires onChunkOutput/);
  });

  it("reports original channel count in stereo stream mode", async () => {
    const result = await runSweetQueuedPcmExport({
      channels: [makeRamp(1000, 0.5), makeRamp(1000, -0.5)],
      sampleRate: 1000,
      preferredChunkSeconds: 0.5,
      outputMode: "stream",
      onChunkOutput: () => undefined,
    });

    expect(result.streamed).toBe(true);
    expect(result.channels).toHaveLength(0);
    expect(result.report.channels).toBe(2);
  });

  it("reports applied, bypassed, and not-wired operations without hiding warnings", () => {
    const project = createEmptyProject();
    project.repairRegions = [
      createSpectralRepairRegion({
        id: "repair-fixed",
        problemType: "hiss",
        operation: "dechirp_lite",
        startSec: 0,
        endSec: 1,
        lowHz: 5000,
        highHz: 12000,
        fixed: true,
      }),
      createSpectralRepairRegion({
        id: "repair-preview",
        problemType: "mud",
        operation: "attenuate",
        startSec: 1,
        endSec: 2,
        lowHz: 200,
        highHz: 500,
        fixed: false,
      }),
    ];
    project.aimixUnmaskState = {
      ...project.aimixUnmaskState,
      operations: [makeUnmaskOperation("unmask-fixed", true)],
    };
    project.master.masterPolish2 = {
      ...project.master.masterPolish2,
      enabled: true,
    };

    const operations = collectSweetExportAppliedOperations(project, {
      repairRegions: true,
      aimixUnmask: false,
      masterPolish2: false,
      finalRepairModules: false,
    });
    expect(operations.find((operation) => operation.id === "repair-fixed")?.exportStatus).toBe("applied");
    expect(operations.find((operation) => operation.id === "repair-preview")?.exportStatus).toBe("bypassed");
    expect(operations.find((operation) => operation.id === "unmask-fixed")?.exportStatus).toBe("not-wired");
    expect(operations.find((operation) => operation.id === "master-polish-2")?.exportStatus).toBe("not-wired");
    expect(operations.find((operation) => operation.id === "final-repair-modules")?.exportStatus).toBe("not-wired");

    const report = createSweetExportProcessingReportFromProject(project, {
      durationSec: 2,
      sampleRate: 48000,
      channels: 2,
      wiring: {
        repairRegions: true,
        aimixUnmask: false,
        masterPolish2: false,
      },
    });
    expect(report.warnings.join(" ")).toContain("not connected");
    expect(report.warnings.join(" ")).toContain("Final Repair Modules");
  });

  it("includes plugin quality risk in export reports", () => {
    const project = createEmptyProject();
    project.master.insertChain = [{
      ...createPluginInstance("sweet-air-exciter", "master"),
      params: { mix: 0.2, syntheticAirBed: true, outputDb: 2 },
    }];

    const report = createSweetExportProcessingReportFromProject(project, {
      durationSec: 4,
      sampleRate: 48000,
      channels: 2,
    });

    expect(report.pluginQuality?.totalPluginCount).toBe(1);
    expect(report.pluginQuality?.masterRiskCount).toBe(1);
    expect(report.pluginQuality?.warningCount).toBeGreaterThan(0);
    expect(report.warnings.join(" ")).toContain("Plugin Quality");
  });

  it("persists only lightweight analysis summaries and migrates old projects safely", () => {
    const project = createEmptyProject();
    project.files = [{
      id: "file-1",
      name: "Stem.wav",
      originalName: "Stem.wav",
      role: "other",
      mimeType: "audio/wav",
      durationSec: 10,
      sampleRate: 48000,
      channelCount: 2,
      byteLength: 1000,
      storageKey: "asset:file-1",
      peakCacheKey: "peaks:file-1",
      hash: "abc",
      createdAt: new Date().toISOString(),
    }];
    project.repairRegions = [createSpectralRepairRegion({
      id: "repair-1",
      problemType: "click",
      operation: "declick_lite",
      startSec: 0,
      endSec: 0.5,
      lowHz: 1000,
      highHz: 8000,
      fixed: true,
    })];

    const summary = createSweetProjectAnalysisCacheSummary(project);
    expect(summary.sourceRefs).toEqual([{ fileId: "file-1", hash: "abc", version: "peaks:file-1" }]);
    expect(JSON.stringify(summary)).not.toContain("Float32Array");
    expect(JSON.stringify(summary)).not.toContain("spectrogram");

    const migrated = migrateProject({
      ...project,
      exportReports: [{
        durationSec: 10,
        sampleRate: 48000,
        channels: 2,
        appliedOperations: [{ id: "x", kind: "legacy", label: "Legacy", fixed: true, exportStatus: "unknown" }],
        warnings: ["legacy"],
      }],
      analysisCacheSummary: {
        ...summary,
        rawSpectrogram: [[1, 2, 3]],
        sourceRefs: [...summary.sourceRefs, ...Array.from({ length: 200 }, (_, index) => ({ fileId: `extra-${index}` }))],
      },
    } as unknown);

    expect(migrated.exportReports).toHaveLength(1);
    expect(migrated.exportReports[0]?.appliedOperations[0]?.exportStatus).toBe("not-wired");
    expect(migrated.analysisCacheSummary?.sourceRefs).toHaveLength(128);
    expect(JSON.stringify(migrated.analysisCacheSummary)).not.toContain("rawSpectrogram");
  });
});

function makeRamp(length: number, scale: number) {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = (index / Math.max(1, length - 1)) * scale;
  }
  return output;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

function makeUnmaskOperation(id: string, fixed: boolean): SweetUnmaskOperation {
  return {
    id,
    kind: "aimix_unmask",
    enabled: true,
    fixed,
    source: "manual",
    winnerTrackId: "vocal",
    targetTrackId: "music",
    bandId: "presence",
    startSec: 0,
    endSec: 2,
    reductionDb: -1,
    maxReductionDb: 2,
    attackMs: 18,
    releaseMs: 140,
    description: "Test unmask",
    warnings: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
