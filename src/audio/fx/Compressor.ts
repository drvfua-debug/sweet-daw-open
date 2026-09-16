import { dbToGain } from "@/audio/engine/TrackGraph";
import type { CompressorState } from "@/daw/model/Project";

export type CompressorNodeChain = {
  input: GainNode;
  compressor: DynamicsCompressorNode;
  makeupGain: GainNode;
  output: GainNode;
  apply: (state: CompressorState, options?: AudioParamApplyOptions) => void;
  dispose: () => void;
};

type AudioParamApplyOptions = {
  smooth?: boolean;
};

export function createCompressor(context: BaseAudioContext, state: CompressorState): CompressorNodeChain {
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  const makeupGain = context.createGain();
  const output = context.createGain();

  input.connect(compressor);
  compressor.connect(makeupGain);
  makeupGain.connect(output);

  const chain: CompressorNodeChain = {
    input,
    compressor,
    makeupGain,
    output,
    apply: (nextState, options) => applyCompressorState(context, compressor, makeupGain, nextState, options),
    dispose: () => {
      input.disconnect();
      compressor.disconnect();
      makeupGain.disconnect();
      output.disconnect();
    },
  };

  chain.apply(state);
  return chain;
}

export function applyCompressorState(
  context: BaseAudioContext,
  compressor: DynamicsCompressorNode,
  makeupGain: GainNode,
  state: CompressorState,
  options: AudioParamApplyOptions = {},
) {
  const time = context.currentTime;
  const enabled = state.enabled;

  setAudioParam(compressor.threshold, enabled ? clamp(state.threshold, -60, 0) : 0, time, options.smooth);
  setAudioParam(compressor.knee, enabled ? clamp(state.knee, 0, 40) : 0, time, options.smooth);
  setAudioParam(compressor.ratio, enabled ? clamp(state.ratio, 1, 20) : 1, time, options.smooth);
  setAudioParam(compressor.attack, enabled ? clamp(state.attack, 0.001, 1) : 0.003, time, options.smooth);
  setAudioParam(compressor.release, enabled ? clamp(state.release, 0.01, 1) : 0.25, time, options.smooth);
  setAudioParam(makeupGain.gain, enabled ? dbToGain(state.makeupGainDb) : 1, time, options.smooth);
}

export function applyLimiterState(
  context: BaseAudioContext,
  limiter: DynamicsCompressorNode,
  enabled: boolean,
  options: AudioParamApplyOptions = {},
) {
  const time = context.currentTime;
  setAudioParam(limiter.threshold, enabled ? -1 : 0, time, options.smooth);
  setAudioParam(limiter.knee, 0, time, options.smooth);
  setAudioParam(limiter.ratio, enabled ? 20 : 1, time, options.smooth);
  setAudioParam(limiter.attack, enabled ? 0.003 : 0.003, time, options.smooth);
  setAudioParam(limiter.release, enabled ? 0.06 : 0.25, time, options.smooth);
}

function setAudioParam(param: AudioParam, value: number, time: number, smooth = false) {
  if (smooth) {
    param.setTargetAtTime(value, time, 0.01);
    return;
  }

  param.setValueAtTime(value, time);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
