import type { EQBand, ParametricEQState } from "@/daw/model/Project";

export type ParametricEQNodeChain = {
  input: GainNode;
  output: GainNode;
  filters: BiquadFilterNode[];
  apply: (state: ParametricEQState, options?: AudioParamApplyOptions) => void;
  dispose: () => void;
};

export type EqCurvePoint = {
  x: number;
  frequency: number;
  db: number;
};

type AudioParamApplyOptions = {
  smooth?: boolean;
};

export const MIN_EQ_FREQUENCY = 20;
export const MAX_EQ_FREQUENCY = 20000;
export const MIN_EQ_GAIN_DB = -18;
export const MAX_EQ_GAIN_DB = 18;
export const MIN_EQ_Q = 0.1;
export const MAX_EQ_Q = 12;

const EQ_BAND_TYPES = new Set<EQBand["type"]>(["highpass", "lowpass", "lowshelf", "highshelf", "peaking", "notch"]);

export function createParametricEQ(context: BaseAudioContext, state: ParametricEQState): ParametricEQNodeChain {
  const input = context.createGain();
  const output = context.createGain();
  const filters = state.bands.map(() => context.createBiquadFilter());

  if (filters.length === 0) {
    input.connect(output);
  } else {
    input.connect(filters[0]);
    for (let index = 0; index < filters.length; index += 1) {
      const next = filters[index + 1] ?? output;
      filters[index].connect(next);
    }
  }

  const chain: ParametricEQNodeChain = {
    input,
    output,
    filters,
    apply: (nextState, options) => applyParametricEQState(context, filters, nextState, options),
    dispose: () => {
      input.disconnect();
      for (const filter of filters) filter.disconnect();
      output.disconnect();
    },
  };

  chain.apply(state);
  return chain;
}

export function applyParametricEQState(
  context: BaseAudioContext,
  filters: BiquadFilterNode[],
  state: ParametricEQState,
  options: AudioParamApplyOptions = {},
) {
  const safeState = sanitizeParametricEQState(state);
  const time = context.currentTime;
  const nyquist = Math.max(MIN_EQ_FREQUENCY + 1, context.sampleRate / 2 - 1);
  const soloActive = safeState.bands.some((band) => band.solo);

  for (let index = 0; index < filters.length; index += 1) {
    const filter = filters[index];
    const band = safeState.bands[index];

    if (!safeState.enabled || !band?.enabled || (soloActive && !band.solo)) {
      filter.type = "allpass";
      setAudioParam(filter.frequency, 1000, time, options.smooth);
      setAudioParam(filter.gain, 0, time, options.smooth);
      setAudioParam(filter.Q, 1, time, options.smooth);
      continue;
    }

    filter.type = band.type;
    setAudioParam(filter.frequency, clampFrequency(band.frequency, nyquist), time, options.smooth);
    setAudioParam(filter.gain, clampDb(band.gainDb), time, options.smooth);
    setAudioParam(filter.Q, clampQ(band.q), time, options.smooth);
  }
}

export function sanitizeEqBand(band: EQBand): EQBand {
  return {
    ...band,
    type: EQ_BAND_TYPES.has(band.type) ? band.type : "peaking",
    frequency: clampFrequency(band.frequency, MAX_EQ_FREQUENCY),
    gainDb: clampDb(band.gainDb),
    q: clampQ(band.q),
    enabled: Boolean(band.enabled),
    solo: Boolean(band.solo),
  };
}

export function sanitizeParametricEQState(state: ParametricEQState): ParametricEQState {
  return {
    ...state,
    enabled: Boolean(state.enabled),
    analyzerEnabled: true,
    analyzerMode: state.analyzerMode === "pre" ? "pre" : "post",
    bands: state.bands.map(sanitizeEqBand),
  };
}

export function frequencyToNormalizedX(frequency: number) {
  const min = Math.log10(MIN_EQ_FREQUENCY);
  const max = Math.log10(MAX_EQ_FREQUENCY);
  return (Math.log10(clamp(frequency, MIN_EQ_FREQUENCY, MAX_EQ_FREQUENCY)) - min) / (max - min);
}

export function normalizedXToFrequency(x: number) {
  const min = Math.log10(MIN_EQ_FREQUENCY);
  const max = Math.log10(MAX_EQ_FREQUENCY);
  return 10 ** (min + clamp(x, 0, 1) * (max - min));
}

export function estimateEqCurveDb(state: ParametricEQState, frequency: number) {
  const safeState = sanitizeParametricEQState(state);
  if (!safeState.enabled) return 0;
  const safeFrequency = clampFrequency(frequency, MAX_EQ_FREQUENCY);
  const soloActive = safeState.bands.some((band) => band.solo);

  return safeState.bands.reduce((sum, band) => {
    if (!band.enabled || (soloActive && !band.solo)) return sum;
    return sum + estimateBandContributionDb(band, safeFrequency);
  }, 0);
}

