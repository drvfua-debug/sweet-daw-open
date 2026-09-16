import { describe, expect, it } from "vitest";
import { estimateRenderBudget } from "./RenderBudget";
import type { Project } from "@/daw/model/Project";

describe("estimateRenderBudget", () => {
  it("reports warn/danger instead of allowing silent crash risk", () => {
    const project = makeProject({
      durationSec: 420,
      trackCount: 12,
      heavyPlugins: 8,
    });
    const report = estimateRenderBudget(project, {
      sampleRate: 48000,
      bitDepth: "pcm24",
      memoryBudgetBytes: 220 * 1024 * 1024,
    });

    expect(report.risk).toBe("danger");
    expect(report.stemCount).toBe(12);
    expect(report.reasons.length).toBeGreaterThan(0);
  });

  it("excludes reference tracks from stem count and source estimate", () => {
    const project = makeProject({ durationSec: 120, trackCount: 2, referenceTrack: true });
    const report = estimateRenderBudget(project, {
      sampleRate: 44100,
      bitDepth: "pcm16",
      memoryBudgetBytes: 512 * 1024 * 1024,
    });

    expect(report.stemCount).toBe(2);
    expect(report.sourceDecodedBytes).toBeGreaterThan(0);
    expect(report.risk).toBe("ok");
  });

  it("treats current render-heavy plugin ids as memory risk", () => {
    const project = makeProject({
      durationSec: 240,
      trackCount: 6,
      heavyPlugins: 1,
      heavyPluginIds: [
        "sweet-aimix-glow",
        "sweet-granular-texture",
        "sweet-vocoder-lite",
        "sweet-ir-space",
        "sweet-guitar-cab",
        "sweet-multiband-comp",
      ],
    });
    const report = estimateRenderBudget(project, {
      sampleRate: 48000,
      bitDepth: "pcm24",
      memoryBudgetBytes: 260 * 1024 * 1024,
    });

    expect(report.risk).not.toBe("ok");
    expect(report.reasons.join(" ")).toContain("Heavy plugin load");
  });
});

function makeProject(input: { durationSec: number; trackCount: number; heavyPlugins?: number; heavyPluginIds?: string[]; referenceTrack?: boolean }): Project {
  const tracks = Array.from({ length: input.trackCount }, (_, index) => ({
    id: `track-${index}`,
    name: `Track ${index}`,
    type: "other",
    role: index === 0 ? "vocal" : "music",
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    color: "#fff",
    eq: { enabled: false, analyzerEnabled: false, analyzerMode: "post", bands: [] },
    compressor: { enabled: false, threshold: -18, ratio: 2, attack: 0.01, release: 0.1, knee: 6, makeupGainDb: 0 },
    sends: [],
    meter: { peakDb: -120, rmsDb: -120, clipping: false },
    insertChain: Array.from({ length: input.heavyPlugins ?? 0 }, (_, pluginIndex) => ({
      id: `plugin-${index}-${pluginIndex}`,
      pluginId: input.heavyPluginIds?.[index % input.heavyPluginIds.length] ?? "sweet-peak-maximizer",
      name: "PeakMax",
      enabled: true,
      params: {},
    })),
  }));
  if (input.referenceTrack) {
    tracks.push({
      ...tracks[0]!,
      id: "reference-track",
      role: "reference",
      type: "reference",
      insertChain: [],
    });
  }

  const clips = tracks.map((track, index) => ({
    id: `clip-${index}`,
    trackId: track.id,
    fileId: `file-${index}`,
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: input.durationSec,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: false,
    movementLocked: true,
    selected: false,
    muted: false,
    color: "#fff",
    name: track.name,
    intentTags: [],
    actionHistory: [],
    repairQueue: false,
    insertChain: [],
    panAutomation: { enabled: false, points: [] },
  }));

  return {
    id: "project",
    title: "Project",
    createdAt: "",
    updatedAt: "",
    sampleRate: 48000,
    bpm: 120,
    timeSignature: [4, 4],
    master: {
      gainDb: 0,
      eq: { enabled: false, analyzerEnabled: false, analyzerMode: "post", bands: [] },
      compressor: { enabled: false, threshold: -18, ratio: 2, attack: 0.01, release: 0.1, knee: 6, makeupGainDb: 0 },
      limiterEnabled: true,
      limiterCeilingDb: -1,
      exportNormalizePeak: false,
      exportPeakTargetDb: -1,
      exportBitDepth: "pcm24",
      exportDither: false,
      insertChain: [],
    },
    tracks,
    clips,
    files: clips.map((clip, index) => ({
      id: clip.fileId,
      name: `file-${index}.wav`,
      mimeType: "audio/wav",
      durationSec: input.durationSec,
      sampleRate: 48000,
      channelCount: 2,
      storageKey: `file-${index}`,
      role: tracks[index]?.role ?? "other",
      createdAt: "",
      byteLength: 0,
    })),
    markers: [],
    regions: [],
    analysis: {},
    exportReports: [],
  } as unknown as Project;
}
