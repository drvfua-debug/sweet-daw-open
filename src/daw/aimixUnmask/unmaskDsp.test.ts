import { describe, expect, it } from "vitest";
import type { Clip } from "@/daw/model/Project";
import type { SweetUnmaskOperation } from "./aimixUnmaskTypes";
import { applyUnmaskOperationsToChannels, buildClipUnmaskPreview, getClipUnmaskSegments } from "./unmaskDsp";

function makeClip(patch: Partial<Clip> = {}): Clip {
  return {
    id: "clip-1",
    trackId: "target-track",
    fileId: "file-1",
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
    ...patch,
  };
}

function op(patch: Partial<SweetUnmaskOperation> = {}): SweetUnmaskOperation {
  return {
    id: "op-1",
    kind: "aimix_unmask",
    enabled: true,
    fixed: false,
    source: "proposal",
    winnerTrackId: "lead-track",
    targetTrackId: "target-track",
    bandId: "presence",
    startSec: 0,
    endSec: 0.5,
    reductionDb: -3,
    maxReductionDb: 3,
    attackMs: 2,
    releaseMs: 50,
    description: "duck presence",
    warnings: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function tone(sampleRate: number, seconds: number, hz: number, gain = 0.4) {
  const length = Math.floor(sampleRate * seconds);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.sin((2 * Math.PI * hz * i) / sampleRate) * gain;
  return out;
}

function energy(channel: Float32Array, sampleRate: number, hz: number) {
  let real = 0;
  let imag = 0;
  for (let i = 0; i < channel.length; i += 1) {
    const angle = (2 * Math.PI * hz * i) / sampleRate;
    real += (channel[i] ?? 0) * Math.cos(angle);
    imag -= (channel[i] ?? 0) * Math.sin(angle);
  }
  return Math.hypot(real, imag) / Math.max(1, channel.length);
}

function fakeBuffer(samples: Float32Array, sampleRate: number): AudioBuffer {
  return { duration: samples.length / sampleRate, length: samples.length, numberOfChannels: 1, sampleRate, getChannelData: () => samples } as unknown as AudioBuffer;
}

describe("AIMIX Unmask DSP", () => {
  it("reduces only the targeted masking band", () => {
    const sampleRate = 48000;
    const input = tone(sampleRate, 0.5, 3200, 0.4);
    const before = energy(input, sampleRate, 3200);
    const result = applyUnmaskOperationsToChannels([input], sampleRate, makeClip(), [op()]);
    const after = energy(result.channels[0] ?? new Float32Array(), sampleRate, 3200);

    expect(result.appliedOperationIds).toEqual(["op-1"]);
    expect(after).toBeLessThan(before * 0.9);
  });

  it("keeps draft operations out of fixed-only export processing", () => {
    const clip = makeClip();
    expect(getClipUnmaskSegments(clip, [op({ fixed: false })], { fixedOnly: true })).toEqual([]);
    expect(getClipUnmaskSegments(clip, [op({ fixed: true })], { fixedOnly: true }).map((segment) => segment.operationId)).toEqual(["op-1"]);
  });

  it("provides removed-only preview at a safety-attenuated level", () => {
    const sampleRate = 48000;
    const input = tone(sampleRate, 0.25, 3200, 0.4);
    const result = buildClipUnmaskPreview(fakeBuffer(input, sampleRate), makeClip({ durationSec: 0.25 }), [op({ endSec: 0.25 })], { previewMode: "removed" });

    expect(result.preview[0]?.length).toBeGreaterThan(0);
    expect(result.warnings.some((warning) => warning.includes("attenuated"))).toBe(true);
  });
});