export type MasterArtifactGuardScores = {
  harshness: number;
  sibilance: number;
  metallic: number;
  hiss: number;
  fakeAirRisk: number;
};

export type MasterArtifactGuardBandSummary = {
  bodyDb: number;
  presenceDb: number;
  sibilanceDb: number;
  metallicDb: number;
  hissDb: number;
  highRatioDb: number;
  metallicPeakConcentration: number;
  hissPeakConcentration: number;
  metallicFlatness: number;
  hissFlatness: number;
  highContinuity: number;
};

export type MasterArtifactGuardReport = {
  applied: boolean;
  amount: number;
  scores: MasterArtifactGuardScores;
  bands: MasterArtifactGuardBandSummary;
  cuts: {
    presenceDb: number;
    sibilanceDb: number;
    metallicDb: number;
    hissDb: number;
  };
  action: string;
  warnings: string[];
};

export type MasterArtifactGuardOptions = {
  amount: number;
  preserveBrightness?: boolean;
  maxCutDb?: number;
  finalPass?: boolean;
};

type Biquad = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

type RatioBandKey = "bodyDb" | "presenceDb" | "sibilanceDb" | "metallicDb" | "hissDb";

type BandSpec = {
  key: RatioBandKey;
  fromHz: number;
  toHz: number;
};

type BandDetail = {
  ratioDb: number;
  peakConcentration: number;
  flatness: number;
  pointCount: number;
};

type SpectrumSummary = MasterArtifactGuardBandSummary & {
  details: Record<RatioBandKey, BandDetail>;
};

const ANALYSIS_POINTS = 96;
const MAX_ANALYSIS_SAMPLES = 65_536;
const EPSILON = 1e-12;

const BANDS: BandSpec[] = [
  { key: "bodyDb", fromHz: 500, toHz: 2000 },
  { key: "presenceDb", fromHz: 2500, toHz: 5000 },
  { key: "sibilanceDb", fromHz: 5000, toHz: 8500 },
  { key: "metallicDb", fromHz: 8500, toHz: 13000 },
  { key: "hissDb", fromHz: 13000, toHz: 18000 },
];

