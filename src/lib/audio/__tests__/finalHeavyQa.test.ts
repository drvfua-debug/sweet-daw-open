import { describe, expect, it } from "vitest";
import type { Clip } from "@/daw/model/Project";
import type { SweetUnmaskOperation } from "@/daw/aimixUnmask/aimixUnmaskTypes";
import { applyUnmaskOperationsToChannels } from "@/daw/aimixUnmask/unmaskDsp";
import { applyRepairOperationsToChannels, type RepairProcessSegment } from "@/audio/repair/repairProcessors";
import { applySweetFinalRepairModulesToChannels, type SweetFinalRepairParams } from "../finalRepairModules";
import { buildSweetReferenceDeltaReport } from "../referenceDelta";
import { getSweetMasterTargetProfile } from "../targetProfiles";
import { applySweetMasterPolish2ToChannels } from "../masterPolishRenderGraph";
import { createSweetExportProcessingReportFromProject } from "../exportQueue";
import { createEmptyProject } from "@/daw/model/Project";
import { PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING } from "@/audio/engine/OfflineRenderer";
import { createWavStreamingEncoder } from "@/audio/export/WavStreamingEncoder";

const SAMPLE_RATE = 48000;

describe("Sweet DAW final heavy QA safety", () => {
  it("keeps zero-amount final repair modules transparent for mono and stereo input", () => {
    const mono = mixedTone(SAMPLE_RATE, 0.2, [{ hz: 440, gain: 0.2 }, { hz: 5000, gain: 0.03 }]);
    const left = mixedTone(SAMPLE_RATE, 0.2, [{ hz: 220, gain: 0.16 }]);
    const right = mixedTone(SAMPLE_RATE, 0.2, [{ hz: 330, gain: 0.16 }]);
    const modules: SweetFinalRepairParams[] = [
      finalParams("dereverb-lite", 0),
      finalParams("peak-restore-lite", 0),
      finalParams("hum-tone-reducer-lite", 0),
      finalParams("plosive-breath-tamer-lite", 0),
      finalParams("stereo-phase-guard", 0),
    ];

    const monoResult = applySweetFinalRepairModulesToChannels([mono], SAMPLE_RATE, modules);
    const stereoResult = applySweetFinalRepairModulesToChannels([left, right], SAMPLE_RATE, modules);

    expect(maxAbsDiff(mono, monoResult.channels[0] ?? new Float32Array())).toBeLessThan(1e-8);
    expect(maxAbsDiff(left, stereoResult.channels[0] ?? new Float32Array())).toBeLessThan(1e-8);
    expect(maxAbsDiff(right, stereoResult.channels[1] ?? new Float32Array())).toBeLessThan(1e-8);
    expect(allFinite([...monoResult.channels, ...stereoResult.channels])).toBe(true);
  });

  it("keeps peak restore under ceiling on clipped material", () => {
    const clipped = mixedTone(SAMPLE_RATE, 0.25, [{ hz: 120, gain: 1.2 }, { hz: 2400, gain: 0.2 }]);
    for (let index = 0; index < clipped.length; index += 1) clipped[index] = Math.max(-1, Math.min(1, clipped[index] ?? 0));

    const result = applySweetFinalRepairModulesToChannels([clipped], SAMPLE_RATE, [finalParams("peak-restore-lite", 1)]);

    expect(allFinite(result.channels)).toBe(true);
    expect(maxAbs(result.channels[0] ?? new Float32Array())).toBeLessThanOrEqual(0.986);
  });

  it("phase guard tightens low side without collapsing high-side image", () => {
    const left = mixedTone(SAMPLE_RATE, 0.35, [{ hz: 80, gain: 0.3 }, { hz: 3000, gain: 0.16 }]);
    const right = mixedTone(SAMPLE_RATE, 0.35, [{ hz: 80, gain: -0.3 }, { hz: 3000, gain: -0.16 }]);
    const beforeLowSide = toneEnergy(sideSignal(left, right), SAMPLE_RATE, 80);
    const beforeHighSide = toneEnergy(sideSignal(left, right), SAMPLE_RATE, 3000);

    const result = applySweetFinalRepairModulesToChannels([left, right], SAMPLE_RATE, [finalParams("stereo-phase-guard", 0.85)]);
    const afterLeft = result.channels[0] ?? new Float32Array();
    const afterRight = result.channels[1] ?? new Float32Array();
    const afterLowSide = toneEnergy(sideSignal(afterLeft, afterRight), SAMPLE_RATE, 80);
    const afterHighSide = toneEnergy(sideSignal(afterLeft, afterRight), SAMPLE_RATE, 3000);

    expect(afterLowSide).toBeLessThan(beforeLowSide);
    expect(afterHighSide).toBeGreaterThan(beforeHighSide * 0.72);
  });

  it("de-chirp and de-click reduce targets without broad damage or ringing", () => {
    const chirp = mixedTone(SAMPLE_RATE, 0.25, [{ hz: 1000, gain: 0.16 }, { hz: 9000, gain: 0.34 }]);
    const dechirped = applyRepairOperationsToChannels([chirp], SAMPLE_RATE, [repairSegment({
      operation: "dechirp_lite",
      lowHz: 7000,
      highHz: 12000,
      amountDb: -6,
      strength: 1,
    })]).channels[0] ?? new Float32Array();

    expect(toneEnergy(dechirped, SAMPLE_RATE, 9000)).toBeLessThan(toneEnergy(chirp, SAMPLE_RATE, 9000));
    expect(toneEnergy(dechirped, SAMPLE_RATE, 1000)).toBeGreaterThan(toneEnergy(chirp, SAMPLE_RATE, 1000) * 0.78);

    const impulse = new Float32Array(SAMPLE_RATE * 0.1);
    impulse[Math.floor(impulse.length / 2)] = 1;
    const declicked = applyRepairOperationsToChannels([impulse], SAMPLE_RATE, [repairSegment({
      operation: "declick_lite",
      amountDb: -6,
      strength: 1,
      endLocalSec: 0.1,
    })]).channels[0] ?? new Float32Array();
    const center = Math.floor(impulse.length / 2);
    expect(Math.abs(declicked[center] ?? 0)).toBeLessThan(0.2);
    expect(maxAbsOutside(declicked, center - 180, center + 180)).toBeLessThan(0.08);
  });

  it("bounds reference delta and avoids full-band unmask ducking", () => {
    const profile = getSweetMasterTargetProfile("balanced-ai-master");
    const delta = buildSweetReferenceDeltaReport({
      profile,
      durationSec: 180,
      currentBands: { "20-35": -60, "3000-5000": -60, "12000-16000": -60 },
      referenceBands: { "20-35": -10, "3000-5000": -10, "12000-16000": -10 },
    });
    expect(delta.bands.every((band) => Math.abs(band.boundedDeltaDb) <= profile.maxReferenceDeltaDb + 1e-6)).toBe(true);
    expect(delta.bands.find((band) => band.bandId === "12000-16000")?.boundedDeltaDb).toBeLessThanOrEqual(profile.maxHighBoostDb);

    const input = mixedTone(SAMPLE_RATE, 0.5, [{ hz: 220, gain: 0.35 }, { hz: 3200, gain: 0.35 }]);
    const beforeLow = toneEnergy(input, SAMPLE_RATE, 220);
    const beforePresence = toneEnergy(input, SAMPLE_RATE, 3200);
    const result = applyUnmaskOperationsToChannels([input], SAMPLE_RATE, makeClip(), [makeUnmaskOperation()]);
    const output = result.channels[0] ?? new Float32Array();

    expect(toneEnergy(output, SAMPLE_RATE, 3200)).toBeLessThan(beforePresence * 0.92);
    expect(toneEnergy(output, SAMPLE_RATE, 220)).toBeGreaterThan(beforeLow * 0.82);
  });

  it("master polish and export reports stay finite and explicit about not-wired operations", () => {
    const project = createEmptyProject();
    project.master.masterPolish2 = { ...project.master.masterPolish2, enabled: true };
    const report = createSweetExportProcessingReportFromProject(project, {
      durationSec: 4,
      sampleRate: SAMPLE_RATE,
      channels: 2,
      wiring: { masterPolish2: false },
    });
    expect(report.appliedOperations.find((operation) => operation.id === "master-polish-2")?.exportStatus).toBe("not-wired");

    const input = [
      mixedTone(SAMPLE_RATE, 0.3, [{ hz: 90, gain: 0.35 }, { hz: 6000, gain: 0.1 }]),
      mixedTone(SAMPLE_RATE, 0.3, [{ hz: 90, gain: 0.35 }, { hz: 6100, gain: 0.1 }]),
    ];
    const polished = applySweetMasterPolish2ToChannels(input, SAMPLE_RATE, {
      enabled: true,
      profileId: "balanced-ai-master",
      targetLufsApprox: -12,
      ceilingDbTpEstimate: -1,
      safeMode: true,
      limiterDrive: 0.2,
    });
    expect(allFinite(polished.channels)).toBe(true);
    expect(polished.report.afterTruePeakEstimate).toBeLessThanOrEqual(0);
  });

  it("keeps long-render memory bypass and WAV Blob cap visible instead of silent", () => {
    const project = createEmptyProject();
    const report = createSweetExportProcessingReportFromProject(project, {
      durationSec: 60 * 20,
      sampleRate: SAMPLE_RATE,
      channels: 2,
      warnings: [PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING],
    });

    expect(report.warnings).toContain(PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING);
    expect(() => createWavStreamingEncoder({
      sampleRate: SAMPLE_RATE,
      channels: 2,
      bitDepth: "pcm16",
      dither: false,
      totalFrames: 4096,
      maxBlobBytes: 1024,
    })).toThrow(/stable browser memory/);
  });
});

