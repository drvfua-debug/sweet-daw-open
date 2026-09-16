import type { CharacterPluginMode, CharacterPluginState } from "@/daw/model/Project";

export type CharacterNodeChain = {
  input: GainNode;
  dryGain: GainNode;
  preFilter: BiquadFilterNode;
  shaper: WaveShaperNode;
  toneFilter: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  wetGain: GainNode;
  output: GainNode;
  apply: (state: CharacterPluginState, options?: AudioParamApplyOptions) => void;
  dispose: () => void;
};

type AudioParamApplyOptions = {
  smooth?: boolean;
};

type CharacterModeConfig = {
  preType: BiquadFilterType;
  preFrequency: number;
  preQ: number;
  preGain: number;
  toneType: BiquadFilterType;
  toneFrequency: number;
  toneQ: number;
  toneGainBase: number;
  toneGainRange: number;
  driveBase: number;
  driveRange: number;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
};

const MODE_CONFIG: Record<CharacterPluginMode, CharacterModeConfig> = {
  drumPunch: {
    preType: "highpass",
    preFrequency: 65,
    preQ: 0.75,
    preGain: 0,
    toneType: "highshelf",
    toneFrequency: 5200,
    toneQ: 0.7,
    toneGainBase: 1.5,
    toneGainRange: 6,
    driveBase: 1.6,
    driveRange: 9,
    threshold: -24,
    ratio: 4,
    attack: 0.003,
    release: 0.08,
  },
  drumAir: {
    preType: "highpass",
    preFrequency: 90,
    preQ: 0.7,
    preGain: 0,
    toneType: "highshelf",
    toneFrequency: 8500,
    toneQ: 0.65,
    toneGainBase: 2,
    toneGainRange: 8,
    driveBase: 1.2,
    driveRange: 5,
    threshold: -22,
    ratio: 2.8,
    attack: 0.004,
    release: 0.07,
  },
  bassTight: {
    preType: "lowshelf",
    preFrequency: 95,
    preQ: 0.75,
    preGain: 2,
    toneType: "peaking",
    toneFrequency: 850,
    toneQ: 1.1,
    toneGainBase: 0.5,
    toneGainRange: 5,
    driveBase: 1.25,
    driveRange: 6,
    threshold: -21,
    ratio: 3.2,
    attack: 0.006,
    release: 0.11,
  },
  bassDrive: {
    preType: "lowshelf",
    preFrequency: 75,
    preQ: 0.8,
    preGain: 1.5,
    toneType: "peaking",
    toneFrequency: 1200,
    toneQ: 1.2,
    toneGainBase: 1,
    toneGainRange: 7,
    driveBase: 2,
    driveRange: 12,
    threshold: -19,
    ratio: 2.8,
    attack: 0.008,
    release: 0.13,
  },
  vocalShine: {
    preType: "highpass",
    preFrequency: 120,
    preQ: 0.72,
    preGain: 0,
    toneType: "highshelf",
    toneFrequency: 7200,
    toneQ: 0.7,
    toneGainBase: 1.2,
    toneGainRange: 7,
    driveBase: 1.08,
    driveRange: 4.2,
    threshold: -20,
    ratio: 2.2,
    attack: 0.006,
    release: 0.12,
  },
  vocalWarm: {
    preType: "highpass",
    preFrequency: 90,
    preQ: 0.7,
    preGain: 0,
    toneType: "lowshelf",
    toneFrequency: 220,
    toneQ: 0.75,
    toneGainBase: 0.8,
    toneGainRange: 4.5,
    driveBase: 1.25,
    driveRange: 6.5,
    threshold: -21,
    ratio: 2.5,
    attack: 0.008,
    release: 0.18,
  },
  synthTransform: {
    preType: "highpass",
    preFrequency: 135,
    preQ: 0.7,
    preGain: 0,
    toneType: "highshelf",
    toneFrequency: 2400,
    toneQ: 0.85,
    toneGainBase: -1,
    toneGainRange: 9,
    driveBase: 1.1,
    driveRange: 14,
    threshold: -18,
    ratio: 2.4,
    attack: 0.01,
    release: 0.16,
  },
  synthWide: {
    preType: "highpass",
    preFrequency: 180,
    preQ: 0.75,
    preGain: 0,
    toneType: "highshelf",
    toneFrequency: 5200,
    toneQ: 0.8,
    toneGainBase: 0.5,
    toneGainRange: 8,
    driveBase: 1.15,
    driveRange: 8.5,
    threshold: -18,
    ratio: 2.2,
    attack: 0.012,
    release: 0.2,
  },
  loFiColor: {
    preType: "lowpass",
    preFrequency: 7800,
    preQ: 0.85,
    preGain: 0,
    toneType: "peaking",
    toneFrequency: 900,
    toneQ: 0.9,
    toneGainBase: -1.5,
    toneGainRange: 5.5,
    driveBase: 2.2,
    driveRange: 15,
    threshold: -17,
    ratio: 2,
    attack: 0.012,
    release: 0.22,
  },
  warmTape: {
    preType: "highpass",
    preFrequency: 35,
    preQ: 0.7,
    preGain: 0,
    toneType: "lowshelf",
    toneFrequency: 160,
    toneQ: 0.7,
    toneGainBase: 0.5,
    toneGainRange: 4,
    driveBase: 1.6,
    driveRange: 9,
    threshold: -22,
    ratio: 2.2,
    attack: 0.018,
    release: 0.24,
  },
  brightExciter: {
    preType: "highpass",
    preFrequency: 250,
    preQ: 0.7,
    preGain: 0,
    toneType: "highshelf",
    toneFrequency: 9500,
    toneQ: 0.62,
    toneGainBase: 2,
    toneGainRange: 9,
    driveBase: 1.4,
    driveRange: 10,
    threshold: -24,
    ratio: 2.6,
    attack: 0.004,
    release: 0.09,
  },
};