export function analyzeMasterArtifacts(
  channels: Float32Array[],
  sampleRate: number,
): Pick<MasterArtifactGuardReport, "scores" | "bands" | "warnings"> {
  const warnings: string[] = [];
  const mono = representativeMono(channels, MAX_ANALYSIS_SAMPLES);
  if (mono.length < 128 || sampleRate < 8000) {
    warnings.push("Master Artifact Guard analysis skipped: input is too short.");
    return {
      scores: { harshness: 0, sibilance: 0, metallic: 0, hiss: 0, fakeAirRisk: 0 },
      bands: {
        bodyDb: -96,
        presenceDb: -96,
        sibilanceDb: -96,
        metallicDb: -96,
        hissDb: -96,
        highRatioDb: -96,
        metallicPeakConcentration: 0,
        hissPeakConcentration: 0,
        metallicFlatness: 0,
        hissFlatness: 0,
        highContinuity: 0,
      },
      warnings,
    };
  }

  const stats = spectrumBandRatios(mono, sampleRate);
  const bodyAnchorDb = Math.max(stats.bodyDb, -44);
  const highStackDb = dbAverage([stats.sibilanceDb, stats.metallicDb, stats.hissDb]);
  const highRatioDb = highStackDb - bodyAnchorDb;
  const metallicNoiseWeight = noiseLikeWeight(stats.details.metallicDb);
  const hissNoiseWeight = noiseLikeWeight(stats.details.hissDb);
  const metallicTonalArtifactWeight = tonalArtifactWeight(stats.details.metallicDb, stats.metallicDb, bodyAnchorDb);
  const highContinuityWeight = clamp(stats.highContinuity / 100, 0, 1);
  const musicalAirProtection = musicalAirProtectionWeight(stats);
  const harshness = clamp((stats.presenceDb + 30) * 2.8 + Math.max(0, stats.presenceDb - bodyAnchorDb - 8) * 3.2, 0, 100);
  const sibilance = clamp(((stats.sibilanceDb + 38) * 3.7 + Math.max(0, highRatioDb + 32) * 1.2) * (0.74 + noiseLikeWeight(stats.details.sibilanceDb) * 0.36) - musicalAirProtection * 18, 0, 100);
  const metallic = clamp(
    ((stats.metallicDb + 34) * 3.6 + Math.max(0, stats.metallicDb + 28) * 4.6 + Math.max(0, stats.metallicDb - stats.sibilanceDb - 2) * 2.2) * (0.38 + metallicNoiseWeight * 0.48 + metallicTonalArtifactWeight * 0.42) -
      musicalAirProtection * 20,
    0,
    100,
  );
  const hiss = clamp(
    ((stats.hissDb + 38) * 3.7 + Math.max(0, stats.hissDb + 32) * 3.4 + Math.max(0, stats.hissDb - stats.metallicDb + 4) * 2.6) * (0.34 + hissNoiseWeight * 0.74 + highContinuityWeight * 0.22) -
      musicalAirProtection * 18,
    0,
    100,
  );
  const fakeAirRisk = clamp(
    Math.max(hiss * 0.82, metallic * 0.58) +
      (hissNoiseWeight * 26) +
      (highContinuityWeight * 16) +
      Math.max(0, highRatioDb + 16) * 1.7 -
      musicalAirProtection * 28,
    0,
    100,
  );

  return {
    scores: {
      harshness: round1(harshness),
      sibilance: round1(sibilance),
      metallic: round1(metallic),
      hiss: round1(hiss),
      fakeAirRisk: round1(fakeAirRisk),
    },
    bands: {
      bodyDb: stats.bodyDb,
      presenceDb: stats.presenceDb,
      sibilanceDb: stats.sibilanceDb,
      metallicDb: stats.metallicDb,
      hissDb: stats.hissDb,
      highRatioDb: round2(highRatioDb),
      metallicPeakConcentration: round2(stats.metallicPeakConcentration),
      hissPeakConcentration: round2(stats.hissPeakConcentration),
      metallicFlatness: round2(stats.metallicFlatness),
      hissFlatness: round2(stats.hissFlatness),
      highContinuity: round1(stats.highContinuity),
    },
    warnings,
  };
}

