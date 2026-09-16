import path from "node:path";
import { writeWavPcm16, type WavAudioData } from "./wavMetrics.ts";

export type SyntheticReferenceFixture = {
  directory: string;
  referencePath: string;
  candidatePath: string;
  spatialPath: string;
};

export function createSyntheticReferenceFixture(directory = path.resolve(".tmp", "aimix-selftest")): SyntheticReferenceFixture {
  const sampleRate = 48000;
  const durationSec = 8;
  const reference = synthesizeMix({ sampleRate, durationSec, air: 0.045, side: 0.13, midSide: 0, gain: 0.9, low: 0.23, mid: 0.19, transient: 0.32 });
  const candidate = synthesizeMix({ sampleRate, durationSec, air: 0.047, side: 0.075, midSide: 0.025, gain: 0.94, low: 0.215, mid: 0.235, transient: 0.32 });
  const spatial = synthesizeMix({ sampleRate, durationSec, air: 0.052, side: 0.15, gain: 0.86, low: 0.22, mid: 0.18, transient: 0.32 });

  const referencePath = path.join(directory, "reference.wav");
  const candidatePath = path.join(directory, "candidate.wav");
  const spatialPath = path.join(directory, "spatial_candidate.wav");
  writeWavPcm16(referencePath, reference);
  writeWavPcm16(candidatePath, candidate);
  writeWavPcm16(spatialPath, spatial);
  return { directory, referencePath, candidatePath, spatialPath };
}

function synthesizeMix(options: {
  sampleRate: number;
  durationSec: number;
  air: number;
  side: number;
  midSide?: number;
  gain: number;
  low: number;
  mid: number;
  transient: number;
}): WavAudioData {
  const frames = Math.floor(options.sampleRate * options.durationSec);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    const t = index / options.sampleRate;
    const beatPhase = (t % 0.5) / 0.035;
    const beat = Math.exp(-(beatPhase ** 2)) * options.transient;
    const bass = Math.sin(2 * Math.PI * 72 * t) * options.low;
    const vocalLike = (Math.sin(2 * Math.PI * 420 * t) * 0.35 + Math.sin(2 * Math.PI * 1150 * t) * 0.22 + Math.sin(2 * Math.PI * 2600 * t) * 0.14) * options.mid;
    const airNoise = pseudoNoise(index) * options.air * (0.4 + 0.6 * Math.sin(2 * Math.PI * 6.5 * t) ** 2);
    const sideTone = Math.sin(2 * Math.PI * 5400 * t + Math.sin(2 * Math.PI * 0.25 * t)) * options.side;
    const midSideTone = (
      Math.sin(2 * Math.PI * 1150 * t + Math.sin(2 * Math.PI * 0.19 * t)) * 0.32 +
      Math.sin(2 * Math.PI * 3200 * t + Math.sin(2 * Math.PI * 0.31 * t)) * 0.22
    ) * (options.midSide ?? 0);
    const mono = (bass + vocalLike + beat + airNoise) * options.gain;
    left[index] = softClip(mono + sideTone * 0.5 + midSideTone * 0.5);
    right[index] = softClip(mono - sideTone * 0.5 - midSideTone * 0.5);
  }
  return { sampleRate: options.sampleRate, channels: [left, right], durationSec: options.durationSec };
}

function pseudoNoise(index: number) {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function softClip(value: number) {
  return Math.tanh(value * 1.15) / 1.15;
}