function finalParams(module: SweetFinalRepairParams["module"], amount = 0.5): SweetFinalRepairParams {
  return { module, amount, focus: "stem", protect: [], safeMode: true };
}

function repairSegment(patch: Partial<RepairProcessSegment>): RepairProcessSegment {
  return {
    regionId: "qa-region",
    operation: "attenuate",
    startLocalSec: 0,
    endLocalSec: 0.25,
    lowHz: 20,
    highHz: 20000,
    amountDb: -3,
    strength: 0.5,
    featherTimeSec: 0,
    ...patch,
  };
}

function makeClip(): Clip {
  return {
    id: "clip-qa",
    trackId: "target-track",
    fileId: "file-qa",
    role: "other",
    clipKind: "audio",
    intentTags: [],
    actionHistory: [],
    timelineStartSec: 0,
    sourceStartSec: 0,
    durationSec: 0.5,
    gainDb: 0,
    fadeInSec: 0,
    fadeOutSec: 0,
    reverse: false,
    stretchRatio: null,
    pitchShiftSemitones: null,
    lockedToGrid: true,
    movementLocked: true,
    insertChain: [],
  };
}

function makeUnmaskOperation(): SweetUnmaskOperation {
  return {
    id: "unmask-qa",
    kind: "aimix_unmask",
    enabled: true,
    fixed: true,
    source: "manual",
    winnerTrackId: "lead-track",
    targetTrackId: "target-track",
    bandId: "presence",
    startSec: 0,
    endSec: 0.5,
    reductionDb: -3,
    maxReductionDb: 3,
    attackMs: 2,
    releaseMs: 60,
    description: "QA presence duck",
    warnings: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function mixedTone(sampleRate: number, durationSec: number, tones: Array<{ hz: number; gain: number }>) {
  const length = Math.floor(sampleRate * durationSec);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = tones.reduce((sum, tone) => sum + Math.sin((2 * Math.PI * tone.hz * index) / sampleRate) * tone.gain, 0);
  }
  return output;
}

function toneEnergy(channel: Float32Array, sampleRate: number, hz: number) {
  let real = 0;
  let imag = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const angle = (2 * Math.PI * hz * index) / sampleRate;
    real += (channel[index] ?? 0) * Math.cos(angle);
    imag -= (channel[index] ?? 0) * Math.sin(angle);
  }
  return Math.hypot(real, imag) / Math.max(1, channel.length);
}

function sideSignal(left: Float32Array, right: Float32Array) {
  const length = Math.min(left.length, right.length);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) output[index] = ((left[index] ?? 0) - (right[index] ?? 0)) * 0.5;
  return output;
}

function maxAbs(channel: Float32Array) {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function maxAbsOutside(channel: Float32Array, start: number, end: number) {
  let peak = 0;
  for (let index = 0; index < channel.length; index += 1) {
    if (index >= start && index <= end) continue;
    peak = Math.max(peak, Math.abs(channel[index] ?? 0));
  }
  return peak;
}

function maxAbsDiff(a: Float32Array, b: Float32Array) {
  let peak = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) peak = Math.max(peak, Math.abs((a[index] ?? 0) - (b[index] ?? 0)));
  return peak;
}

function allFinite(channels: Float32Array[]) {
  return channels.every((channel) => Array.from(channel).every(Number.isFinite));
}