export function createCharacter(context: BaseAudioContext, state: CharacterPluginState): CharacterNodeChain {
  const input = context.createGain();
  const dryGain = context.createGain();
  const preFilter = context.createBiquadFilter();
  const shaper = context.createWaveShaper();
  const toneFilter = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const wetGain = context.createGain();
  const output = context.createGain();

  input.connect(dryGain);
  dryGain.connect(output);

  input.connect(preFilter);
  preFilter.connect(shaper);
  shaper.connect(toneFilter);
  toneFilter.connect(compressor);
  compressor.connect(wetGain);
  wetGain.connect(output);

  const chain: CharacterNodeChain = {
    input,
    dryGain,
    preFilter,
    shaper,
    toneFilter,
    compressor,
    wetGain,
    output,
    apply: (nextState, options) => applyCharacterState(context, chain, nextState, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      preFilter.disconnect();
      shaper.disconnect();
      toneFilter.disconnect();
      compressor.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  chain.apply(state);
  return chain;
}

export function applyCharacterState(
  context: BaseAudioContext,
  chain: CharacterNodeChain,
  state: CharacterPluginState,
  options: AudioParamApplyOptions = {},
) {
  const config = MODE_CONFIG[state.mode];
  const time = context.currentTime;
  const amount = clamp01(state.amount);
  const tone = clamp01(state.tone);
  const mix = clamp01(state.mix);
  const enabledMix = state.enabled ? mix : 0;

  setAudioParam(chain.dryGain.gain, state.enabled ? Math.max(0.2, 1 - enabledMix * 0.55) : 1, time, options.smooth);
  setAudioParam(chain.wetGain.gain, state.enabled ? enabledMix * 0.9 : 0, time, options.smooth);

  chain.preFilter.type = config.preType;
  setAudioParam(chain.preFilter.frequency, config.preFrequency, time, options.smooth);
  setAudioParam(chain.preFilter.Q, config.preQ, time, options.smooth);
  setAudioParam(chain.preFilter.gain, config.preGain, time, options.smooth);

  chain.toneFilter.type = config.toneType;
  setAudioParam(chain.toneFilter.frequency, config.toneFrequency, time, options.smooth);
  setAudioParam(chain.toneFilter.Q, config.toneQ, time, options.smooth);
  setAudioParam(chain.toneFilter.gain, config.toneGainBase + tone * config.toneGainRange, time, options.smooth);

  chain.shaper.curve = makeSaturationCurve(config.driveBase + amount * config.driveRange);
  chain.shaper.oversample = "2x";

  setAudioParam(chain.compressor.threshold, config.threshold + amount * -4, time, options.smooth);
  setAudioParam(chain.compressor.knee, 8, time, options.smooth);
  setAudioParam(chain.compressor.ratio, config.ratio, time, options.smooth);
  setAudioParam(chain.compressor.attack, config.attack, time, options.smooth);
  setAudioParam(chain.compressor.release, config.release, time, options.smooth);
}

export function getCharacterModeLabel(mode: CharacterPluginMode) {
  if (mode === "drumPunch") return "Drum punch";
  if (mode === "drumAir") return "Drum air";
  if (mode === "bassTight") return "Bass tight";
  if (mode === "bassDrive") return "Bass drive";
  if (mode === "vocalShine") return "Vocal shine";
  if (mode === "vocalWarm") return "Vocal warm";
  if (mode === "synthTransform") return "Synth morph";
  if (mode === "synthWide") return "Synth wide";
  if (mode === "loFiColor") return "Lo-fi color";
  if (mode === "warmTape") return "Warm tape";
  return "Bright exciter";
}

export function getCharacterModeDefaults(mode: CharacterPluginMode): Pick<CharacterPluginState, "amount" | "tone" | "mix"> {
  if (mode === "drumPunch") return { amount: 0.55, tone: 0.65, mix: 0.35 };
  if (mode === "drumAir") return { amount: 0.46, tone: 0.8, mix: 0.3 };
  if (mode === "bassTight") return { amount: 0.5, tone: 0.45, mix: 0.32 };
  if (mode === "bassDrive") return { amount: 0.52, tone: 0.58, mix: 0.34 };
  if (mode === "vocalShine") return { amount: 0.38, tone: 0.62, mix: 0.28 };
  if (mode === "vocalWarm") return { amount: 0.42, tone: 0.44, mix: 0.3 };
  if (mode === "synthTransform") return { amount: 0.45, tone: 0.55, mix: 0.3 };
  if (mode === "synthWide") return { amount: 0.36, tone: 0.7, mix: 0.28 };
  if (mode === "loFiColor") return { amount: 0.42, tone: 0.5, mix: 0.28 };
  if (mode === "warmTape") return { amount: 0.34, tone: 0.4, mix: 0.32 };
  return { amount: 0.48, tone: 0.82, mix: 0.26 };
}

function makeSaturationCurve(drive: number) {
  const samples = 512;
  const curve = new Float32Array(samples);
  const shapedDrive = Math.max(1, drive);

  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / (samples - 1) - 1;
    curve[index] = Math.tanh(x * shapedDrive) / Math.tanh(shapedDrive);
  }

  return curve;
}

function setAudioParam(param: AudioParam, value: number, time: number, smooth = false) {
  if (smooth) {
    param.setTargetAtTime(value, time, 0.01);
    return;
  }

  param.setValueAtTime(value, time);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
