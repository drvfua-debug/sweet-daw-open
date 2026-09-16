import { describe, expect, it } from "vitest";
import {
  analyzeSingleFileMastering,
  processSingleFileMastering,
  resolveSingleFileMasteringSettings,
  type SingleFileStageToggles,
} from "./singleFileMastering";

const SAMPLE_RATE = 48000;

function sine(freq: number, seconds = 1, gain = 0.1) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = Math.sin((2 * Math.PI * freq * index) / SAMPLE_RATE) * gain;
  }
  return out;
}

function mixedTone(seconds = 1, gain = 0.08) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    left[index] = (
      Math.sin(2 * Math.PI * 80 * t) * 0.45 +
      Math.sin(2 * Math.PI * 800 * t) * 0.35 +
      Math.sin(2 * Math.PI * 7200 * t) * 0.2
    ) * gain;
    right[index] = (
      Math.sin(2 * Math.PI * 90 * t) * 0.4 +
      Math.sin(2 * Math.PI * 1200 * t) * 0.4 +
      Math.sin(2 * Math.PI * 8500 * t) * 0.2
    ) * gain;
  }
  return [left, right];
}

function peakyTone(seconds = 1) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const bed = Math.sin(2 * Math.PI * 440 * t) * 0.025;
    const spike = index % 4800 === 0 ? 1 : 0;
    left[index] = bed + spike;
    right[index] = bed - spike * 0.85;
  }
  return [left, right];
}

function hissBed(seconds = 1) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let state = 987654321;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 - 0.5;
  };
  let highNoiseL = 0;
  let highNoiseR = 0;
  for (let index = 0; index < length; index += 1) {
    const t = index / SAMPLE_RATE;
    const body = Math.sin(2 * Math.PI * 900 * t) * 0.04 + Math.sin(2 * Math.PI * 2200 * t) * 0.012;
    highNoiseL = random() * 0.045 - highNoiseL * 0.72;
    highNoiseR = random() * 0.045 - highNoiseR * 0.72;
    left[index] = body + highNoiseL;
    right[index] = body * 0.98 + highNoiseR;
  }
  return [left, right];
}

function rms(channel: Float32Array) {
  let sum = 0;
  for (const sample of channel) sum += sample * sample;
  return Math.sqrt(sum / channel.length);
}

function maxAbs(channels: Float32Array[]) {
  let peak = 0;
  for (const channel of channels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}

function stereoImage(channels: Float32Array[]) {
  const left = channels[0]!;
  const right = channels[1]!;
  let leftSquares = 0;
  let rightSquares = 0;
  let cross = 0;
  let midSquares = 0;
  let sideSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    leftSquares += l * l;
    rightSquares += r * r;
    cross += l * r;
    midSquares += mid * mid;
    sideSquares += side * side;
  }
  const sideRms = Math.sqrt(sideSquares / left.length);
  const midRms = Math.sqrt(midSquares / left.length);
  return {
    sideMidDb: 20 * Math.log10(Math.max(1e-9, sideRms)) - 20 * Math.log10(Math.max(1e-9, midRms)),
    correlation: cross / Math.max(1e-9, Math.sqrt(leftSquares * rightSquares)),
  };
}

function highBandSideMidDb(channels: Float32Array[], frequency = 16000) {
  const left = channels[0]!;
  const right = channels[1]!;
  const length = Math.min(left.length, right.length);
  let midReal = 0;
  let midImag = 0;
  let sideReal = 0;
  let sideImag = 0;
  const omega = (2 * Math.PI * frequency) / SAMPLE_RATE;
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, length - 1));
    midReal += mid * win * Math.cos(omega * index);
    midImag -= mid * win * Math.sin(omega * index);
    sideReal += side * win * Math.cos(omega * index);
    sideImag -= side * win * Math.sin(omega * index);
  }
  const mid = Math.sqrt(midReal * midReal + midImag * midImag);
  const side = Math.sqrt(sideReal * sideReal + sideImag * sideImag);
  return 20 * Math.log10(Math.max(1e-9, side)) - 20 * Math.log10(Math.max(1e-9, mid));
}

