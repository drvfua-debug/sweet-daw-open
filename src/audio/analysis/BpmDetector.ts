export type BpmCandidate = {
  bpm: number;
  score: number;
};

export type BpmDetectionResult = {
  bpm: number;
  confidence: number;
  candidates: BpmCandidate[];
  analyzedDurationSec: number;
};

type BpmDetectionOptions = {
  minBpm?: number;
  maxBpm?: number;
  maxAnalysisSec?: number;
};

export function detectBpmFromBuffer(
  buffer: AudioBuffer,
  {
    minBpm = 60,
    maxBpm = 200,
    maxAnalysisSec = 45,
  }: BpmDetectionOptions = {},
): BpmDetectionResult | null {
  const analyzedDurationSec = Math.min(buffer.duration, maxAnalysisSec);
  if (!Number.isFinite(analyzedDurationSec) || analyzedDurationSec < 6) return null;

  const hopSize = Math.max(256, Math.floor(buffer.sampleRate / 86));
  const sampleLimit = Math.min(buffer.length, Math.floor(analyzedDurationSec * buffer.sampleRate));
  const frameCount = Math.floor(sampleLimit / hopSize);
  if (frameCount < 64) return null;

  const energies = buildEnergyEnvelope(buffer, frameCount, hopSize);
  const novelty = buildOnsetNovelty(energies);
  const noveltyPower = novelty.reduce((sum, value) => sum + value, 0);
  if (noveltyPower < 0.001) return null;

  const hopSec = hopSize / buffer.sampleRate;
  const candidates = scoreTempoCandidates(novelty, hopSec, minBpm, maxBpm);
  if (candidates.length === 0) return null;

  const best = chooseMusicalCandidate(candidates);
  const confidence = candidates.length > 1 ? best.score / Math.max(0.000001, candidates[1]?.score ?? best.score) - 1 : best.score;

  return {
    bpm: Math.round(best.bpm),
    confidence: Number(Math.max(0, confidence).toFixed(3)),
    candidates: candidates.slice(0, 5).map((candidate) => ({
      bpm: Math.round(candidate.bpm),
      score: Number(candidate.score.toFixed(4)),
    })),
    analyzedDurationSec,
  };
}

function buildEnergyEnvelope(buffer: AudioBuffer, frameCount: number, hopSize: number) {
  const energies = new Array<number>(frameCount).fill(0);
  const channelCount = Math.min(buffer.numberOfChannels, 2);
  const sampleStep = Math.max(1, Math.floor(hopSize / 128));

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * hopSize;
    const end = Math.min(buffer.length, start + hopSize);
    let energy = 0;
    let reads = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let sample = start; sample < end; sample += sampleStep) {
        energy += Math.abs(data[sample] ?? 0);
        reads += 1;
      }
    }

    energies[frame] = reads > 0 ? energy / reads : 0;
  }

  return energies;
}

function buildOnsetNovelty(energies: number[]) {
  const novelty = new Array<number>(energies.length).fill(0);
  let peak = 0;

  for (let index = 4; index < energies.length; index += 1) {
    const localAverage =
      (energies[index - 1] + energies[index - 2] + energies[index - 3] + energies[index - 4]) / 4;
    const value = Math.max(0, energies[index] - localAverage * 1.06);
    novelty[index] = value;
    if (value > peak) peak = value;
  }

  if (peak <= 0) return novelty;
  return novelty.map((value) => value / peak);
}

function scoreTempoCandidates(novelty: number[], hopSec: number, minBpm: number, maxBpm: number) {
  const candidates: BpmCandidate[] = [];
  const safeMin = Math.max(40, Math.min(minBpm, maxBpm));
  const safeMax = Math.min(240, Math.max(minBpm, maxBpm));

  for (let bpm = safeMin; bpm <= safeMax; bpm += 1) {
    const lag = Math.round((60 / bpm) / hopSec);
    if (lag < 2 || lag >= novelty.length / 2) continue;

    let score = 0;
    let weightSum = 0;
    const harmonicWeights = [1, 0.62, 0.34];

    for (let harmonic = 0; harmonic < harmonicWeights.length; harmonic += 1) {
      const weightedLag = lag * (harmonic + 1);
      if (weightedLag >= novelty.length) continue;
      const weight = harmonicWeights[harmonic] ?? 0;

      for (let index = weightedLag; index < novelty.length; index += 1) {
        score += novelty[index] * novelty[index - weightedLag] * weight;
      }
      weightSum += weight * (novelty.length - weightedLag);
    }

    if (weightSum > 0) {
      candidates.push({
        bpm,
        score: score / weightSum,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function chooseMusicalCandidate(candidates: BpmCandidate[]) {
  const best = candidates[0];
  if (!best) return { bpm: 120, score: 0 };

  if (best.bpm > 150) {
    const half = findCandidateNear(candidates, best.bpm / 2);
    if (half && half.score >= best.score * 0.72) return half;
  }

  if (best.bpm < 75) {
    const double = findCandidateNear(candidates, best.bpm * 2);
    if (double && double.score >= best.score * 0.72) return double;
  }

  return best;
}

function findCandidateNear(candidates: BpmCandidate[], bpm: number) {
  return candidates.find((candidate) => Math.abs(candidate.bpm - bpm) <= 2) ?? null;
}