export function applyMasterArtifactGuard(
  channels: Float32Array[],
  sampleRate: number,
  options: MasterArtifactGuardOptions,
): MasterArtifactGuardReport {
  const amount = clamp(options.amount, 0, 1);
  const analysis = analyzeMasterArtifacts(channels, sampleRate);
  const warnings = [...analysis.warnings];
  const preserveScale = options.preserveBrightness ? 0.62 : 1;
  const musicalPeakProtectionScale = options.preserveBrightness &&
    analysis.bands.metallicPeakConcentration > 0.85 &&
    analysis.bands.metallicFlatness < 0.18 &&
    analysis.bands.highContinuity < 45
    ? 0.35
    : 1;
  const maxCutDb = clamp(options.maxCutDb ?? 1.55, 0.2, 3);
  const finalPass = Boolean(options.finalPass);
  const finalPassScale = finalPass ? 0.6 : 1;
  const presenceMaxDb = finalPass ? Math.min(maxCutDb * 0.25, 0.08) : options.preserveBrightness ? Math.min(maxCutDb * 0.42, 0.25) : maxCutDb * 0.42;
  const sibilanceMaxDb = finalPass ? Math.min(maxCutDb * 0.45, 0.16) : options.preserveBrightness ? Math.min(maxCutDb * 0.78, 0.55) : maxCutDb * 0.78;
  const metallicMaxDb = finalPass ? Math.min(maxCutDb * 0.52, 0.2) : options.preserveBrightness ? Math.min(maxCutDb, 0.75) : maxCutDb;
  const hissMaxDb = finalPass ? Math.min(maxCutDb * 0.58, 0.22) : options.preserveBrightness ? Math.min(maxCutDb * 0.82, 0.85) : maxCutDb * 1.05;
  const presenceCutDb = -cutFromScore(analysis.scores.harshness, 68, presenceMaxDb, amount) * preserveScale * finalPassScale;
  const sibilanceCutDb = -cutFromScore(analysis.scores.sibilance, 56, sibilanceMaxDb, amount) * preserveScale * musicalPeakProtectionScale * finalPassScale;
  const metallicCutDb = -cutFromScore(analysis.scores.metallic, 54, metallicMaxDb, amount) * preserveScale * musicalPeakProtectionScale * finalPassScale;
  const hissCutDb = -cutFromScore(analysis.scores.hiss, 54, hissMaxDb, amount) * musicalPeakProtectionScale * finalPassScale;
  const appliedThresholdDb = finalPass ? 0.012 : 0.03;
  const applied =
    Math.abs(presenceCutDb) > appliedThresholdDb ||
    Math.abs(sibilanceCutDb) > appliedThresholdDb ||
    Math.abs(metallicCutDb) > appliedThresholdDb ||
    Math.abs(hissCutDb) > appliedThresholdDb;

  if (applied) {
    for (const channel of channels) {
      if (presenceCutDb < -appliedThresholdDb) runBiquadInPlace(channel, makePeaking(sampleRate, 3600, 1.0, presenceCutDb));
      if (sibilanceCutDb < -appliedThresholdDb) runBiquadInPlace(channel, makePeaking(sampleRate, 7200, 1.45, sibilanceCutDb));
      if (metallicCutDb < -appliedThresholdDb) runBiquadInPlace(channel, makePeaking(sampleRate, 10800, 1.05, metallicCutDb));
      if (hissCutDb < -appliedThresholdDb) {
        runBiquadInPlace(channel, makePeaking(sampleRate, 15600, 0.82, hissCutDb));
        if (analysis.scores.fakeAirRisk > 82 && analysis.scores.hiss > 70 && !options.preserveBrightness) {
          runBiquadInPlace(channel, makeHighshelf(sampleRate, 14200, Math.max(-0.35, hissCutDb * 0.32), 0.7));
        }
      }
    }
  }

  if (analysis.scores.fakeAirRisk > 70 && amount > 0.05) {
    warnings.push("Artifact Guard detected fake-air / hiss risk; broad air boosts should stay conservative.");
  }

  const cuts = {
    presenceDb: round2(presenceCutDb),
    sibilanceDb: round2(sibilanceCutDb),
    metallicDb: round2(metallicCutDb),
    hissDb: round2(hissCutDb),
  };

  return {
    applied,
    amount: round2(amount),
    scores: analysis.scores,
    bands: analysis.bands,
    cuts,
    warnings,
    action: applied
      ? `Master Artifact Guard${options.finalPass ? " final" : ""}: hiss ${analysis.scores.hiss.toFixed(0)} / metallic ${analysis.scores.metallic.toFixed(0)} / fake-air ${analysis.scores.fakeAirRisk.toFixed(0)} / cuts P ${cuts.presenceDb.toFixed(2)} S ${cuts.sibilanceDb.toFixed(2)} M ${cuts.metallicDb.toFixed(2)} H ${cuts.hissDb.toFixed(2)} dB`
      : `Master Artifact Guard bypassed: hiss ${analysis.scores.hiss.toFixed(0)} / metallic ${analysis.scores.metallic.toFixed(0)} below threshold`,
  };
}