export function buildEqCurvePoints(state: ParametricEQState, sampleRate = 48000, pointCount = 256): EqCurvePoint[] {
  const safeState = sanitizeParametricEQState(state);
  const frequencies = new Float32Array(new ArrayBuffer(pointCount * Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < pointCount; index += 1) {
    const x = pointCount <= 1 ? 0 : index / (pointCount - 1);
    frequencies[index] = normalizedXToFrequency(x);
  }

  const responseDb = getBiquadResponseDb(safeState, frequencies, sampleRate);
  return Array.from(frequencies, (frequency, index) => ({
    x: pointCount <= 1 ? 0 : index / (pointCount - 1),
    frequency,
    db: responseDb?.[index] ?? estimateEqCurveDb(safeState, frequency),
  }));
}

function getBiquadResponseDb(state: ParametricEQState, frequencies: Float32Array<ArrayBuffer>, sampleRate: number) {
  if (typeof window === "undefined") return null;

  const OfflineAudioContextCtor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  if (!OfflineAudioContextCtor) return null;

  try {
    const safeState = sanitizeParametricEQState(state);
    const context = new OfflineAudioContextCtor(1, 1, sampleRate);
    const soloActive = safeState.bands.some((band) => band.solo);
    const accumulated = new Float32Array(frequencies.length);
    accumulated.fill(1);

    for (const band of safeState.bands) {
      if (!safeState.enabled || !band.enabled || (soloActive && !band.solo)) continue;

      const filter = context.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = clamp(band.frequency, MIN_EQ_FREQUENCY, Math.min(MAX_EQ_FREQUENCY, sampleRate / 2 - 1));
      filter.gain.value = clampDb(band.gainDb);
      filter.Q.value = clampQ(band.q);

      const mag = new Float32Array(new ArrayBuffer(frequencies.length * Float32Array.BYTES_PER_ELEMENT));
      const phase = new Float32Array(new ArrayBuffer(frequencies.length * Float32Array.BYTES_PER_ELEMENT));
      filter.getFrequencyResponse(frequencies, mag, phase);
      for (let index = 0; index < mag.length; index += 1) {
        accumulated[index] *= mag[index] ?? 1;
      }
    }

    return Array.from(accumulated, (value) => {
      const safeValue = Math.max(0.0001, value);
      return 20 * Math.log10(safeValue);
    });
  } catch {
    return null;
  }
}

function estimateBandContributionDb(band: EQBand, frequency: number) {
  const safeBand = sanitizeEqBand(band);
  const safeFrequency = clampFrequency(frequency, MAX_EQ_FREQUENCY);
  const octaves = Math.log2(safeFrequency / safeBand.frequency);
  const q = safeBand.q;

  if (safeBand.type === "peaking") {
    const width = Math.max(0.16, 1.2 / q);
    return safeBand.gainDb * Math.exp(-0.5 * (octaves / width) ** 2);
  }

  if (safeBand.type === "notch") {
    const width = Math.max(0.08, 0.7 / q);
    return -18 * Math.exp(-0.5 * (octaves / width) ** 2);
  }

  if (safeBand.type === "lowshelf") {
    const amount = 1 / (1 + Math.exp(octaves * 4));
    return safeBand.gainDb * amount;
  }

  if (safeBand.type === "highshelf") {
    const amount = 1 / (1 + Math.exp(-octaves * 4));
    return safeBand.gainDb * amount;
  }

  if (safeBand.type === "highpass") {
    return safeFrequency < safeBand.frequency ? Math.max(-18, -12 * Math.log2(safeBand.frequency / safeFrequency)) : 0;
  }

  if (safeBand.type === "lowpass") {
    return safeFrequency > safeBand.frequency ? Math.max(-18, -12 * Math.log2(safeFrequency / safeBand.frequency)) : 0;
  }

  return 0;
}

function setAudioParam(param: AudioParam, value: number, time: number, smooth = false) {
  if (smooth) {
    param.setTargetAtTime(value, time, 0.01);
    return;
  }

  param.setValueAtTime(value, time);
}

function clampFrequency(frequency: number, nyquist: number) {
  return clamp(frequency, MIN_EQ_FREQUENCY, Math.min(MAX_EQ_FREQUENCY, nyquist));
}

function clampDb(db: number) {
  return clamp(db, MIN_EQ_GAIN_DB, MAX_EQ_GAIN_DB);
}

function clampQ(q: number) {
  return clamp(q, MIN_EQ_Q, MAX_EQ_Q);
}

function clamp(value: number, min: number, max: number) {
  const safeValue = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, safeValue));
}
