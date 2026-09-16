export type SpectralTile = {
  timeBins: number;
  freqBins: number;
  startSec: number;
  durationSec: number;
  minHz: number;
  maxHz: number;
  values: Uint8Array;
};

export type SpectralTileOptions = {
  startSec?: number;
  durationSec?: number;
  timeBins?: number;
  freqBins?: number;
  minHz?: number;
  maxHz?: number;
  minDb?: number;
  maxDb?: number;
};

export function buildSpectralTile(buffer: AudioBuffer, options: SpectralTileOptions = {}): SpectralTile {
  const timeBins = clampInt(options.timeBins ?? 96, 16, 180);
  const freqBins = clampInt(options.freqBins ?? 72, 24, 128);
  const minHz = clamp(options.minHz ?? 20, 10, buffer.sampleRate / 2);
  const maxHz = clamp(options.maxHz ?? Math.min(20000, buffer.sampleRate / 2 - 100), minHz + 100, buffer.sampleRate / 2);
  const startSec = clamp(options.startSec ?? 0, 0, Math.max(0, buffer.duration - 0.05));
  const durationSec = clamp(options.durationSec ?? Math.min(buffer.duration - startSec, 20), 0.05, Math.max(0.05, buffer.duration - startSec));
  const minDb = options.minDb ?? -72;
  const maxDb = options.maxDb ?? -12;
  const values = new Uint8Array(timeBins * freqBins);
  const channelCount = Math.max(1, buffer.numberOfChannels);
  const channels = Array.from({ length: channelCount }, (_, index) => buffer.getChannelData(index));
  const windowSize = Math.min(1024, Math.max(256, Math.floor((durationSec * buffer.sampleRate) / Math.max(1, timeBins * 0.8))));
  const segmentStart = Math.floor(startSec * buffer.sampleRate);
  const segmentSamples = Math.max(windowSize, Math.floor(durationSec * buffer.sampleRate));

  for (let t = 0; t < timeBins; t += 1) {
    const center = segmentStart + Math.floor((t / Math.max(1, timeBins - 1)) * Math.max(0, segmentSamples - 1));
    const frameStart = Math.max(0, Math.min(buffer.length - windowSize, center - Math.floor(windowSize / 2)));

    for (let f = 0; f < freqBins; f += 1) {
      const hz = logFreq(minHz, maxHz, f / Math.max(1, freqBins - 1));
      const magnitude = estimateMagnitude(channels, buffer.sampleRate, frameStart, windowSize, hz);
      const db = 20 * Math.log10(Math.max(1e-8, magnitude));
      const normalized = clamp((db - minDb) / Math.max(1, maxDb - minDb), 0, 1);
      values[(freqBins - 1 - f) * timeBins + t] = Math.round(normalized * 255);
    }
  }

  return {
    timeBins,
    freqBins,
    startSec,
    durationSec,
    minHz,
    maxHz,
    values,
  };
}

function estimateMagnitude(channels: Float32Array[], sampleRate: number, start: number, windowSize: number, frequency: number) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  let real = 0;
  let imag = 0;
  for (let index = 0; index < windowSize; index += 1) {
    const sample = averageSample(channels, start + index);
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, windowSize - 1));
    const value = sample * window;
    real += value * Math.cos(omega * index);
    imag -= value * Math.sin(omega * index);
  }
  return Math.sqrt(real * real + imag * imag) / (windowSize * 0.5);
}

function averageSample(channels: Float32Array[], index: number) {
  let sum = 0;
  for (const channel of channels) sum += channel[index] ?? 0;
  return sum / Math.max(1, channels.length);
}

function logFreq(minHz: number, maxHz: number, ratio: number) {
  return minHz * (maxHz / minHz) ** clamp(ratio, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampInt(value: number, min: number, max: number) {
  return Math.round(clamp(value, min, max));
}