function spectrumBandRatios(samples: Float32Array, sampleRate: number): SpectrumSummary {
  const nyquist = sampleRate * 0.5;
  const maxHz = Math.min(nyquist * 0.92, 19000);
  const minHz = 220;
  const powers = new Map<RatioBandKey, number[]>();
  for (const band of BANDS) powers.set(band.key as RatioBandKey, []);
  let total = 0;

  for (let point = 1; point <= ANALYSIS_POINTS; point += 1) {
    const hz = minHz * Math.pow(maxHz / minHz, point / ANALYSIS_POINTS);
    const power = goertzelPower(samples, sampleRate, hz) + EPSILON;
    total += power;
    for (const band of BANDS) {
      if (hz >= band.fromHz && hz < Math.min(band.toHz, nyquist * 0.96)) {
        powers.get(band.key as RatioBandKey)?.push(power);
      }
    }
  }
  const details: Record<RatioBandKey, BandDetail> = {
    bodyDb: bandDetail(powers.get("bodyDb") ?? [], total),
    presenceDb: bandDetail(powers.get("presenceDb") ?? [], total),
    sibilanceDb: bandDetail(powers.get("sibilanceDb") ?? [], total),
    metallicDb: bandDetail(powers.get("metallicDb") ?? [], total),
    hissDb: bandDetail(powers.get("hissDb") ?? [], total),
  };
  const continuity = clamp(100 - Math.abs(details.metallicDb.ratioDb - details.hissDb.ratioDb) * 4, 0, 100);

  return {
    bodyDb: round2(details.bodyDb.ratioDb),
    presenceDb: round2(details.presenceDb.ratioDb),
    sibilanceDb: round2(details.sibilanceDb.ratioDb),
    metallicDb: round2(details.metallicDb.ratioDb),
    hissDb: round2(details.hissDb.ratioDb),
    highRatioDb: 0,
    metallicPeakConcentration: round2(details.metallicDb.peakConcentration),
    hissPeakConcentration: round2(details.hissDb.peakConcentration),
    metallicFlatness: round2(details.metallicDb.flatness),
    hissFlatness: round2(details.hissDb.flatness),
    highContinuity: round1(continuity),
    details,
  };
}

function bandDetail(values: number[], total: number): BandDetail {
  const sum = values.reduce((acc, value) => acc + value, 0);
  const max = values.reduce((acc, value) => Math.max(acc, value), 0);
  const arithmetic = sum / Math.max(1, values.length);
  const geometric = values.length > 0
    ? Math.exp(values.reduce((acc, value) => acc + Math.log(Math.max(EPSILON, value)), 0) / values.length)
    : 0;
  return {
    ratioDb: ratioDb(sum, total),
    peakConcentration: clamp(max / Math.max(EPSILON, sum), 0, 1),
    flatness: clamp(geometric / Math.max(EPSILON, arithmetic), 0, 1),
    pointCount: values.length,
  };
}

function noiseLikeWeight(detail: BandDetail) {
  const flat = clamp((detail.flatness - 0.22) / 0.46, 0, 1);
  const diffuse = clamp((0.58 - detail.peakConcentration) / 0.38, 0, 1);
  return clamp(flat * 0.58 + diffuse * 0.42, 0, 1);
}

function tonalArtifactWeight(detail: BandDetail, bandDb: number, bodyAnchorDb: number) {
  const strongTone = clamp((bandDb - bodyAnchorDb + 22) / 16, 0, 1);
  const concentrated = clamp((detail.peakConcentration - 0.34) / 0.42, 0, 1);
  return strongTone * concentrated;
}

function musicalAirProtectionWeight(stats: SpectrumSummary) {
  const tonalHigh = Math.max(stats.details.metallicDb.peakConcentration, stats.details.hissDb.peakConcentration);
  const lowFlatness = 1 - Math.max(stats.details.metallicDb.flatness, stats.details.hissDb.flatness);
  const presenceSupport = clamp((stats.presenceDb - stats.hissDb + 10) / 18, 0, 1);
  const separatedTop = clamp((stats.metallicDb - stats.hissDb + 5) / 16, 0, 1);
  return clamp(tonalHigh * 0.45 + lowFlatness * 0.25 + presenceSupport * 0.18 + separatedTop * 0.12, 0, 1);
}

