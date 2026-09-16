import { describe, expect, it } from "vitest";
import { processAimixGlow, type AimixGlowSettings } from "@/daw/aimixGlow";
import { analyzeSingleFileMastering, processSingleFileMastering, resolveSingleFileMasteringSettings } from "./singleFileMastering";
import { createStreamingMasterChunkJoiner, cropStreamingMasterChunk, STREAMING_MASTER_POST_ROLL_SEC, STREAMING_MASTER_PRE_ROLL_SEC } from "./StreamingMasterProcessor";

const SAMPLE_RATE = 48000;
const DURATION_SEC = 30;
const CHUNK_SEC = 3;

describe("Single File Mastering low-memory parity", () => {
  it("keeps the current padded low-memory path close to full-buffer mastering", () => {
    const source = createStereoProgram(DURATION_SEC);
    const vocalSidechain = createVocalSidechain(DURATION_SEC);
    const glowSettings: AimixGlowSettings = {
      enabled: true,
      preset: "aiStemRescue",
      amount: 42,
      vocalKey: 65,
      recover: 34,
      gloss: 22,
      air: 18,
      tame: 55,
      outputMatch: true,
      quality: "offlineHighQuality",
    };
    const baseSettings = resolveSingleFileMasteringSettings("lightMaster", {
      targetLufs: -16,
      truePeakCeilingDb: -1.2,
      artifactGuardAmount: 0.22,
      clipperDriveDb: 1.8,
      clipperMix: 0.5,
    });

    const fullGlow = processAimixGlow(cloneChannels(source), SAMPLE_RATE, glowSettings, { vocalSidechain });
    const full = processSingleFileMastering(fullGlow.channels, SAMPLE_RATE, baseSettings, { copyInput: false, quality: "mobile-hq" });
    const scan = scanCurrentLowMemorySource(source, vocalSidechain, glowSettings, baseSettings);
    const fixedTargetGainDb = baseSettings.targetLufs - scan.estimatedLufs;
    const joiner = createStreamingMasterChunkJoiner({ sampleRate: SAMPLE_RATE });
    const outputChunks: Float32Array[][] = [];

    for (let start = 0; start < source[0].length; start += CHUNK_SEC * SAMPLE_RATE) {
      const end = Math.min(source[0].length, start + CHUNK_SEC * SAMPLE_RATE);
      const paddedStart = Math.max(0, start - Math.floor(STREAMING_MASTER_PRE_ROLL_SEC * SAMPLE_RATE));
      const paddedEnd = Math.min(source[0].length, end + Math.floor(STREAMING_MASTER_POST_ROLL_SEC * SAMPLE_RATE));
      const chunkGlow = processAimixGlow(sliceChannels(source, paddedStart, paddedEnd), SAMPLE_RATE, glowSettings, {
        vocalSidechain: sliceChannels(vocalSidechain, paddedStart, paddedEnd),
      });
      const chunk = processSingleFileMastering(chunkGlow.channels, SAMPLE_RATE, {
        ...baseSettings,
        chunkedFixedTargetGainDb: fixedTargetGainDb,
        chunkedGlobalLufs: scan.estimatedLufs,
      }, { copyInput: false, quality: "mobile-hq" });
      const stable = joiner.add(chunk.channels, {
        cropStartFrame: start - paddedStart,
        cropFrameCount: end - start,
      });
      if ((stable[0]?.length ?? 0) > 0) outputChunks.push(stable);
    }
    outputChunks.push(joiner.flush());
    const stitched = concatenateChunks(outputChunks, source.length);

    const fullMetrics = analyzeSingleFileMastering(full.channels, SAMPLE_RATE, { quality: "mobile-hq" });
    const chunkMetrics = analyzeSingleFileMastering(stitched, SAMPLE_RATE, { quality: "mobile-hq" });
    const snapshot = {
      lufsDeltaLu: round2(chunkMetrics.estimatedLufs - fullMetrics.estimatedLufs),
      truePeakDeltaDb: round2(chunkMetrics.estimatedTruePeakDb - fullMetrics.estimatedTruePeakDb),
      sideMidDeltaDb: round2(estimateSideMidDb(stitched) - estimateSideMidDb(full.channels)),
      boundaryClickScore: round6(measureChunkBoundaryClickScore(stitched, CHUNK_SEC * SAMPLE_RATE)),
      fullBoundaryScore: round6(measureChunkBoundaryClickScore(full.channels, CHUNK_SEC * SAMPLE_RATE)),
    };

    console.info("Full-buffer / current low-memory chunk parity", snapshot);
    expect(Math.abs(snapshot.lufsDeltaLu)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(snapshot.truePeakDeltaDb)).toBeLessThanOrEqual(0.35);
    expect(Math.abs(snapshot.sideMidDeltaDb)).toBeLessThanOrEqual(0.35);
    expect(snapshot.boundaryClickScore).toBeLessThanOrEqual(snapshot.fullBoundaryScore + 0.03);
    expect(allFinite(stitched)).toBe(true);
  }, 60000);
});

