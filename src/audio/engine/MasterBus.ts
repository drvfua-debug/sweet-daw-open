import { applyCompressorState, applyLimiterState, createCompressor, type CompressorNodeChain } from "@/audio/fx/Compressor";
import { createParametricEQ, type ParametricEQNodeChain } from "@/audio/fx/ParametricEQ";
import { dbToGain } from "@/audio/engine/TrackGraph";
import { buildPluginChain, type PluginChainNodes } from "@/audio/plugins/PluginChain";
import type { MasterState } from "@/daw/model/Project";

export type MasterBusNodes = {
  input: GainNode;
  mixBusTrim: GainNode;
  eq: ParametricEQNodeChain;
  compressor: CompressorNodeChain;
  gain: GainNode;
  limiter: DynamicsCompressorNode;
  insertChain: PluginChainNodes;
  output: GainNode;
  signature: string;
  apply: (master: MasterState, options?: AudioParamApplyOptions) => void;
  dispose: () => void;
};

type AudioParamApplyOptions = {
  smooth?: boolean;
};

export function createMasterBus(context: BaseAudioContext, master: MasterState): MasterBusNodes {
  const input = context.createGain();
  const mixBusTrim = context.createGain();
  const eq = createParametricEQ(context, master.eq);
  const compressor = createCompressor(context, master.compressor);
  const limiter = context.createDynamicsCompressor();
  const insertChain = buildPluginChain(context, master.insertChain);
  const gain = context.createGain();
  const output = context.createGain();

  input.connect(mixBusTrim);
  mixBusTrim.connect(eq.input);
  eq.output.connect(compressor.input);
  compressor.output.connect(insertChain.input);
  insertChain.output.connect(gain);
  gain.connect(limiter);
  limiter.connect(output);

  const nodes: MasterBusNodes = {
    input,
    mixBusTrim,
    eq,
    compressor,
    gain,
    limiter,
    insertChain,
    output,
    signature: insertChain.signature,
    apply: (nextMaster, options) => applyMasterBusState(context, nodes, nextMaster, options),
    dispose: () => {
      input.disconnect();
      mixBusTrim.disconnect();
      eq.dispose();
      compressor.dispose();
      gain.disconnect();
      limiter.disconnect();
      insertChain.dispose();
      output.disconnect();
    },
  };

  nodes.apply(master);
  return nodes;
}

export function applyMasterBusState(
  context: BaseAudioContext,
  nodes: MasterBusNodes,
  master: MasterState,
  options: AudioParamApplyOptions = {},
) {
  const time = context.currentTime;
  const peakMaxActive = hasEnabledPeakMaximizer(master);
  nodes.eq.apply(master.eq, options);
  applyCompressorState(context, nodes.compressor.compressor, nodes.compressor.makeupGain, master.compressor, options);
  applyLimiterState(context, nodes.limiter, master.limiterEnabled && !peakMaxActive, options);
  nodes.insertChain.update(master.insertChain, options);
  const mixBusTrimGain = dbToGain(master.mixBusTrimDb ?? 0);
  if (options.smooth) {
    nodes.mixBusTrim.gain.setTargetAtTime(mixBusTrimGain, time, 0.01);
  } else {
    nodes.mixBusTrim.gain.setValueAtTime(mixBusTrimGain, time);
  }

  if (options.smooth) {
    nodes.gain.gain.setTargetAtTime(dbToGain(master.gainDb), time, 0.01);
  } else {
    nodes.gain.gain.setValueAtTime(dbToGain(master.gainDb), time);
  }

  const finalOutputTrimGain = dbToGain(master.finalOutputTrimDb ?? 0);
  if (options.smooth) {
    nodes.output.gain.setTargetAtTime(finalOutputTrimGain, time, 0.01);
  } else {
    nodes.output.gain.setValueAtTime(finalOutputTrimGain, time);
  }
}

function hasEnabledPeakMaximizer(master: MasterState) {
  return master.insertChain.some((plugin) => plugin.enabled && plugin.pluginId === "sweet-peak-maximizer");
}