function representativeMono(channels: Float32Array[], maxSamples: number) {
  const length = Math.min(...channels.filter(Boolean).map((channel) => channel.length));
  if (!Number.isFinite(length) || length <= 0) return new Float32Array();
  const outLength = Math.min(maxSamples, length);
  const out = new Float32Array(outLength);
  if (length <= outLength) {
    for (let index = 0; index < outLength; index += 1) out[index] = monoAt(channels, index);
    return out;
  }

  const windows = Math.min(16, Math.max(4, Math.floor(outLength / 4096)));
  const windowSize = Math.max(1, Math.floor(outLength / windows));
  let offset = 0;
  for (let windowIndex = 0; windowIndex < windows; windowIndex += 1) {
    const position = windows === 1 ? 0 : windowIndex / (windows - 1);
    const start = Math.min(length - windowSize, Math.floor(position * Math.max(0, length - windowSize)));
    for (let local = 0; local < windowSize && offset < out.length; local += 1) {
      out[offset] = monoAt(channels, start + local);
      offset += 1;
    }
  }
  return out;
}

function monoAt(channels: Float32Array[], index: number) {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    if (!channel) continue;
    sum += sanitize(channel[index] ?? 0);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

function goertzelPower(samples: Float32Array, sampleRate: number, freq: number) {
  const omega = (2 * Math.PI * freq) / Math.max(1, sampleRate);
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    s0 = samples[index] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, samples.length);
}

function cutFromScore(score: number, threshold: number, maxCutDb: number, amount: number) {
  if (amount <= 0 || score <= threshold) return 0;
  return clamp(((score - threshold) / Math.max(1, 100 - threshold)) * maxCutDb * amount, 0, maxCutDb);
}

function makePeaking(sampleRate: number, frequency: number, q: number, gainDb: number): Biquad {
  const safeFreq = clamp(frequency, 20, Math.max(20, sampleRate * 0.46));
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * safeFreq) / Math.max(1, sampleRate);
  const alpha = Math.sin(w0) / (2 * Math.max(0.1, q));
  const cos = Math.cos(w0);
  const b0 = 1 + alpha * a;
  const b1 = -2 * cos;
  const b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a;
  const a1 = -2 * cos;
  const a2 = 1 - alpha / a;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function makeHighshelf(sampleRate: number, frequency: number, gainDb: number, slope = 0.7): Biquad {
  const safeFreq = clamp(frequency, 20, Math.max(20, sampleRate * 0.46));
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * safeFreq) / Math.max(1, sampleRate);
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = (sin / 2) * Math.sqrt((a + 1 / a) * (1 / Math.max(0.1, slope) - 1) + 2);
  const beta = 2 * Math.sqrt(a) * alpha;
  const b0 = a * ((a + 1) + (a - 1) * cos + beta);
  const b1 = -2 * a * ((a - 1) + (a + 1) * cos);
  const b2 = a * ((a + 1) + (a - 1) * cos - beta);
  const a0 = (a + 1) - (a - 1) * cos + beta;
  const a1 = 2 * ((a - 1) - (a + 1) * cos);
  const a2 = (a + 1) - (a - 1) * cos - beta;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function runBiquadInPlace(channel: Float32Array, coeff: Biquad) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const x = sanitize(channel[index] ?? 0);
    const y = coeff.b0 * x + coeff.b1 * x1 + coeff.b2 * x2 - coeff.a1 * y1 - coeff.a2 * y2;
    channel[index] = sanitize(y);
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
}

function ratioDb(value: number, total: number) {
  return 10 * Math.log10(Math.max(EPSILON, value) / Math.max(EPSILON, total));
}

function dbAverage(values: number[]) {
  const sum = values.reduce((acc, value) => acc + Math.pow(10, value / 10), 0);
  return 10 * Math.log10(Math.max(EPSILON, sum / Math.max(1, values.length)));
}

function sanitize(sample: number) {
  return Number.isFinite(sample) ? clamp(sample, -1.5, 1.5) : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