function scanCurrentLowMemorySource(
  source: Float32Array[],
  vocalSidechain: Float32Array[],
  glowSettings: AimixGlowSettings,
  baseSettings: ReturnType<typeof resolveSingleFileMasteringSettings>,
) {
  let weightedPowerSeconds = 0;
  let measuredSeconds = 0;
  const analysisSettings = {
    ...baseSettings,
    stages: {
      ...baseSettings.stages,
      targetLoudness: false,
      truePeakLimiter: false,
    },
  };
  for (let start = 0; start < source[0]!.length; start += CHUNK_SEC * SAMPLE_RATE) {
    const end = Math.min(source[0]!.length, start + CHUNK_SEC * SAMPLE_RATE);
    const paddedStart = Math.max(0, start - Math.floor(STREAMING_MASTER_PRE_ROLL_SEC * SAMPLE_RATE));
    const paddedEnd = Math.min(source[0]!.length, end + Math.floor(STREAMING_MASTER_POST_ROLL_SEC * SAMPLE_RATE));
    const glow = processAimixGlow(sliceChannels(source, paddedStart, paddedEnd), SAMPLE_RATE, glowSettings, {
      vocalSidechain: sliceChannels(vocalSidechain, paddedStart, paddedEnd),
    });
    const processed = processSingleFileMastering(glow.channels, SAMPLE_RATE, analysisSettings, {
      copyInput: false,
      quality: "mobile-hq",
    });
    const stable = cropStreamingMasterChunk(processed.channels, {
      cropStartFrame: start - paddedStart,
      cropFrameCount: end - start,
    });
    const metrics = analyzeSingleFileMastering(stable, SAMPLE_RATE, { quality: "mobile-hq" });
    const seconds = (end - start) / SAMPLE_RATE;
    weightedPowerSeconds += 10 ** ((metrics.estimatedLufs + 0.691) / 10) * seconds;
    measuredSeconds += seconds;
  }
  return {
    estimatedLufs: -0.691 + 10 * Math.log10(Math.max(1e-12, weightedPowerSeconds / Math.max(1e-8, measuredSeconds))),
  };
}

function createStereoProgram(seconds: number): Float32Array[] {
  const length = seconds * SAMPLE_RATE;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let noiseState = 0x1a2b3c4d;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
    const noise = (noiseState / 0xffffffff - 0.5) * 0.003;
    const pulse = index % (SAMPLE_RATE * 2) < 260 ? 0.12 : 0;
    const body = Math.sin(2 * Math.PI * 140 * time) * 0.075 + Math.sin(2 * Math.PI * 760 * time) * 0.045;
    const presence = Math.sin(2 * Math.PI * 3300 * time) * 0.018;
    const air = Math.sin(2 * Math.PI * 10400 * time) * 0.006;
    left[index] = body + presence + air + pulse + noise;
    right[index] = body * 0.96 + presence * 0.82 - air * 0.45 + pulse * 0.72 - noise;
  }
  return [left, right];
}

function createVocalSidechain(seconds: number): Float32Array[] {
  const length = seconds * SAMPLE_RATE;
  const vocal = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    const phraseActive = Math.floor(time / 2.5) % 2 === 0;
    vocal[index] = phraseActive ? Math.sin(2 * Math.PI * 1150 * time) * 0.11 : 0;
  }
  return [vocal];
}

function cloneChannels(channels: Float32Array[]) {
  return channels.map((channel) => new Float32Array(channel));
}

function sliceChannels(channels: Float32Array[], start: number, end: number) {
  return channels.map((channel) => new Float32Array(channel.subarray(start, end)));
}

function createSilentStereo(length: number) {
  return [new Float32Array(length), new Float32Array(length)];
}

function concatenateChunks(chunks: Float32Array[][], channelCount: number) {
  const totalFrames = chunks.reduce((sum, chunk) => sum + (chunk[0]?.length ?? 0), 0);
  return Array.from({ length: channelCount }, (_, channelIndex) => {
    const output = new Float32Array(totalFrames);
    let offset = 0;
    for (const chunk of chunks) {
      const channel = chunk[channelIndex] ?? chunk[0] ?? new Float32Array();
      output.set(channel, offset);
      offset += channel.length;
    }
    return output;
  });
}

function estimateSideMidDb(channels: Float32Array[]) {
  const left = channels[0]!;
  const right = channels[1]!;
  let midSquares = 0;
  let sideSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const mid = (left[index]! + right[index]!) * 0.5;
    const side = (left[index]! - right[index]!) * 0.5;
    midSquares += mid * mid;
    sideSquares += side * side;
  }
  return 20 * Math.log10(Math.max(1e-12, Math.sqrt(sideSquares / left.length)))
    - 20 * Math.log10(Math.max(1e-12, Math.sqrt(midSquares / left.length)));
}

function measureChunkBoundaryClickScore(channels: Float32Array[], framesPerChunk: number) {
  let highestDelta = 0;
  for (const channel of channels) {
    for (let boundary = framesPerChunk; boundary < channel.length; boundary += framesPerChunk) {
      highestDelta = Math.max(highestDelta, Math.abs(channel[boundary]! - channel[boundary - 1]!));
    }
  }
  return highestDelta;
}

function allFinite(channels: Float32Array[]) {
  return channels.every((channel) => channel.every(Number.isFinite));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round6(value: number) {
  return Math.round(value * 1000000) / 1000000;
}