function midFrequencyMagnitudeDb(channels: Float32Array[], frequency: number) {
  const left = channels[0]!;
  const right = channels[1] ?? left;
  const length = Math.min(left.length, right.length);
  let real = 0;
  let imag = 0;
  const omega = (2 * Math.PI * frequency) / SAMPLE_RATE;
  for (let index = 0; index < length; index += 1) {
    const mid = ((left[index] ?? 0) + (right[index] ?? 0)) * 0.5;
    const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, length - 1));
    real += mid * win * Math.cos(omega * index);
    imag -= mid * win * Math.sin(omega * index);
  }
  return 20 * Math.log10(Math.max(1e-9, Math.sqrt(real * real + imag * imag)));
}

const noToneStages: SingleFileStageToggles = {
  safetyHpf: false,
  tiltBalance: false,
  toneCleanup: false,
  harshnessGuard: false,
  glueCompression: false,
  preLimiterClipper: false,
  targetLoudness: false,
  truePeakLimiter: false,
};

const DEFAULT_LOUD_RELEASE_STAGES_FOR_TEST: SingleFileStageToggles = {
  safetyHpf: true,
  tiltBalance: true,
  toneCleanup: true,
  harshnessGuard: true,
  glueCompression: true,
  preLimiterClipper: true,
  targetLoudness: true,
  truePeakLimiter: true,
};

describe("single file mastering", () => {
  it("analyzes peak, loudness, duration, and channel count", () => {
    const metrics = analyzeSingleFileMastering(mixedTone(0.5), SAMPLE_RATE);
    expect(metrics.channels).toBe(2);
    expect(metrics.durationSec).toBeCloseTo(0.5, 2);
    expect(metrics.estimatedLufs).toBeLessThan(0);
    expect(metrics.estimatedTruePeakDb).toBeGreaterThan(metrics.peakDb);
    expect(metrics.loudnessQuality).toBe("fast");
  });

  it("can re-measure final metrics with Mobile HQ true-peak analysis", () => {
    const fast = analyzeSingleFileMastering(mixedTone(0.5, 0.2), SAMPLE_RATE);
    const mobileHq = analyzeSingleFileMastering(mixedTone(0.5, 0.2), SAMPLE_RATE, { quality: "mobile-hq" });

    expect(mobileHq.loudnessQuality).toBe("mobile-hq");
    expect(mobileHq.estimatedTruePeakDb).toBeGreaterThanOrEqual(fast.peakDb);
    expect(mobileHq.monoFoldDownRmsLossDb).not.toBeNull();
  });

  it("resolves Loudness Only as gain and limiter only", () => {
    const settings = resolveSingleFileMasteringSettings("loudnessOnly", {
      stages: {
        safetyHpf: true,
        tiltBalance: true,
        toneCleanup: true,
        harshnessGuard: true,
        glueCompression: true,
        preLimiterClipper: true,
        targetLoudness: false,
        truePeakLimiter: false,
      },
      safetyHpfHz: 120,
      harshnessAmount: 1,
    });
    expect(settings.safetyHpfHz).toBe(0);
    expect(settings.harshnessAmount).toBe(0);
    expect(settings.stages).toEqual({
      safetyHpf: false,
      tiltBalance: false,
      toneCleanup: false,
      harshnessGuard: false,
      glueCompression: false,
      preLimiterClipper: false,
      targetLoudness: true,
      truePeakLimiter: true,
    });
  });

  it("resolves Reference Catch-Up with the supplied UI target", () => {
    const settings = resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: -9.7,
      truePeakCeilingDb: -1,
      targetLufsSource: "ui",
    });

    expect(settings.mode).toBe("referenceCatchUp");
    expect(settings.targetLufs).toBe(-9.7);
    expect(settings.targetLufsSource).toBe("ui");
    expect(settings.truePeakCeilingDb).toBe(-1);
    expect(settings.stages.preLimiterClipper).toBe(true);
    expect(settings.stages.targetLoudness).toBe(true);
    expect(settings.stages.truePeakLimiter).toBe(true);
  });

  it("keeps Direct WAV Polish conservative and widens only the mid support band", () => {
    const length = SAMPLE_RATE;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const t = index / SAMPLE_RATE;
      const mono = Math.sin(2 * Math.PI * 700 * t) * 0.18 + Math.sin(2 * Math.PI * 2400 * t) * 0.06;
      const side = Math.sin(2 * Math.PI * 1800 * t) * 0.008;
      left[index] = mono + side;
      right[index] = mono - side;
    }
    const settings = resolveSingleFileMasteringSettings("directWavPolish");
    const before = stereoImage([left, right]);
    const result = processSingleFileMastering([left, right], SAMPLE_RATE, settings);
    const after = stereoImage(result.channels as Float32Array[]);

    expect(settings.stages.glueCompression).toBe(false);
    expect(settings.stages.preLimiterClipper).toBe(false);
    expect(settings.stages.targetLoudness).toBe(false);
    expect(result.actions.some((action) => action.startsWith("Direct WAV Spatial:"))).toBe(true);
    expect(after.sideMidDb).toBeGreaterThan(before.sideMidDb);
    expect(after.correlation).toBeGreaterThan(0.65);
    expect(Math.abs(result.after.rmsDb - result.before.rmsDb)).toBeLessThan(0.35);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-1.15);
  });

  it("keeps Reference LUFS as analysis context without overriding the UI target", () => {
    const settings = resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: -10,
      referenceTargetLufs: -7.6,
      targetLufsSource: "ui",
      truePeakCeilingDb: -0.1,
    });

    expect(settings.targetLufs).toBe(-10);
    expect(settings.referenceTargetLufs).toBe(-7.6);
    expect(settings.targetLufsSource).toBe("ui");
    expect(settings.truePeakCeilingDb).toBe(-1);
  });

  it("keeps duration and channel count after Light Master processing", () => {
    const input = mixedTone(1.25);
    const result = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("lightMaster"));
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]).toHaveLength(input[0].length);
    expect(result.after.durationSec).toBeCloseTo(result.before.durationSec, 3);
    expect(result.after.channels).toBe(result.before.channels);
    expect(result.after.loudnessQuality).toBe("mobile-hq");
    expect(result.actions.join(" ")).toContain("Mobile HQ final metrics");
  });

  it("runs Tilt Balance in Light Master but bypasses it in Loudness Only", () => {
    const light = processSingleFileMastering(mixedTone(0.5), SAMPLE_RATE, resolveSingleFileMasteringSettings("lightMaster"));
    const loudnessOnly = processSingleFileMastering(mixedTone(0.5), SAMPLE_RATE, resolveSingleFileMasteringSettings("loudnessOnly"));

    expect(light.actions.some((action) => action.startsWith("Tilt Balance +"))).toBe(true);
    expect(loudnessOnly.actions).toContain("Tilt Balance bypassed");
  });

  it("moves Light Master output near the -14 LUFS target when headroom allows it", () => {
    const input = [sine(1000, 1, 0.05), sine(1000, 1, 0.05)];
    const result = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("lightMaster"));
    expect(result.after.estimatedLufs).toBeGreaterThan(-15.5);
    expect(result.after.estimatedLufs).toBeLessThan(-12.7);
  });

  it("applies a safety HPF that reduces very low sine energy", () => {
    const input = [sine(30, 1, 0.5), sine(30, 1, 0.5)];
    const settings = resolveSingleFileMasteringSettings("lightMaster", {
      safetyHpfHz: 100,
      stages: { ...noToneStages, safetyHpf: true },
    });
    const result = processSingleFileMastering(input, SAMPLE_RATE, settings);
    expect(rms(result.channels[0])).toBeLessThan(rms(input[0]) * 0.45);
  });

  it("can soften tone cleanup so Glow clarity is not cut back too hard", () => {
    const input = mixedTone(1, 0.12);
    const settings = resolveSingleFileMasteringSettings("lightMaster", {
      toneCleanupAmount: 0.35,
      stages: { ...noToneStages, toneCleanup: true },
    });
    const result = processSingleFileMastering(input, SAMPLE_RATE, settings);

    expect(result.actions.join(" ")).toContain("Tone Cleanup softened 35%");
    expect(result.after.durationSec).toBeCloseTo(result.before.durationSec, 3);
  });

  it("uses Reference Clarity Catch-Up instead of cutting presence when muffle guard is active", () => {
    const input = mixedTone(1, 0.1);
    const settings = resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: -14,
      referenceClarityMode: "catchUp",
      presenceCatchUpDb: 0.7,
      clarityCatchUpDb: 0.55,
      airCatchUpDb: 0.3,
      falseAirRisk: true,
    });
    const result = processSingleFileMastering(input, SAMPLE_RATE, settings);
    const actions = result.actions.join(" ");

    expect(actions).toContain("Tone Cleanup muffle guard");
    expect(actions).toContain("Harshness Guard muffle-safe");
    expect(actions).toContain("Reference Clarity Catch-Up");
    expect(actions).toContain("air 0.00dB");
    expect(result.after.durationSec).toBeCloseTo(result.before.durationSec, 3);
  });

  it("can recover sheen without adding presence or clarity and re-limits afterward", () => {
    const input = mixedTone(1, 0.4);
    const settings = resolveSingleFileMasteringSettings("referenceCatchUp", {
      referenceClarityMode: "catchUp",
      presenceCatchUpDb: 0,
      clarityCatchUpDb: 0,
      airCatchUpDb: 0,
      sheenCatchUpDb: 1.2,
      stages: { ...noToneStages, truePeakLimiter: true },
    });
    const result = processSingleFileMastering(input, SAMPLE_RATE, settings);
    const actions = result.actions.join(" ");

    expect(actions).toContain("presence 0.00dB");
    expect(actions).toContain("clarity 0.00dB");
    expect(actions).toContain("sheen 1.20dB");
    expect(actions).toContain("Reference Master Plan bypassed");
    expect(actions).toContain("Final true-peak authority");
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
  });

  it("applies one frozen Reference plan, one residual pass, and one Side High Clamp", () => {
    const result = processSingleFileMastering(mixedTone(1, 0.24), SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: -11,
      referenceClarityMode: "catchUp",
      referencePresenceDb: -18,
      referenceAirDb: -25,
      referenceGlossDb: -31,
      referenceUltraAirDb: -39,
      referenceSheenDb: -44,
      stages: { ...DEFAULT_LOUD_RELEASE_STAGES_FOR_TEST },
    }));
    const matchingActions = (prefix: string) => result.actions.filter((action) => action.startsWith(prefix));

    expect(matchingActions("Reference Master Plan:")).toHaveLength(1);
    expect(matchingActions("Reference Residual Tonal Safety")).toHaveLength(1);
    expect(matchingActions("Reference Side High Clamp")).toHaveLength(1);
    expect(result.actions.some((action) => action.includes("Post-target Reference Final Tonal Safety"))).toBe(false);
    expect(result.actions.some((action) => action.includes("Post-catch-up Reference Final Tonal Safety"))).toBe(false);
  });

  it("clamps excessive 14-20k side energy instead of adding more sheen", () => {
    const length = SAMPLE_RATE;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const t = index / SAMPLE_RATE;
      const mid = Math.sin(2 * Math.PI * 16000 * t) * 0.018;
      const side = Math.sin(2 * Math.PI * 16000 * t) * 0.16;
      left[index] = mid + side;
      right[index] = mid - side;
    }

    const beforeSide = highBandSideMidDb([left, right]);
    const beforeMidGloss = midFrequencyMagnitudeDb([left, right], 11000);
    const beforeMidSheen = midFrequencyMagnitudeDb([left, right], 16000);
    const result = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      referenceClarityMode: "catchUp",
      presenceCatchUpDb: 0,
      clarityCatchUpDb: 0,
      airCatchUpDb: 0,
      sheenCatchUpDb: 3,
      referenceUltraAirSideMidDb: -8,
      referenceGlossSideMidDb: -8,
      referenceAirNoiseSideMidDb: -12,
      referenceMidGlossShiftDb: 1.4,
      sideHighClampAmount: 1,
      stages: { ...noToneStages, truePeakLimiter: true },
    }));
    const afterSide = highBandSideMidDb(result.channels);
    const midGlossLift = midFrequencyMagnitudeDb(result.channels, 11000) - beforeMidGloss;
    const midSheenLift = midFrequencyMagnitudeDb(result.channels, 16000) - beforeMidSheen;
    const actions = result.actions.join(" ");

    expect(actions).toContain("high-side protected");
    expect(actions).toContain("mid sheen");
    expect(actions).toContain("Reference Upper Sheen Redirect");
    expect(actions).toContain("Reference Side High Clamp");
    expect(midSheenLift).toBeGreaterThan(midGlossLift + 0.8);
    expect(afterSide).toBeLessThan(beforeSide);
    expect(afterSide).toBeLessThan(beforeSide - 6);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
  });

  it("uses Reference Image Catch-Up to pull excessive side energy back toward the reference", () => {
    const length = SAMPLE_RATE;
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      const t = index / SAMPLE_RATE;
      const mid = Math.sin(2 * Math.PI * 700 * t) * 0.11;
      const side = Math.sin(2 * Math.PI * 2100 * t) * 0.18;
      left[index] = mid + side;
      right[index] = mid - side;
    }
    const before = stereoImage([left, right]);
    const result = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      referenceSideMidDb: -8,
      referenceCorrelation: 0.72,
      imageCatchUpAmount: 1,
      stages: { ...noToneStages },
    }));
    const after = stereoImage(result.channels);

    expect(result.actions.join(" ")).toContain("Reference Image Catch-Up");
    expect(after.sideMidDb).toBeLessThan(before.sideMidDb);
    expect(after.correlation).toBeGreaterThan(before.correlation);
  });

  it("keeps the estimated true peak below the requested ceiling", () => {
    const input = [sine(440, 1, 1.8), sine(440, 1, 1.8)];
    const settings = resolveSingleFileMasteringSettings("loudRelease", {
      targetLufs: -9,
      truePeakCeilingDb: -1,
    });
    const result = processSingleFileMastering(input, SAMPLE_RATE, settings);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
    expect(maxAbs(result.channels)).toBeLessThan(1);
  });

  it("uses pre-limiter clipping to reduce limiter load on transient-heavy loud masters", () => {
    const left = sine(220, 1, 0.04);
    const right = sine(330, 1, 0.04);
    for (let index = 0; index < left.length; index += 2400) {
      left[index] = index % 4800 === 0 ? 1.45 : -1.25;
      right[index] = index % 4800 === 0 ? -1.35 : 1.2;
    }

    const withClipper = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("loudRelease", {
      targetLufs: -8,
      truePeakCeilingDb: -1,
      clipperDriveDb: 2.6,
      clipperMix: 0.7,
    }));
    const withoutClipper = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("loudRelease", {
      targetLufs: -8,
      truePeakCeilingDb: -1,
      stages: { ...DEFAULT_LOUD_RELEASE_STAGES_FOR_TEST, preLimiterClipper: false },
    }));

    expect(withClipper.actions.join(" ")).toContain("Pre-Limiter Clipper");
    expect(withClipper.limiterGainReductionDb).toBeLessThan(withoutClipper.limiterGainReductionDb);
    expect(withClipper.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
    expect(withClipper.after.channels).toBe(withClipper.before.channels);
  });

  it("does not generate NaN or Infinity when cleanup stages are enabled", () => {
    const result = processSingleFileMastering(mixedTone(1, 0.2), SAMPLE_RATE, resolveSingleFileMasteringSettings("loudRelease"));
    for (const channel of result.channels) {
      for (const sample of channel) {
        expect(Number.isFinite(sample)).toBe(true);
      }
    }
  });

  it("can process in place to avoid extra full-song channel copies", () => {
    const input = mixedTone(1, 0.09);
    const firstChannel = input[0];
    const beforeRms = rms(firstChannel);
    const result = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("lightMaster"), { copyInput: false });
    expect(result.channels[0]).toBe(firstChannel);
    expect(rms(firstChannel)).not.toBeCloseTo(beforeRms, 6);
    expect(result.after.durationSec).toBeCloseTo(result.before.durationSec, 3);
  });

  it("raises peak-heavy material closer to target without global pull-down", () => {
    const left = sine(220, 1, 0.035);
    const right = sine(330, 1, 0.032);
    for (let index = 0; index < left.length; index += 4800) {
      left[index] = 1;
      right[index] = -0.95;
    }
    const before = analyzeSingleFileMastering([left, right], SAMPLE_RATE);
    const result = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("loudnessOnly", {
      targetLufs: before.estimatedLufs + 3,
      truePeakCeilingDb: -1,
    }));

    expect(result.after.estimatedLufs).toBeGreaterThan(before.estimatedLufs + 1.4);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
    expect(result.limiterGainReductionDb).toBeGreaterThan(0);
  });

  it("uses Reference Catch-Up to recover loudness while keeping the true peak ceiling", () => {
    const left = sine(220, 1, 0.032);
    const right = sine(330, 1, 0.03);
    for (let index = 0; index < left.length; index += 3600) {
      left[index] = index % 7200 === 0 ? 0.95 : -0.82;
      right[index] = index % 7200 === 0 ? -0.9 : 0.78;
    }
    const before = analyzeSingleFileMastering([left, right], SAMPLE_RATE);
    const result = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: before.estimatedLufs + 4,
      truePeakCeilingDb: -1,
    }));

    expect(result.actions.join(" ")).toContain("Reference Catch-Up");
    expect(result.after.estimatedLufs).toBeGreaterThan(before.estimatedLufs + 1.6);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
    expect(maxAbs(result.channels)).toBeLessThan(1);
  });

  it("holds Reference Catch-Up back when measured peak load would haze the limiter", () => {
    const left = sine(220, 1, 0.025);
    const right = sine(330, 1, 0.024);
    for (let index = 0; index < left.length; index += 2400) {
      left[index] = index % 4800 === 0 ? 0.92 : -0.84;
      right[index] = index % 4800 === 0 ? -0.9 : 0.82;
    }
    const before = analyzeSingleFileMastering([left, right], SAMPLE_RATE);
    const result = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: before.estimatedLufs + 7,
      truePeakCeilingDb: -1,
      referenceClarityMode: "off",
      presenceCatchUpDb: 0,
      clarityCatchUpDb: 0,
      airCatchUpDb: 0,
      sheenCatchUpDb: 0,
    }));
    const actions = result.actions.join(" ");

    expect(actions).toContain("Audition Guard");
    expect(result.limiterGainReductionDb).toBeLessThanOrEqual(2.9);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
    expect(result.after.estimatedLufs).toBeGreaterThan(before.estimatedLufs + 1.2);
  });

  it("uses measured Reference corrections without widening excessive high side", () => {
    const left = sine(180, 1, 0.05);
    const right = sine(260, 1, 0.05);
    for (let index = 0; index < left.length; index += 1) {
      const t = index / SAMPLE_RATE;
      const sub = Math.sin(2 * Math.PI * 42 * t) * 0.16;
      const glossMid = Math.sin(2 * Math.PI * 11000 * t) * 0.005;
      const supportSide = Math.sin(2 * Math.PI * 1800 * t) * 0.015;
      const highSide = Math.sin(2 * Math.PI * 16500 * t) * 0.06;
      left[index] += sub + glossMid + supportSide + highSide;
      right[index] += sub + glossMid - supportSide - highSide;
    }

    const beforeHighSide = highBandSideMidDb([left, right], 16500);
    const result = processSingleFileMastering([left, right], SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      referenceClarityMode: "catchUp",
      presenceCatchUpDb: 0,
      clarityCatchUpDb: 0,
      airCatchUpDb: 0,
      sheenCatchUpDb: 0,
      referenceSubTrimDb: 1.1,
      referenceDensityGateAmount: 0.35,
      referenceMidGlossShiftDb: 1.2,
      referenceMidSideRecoveryDb: 0.45,
      referenceUltraAirSideMidDb: -10,
      referenceAirNoiseSideMidDb: -12,
      sideHighClampAmount: 1,
      stages: { ...noToneStages, truePeakLimiter: true },
    }));
    const actions = result.actions.join(" ");
    const afterHighSide = highBandSideMidDb(result.channels, 16500);

    expect(actions).toContain("Reference Sub Trim");
    expect(actions).toContain("Reference Density Gate");
    expect(actions).toContain("Reference Mid Gloss Shift");
    expect(actions).toContain("Reference Mid-Side Recovery");
    expect(actions).toContain("Reference Side High Clamp");
    expect(afterHighSide).toBeLessThan(beforeHighSide);
    expect(afterHighSide).toBeLessThan(beforeHighSide - 6);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
  });

  it("skips Reference Density Gate when gloss correction is enough", () => {
    const input = mixedTone(1, 0.18);
    const result = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      referenceClarityMode: "catchUp",
      presenceCatchUpDb: 0,
      clarityCatchUpDb: 0,
      airCatchUpDb: 0,
      sheenCatchUpDb: 0,
      referenceDensityGateAmount: 0,
      referenceMidGlossShiftDb: 0.8,
      stages: { ...noToneStages, truePeakLimiter: true },
    }));
    const actions = result.actions.join(" ");

    expect(actions).toContain("Reference Mid Gloss Shift");
    expect(actions).toContain("Reference Density Gate skipped");
    expect(actions).not.toContain("Reference Density Gate: amount");
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
  });

  it("reports Reference Catch-Up guard values for UI audit", () => {
    const result = processSingleFileMastering(mixedTone(1, 0.045), SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: -10.5,
      referenceClarityMode: "catchUp",
      presenceCatchUpDb: 0.8,
      clarityCatchUpDb: 0.5,
      airCatchUpDb: 0.1,
      sheenCatchUpDb: 0.9,
      referenceDensityGateAmount: 0.42,
      stages: { ...noToneStages, truePeakLimiter: true },
    }));

    expect(result.referenceCatchUpGuardReport).toBeDefined();
    expect(result.referenceCatchUpGuardReport?.requestedPushDb).toBeGreaterThan(0);
    expect(result.referenceCatchUpGuardReport?.appliedPushDb).toBeGreaterThanOrEqual(0);
    expect(result.referenceCatchUpGuardReport?.targetLimiterBudgetDb).toBeGreaterThan(0);
    expect(result.referenceCatchUpGuardReport?.presenceLiftDb).toBeCloseTo(0.8, 1);
    expect(result.referenceCatchUpGuardReport?.densityAmount).toBeCloseTo(0.42, 2);
  });

  it("reports Loud Release warnings when limiter reduction becomes heavy", () => {
    const input = [sine(1000, 1, 1.8), sine(1000, 1, 1.8)];
    const result = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("loudRelease", { targetLufs: -6 }));
    expect(result.actions.join(" ")).toContain("Pre-Limiter Clipper");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("treats true peak ceiling as the final authority", () => {
    for (const ceiling of [-2, -1.2, -1]) {
      const result = processSingleFileMastering(mixedTone(1, 2.4), SAMPLE_RATE, resolveSingleFileMasteringSettings("lightMaster", {
        truePeakCeilingDb: ceiling,
        stages: { ...noToneStages, truePeakLimiter: true },
      }));

      expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(ceiling + 0.03);
      expect(result.exportSafetyReport.requestedTruePeakCeilingDbtp).toBe(ceiling);
      expect(result.exportSafetyReport.truePeakCeilingReached).toBe(true);
    }
  });

  it("separates headroom analysis from applied audio trim", () => {
    const analysisOnly = processSingleFileMastering(mixedTone(1, 2), SAMPLE_RATE, resolveSingleFileMasteringSettings("lightMaster", {
      headroomMode: "analysis",
      preMasterPeakCeilingDbfs: -6,
      stages: { ...noToneStages },
    }));
    const applied = processSingleFileMastering(mixedTone(1, 2), SAMPLE_RATE, resolveSingleFileMasteringSettings("lightMaster", {
      headroomMode: "apply",
      preMasterPeakCeilingDbfs: -6,
      stages: { ...noToneStages },
    }));

    expect(analysisOnly.exportSafetyReport.appliedHeadroomTrimDb).toBe(0);
    expect(applied.exportSafetyReport.appliedHeadroomTrimDb).toBeLessThan(0);
    expect(applied.exportSafetyReport.measuredPreMasterPeakAfterDbfs).toBeLessThanOrEqual(-5.9);
    expect(maxAbs(applied.channels)).toBeLessThan(maxAbs(analysisOnly.channels));
  });

  it("trims final output when catch-up processing overshoots the selected target", () => {
    const result = processSingleFileMastering(mixedTone(1, 0.7), SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: -10,
      referenceTargetLufs: -7.6,
      targetLufsSource: "ui",
      truePeakCeilingDb: -1,
      referenceClarityMode: "catchUp",
      presenceCatchUpDb: 0.8,
      clarityCatchUpDb: 0.6,
      sheenCatchUpDb: 1.2,
    }));

    expect(result.targetReport.effectiveTargetLufs).toBe(-10);
    expect(result.targetReport.referenceTargetLufs).toBe(-7.6);
    expect(result.targetReport.targetLufsSource).toBe("ui");
    expect(result.targetReport.afterLufs).toBeLessThanOrEqual(-9.65);
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
  });

  it("keeps transparent Reference checks from changing clean material with Artifact Guard", () => {
    const input = mixedTone(1, 0.28);
    const before = analyzeSingleFileMastering(input, SAMPLE_RATE);
    const control = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: before.estimatedLufs,
      referenceTransparentCheck: true,
      referenceClarityMode: "off",
      artifactGuardAmount: 0,
    }));
    const result = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: before.estimatedLufs,
      referenceTransparentCheck: true,
      referenceClarityMode: "off",
      artifactGuardAmount: 0.8,
    }));
    const actions = result.actions.join(" ");

    expect(actions).toContain("Reference Transparent Check");
    expect(actions).toContain("Master Artifact Guard transparent bypassed");
    expect(Math.abs(result.after.estimatedLufs - control.after.estimatedLufs)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(result.after.estimatedTruePeakDb - control.after.estimatedTruePeakDb)).toBeLessThanOrEqual(0.03);
    expect(result.limiterGainReductionDb).toBeLessThanOrEqual(0.05);
  });

  it("allows transparent Reference checks to tame obvious hiss only", () => {
    const input = hissBed(1).map((channel) => {
      const copy = new Float32Array(channel.length);
      for (let index = 0; index < channel.length; index += 1) copy[index] = channel[index]! * 3.2;
      return copy;
    });
    const before = analyzeSingleFileMastering(input, SAMPLE_RATE);
    const result = processSingleFileMastering(input, SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: before.estimatedLufs,
      referenceTransparentCheck: true,
      referenceClarityMode: "off",
      artifactGuardAmount: 0.8,
    }));
    const actions = result.actions.join(" ");

    expect(actions).toContain("Reference Transparent Check");
    expect(actions).toContain("Master Artifact Guard");
    expect(actions).toContain("Target Loudness bypassed for transparent Reference check");
    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.95);
  });

  it("reports when target loudness is limited by true peak ceiling", () => {
    const result = processSingleFileMastering(peakyTone(1), SAMPLE_RATE, resolveSingleFileMasteringSettings("loudnessOnly", {
      targetLufs: -6,
      truePeakCeilingDb: -1,
    }));

    expect(result.after.estimatedTruePeakDb).toBeLessThanOrEqual(-0.97);
    expect(result.exportSafetyReport.targetLufsLimitedByTruePeak).toBe(true);
    expect(result.exportSafetyReport.heldBackByTruePeakDb).toBeGreaterThan(0);
  });

  it("uses fixed full-song target gain for chunked single-file mastering", () => {
    const result = processSingleFileMastering(mixedTone(1, 0.05), SAMPLE_RATE, resolveSingleFileMasteringSettings("referenceCatchUp", {
      targetLufs: -11,
      chunkedFixedTargetGainDb: 1.25,
      chunkedGlobalLufs: -12.25,
      referenceClarityMode: "off",
    }), { quality: "fast" });
    const actions = result.actions.join(" ");

    expect(actions).toContain("fixed full-song chunk gain +1.3 dB");
    expect(actions).toContain("per-chunk Reference gain catch-up bypassed");
    expect(actions).toContain("final LUFS authority trim bypassed");
    expect(actions).not.toContain("post-crest LUFS catch-up");
  });
});
