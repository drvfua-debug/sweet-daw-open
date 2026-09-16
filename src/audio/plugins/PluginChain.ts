import type { PluginInstance } from "../../daw/model/Plugin";
import { resolvePeakMaximizerParams } from "../dsp/PeakMaximizer";
import { buildLowEndTranslatorCurve, sanitizeLowEndTranslatorParams } from "../dsp/lowEndTranslator";
import { buildSoftClipperCurve, resolveSoftClipperParams, type SoftClipperMode } from "../dsp/softClipper";
import { getCachedWaveShaperCurve } from "./pluginCurveCache";
import { finiteSample, roundForCache, safeSetAudioParam } from "./pluginDspUtils";
import { getCachedImpulse } from "./pluginImpulseCache";
import { applyPluginQualityGuards } from "./pluginQualityGuards";

export type PluginNode = {
  input: AudioNode;
  output: AudioNode;
  update: (instance: PluginInstance, options?: AudioParamApplyOptions) => void;
  dispose: () => void;
};

export type PluginChainNodes = {
  input: GainNode;
  output: GainNode;
  nodes: Array<{
    instanceId: string;
    node: PluginNode;
  }>;
  signature: string;
  update: (chain: PluginInstance[], options?: AudioParamApplyOptions) => void;
  dispose: () => void;
};

type AudioParamApplyOptions = {
  smooth?: boolean;
  bpm?: number;
};

const FILTER_TYPES: BiquadFilterType[] = ["lowpass", "highpass", "bandpass", "notch", "lowshelf", "highshelf"];

export function getPluginChainSignature(chain: PluginInstance[]) {
  return chain.map((plugin) => `${plugin.id}:${plugin.pluginId}`).join("|");
}

export function buildPluginChain(context: BaseAudioContext, chain: PluginInstance[], options: AudioParamApplyOptions = {}): PluginChainNodes {
  const input = context.createGain();
  const output = context.createGain();
  const nodes = chain.map((instance) => ({
    instanceId: instance.id,
    node: createPluginNode(context, applyPluginQualityGuards(instance).instance),
  }));

  let previous: AudioNode = input;
  for (const entry of nodes) {
    previous.connect(entry.node.input);
    previous = entry.node.output;
  }
  previous.connect(output);

  const chainNodes: PluginChainNodes = {
    input,
    output,
    nodes,
    signature: getPluginChainSignature(chain),
    update: (nextChain, options) => {
      for (const instance of nextChain) {
        const entry = nodes.find((candidate) => candidate.instanceId === instance.id);
        entry?.node.update(applyPluginQualityGuards(instance).instance, options);
      }
    },
    dispose: () => {
      input.disconnect();
      for (const entry of nodes) entry.node.dispose();
      output.disconnect();
    },
  };

  chainNodes.update(chain, options);
  return chainNodes;
}

function createPluginNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  if (instance.pluginId === "sweet-filter") return createSweetFilterNode(context, instance);
  if (instance.pluginId === "sweet-tilt-eq") return createSweetTiltEqNode(context, instance);
  if (instance.pluginId === "sweet-drive") return createSweetDriveNode(context, instance);
  if (instance.pluginId === "sweet-saturator") return createSweetSaturatorNode(context, instance);
  if (instance.pluginId === "sweet-clipper") return createSweetClipperNode(context, instance);
  if (instance.pluginId === "sweet-peak-maximizer") return createSweetPeakMaximizerNode(context, instance);
  if (instance.pluginId === "sweet-low-end-translator") return createSweetLowEndTranslatorNode(context, instance);
  if (instance.pluginId === "sweet-air-exciter") return createSweetAirExciterNode(context, instance);
  if (instance.pluginId === "sweet-aimix-glow") return createSweetAimixGlowNode(context, instance);
  if (instance.pluginId === "sweet-utility") return createSweetUtilityNode(context, instance);
  if (instance.pluginId === "sweet-delay-lite") return createSweetDelayNode(context, instance);
  if (instance.pluginId === "sweet-reverb-lite") return createSweetReverbNode(context, instance);
  if (instance.pluginId === "sweet-guitar-fx") return createSweetGuitarFxNode(context, instance);
  if (instance.pluginId === "sweet-guitar-drive") return createSweetDriveNode(context, instance);
  if (instance.pluginId === "sweet-guitar-amp") return createSweetGuitarFxNode(context, instance);
  if (instance.pluginId === "sweet-guitar-cab") return createSweetIrSpaceNode(context, instance);
  if (instance.pluginId === "sweet-guitar-rig") return createSweetGuitarizerNode(context, instance);
  if (instance.pluginId === "sweet-vocal-fx") return createSweetVocalFxNode(context, instance);
  if (instance.pluginId === "sweet-bass-enhancer") return createSweetBassEnhancerNode(context, instance);
  if (instance.pluginId === "sweet-de-esser") return createSweetDeEsserNode(context, instance);
  if (instance.pluginId === "sweet-vocal-duck-eq") return createSweetVocalDuckEqNode(context, instance);
  if (instance.pluginId === "sweet-parallel-comp") return createSweetParallelCompNode(context, instance);
  if (instance.pluginId === "sweet-gate-lite") return createSweetGateNode(context, instance);
  if (instance.pluginId === "sweet-chorus") return createSweetChorusNode(context, instance);
  if (instance.pluginId === "sweet-phaser") return createSweetPhaserNode(context, instance);
  if (instance.pluginId === "sweet-stereo-widener") return createSweetStereoWidenerNode(context, instance);
  if (instance.pluginId === "sweet-support-widener") return createSweetSupportWidenerNode(context, instance);
  if (instance.pluginId === "sweet-transient-shaper") return createSweetTransientShaperNode(context, instance);
  if (instance.pluginId === "sweet-rhythm-chopper") return createSweetRhythmChopperNode(context, instance);
  if (instance.pluginId === "sweet-guitarizer") return createSweetGuitarizerNode(context, instance);
  if (instance.pluginId === "sweet-vocal-formant-color") return createSweetVocalFormantNode(context, instance);
  if (instance.pluginId === "sweet-ir-space") return createSweetIrSpaceNode(context, instance);
  if (instance.pluginId === "sweet-vocoder-lite") return createSweetVocoderNode(context, instance);
  if (instance.pluginId === "sweet-pitch-assist") return createSweetPitchAssistNode(context, instance);
  if (instance.pluginId === "sweet-granular-texture") return createSweetGranularNode(context, instance);
  if (instance.pluginId === "sweet-multiband-comp") return createSweetMultibandNode(context, instance);
  if (instance.pluginId === "sweet-wavetable-carrier") return createSweetWavetableCarrierNode(context, instance);
  return createBypassNode(context);
}

function createBypassNode(context: BaseAudioContext): PluginNode {
  const input = context.createGain();
  const output = context.createGain();
  input.connect(output);
  return {
    input,
    output,
    update: () => undefined,
    dispose: () => {
      input.disconnect();
      output.disconnect();
    },
  };
}

function createSweetFilterNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const filter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(filter);
  filter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetFilterState(context, { dryGain, filter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      filter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetTiltEqNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const lowShelf = context.createBiquadFilter();
  const highShelf = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  lowShelf.type = "lowshelf";
  highShelf.type = "highshelf";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(lowShelf);
  lowShelf.connect(highShelf);
  highShelf.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetTiltEqState(context, { dryGain, lowShelf, highShelf, wetGain, output }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      lowShelf.disconnect();
      highShelf.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetDriveNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const shaper = context.createWaveShaper();
  const toneFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(shaper);
  shaper.connect(toneFilter);
  toneFilter.connect(wetGain);
  wetGain.connect(output);

  toneFilter.type = "highshelf";
  toneFilter.frequency.value = 2600;
  shaper.oversample = "2x";

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetDriveState(context, { dryGain, shaper, toneFilter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      shaper.disconnect();
      toneFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetSaturatorNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const highpass = context.createBiquadFilter();
  const preGain = context.createGain();
  const shaper = context.createWaveShaper();
  const toneFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  highpass.type = "highpass";
  toneFilter.type = "highshelf";
  toneFilter.frequency.value = 3200;
  shaper.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(highpass);
  highpass.connect(preGain);
  preGain.connect(shaper);
  shaper.connect(toneFilter);
  toneFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetSaturatorState(context, { dryGain, highpass, preGain, shaper, toneFilter, wetGain, output }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      highpass.disconnect();
      preGain.disconnect();
      shaper.disconnect();
      toneFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetClipperNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const preGain = context.createGain();
  const shaper = context.createWaveShaper();
  const wetGain = context.createGain();
  const output = context.createGain();

  shaper.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(preGain);
  preGain.connect(shaper);
  shaper.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetClipperState(context, { dryGain, preGain, shaper, wetGain, output }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      preGain.disconnect();
      shaper.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetPeakMaximizerNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const bypassGain = context.createGain();
  const preGain = context.createGain();
  const limiter = context.createDynamicsCompressor();
  const shaper = context.createWaveShaper();
  const postGain = context.createGain();
  const wetGain = context.createGain();
  const output = context.createGain();

  input.connect(bypassGain);
  bypassGain.connect(output);
  input.connect(preGain);
  preGain.connect(limiter);
  limiter.connect(shaper);
  shaper.connect(postGain);
  postGain.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetPeakMaximizerPreviewState(context, { bypassGain, preGain, limiter, shaper, postGain, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      bypassGain.disconnect();
      preGain.disconnect();
      limiter.disconnect();
      shaper.disconnect();
      postGain.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetLowEndTranslatorNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const lowCut = context.createBiquadFilter();
  const preGain = context.createGain();
  const shaper = context.createWaveShaper();
  const translateEq = context.createBiquadFilter();
  const upperEq = context.createBiquadFilter();
  const subGuard = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  lowCut.type = "highpass";
  translateEq.type = "peaking";
  upperEq.type = "peaking";
  subGuard.type = "lowshelf";
  shaper.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(lowCut);
  lowCut.connect(preGain);
  preGain.connect(shaper);
  shaper.connect(translateEq);
  translateEq.connect(upperEq);
  upperEq.connect(subGuard);
  subGuard.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetLowEndTranslatorState(context, { dryGain, lowCut, preGain, shaper, translateEq, upperEq, subGuard, wetGain, output }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      lowCut.disconnect();
      preGain.disconnect();
      shaper.disconnect();
      translateEq.disconnect();
      upperEq.disconnect();
      subGuard.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetAirExciterNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const airHighpass = context.createBiquadFilter();
  const preGain = context.createGain();
  const shaper = context.createWaveShaper();
  const airPostHighpass = context.createBiquadFilter();
  const harshGuard = context.createBiquadFilter();
  const airFocus = context.createBiquadFilter();
  const airLowpass = context.createBiquadFilter();
  const wetGain = context.createGain();
  const envelopeHighpass = context.createBiquadFilter();
  const envelopeRectifier = context.createWaveShaper();
  const envelopeSmooth = context.createBiquadFilter();
  const envelopeScale = context.createGain();
  const airBedSource = context.createBufferSource();
  const airBedHighpass = context.createBiquadFilter();
  const airBedFocus = context.createBiquadFilter();
  const airBedLowpass = context.createBiquadFilter();
  const airBedGain = context.createGain();
  const output = context.createGain();

  airHighpass.type = "highpass";
  airPostHighpass.type = "highpass";
  harshGuard.type = "peaking";
  airFocus.type = "peaking";
  airLowpass.type = "lowpass";
  envelopeHighpass.type = "highpass";
  envelopeRectifier.curve = makeEnvelopeFollowerCurve();
  envelopeSmooth.type = "lowpass";
  airBedHighpass.type = "highpass";
  airBedFocus.type = "peaking";
  airBedLowpass.type = "lowpass";
  airBedSource.buffer = makeAirBedNoiseBuffer(context);
  airBedSource.loop = true;
  shaper.oversample = "2x";
  try {
    airBedSource.start(context.currentTime);
  } catch {
    // Already started or context refused scheduling; the dry/wet exciter path still works.
  }

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(airHighpass);
  airHighpass.connect(preGain);
  preGain.connect(shaper);
  shaper.connect(airPostHighpass);
  airPostHighpass.connect(harshGuard);
  harshGuard.connect(airFocus);
  airFocus.connect(airLowpass);
  airLowpass.connect(wetGain);
  wetGain.connect(output);

  input.connect(envelopeHighpass);
  envelopeHighpass.connect(envelopeRectifier);
  envelopeRectifier.connect(envelopeSmooth);
  envelopeSmooth.connect(envelopeScale);
  envelopeScale.connect(airBedGain.gain);
  airBedSource.connect(airBedHighpass);
  airBedHighpass.connect(airBedFocus);
  airBedFocus.connect(airBedLowpass);
  airBedLowpass.connect(airBedGain);
  airBedGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetAirExciterState(
        context,
        {
          dryGain,
          airHighpass,
          preGain,
          shaper,
          airPostHighpass,
          harshGuard,
          airFocus,
          airLowpass,
          wetGain,
          envelopeHighpass,
          envelopeSmooth,
          envelopeScale,
          airBedHighpass,
          airBedFocus,
          airBedLowpass,
          airBedGain,
        },
        nextInstance,
        options,
      ),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      airHighpass.disconnect();
      preGain.disconnect();
      shaper.disconnect();
      airPostHighpass.disconnect();
      harshGuard.disconnect();
      airFocus.disconnect();
      airLowpass.disconnect();
      wetGain.disconnect();
      envelopeHighpass.disconnect();
      envelopeRectifier.disconnect();
      envelopeSmooth.disconnect();
      envelopeScale.disconnect();
      try {
        airBedSource.stop();
      } catch {
        // Already stopped.
      }
      airBedSource.disconnect();
      airBedHighpass.disconnect();
      airBedFocus.disconnect();
      airBedLowpass.disconnect();
      airBedGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}
function createSweetAimixGlowNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const bypassGain = context.createGain();
  const guardOne = context.createBiquadFilter();
  const guardTwo = context.createBiquadFilter();
  const dryGain = context.createGain();
  const presenceHighpass = context.createBiquadFilter();
  const presencePreGain = context.createGain();
  const glossShaper = context.createWaveShaper();
  const presenceBody = context.createBiquadFilter();
  const presenceFocus = context.createBiquadFilter();
  const glossFilter = context.createBiquadFilter();
  const presenceWetGain = context.createGain();
  const airHighpass = context.createBiquadFilter();
  const airPreGain = context.createGain();
  const airShaper = context.createWaveShaper();
  const airGuard = context.createBiquadFilter();
  const airFocus = context.createBiquadFilter();
  const airShelf = context.createBiquadFilter();
  const airLowpass = context.createBiquadFilter();
  const airWetGain = context.createGain();
  const processedOutput = context.createGain();
  const output = context.createGain();

  guardOne.type = "peaking";
  guardTwo.type = "peaking";
  presenceHighpass.type = "highpass";
  presenceBody.type = "peaking";
  presenceFocus.type = "peaking";
  glossFilter.type = "highshelf";
  airHighpass.type = "highpass";
  airGuard.type = "peaking";
  airFocus.type = "peaking";
  airShelf.type = "highshelf";
  airLowpass.type = "lowpass";
  glossShaper.oversample = "2x";
  airShaper.oversample = "2x";

  input.connect(bypassGain);
  bypassGain.connect(output);
  input.connect(guardOne);
  guardOne.connect(guardTwo);
  guardTwo.connect(dryGain);
  dryGain.connect(processedOutput);

  guardTwo.connect(presenceHighpass);
  presenceHighpass.connect(presencePreGain);
  presencePreGain.connect(glossShaper);
  glossShaper.connect(presenceBody);
  presenceBody.connect(presenceFocus);
  presenceFocus.connect(glossFilter);
  glossFilter.connect(presenceWetGain);
  presenceWetGain.connect(processedOutput);

  guardTwo.connect(airHighpass);
  airHighpass.connect(airPreGain);
  airPreGain.connect(airShaper);
  airShaper.connect(airGuard);
  airGuard.connect(airFocus);
  airFocus.connect(airShelf);
  airShelf.connect(airLowpass);
  airLowpass.connect(airWetGain);
  airWetGain.connect(processedOutput);
  processedOutput.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetAimixGlowState(
        context,
        {
          bypassGain,
          guardOne,
          guardTwo,
          dryGain,
          presenceHighpass,
          presencePreGain,
          glossShaper,
          presenceBody,
          presenceFocus,
          glossFilter,
          presenceWetGain,
          airHighpass,
          airPreGain,
          airShaper,
          airGuard,
          airFocus,
          airShelf,
          airLowpass,
          airWetGain,
          processedOutput,
        },
        nextInstance,
        options,
      ),
    dispose: () => {
      input.disconnect();
      bypassGain.disconnect();
      guardOne.disconnect();
      guardTwo.disconnect();
      dryGain.disconnect();
      presenceHighpass.disconnect();
      presencePreGain.disconnect();
      glossShaper.disconnect();
      presenceBody.disconnect();
      presenceFocus.disconnect();
      glossFilter.disconnect();
      presenceWetGain.disconnect();
      airHighpass.disconnect();
      airPreGain.disconnect();
      airShaper.disconnect();
      airGuard.disconnect();
      airFocus.disconnect();
      airShelf.disconnect();
      airLowpass.disconnect();
      airWetGain.disconnect();
      processedOutput.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}
function createSweetUtilityNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const splitter = context.createChannelSplitter(2);
  const merger = context.createChannelMerger(2);
  const leftGain = context.createGain();
  const rightGain = context.createGain();
  const monoSum = context.createGain();
  const monoLeft = context.createGain();
  const monoRight = context.createGain();
  const output = context.createGain();

  input.connect(splitter);
  splitter.connect(leftGain, 0);
  splitter.connect(rightGain, 1);
  leftGain.connect(merger, 0, 0);
  rightGain.connect(merger, 0, 1);

  splitter.connect(monoSum, 0);
  splitter.connect(monoSum, 1);
  monoSum.connect(monoLeft);
  monoSum.connect(monoRight);
  monoLeft.connect(merger, 0, 0);
  monoRight.connect(merger, 0, 1);
  merger.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetUtilityState(context, { leftGain, rightGain, monoSum, monoLeft, monoRight, output }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      splitter.disconnect();
      merger.disconnect();
      leftGain.disconnect();
      rightGain.disconnect();
      monoSum.disconnect();
      monoLeft.disconnect();
      monoRight.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}
function createSweetDelayNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const delay = context.createDelay(2);
  const feedbackGain = context.createGain();
  const wetGain = context.createGain();
  const output = context.createGain();

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(delay);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetDelayState(context, { dryGain, delay, feedbackGain, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      delay.disconnect();
      feedbackGain.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetReverbNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const preDelay = context.createDelay(0.12);
  const lowCutFilter = context.createBiquadFilter();
  const convolver = context.createConvolver();
  const dampFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  lowCutFilter.type = "highpass";
  dampFilter.type = "lowpass";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(preDelay);
  preDelay.connect(lowCutFilter);
  lowCutFilter.connect(convolver);
  convolver.connect(dampFilter);
  dampFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetReverbState(context, { dryGain, preDelay, lowCutFilter, convolver, dampFilter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      preDelay.disconnect();
      lowCutFilter.disconnect();
      convolver.disconnect();
      dampFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetGuitarFxNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const preGain = context.createGain();
  const highpass = context.createBiquadFilter();
  const shaper = context.createWaveShaper();
  const bodyFilter = context.createBiquadFilter();
  const cabFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  highpass.type = "highpass";
  highpass.frequency.value = 80;
  bodyFilter.type = "peaking";
  cabFilter.type = "lowpass";
  shaper.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(highpass);
  highpass.connect(preGain);
  preGain.connect(shaper);
  shaper.connect(bodyFilter);
  bodyFilter.connect(cabFilter);
  cabFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetGuitarFxState(context, { dryGain, preGain, shaper, bodyFilter, cabFilter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      preGain.disconnect();
      highpass.disconnect();
      shaper.disconnect();
      bodyFilter.disconnect();
      cabFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetVocalFxNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const highpass = context.createBiquadFilter();
  const preGain = context.createGain();
  const shaper = context.createWaveShaper();
  const bodyFilter = context.createBiquadFilter();
  const presenceFilter = context.createBiquadFilter();
  const airFilter = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const wetGain = context.createGain();
  const output = context.createGain();

  highpass.type = "highpass";
  bodyFilter.type = "lowshelf";
  presenceFilter.type = "peaking";
  airFilter.type = "highshelf";
  shaper.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(highpass);
  highpass.connect(preGain);
  preGain.connect(shaper);
  shaper.connect(bodyFilter);
  bodyFilter.connect(presenceFilter);
  presenceFilter.connect(airFilter);
  airFilter.connect(compressor);
  compressor.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetVocalFxState(
        context,
        { dryGain, highpass, preGain, shaper, bodyFilter, presenceFilter, airFilter, compressor, wetGain },
        nextInstance,
        options,
      ),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      highpass.disconnect();
      preGain.disconnect();
      shaper.disconnect();
      bodyFilter.disconnect();
      presenceFilter.disconnect();
      airFilter.disconnect();
      compressor.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetBassEnhancerNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const lowpass = context.createBiquadFilter();
  const lowComp = context.createDynamicsCompressor();
  const subGain = context.createGain();
  const harmonicBand = context.createBiquadFilter();
  const shaper = context.createWaveShaper();
  const toneFilter = context.createBiquadFilter();
  const harmonicGain = context.createGain();
  const output = context.createGain();

  lowpass.type = "lowpass";
  harmonicBand.type = "bandpass";
  toneFilter.type = "peaking";
  shaper.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(lowpass);
  lowpass.connect(lowComp);
  lowComp.connect(subGain);
  subGain.connect(output);
  input.connect(harmonicBand);
  harmonicBand.connect(shaper);
  shaper.connect(toneFilter);
  toneFilter.connect(harmonicGain);
  harmonicGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetBassEnhancerState(
        context,
        { dryGain, lowpass, lowComp, subGain, harmonicBand, shaper, toneFilter, harmonicGain },
        nextInstance,
        options,
      ),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      lowpass.disconnect();
      lowComp.disconnect();
      subGain.disconnect();
      harmonicBand.disconnect();
      shaper.disconnect();
      toneFilter.disconnect();
      harmonicGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetDeEsserNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const sibilanceFilter = context.createBiquadFilter();
  const compressor = context.createDynamicsCompressor();
  const bandCancelGain = context.createGain();
  const compressedBandGain = context.createGain();
  const output = context.createGain();

  sibilanceFilter.type = "bandpass";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(sibilanceFilter);
  sibilanceFilter.connect(bandCancelGain);
  bandCancelGain.connect(output);
  sibilanceFilter.connect(compressor);
  compressor.connect(compressedBandGain);
  compressedBandGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetDeEsserState(context, { dryGain, sibilanceFilter, compressor, bandCancelGain, compressedBandGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      sibilanceFilter.disconnect();
      compressor.disconnect();
      bandCancelGain.disconnect();
      compressedBandGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetVocalDuckEqNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const duckFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  duckFilter.type = "peaking";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(duckFilter);
  duckFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetVocalDuckEqState(context, { dryGain, duckFilter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      duckFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetGateNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const shaper = context.createWaveShaper();
  const wetGain = context.createGain();
  const output = context.createGain();

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(shaper);
  shaper.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) => applySweetGateState(context, { dryGain, shaper, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      shaper.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetChorusNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const delay = context.createDelay(0.08);
  const feedbackGain = context.createGain();
  const toneFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const lfo = context.createOscillator();
  const depthGain = context.createGain();
  const output = context.createGain();

  toneFilter.type = "highpass";
  lfo.type = "sine";
  lfo.start(0);

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(delay);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(toneFilter);
  toneFilter.connect(wetGain);
  wetGain.connect(output);
  lfo.connect(depthGain);
  depthGain.connect(delay.delayTime);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetChorusState(context, { dryGain, delay, feedbackGain, toneFilter, wetGain, lfo, depthGain }, nextInstance, options),
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // Already stopped.
      }
      input.disconnect();
      dryGain.disconnect();
      delay.disconnect();
      feedbackGain.disconnect();
      toneFilter.disconnect();
      wetGain.disconnect();
      lfo.disconnect();
      depthGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetPhaserNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const filters = [context.createBiquadFilter(), context.createBiquadFilter(), context.createBiquadFilter(), context.createBiquadFilter()];
  const feedbackGain = context.createGain();
  const wetGain = context.createGain();
  const lfo = context.createOscillator();
  const depthGains = filters.map(() => context.createGain());
  const output = context.createGain();

  for (const filter of filters) filter.type = "allpass";
  lfo.type = "sine";
  lfo.start(0);

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(filters[0]);
  filters[0].connect(filters[1]);
  filters[1].connect(filters[2]);
  filters[2].connect(filters[3]);
  filters[3].connect(wetGain);
  filters[3].connect(feedbackGain);
  feedbackGain.connect(filters[0]);
  wetGain.connect(output);
  filters.forEach((filter, index) => {
    lfo.connect(depthGains[index]);
    depthGains[index].connect(filter.frequency);
  });

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetPhaserState(context, { dryGain, filters, feedbackGain, wetGain, lfo, depthGains }, nextInstance, options),
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // Already stopped.
      }
      input.disconnect();
      dryGain.disconnect();
      filters.forEach((filter) => filter.disconnect());
      feedbackGain.disconnect();
      wetGain.disconnect();
      lfo.disconnect();
      depthGains.forEach((depthGain) => depthGain.disconnect());
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetStereoWidenerNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const delayL = context.createDelay(0.05);
  const delayR = context.createDelay(0.05);
  const panL = context.createStereoPanner();
  const panR = context.createStereoPanner();
  const toneFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  toneFilter.type = "lowpass";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(delayL);
  input.connect(delayR);
  delayL.connect(panL);
  delayR.connect(panR);
  panL.connect(toneFilter);
  panR.connect(toneFilter);
  toneFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetStereoWidenerState(context, { dryGain, delayL, delayR, panL, panR, toneFilter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      delayL.disconnect();
      delayR.disconnect();
      panL.disconnect();
      panR.disconnect();
      toneFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetSupportWidenerNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const delayL = context.createDelay(0.04);
  const delayR = context.createDelay(0.04);
  const panL = context.createStereoPanner();
  const panR = context.createStereoPanner();
  const wetGain = context.createGain();
  const output = context.createGain();

  highpass.type = "highpass";
  lowpass.type = "lowpass";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(delayL);
  lowpass.connect(delayR);
  delayL.connect(panL);
  delayR.connect(panR);
  panL.connect(wetGain);
  panR.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetSupportWidenerState(context, { dryGain, highpass, lowpass, delayL, delayR, panL, panR, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      highpass.disconnect();
      lowpass.disconnect();
      delayL.disconnect();
      delayR.disconnect();
      panL.disconnect();
      panR.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetTransientShaperNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const attackFilter = context.createBiquadFilter();
  const attackShape = context.createWaveShaper();
  const attackGain = context.createGain();
  const sustainFilter = context.createBiquadFilter();
  const sustainComp = context.createDynamicsCompressor();
  const sustainGain = context.createGain();
  const wetGain = context.createGain();
  const output = context.createGain();

  attackFilter.type = "highpass";
  sustainFilter.type = "lowpass";
  attackShape.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(attackFilter);
  attackFilter.connect(attackShape);
  attackShape.connect(attackGain);
  attackGain.connect(wetGain);
  input.connect(sustainFilter);
  sustainFilter.connect(sustainComp);
  sustainComp.connect(sustainGain);
  sustainGain.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetTransientShaperState(
        context,
        { dryGain, attackFilter, attackShape, attackGain, sustainFilter, sustainComp, sustainGain, wetGain },
        nextInstance,
        options,
      ),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      attackFilter.disconnect();
      attackShape.disconnect();
      attackGain.disconnect();
      sustainFilter.disconnect();
      sustainComp.disconnect();
      sustainGain.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetRhythmChopperNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const chopGain = context.createGain();
  const wetGain = context.createGain();
  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  const output = context.createGain();

  lfo.type = "square";
  lfo.start(0);
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(chopGain);
  chopGain.connect(wetGain);
  wetGain.connect(output);
  lfo.connect(lfoDepth);
  lfoDepth.connect(chopGain.gain);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetRhythmChopperState(context, { dryGain, chopGain, wetGain, lfo, lfoDepth }, nextInstance, options),
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // Already stopped.
      }
      input.disconnect();
      dryGain.disconnect();
      chopGain.disconnect();
      wetGain.disconnect();
      lfo.disconnect();
      lfoDepth.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetGuitarizerNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const highpass = context.createBiquadFilter();
  const chopGain = context.createGain();
  const lfo = context.createOscillator();
  const lfoDepth = context.createGain();
  const attackFilter = context.createBiquadFilter();
  const preGain = context.createGain();
  const shaper = context.createWaveShaper();
  const bodyFilter = context.createBiquadFilter();
  const cabFilter = context.createBiquadFilter();
  const gate = context.createWaveShaper();
  const wetGain = context.createGain();
  const output = context.createGain();

  highpass.type = "highpass";
  attackFilter.type = "highpass";
  bodyFilter.type = "peaking";
  cabFilter.type = "lowpass";
  shaper.oversample = "2x";
  lfo.type = "square";
  lfo.start(0);

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(highpass);
  highpass.connect(chopGain);
  chopGain.connect(attackFilter);
  attackFilter.connect(preGain);
  preGain.connect(shaper);
  shaper.connect(bodyFilter);
  bodyFilter.connect(cabFilter);
  cabFilter.connect(gate);
  gate.connect(wetGain);
  wetGain.connect(output);
  lfo.connect(lfoDepth);
  lfoDepth.connect(chopGain.gain);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetGuitarizerState(
        context,
        { dryGain, highpass, chopGain, lfo, lfoDepth, attackFilter, preGain, shaper, bodyFilter, cabFilter, gate, wetGain },
        nextInstance,
        options,
      ),
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // Already stopped.
      }
      input.disconnect();
      dryGain.disconnect();
      highpass.disconnect();
      chopGain.disconnect();
      lfo.disconnect();
      lfoDepth.disconnect();
      attackFilter.disconnect();
      preGain.disconnect();
      shaper.disconnect();
      bodyFilter.disconnect();
      cabFilter.disconnect();
      gate.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetVocalFormantNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const highpass = context.createBiquadFilter();
  const bodyFilter = context.createBiquadFilter();
  const throatFilter = context.createBiquadFilter();
  const formantFilter = context.createBiquadFilter();
  const presenceFilter = context.createBiquadFilter();
  const airFilter = context.createBiquadFilter();
  const shaper = context.createWaveShaper();
  const pitchDelay = context.createDelay(0.08);
  const pitchLayerGain = context.createGain();
  const wetGain = context.createGain();
  const output = context.createGain();

  highpass.type = "highpass";
  bodyFilter.type = "lowshelf";
  throatFilter.type = "peaking";
  formantFilter.type = "peaking";
  presenceFilter.type = "peaking";
  airFilter.type = "highshelf";
  shaper.oversample = "2x";

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(highpass);
  highpass.connect(bodyFilter);
  bodyFilter.connect(throatFilter);
  throatFilter.connect(formantFilter);
  formantFilter.connect(presenceFilter);
  presenceFilter.connect(airFilter);
  airFilter.connect(shaper);
  shaper.connect(wetGain);
  highpass.connect(pitchDelay);
  pitchDelay.connect(pitchLayerGain);
  pitchLayerGain.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetVocalFormantState(
        context,
        { dryGain, highpass, bodyFilter, throatFilter, formantFilter, presenceFilter, airFilter, shaper, pitchDelay, pitchLayerGain, wetGain },
        nextInstance,
        options,
      ),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      highpass.disconnect();
      bodyFilter.disconnect();
      throatFilter.disconnect();
      formantFilter.disconnect();
      presenceFilter.disconnect();
      airFilter.disconnect();
      shaper.disconnect();
      pitchDelay.disconnect();
      pitchLayerGain.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetIrSpaceNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const preDelay = context.createDelay(0.08);
  const preFilter = context.createBiquadFilter();
  const convolver = context.createConvolver();
  const bodyFilter = context.createBiquadFilter();
  const toneFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  preFilter.type = "highpass";
  bodyFilter.type = "peaking";
  toneFilter.type = "lowpass";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(preDelay);
  preDelay.connect(preFilter);
  preFilter.connect(convolver);
  convolver.connect(bodyFilter);
  bodyFilter.connect(toneFilter);
  toneFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetIrSpaceState(context, { dryGain, preDelay, preFilter, convolver, bodyFilter, toneFilter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      preDelay.disconnect();
      preFilter.disconnect();
      convolver.disconnect();
      bodyFilter.disconnect();
      toneFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetVocoderNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const envelopeFilter = context.createBiquadFilter();
  const oscillator = context.createOscillator();
  const carrierGain = context.createGain();
  const formantFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  envelopeFilter.type = "bandpass";
  formantFilter.type = "bandpass";
  carrierGain.gain.value = 0;
  oscillator.type = "sawtooth";
  oscillator.start(0);

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(envelopeFilter);
  envelopeFilter.connect(carrierGain.gain);
  oscillator.connect(carrierGain);
  carrierGain.connect(formantFilter);
  formantFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetVocoderState(context, { dryGain, envelopeFilter, oscillator, formantFilter, wetGain }, nextInstance, options),
    dispose: () => {
      try {
        oscillator.stop();
      } catch {
        // Already stopped.
      }
      input.disconnect();
      dryGain.disconnect();
      envelopeFilter.disconnect();
      oscillator.disconnect();
      carrierGain.disconnect();
      formantFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetPitchAssistNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const delayA = context.createDelay(0.08);
  const delayB = context.createDelay(0.08);
  const gainA = context.createGain();
  const gainB = context.createGain();
  const colorFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const lfo = context.createOscillator();
  const lfoDepthA = context.createGain();
  const lfoDepthB = context.createGain();
  const output = context.createGain();

  colorFilter.type = "highshelf";
  lfo.type = "triangle";
  lfo.frequency.value = 5.5;
  lfo.start(0);

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(delayA);
  input.connect(delayB);
  delayA.connect(gainA);
  delayB.connect(gainB);
  gainA.connect(colorFilter);
  gainB.connect(colorFilter);
  colorFilter.connect(wetGain);
  wetGain.connect(output);
  lfo.connect(lfoDepthA);
  lfo.connect(lfoDepthB);
  lfoDepthA.connect(delayA.delayTime);
  lfoDepthB.connect(delayB.delayTime);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetPitchAssistState(context, { dryGain, delayA, delayB, gainA, gainB, colorFilter, wetGain, lfo, lfoDepthA, lfoDepthB }, nextInstance, options),
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        // Already stopped.
      }
      input.disconnect();
      dryGain.disconnect();
      delayA.disconnect();
      delayB.disconnect();
      gainA.disconnect();
      gainB.disconnect();
      colorFilter.disconnect();
      wetGain.disconnect();
      lfo.disconnect();
      lfoDepthA.disconnect();
      lfoDepthB.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetGranularNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const delayA = context.createDelay(1);
  const delayB = context.createDelay(1);
  const feedback = context.createGain();
  const spreadGain = context.createGain();
  const textureFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  textureFilter.type = "bandpass";
  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(delayA);
  input.connect(delayB);
  delayA.connect(feedback);
  feedback.connect(delayB);
  delayB.connect(spreadGain);
  spreadGain.connect(textureFilter);
  textureFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetGranularState(context, { dryGain, delayA, delayB, feedback, spreadGain, textureFilter, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      delayA.disconnect();
      delayB.disconnect();
      feedback.disconnect();
      spreadGain.disconnect();
      textureFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetParallelCompNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const wetInputGain = context.createGain();
  const wetHPF = context.createBiquadFilter();
  const wetCompressor = context.createDynamicsCompressor();
  const wetLPF = context.createBiquadFilter();
  const wetTone = context.createBiquadFilter();
  const wetGain = context.createGain();
  const outputGain = context.createGain();
  const output = context.createGain();

  wetHPF.type = "highpass";
  wetLPF.type = "lowpass";
  wetTone.type = "highshelf";
  wetTone.frequency.value = 3600;

  input.connect(dryGain);
  dryGain.connect(outputGain);
  input.connect(wetInputGain);
  wetInputGain.connect(wetHPF);
  wetHPF.connect(wetCompressor);
  wetCompressor.connect(wetLPF);
  wetLPF.connect(wetTone);
  wetTone.connect(wetGain);
  wetGain.connect(outputGain);
  outputGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetParallelCompState(context, { dryGain, wetInputGain, wetHPF, wetCompressor, wetLPF, wetTone, wetGain, outputGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      wetInputGain.disconnect();
      wetHPF.disconnect();
      wetCompressor.disconnect();
      wetLPF.disconnect();
      wetTone.disconnect();
      wetGain.disconnect();
      outputGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}
function createSweetMultibandNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const lowFilter = context.createBiquadFilter();
  const midFilter = context.createBiquadFilter();
  const highFilter = context.createBiquadFilter();
  const lowComp = context.createDynamicsCompressor();
  const midComp = context.createDynamicsCompressor();
  const highComp = context.createDynamicsCompressor();
  const lowGain = context.createGain();
  const midGain = context.createGain();
  const highGain = context.createGain();
  const wetSum = context.createGain();
  const wetGain = context.createGain();
  const output = context.createGain();

  lowFilter.type = "lowpass";
  lowFilter.frequency.value = 180;
  midFilter.type = "bandpass";
  midFilter.frequency.value = 1100;
  midFilter.Q.value = 0.8;
  highFilter.type = "highpass";
  highFilter.frequency.value = 4200;

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(lowFilter);
  input.connect(midFilter);
  input.connect(highFilter);
  lowFilter.connect(lowComp);
  midFilter.connect(midComp);
  highFilter.connect(highComp);
  lowComp.connect(lowGain);
  midComp.connect(midGain);
  highComp.connect(highGain);
  lowGain.connect(wetSum);
  midGain.connect(wetSum);
  highGain.connect(wetSum);
  wetSum.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetMultibandState(context, { dryGain, lowComp, midComp, highComp, lowGain, midGain, highGain, wetGain }, nextInstance, options),
    dispose: () => {
      input.disconnect();
      dryGain.disconnect();
      lowFilter.disconnect();
      midFilter.disconnect();
      highFilter.disconnect();
      lowComp.disconnect();
      midComp.disconnect();
      highComp.disconnect();
      lowGain.disconnect();
      midGain.disconnect();
      highGain.disconnect();
      wetSum.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function createSweetWavetableCarrierNode(context: BaseAudioContext, instance: PluginInstance): PluginNode {
  const input = context.createGain();
  const dryGain = context.createGain();
  const envelopeFilter = context.createBiquadFilter();
  const oscillator = context.createOscillator();
  const subOscillator = context.createOscillator();
  const oscillatorGain = context.createGain();
  const subGain = context.createGain();
  const carrierGain = context.createGain();
  const toneFilter = context.createBiquadFilter();
  const wetGain = context.createGain();
  const output = context.createGain();

  envelopeFilter.type = "lowpass";
  envelopeFilter.frequency.value = 90;
  oscillatorGain.gain.value = 1;
  subGain.gain.value = 0.2;
  carrierGain.gain.value = 0;
  toneFilter.type = "lowpass";
  oscillator.start(0);
  subOscillator.start(0);

  input.connect(dryGain);
  dryGain.connect(output);
  input.connect(envelopeFilter);
  envelopeFilter.connect(carrierGain.gain);
  oscillator.connect(oscillatorGain);
  subOscillator.connect(subGain);
  oscillatorGain.connect(carrierGain);
  subGain.connect(carrierGain);
  carrierGain.connect(toneFilter);
  toneFilter.connect(wetGain);
  wetGain.connect(output);

  const node: PluginNode = {
    input,
    output,
    update: (nextInstance, options) =>
      applySweetWavetableCarrierState(context, { dryGain, oscillator, subOscillator, subGain, toneFilter, wetGain }, nextInstance, options),
    dispose: () => {
      try {
        oscillator.stop();
        subOscillator.stop();
      } catch {
        // Already stopped.
      }
      input.disconnect();
      dryGain.disconnect();
      envelopeFilter.disconnect();
      oscillator.disconnect();
      subOscillator.disconnect();
      oscillatorGain.disconnect();
      subGain.disconnect();
      carrierGain.disconnect();
      toneFilter.disconnect();
      wetGain.disconnect();
      output.disconnect();
    },
  };

  node.update(instance);
  return node;
}

function applySweetFilterState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    filter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const filterType = readFilterType(params.type);

  node.filter.type = filterType;
  setAudioParam(node.filter.frequency, clamp(readNumber(params.frequency, 12000), 20, Math.min(20000, context.sampleRate / 2 - 1)), time, options.smooth);
  setAudioParam(node.filter.Q, clamp(readNumber(params.q, 0.8), 0.1, 24), time, options.smooth);
  setAudioParam(node.filter.gain, clamp(readNumber(params.gainDb, 0), -18, 18), time, options.smooth);
  setAudioParam(node.dryGain.gain, instance.enabled ? 0 : 1, time, options.smooth);
  setAudioParam(node.wetGain.gain, instance.enabled ? 1 : 0, time, options.smooth);
}

export type SweetTiltEqRuntimeParams = {
  tiltDb: number;
  pivotHz: number;
  lowShape: number;
  highShape: number;
  mix: number;
  outputDb: number;
  lowGainDb: number;
  highGainDb: number;
};

export function resolveSweetTiltEqParams(params: Record<string, unknown>, sampleRate = 48000): SweetTiltEqRuntimeParams {
  const nyquist = Math.max(1000, sampleRate / 2 - 1);
  const tiltDb = clamp(readNumber(params.tiltDb, 0), -6, 6);
  const pivotHz = clamp(readNumber(params.pivotHz, 1000), 500, Math.min(2500, nyquist));
  const lowShape = clamp(readNumber(params.lowShape, 0.7), 0.3, 1.2);
  const highShape = clamp(readNumber(params.highShape, 0.7), 0.3, 1.2);
  const mix = clamp(readNumber(params.mix, 1), 0, 1);
  const outputDb = clamp(readNumber(params.outputDb, 0), -6, 6);
  return {
    tiltDb,
    pivotHz,
    lowShape,
    highShape,
    mix,
    outputDb,
    lowGainDb: round2(-tiltDb * 0.5),
    highGainDb: round2(tiltDb * 0.5),
  };
}

function applySweetTiltEqState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    lowShelf: BiquadFilterNode;
    highShelf: BiquadFilterNode;
    wetGain: GainNode;
    output: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = resolveSweetTiltEqParams(instance.params, context.sampleRate);
  const time = context.currentTime;
  const enabledMix = instance.enabled ? params.mix : 0;

  setAudioParam(node.lowShelf.frequency, params.pivotHz, time, options.smooth);
  setAudioParam(node.highShelf.frequency, params.pivotHz, time, options.smooth);
  setAudioParam(node.lowShelf.Q, params.lowShape, time, options.smooth);
  setAudioParam(node.highShelf.Q, params.highShape, time, options.smooth);
  setAudioParam(node.lowShelf.gain, params.lowGainDb, time, options.smooth);
  setAudioParam(node.highShelf.gain, params.highGainDb, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix, time, options.smooth);
  setAudioParam(node.output.gain, dbToGain(instance.enabled ? params.outputDb : 0), time, options.smooth);
}

function applySweetDriveState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    shaper: WaveShaperNode;
    toneFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const drive = clamp01(readNumber(params.drive, 0.35));
  const tone = clamp01(readNumber(params.tone, 0.55));
  const mix = clamp01(readNumber(params.mix, 0.35));
  const enabledMix = instance.enabled ? mix : 0;

  node.shaper.curve = makeSaturationCurve(1 + drive * 22);
  setAudioParam(node.toneFilter.gain, -4 + tone * 10, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.55, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.9, time, options.smooth);
}

function applySweetSaturatorState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    highpass: BiquadFilterNode;
    preGain: GainNode;
    shaper: WaveShaperNode;
    toneFilter: BiquadFilterNode;
    wetGain: GainNode;
    output: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const drive = clamp01(readNumber(params.drive, 0.22));
  const color = clamp01(readNumber(params.color, 0.48));
  const lowCutHz = clamp(readNumber(params.lowCutHz, 35), 20, 220);
  const mix = clamp01(readNumber(params.mix, 0.18));
  const outputDb = clamp(readNumber(params.outputDb, 0), -12, 6);
  const enabledMix = instance.enabled ? mix : 0;

  node.shaper.curve = makeSaturationCurve(1 + drive * 12);
  setAudioParam(node.highpass.frequency, lowCutHz, time, options.smooth);
  setAudioParam(node.preGain.gain, 1 + drive * 1.6, time, options.smooth);
  setAudioParam(node.toneFilter.gain, -1.5 + color * 3, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.38, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * (0.72 + color * 0.2), time, options.smooth);
  setAudioParam(node.output.gain, dbToGain(outputDb), time, options.smooth);
}

export function resolveSweetClipperParams(params: Record<string, unknown>) {
  const mode = readSweetClipperMode(params.mode);
  const modeDefaults = mode === "hard"
    ? { knee: 0.22, hardness: 0.78 }
    : mode === "medium"
      ? { knee: 0.38, hardness: 0.55 }
      : { knee: 0.55, hardness: 0.35 };
  return {
    ...resolveSoftClipperParams({
      mode,
      driveDb: readNumber(params.driveDb, 2),
      ceilingDb: readNumber(params.ceilingDb, -1),
      knee: readNumber(params.knee, modeDefaults.knee),
      hardness: readNumber(params.hardness, modeDefaults.hardness),
      mix: readNumber(params.mix, 0.65),
      outputDb: readNumber(params.outputDb, -0.3),
    }),
    autoTrim: readBoolean(params.autoTrim, true),
  };
}

function applySweetClipperState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    preGain: GainNode;
    shaper: WaveShaperNode;
    wetGain: GainNode;
    output: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = resolveSweetClipperParams(instance.params);
  const time = context.currentTime;
  const enabledMix = instance.enabled ? params.mix : 0;
  const autoTrimDb = params.autoTrim ? clamp(-params.driveDb * 0.35, -4, 0) : 0;
  const outputDb = instance.enabled ? params.outputDb + autoTrimDb : 0;

  node.shaper.curve = buildSoftClipperCurve(params);
  setAudioParam(node.preGain.gain, instance.enabled ? dbToGain(params.driveDb) : 1, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix, time, options.smooth);
  setAudioParam(node.output.gain, dbToGain(outputDb), time, options.smooth);
}

function applySweetPeakMaximizerPreviewState(
  context: BaseAudioContext,
  node: {
    bypassGain: GainNode;
    preGain: GainNode;
    limiter: DynamicsCompressorNode;
    shaper: WaveShaperNode;
    postGain: GainNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = resolvePeakMaximizerParams(instance.params);
  const time = context.currentTime;
  const enabled = instance.enabled;
  const ratio = params.mode === "dense" ? 18 : params.mode === "loud" ? 15 : params.mode === "punch" ? 8 : 12;
  const previewThreshold = clamp(params.ceilingDb - Math.max(1.5, Math.max(0, params.inputDriveDb) * 0.5), -18, -0.3);
  const clipperMode: SoftClipperMode = params.mode === "dense" || params.mode === "loud" ? "medium" : "soft";

  node.shaper.oversample = params.oversample === "off" ? "none" : params.oversample;
  node.shaper.curve = buildSoftClipperCurve({
    mode: clipperMode,
    driveDb: 0,
    ceilingDb: params.ceilingDb,
    knee: clamp(0.52 - params.softClipGuard * 0.35, 0.25, 0.58),
    hardness: clamp(0.28 + params.softClipGuard * 0.7, 0.25, 0.68),
    mix: 1,
    outputDb: 0,
  });

  setAudioParam(node.bypassGain.gain, enabled ? 0 : 1, time, options.smooth);
  setAudioParam(node.preGain.gain, enabled ? dbToGain(params.inputDriveDb) : 1, time, options.smooth);
  setAudioParam(node.limiter.threshold, enabled ? previewThreshold : 0, time, options.smooth);
  setAudioParam(node.limiter.knee, enabled ? 1.5 + params.softClipGuard * 8 : 0, time, options.smooth);
  setAudioParam(node.limiter.ratio, enabled ? ratio : 1, time, options.smooth);
  setAudioParam(node.limiter.attack, enabled ? clamp(params.lookaheadMs / 1000, 0.0005, 0.005) : 0.003, time, options.smooth);
  setAudioParam(node.limiter.release, enabled ? params.releaseMs / 1000 : 0.06, time, options.smooth);
  setAudioParam(node.postGain.gain, enabled ? dbToGain(Math.min(0, params.ceilingDb + 0.35)) : 1, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabled ? 1 : 0, time, options.smooth);
}

export function resolveSweetLowEndTranslatorParams(params: Record<string, unknown>, sampleRate = 48000) {
  const safe = sanitizeLowEndTranslatorParams({
    mode: params.mode === "808Audibility" || params.mode === "warmBass" || params.mode === "subToBass" ? params.mode : undefined,
    amount: readNumber(params.amount, 0.24),
    drive: readNumber(params.drive, 0.16),
    sourceLowHz: readNumber(params.sourceLowHz, 58),
    translateHz: readNumber(params.translateHz, 115),
    upperHarmonicHz: readNumber(params.upperHarmonicHz, 185),
    lowCutHz: readNumber(params.lowCutHz, 30),
    subGuardHz: readNumber(params.subGuardHz, 55),
    subGuardDb: readNumber(params.subGuardDb, -0.7),
    mix: readNumber(params.mix, 0.16),
    outputDb: readNumber(params.outputDb, -0.4),
    monoSafe: readBoolean(params.monoSafe, true),
  });
  const nyquist = Math.max(1000, sampleRate / 2 - 1);
  return {
    ...safe,
    sourceLowHz: clamp(safe.sourceLowHz, 35, Math.min(95, nyquist)),
    translateHz: clamp(safe.translateHz, 75, Math.min(180, nyquist)),
    upperHarmonicHz: clamp(safe.upperHarmonicHz, 120, Math.min(320, nyquist)),
    lowCutHz: clamp(safe.lowCutHz, 22, Math.min(45, nyquist)),
    subGuardHz: clamp(safe.subGuardHz, 45, Math.min(85, nyquist)),
  };
}

function applySweetLowEndTranslatorState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    lowCut: BiquadFilterNode;
    preGain: GainNode;
    shaper: WaveShaperNode;
    translateEq: BiquadFilterNode;
    upperEq: BiquadFilterNode;
    subGuard: BiquadFilterNode;
    wetGain: GainNode;
    output: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = resolveSweetLowEndTranslatorParams(instance.params, context.sampleRate);
  const time = context.currentTime;
  const enabledMix = instance.enabled ? params.mix : 0;
  const modeLift = params.mode === "808Audibility" ? 1.12 : params.mode === "warmBass" ? 0.84 : 1;

  node.shaper.curve = buildLowEndTranslatorCurve(params);
  setAudioParam(node.lowCut.frequency, params.lowCutHz, time, options.smooth);
  setAudioParam(node.lowCut.Q, 0.72, time, options.smooth);
  setAudioParam(node.preGain.gain, instance.enabled ? 1 + params.drive * 1.8 : 1, time, options.smooth);
  setAudioParam(node.translateEq.frequency, params.translateHz, time, options.smooth);
  setAudioParam(node.translateEq.Q, 0.85, time, options.smooth);
  setAudioParam(node.translateEq.gain, instance.enabled ? params.amount * 2.4 * modeLift : 0, time, options.smooth);
  setAudioParam(node.upperEq.frequency, params.upperHarmonicHz, time, options.smooth);
  setAudioParam(node.upperEq.Q, 1.05, time, options.smooth);
  setAudioParam(node.upperEq.gain, instance.enabled ? params.amount * 1.5 * modeLift : 0, time, options.smooth);
  setAudioParam(node.subGuard.frequency, params.subGuardHz, time, options.smooth);
  setAudioParam(node.subGuard.gain, instance.enabled ? params.subGuardDb : 0, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.18, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.74, time, options.smooth);
  setAudioParam(node.output.gain, dbToGain(instance.enabled ? params.outputDb : 0), time, options.smooth);
}

export function resolveSweetAirExciterParams(params: Record<string, unknown>, sampleRate: number) {
  const nyquist = Math.max(1000, sampleRate / 2 - 1);
  const amount = clamp01(readNumber(params.amount, 0.22));
  const tone = clamp01(readNumber(params.tone, 0.62));
  const highPassHz = clamp(readNumber(params.highPassHz, 6800), 6000, Math.min(10000, nyquist));
  const postHighPassHz = clamp(readNumber(params.postHighPassHz, 10000), Math.min(highPassHz + 900, nyquist), Math.min(14000, nyquist));
  const focusHz = clamp(readNumber(params.focusHz, 12500), Math.min(postHighPassHz + 900, nyquist), Math.min(16500, nyquist));
  const lowPassHz = clamp(readNumber(params.lowPassHz, 18500), Math.min(focusHz + 900, nyquist), Math.min(20000, nyquist));
  const harshGuard = clamp01(readNumber(params.harshGuard, 0.68));
  const syntheticAirBed = readBoolean(params.syntheticAirBed, false);
  const airBedLevel = clamp(readNumber(params.airBedLevel, 0), 0, 0.18);
  const airBedKeyHz = clamp(readNumber(params.airBedKeyHz, 3200), 1800, Math.min(8000, nyquist));
  const airBedFollow = clamp01(readNumber(params.airBedFollow, 0.72));
  const dryLevel = clamp(readNumber(params.dryLevel, 1), 0, 1);
  const mix = clamp(readNumber(params.mix, 0.06), 0, 0.18);
  const outputDb = clamp(readNumber(params.outputDb, -1), -12, 3);

  return {
    amount,
    tone,
    highPassHz,
    focusHz,
    lowPassHz,
    harshGuard,
    postHighPassHz,
    syntheticAirBed,
    airBedLevel,
    airBedKeyHz,
    airBedFollow,
    dryLevel,
    mix,
    outputDb,
  };
}

function applySweetAirExciterState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    airHighpass: BiquadFilterNode;
    preGain: GainNode;
    shaper: WaveShaperNode;
    airPostHighpass: BiquadFilterNode;
    harshGuard: BiquadFilterNode;
    airFocus: BiquadFilterNode;
    airLowpass: BiquadFilterNode;
    wetGain: GainNode;
    envelopeHighpass: BiquadFilterNode;
    envelopeSmooth: BiquadFilterNode;
    envelopeScale: GainNode;
    airBedHighpass: BiquadFilterNode;
    airBedFocus: BiquadFilterNode;
    airBedLowpass: BiquadFilterNode;
    airBedGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = resolveSweetAirExciterParams(instance.params, context.sampleRate);
  const time = context.currentTime;
  const enabledMix = instance.enabled ? params.mix : 0;
  const guardDb = -params.harshGuard * (0.75 + params.amount * 1.8);
  const focusDb = -0.2 + params.tone * 0.75;
  const wetLevel = enabledMix * (0.38 + params.amount * 0.6) * dbToGain(params.outputDb);
  const airBedEnabled = instance.enabled && params.syntheticAirBed;
  const airBedScale = airBedEnabled ? params.airBedLevel * (52 + params.amount * 120) * (0.45 + params.airBedFollow * 0.75) * dbToGain(params.outputDb) : 0;

  node.shaper.curve = makeAirExciterCurve(params.amount, params.tone);
  setAudioParam(node.airHighpass.frequency, params.highPassHz, time, options.smooth);
  setAudioParam(node.airHighpass.Q, 0.72, time, options.smooth);
  setAudioParam(node.preGain.gain, 1 + params.amount * 0.95, time, options.smooth);
  setAudioParam(node.airPostHighpass.frequency, params.postHighPassHz, time, options.smooth);
  setAudioParam(node.airPostHighpass.Q, 0.7, time, options.smooth);
  setAudioParam(node.harshGuard.frequency, 7600 + params.tone * 1200, time, options.smooth);
  setAudioParam(node.harshGuard.Q, 2.2 + params.harshGuard * 2.8, time, options.smooth);
  setAudioParam(node.harshGuard.gain, guardDb, time, options.smooth);
  setAudioParam(node.airFocus.frequency, params.focusHz, time, options.smooth);
  setAudioParam(node.airFocus.Q, 0.65 + params.tone * 0.85, time, options.smooth);
  setAudioParam(node.airFocus.gain, focusDb, time, options.smooth);
  setAudioParam(node.airLowpass.frequency, params.lowPassHz, time, options.smooth);
  setAudioParam(node.airLowpass.Q, 0.65, time, options.smooth);
  setAudioParam(node.envelopeHighpass.frequency, params.airBedKeyHz, time, options.smooth);
  setAudioParam(node.envelopeHighpass.Q, 0.65, time, options.smooth);
  setAudioParam(node.envelopeSmooth.frequency, 18 + params.airBedFollow * 46, time, options.smooth);
  setAudioParam(node.envelopeSmooth.Q, 0.55, time, options.smooth);
  setAudioParam(node.envelopeScale.gain, airBedScale, time, options.smooth);
  setAudioParam(node.airBedHighpass.frequency, params.postHighPassHz, time, options.smooth);
  setAudioParam(node.airBedHighpass.Q, 0.7, time, options.smooth);
  setAudioParam(node.airBedFocus.frequency, params.focusHz + 1400, time, options.smooth);
  setAudioParam(node.airBedFocus.Q, 0.8 + params.tone * 0.7, time, options.smooth);
  setAudioParam(node.airBedFocus.gain, -0.35 + params.tone * 0.55, time, options.smooth);
  setAudioParam(node.airBedLowpass.frequency, params.lowPassHz, time, options.smooth);
  setAudioParam(node.airBedLowpass.Q, 0.65, time, options.smooth);
  setAudioParam(node.airBedGain.gain, 0, time, options.smooth);
  setAudioParam(node.dryGain.gain, instance.enabled ? params.dryLevel * (1 - enabledMix * 0.04) : 1, time, options.smooth);
  setAudioParam(node.wetGain.gain, wetLevel, time, options.smooth);
}
export function resolveSweetAimixGlowParams(params: Record<string, unknown>, sampleRate: number) {
  const nyquist = Math.max(1000, sampleRate / 2 - 1);
  const amount = clamp(readNumber(params.amount, 42), 0, 100) / 100;
  const recover = clamp(readNumber(params.recover, 34), 0, 100) / 100;
  const gloss = clamp(readNumber(params.gloss, 22), 0, 100) / 100;
  const air = clamp(readNumber(params.air, 18), 0, 100) / 100;
  const tame = clamp(readNumber(params.tame, 55), 0, 100) / 100;
  const mix = clamp(readNumber(params.mix, 0.32), 0, 0.72);
  const outputDb = clamp(readNumber(params.outputDb, -0.3), -6, 3);
  return {
    amount,
    recover,
    gloss,
    air,
    tame,
    mix,
    outputDb,
    presenceHighpassHz: clamp(260 + recover * 160, 220, Math.min(700, nyquist)),
    airHighpassHz: clamp(6200 + tame * 900, 5600, Math.min(9200, nyquist)),
    airFocusHz: clamp(9200 + air * 3200, 8500, Math.min(15000, nyquist)),
    airLowpassHz: clamp(17800 + air * 900, 15000, Math.min(19500, nyquist)),
  };
}

function applySweetAimixGlowState(
  context: BaseAudioContext,
  node: {
    bypassGain: GainNode;
    guardOne: BiquadFilterNode;
    guardTwo: BiquadFilterNode;
    dryGain: GainNode;
    presenceHighpass: BiquadFilterNode;
    presencePreGain: GainNode;
    glossShaper: WaveShaperNode;
    presenceBody: BiquadFilterNode;
    presenceFocus: BiquadFilterNode;
    glossFilter: BiquadFilterNode;
    presenceWetGain: GainNode;
    airHighpass: BiquadFilterNode;
    airPreGain: GainNode;
    airShaper: WaveShaperNode;
    airGuard: BiquadFilterNode;
    airFocus: BiquadFilterNode;
    airShelf: BiquadFilterNode;
    airLowpass: BiquadFilterNode;
    airWetGain: GainNode;
    processedOutput: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = resolveSweetAimixGlowParams(instance.params, context.sampleRate);
  const time = context.currentTime;
  const enabledMix = instance.enabled ? params.mix : 0;
  const amount = params.amount;
  const presenceDb = Math.min(1.2, amount * params.recover * 2.2);
  const bodyDb = Math.min(0.6, amount * params.recover * 0.9);
  const glossDb = Math.min(0.45, amount * params.gloss * 0.9);
  const airDb = Math.min(0.9, amount * params.air * 1.8);
  const tameDb = -Math.min(2.2, amount * params.tame * 3.2);
  const airGuardDb = -Math.min(1.8, amount * params.tame * (1.4 + params.air));

  node.glossShaper.curve = makeSaturationCurve(1 + amount * params.gloss * 6.5);
  node.airShaper.curve = makeAirExciterCurve(amount * Math.max(0.1, params.air), 0.55 + params.air * 0.25);

  setAudioParam(node.bypassGain.gain, instance.enabled ? 0 : 1, time, options.smooth);
  setAudioParam(node.processedOutput.gain, instance.enabled ? dbToGain(params.outputDb) : 0, time, options.smooth);

  setAudioParam(node.guardOne.frequency, 6800, time, options.smooth);
  setAudioParam(node.guardOne.Q, 2.1 + params.tame * 1.6, time, options.smooth);
  setAudioParam(node.guardOne.gain, tameDb * 0.58, time, options.smooth);
  setAudioParam(node.guardTwo.frequency, 9400, time, options.smooth);
  setAudioParam(node.guardTwo.Q, 1.8 + params.tame * 1.4, time, options.smooth);
  setAudioParam(node.guardTwo.gain, tameDb * 0.32, time, options.smooth);

  setAudioParam(node.dryGain.gain, instance.enabled ? 1 - enabledMix * 0.08 : 0, time, options.smooth);
  setAudioParam(node.presenceHighpass.frequency, params.presenceHighpassHz, time, options.smooth);
  setAudioParam(node.presenceHighpass.Q, 0.72, time, options.smooth);
  setAudioParam(node.presencePreGain.gain, 1 + amount * params.gloss * 0.55, time, options.smooth);
  setAudioParam(node.presenceBody.frequency, 1700 + params.recover * 450, time, options.smooth);
  setAudioParam(node.presenceBody.Q, 0.9, time, options.smooth);
  setAudioParam(node.presenceBody.gain, bodyDb, time, options.smooth);
  setAudioParam(node.presenceFocus.frequency, 3300 + params.recover * 800, time, options.smooth);
  setAudioParam(node.presenceFocus.Q, 1.05, time, options.smooth);
  setAudioParam(node.presenceFocus.gain, presenceDb, time, options.smooth);
  setAudioParam(node.glossFilter.frequency, 7200, time, options.smooth);
  setAudioParam(node.glossFilter.gain, glossDb, time, options.smooth);
  setAudioParam(node.presenceWetGain.gain, enabledMix * (0.22 + params.recover * 0.28 + params.gloss * 0.14), time, options.smooth);

  setAudioParam(node.airHighpass.frequency, params.airHighpassHz, time, options.smooth);
  setAudioParam(node.airHighpass.Q, 0.72, time, options.smooth);
  setAudioParam(node.airPreGain.gain, 1 + amount * params.air * 0.75, time, options.smooth);
  setAudioParam(node.airGuard.frequency, 8100, time, options.smooth);
  setAudioParam(node.airGuard.Q, 2.4 + params.tame * 2.2, time, options.smooth);
  setAudioParam(node.airGuard.gain, airGuardDb, time, options.smooth);
  setAudioParam(node.airFocus.frequency, params.airFocusHz, time, options.smooth);
  setAudioParam(node.airFocus.Q, 0.85, time, options.smooth);
  setAudioParam(node.airFocus.gain, airDb * 0.65, time, options.smooth);
  setAudioParam(node.airShelf.frequency, 11800, time, options.smooth);
  setAudioParam(node.airShelf.gain, airDb * 0.45, time, options.smooth);
  setAudioParam(node.airLowpass.frequency, params.airLowpassHz, time, options.smooth);
  setAudioParam(node.airLowpass.Q, 0.65, time, options.smooth);
  setAudioParam(node.airWetGain.gain, enabledMix * (0.08 + params.air * 0.22), time, options.smooth);
}

function applySweetUtilityState(
  context: BaseAudioContext,
  node: {
    leftGain: GainNode;
    rightGain: GainNode;
    monoSum: GainNode;
    monoLeft: GainNode;
    monoRight: GainNode;
    output: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const gainDb = clamp(readNumber(params.gainDb, 0), -18, 12);
  const width = clamp(readNumber(params.width, 1), 0, 1);
  const mono = readBoolean(params.mono, false);
  const monoAmount = instance.enabled ? (mono ? 1 : 1 - width) : 0;
  const stereoAmount = instance.enabled ? width : 1;

  setAudioParam(node.leftGain.gain, stereoAmount, time, options.smooth);
  setAudioParam(node.rightGain.gain, stereoAmount, time, options.smooth);
  setAudioParam(node.monoSum.gain, 0.5, time, options.smooth);
  setAudioParam(node.monoLeft.gain, monoAmount, time, options.smooth);
  setAudioParam(node.monoRight.gain, monoAmount, time, options.smooth);
  setAudioParam(node.output.gain, dbToGain(gainDb), time, options.smooth);
}
function applySweetDelayState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    delay: DelayNode;
    feedbackGain: GainNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const timeSec = clamp(readNumber(params.timeSec, 0.25), 0.01, 1.5);
  const feedback = clamp(readNumber(params.feedback, 0.25), 0, 0.85);
  const mix = clamp01(readNumber(params.mix, 0.18));

  setAudioParam(node.dryGain.gain, 1, time, options.smooth);
  setAudioParam(node.delay.delayTime, timeSec, time, options.smooth);
  setAudioParam(node.feedbackGain.gain, instance.enabled ? feedback : 0, time, options.smooth);
  setAudioParam(node.wetGain.gain, instance.enabled ? mix : 0, time, options.smooth);
}

function applySweetReverbState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    preDelay: DelayNode;
    lowCutFilter: BiquadFilterNode;
    convolver: ConvolverNode;
    dampFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const mode = readString(params.mode, "room");
  const room = clamp01(readNumber(params.room, 0.45));
  const damp = clamp01(readNumber(params.damp, 0.55));
  const preDelayMs = clamp(readNumber(params.preDelayMs, 12), 0, 80);
  const modeDecay =
    mode === "air" ? 0.24 :
    mode === "tail" ? 1.8 :
    0.72;
  const decaySec = clamp(readNumber(params.decaySec, modeDecay), 0.12, 2.2);
  const lowCutHz = clamp(readNumber(params.lowCutHz, 180), 20, Math.min(800, context.sampleRate / 2 - 1));
  const highCutHz = clamp(readNumber(params.highCutHz, 10000), 1200, Math.min(20000, context.sampleRate / 2 - 1));
  const width = clamp01(readNumber(params.width, 0.45));
  const ducking = clamp01(readNumber(params.ducking, 0));
  const mix = clamp01(readNumber(params.mix, 0.2));
  const enabledMix = instance.enabled ? mix : 0;
  const dampedHighCutHz = clamp(highCutHz * (1.05 - damp * 0.5), 1200, Math.min(20000, context.sampleRate / 2 - 1));
  const duckedWetScale = 1 - ducking * 0.35;

  node.convolver.buffer = makeReverbImpulse(context, clamp(decaySec * (0.72 + room * 0.45), 0.12, 2.4), damp, width);
  setAudioParam(node.preDelay.delayTime, preDelayMs / 1000, time, options.smooth);
  setAudioParam(node.lowCutFilter.frequency, lowCutHz, time, options.smooth);
  setAudioParam(node.lowCutFilter.Q, 0.65, time, options.smooth);
  setAudioParam(node.dampFilter.frequency, dampedHighCutHz, time, options.smooth);
  setAudioParam(node.dampFilter.Q, 0.65, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.12, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * (0.72 + width * 0.18) * duckedWetScale, time, options.smooth);
}

function applySweetGuitarFxState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    preGain: GainNode;
    shaper: WaveShaperNode;
    bodyFilter: BiquadFilterNode;
    cabFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const drive = clamp01(readNumber(params.drive, 0.48));
  const tone = clamp01(readNumber(params.tone, 0.45));
  const body = clamp01(readNumber(params.body, 0.55));
  const mix = clamp01(readNumber(params.mix, 0.45));
  const enabledMix = instance.enabled ? mix : 0;

  node.shaper.curve = makeSaturationCurve(2 + drive * 34);
  setAudioParam(node.preGain.gain, 1 + drive * 2.2, time, options.smooth);
  setAudioParam(node.bodyFilter.frequency, 420 + body * 760, time, options.smooth);
  setAudioParam(node.bodyFilter.Q, 0.65 + body * 1.4, time, options.smooth);
  setAudioParam(node.bodyFilter.gain, -2 + body * 7, time, options.smooth);
  setAudioParam(node.cabFilter.frequency, 1700 + tone * 5200, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.72, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.92, time, options.smooth);
}

function applySweetVocalFxState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    highpass: BiquadFilterNode;
    preGain: GainNode;
    shaper: WaveShaperNode;
    bodyFilter: BiquadFilterNode;
    presenceFilter: BiquadFilterNode;
    airFilter: BiquadFilterNode;
    compressor: DynamicsCompressorNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const drive = clamp01(readNumber(params.drive, 0.24));
  const body = clamp01(readNumber(params.body, 0.46));
  const presence = clamp01(readNumber(params.presence, 0.55));
  const air = clamp01(readNumber(params.air, 0.5));
  const mix = clamp01(readNumber(params.mix, 0.38));
  const enabledMix = instance.enabled ? mix : 0;

  node.shaper.curve = makeSaturationCurve(1 + drive * 12);
  setAudioParam(node.highpass.frequency, 70 + body * 80, time, options.smooth);
  setAudioParam(node.highpass.Q, 0.7, time, options.smooth);
  setAudioParam(node.preGain.gain, 1 + drive * 0.7, time, options.smooth);
  setAudioParam(node.bodyFilter.frequency, 160 + body * 160, time, options.smooth);
  setAudioParam(node.bodyFilter.gain, -1 + body * 4.5, time, options.smooth);
  setAudioParam(node.presenceFilter.frequency, 2400 + presence * 1800, time, options.smooth);
  setAudioParam(node.presenceFilter.Q, 0.9 + presence * 0.8, time, options.smooth);
  setAudioParam(node.presenceFilter.gain, -1.2 + presence * 4.8, time, options.smooth);
  setAudioParam(node.airFilter.frequency, 7800 + air * 4200, time, options.smooth);
  setAudioParam(node.airFilter.gain, air * 5, time, options.smooth);
  setAudioParam(node.compressor.threshold, -18 - drive * 8, time, options.smooth);
  setAudioParam(node.compressor.knee, 8, time, options.smooth);
  setAudioParam(node.compressor.ratio, 1.6 + drive * 2.4, time, options.smooth);
  setAudioParam(node.compressor.attack, 0.006, time, options.smooth);
  setAudioParam(node.compressor.release, 0.12 + body * 0.12, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.48, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.9, time, options.smooth);
}

function applySweetBassEnhancerState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    lowpass: BiquadFilterNode;
    lowComp: DynamicsCompressorNode;
    subGain: GainNode;
    harmonicBand: BiquadFilterNode;
    shaper: WaveShaperNode;
    toneFilter: BiquadFilterNode;
    harmonicGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const sub = clamp01(readNumber(params.sub, 0.42));
  const harmonics = clamp01(readNumber(params.harmonics, 0.38));
  const tight = clamp01(readNumber(params.tight, 0.48));
  const tone = clamp01(readNumber(params.tone, 0.44));
  const mix = clamp01(readNumber(params.mix, 0.5));
  const enabledMix = instance.enabled ? mix : 0;

  node.shaper.curve = makeSaturationCurve(1.5 + harmonics * 16);
  setAudioParam(node.lowpass.frequency, 72 + sub * 82, time, options.smooth);
  setAudioParam(node.lowpass.Q, 0.7 + tight * 0.8, time, options.smooth);
  setAudioParam(node.lowComp.threshold, -24 - tight * 14, time, options.smooth);
  setAudioParam(node.lowComp.knee, 8, time, options.smooth);
  setAudioParam(node.lowComp.ratio, 2 + tight * 5, time, options.smooth);
  setAudioParam(node.lowComp.attack, 0.01 + tight * 0.012, time, options.smooth);
  setAudioParam(node.lowComp.release, 0.08 + tight * 0.2, time, options.smooth);
  setAudioParam(node.subGain.gain, enabledMix * sub * 1.25, time, options.smooth);
  setAudioParam(node.harmonicBand.frequency, 450 + tone * 1100, time, options.smooth);
  setAudioParam(node.harmonicBand.Q, 0.7 + harmonics * 1.8, time, options.smooth);
  setAudioParam(node.toneFilter.frequency, 720 + tone * 1500, time, options.smooth);
  setAudioParam(node.toneFilter.Q, 0.7 + tone * 0.9, time, options.smooth);
  setAudioParam(node.toneFilter.gain, -1 + tone * 6, time, options.smooth);
  setAudioParam(node.harmonicGain.gain, enabledMix * harmonics * 0.95, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.22, time, options.smooth);
}

export type SweetDeEsserResolvedParams = {
  frequency: number;
  amount: number;
  sharpness: number;
  mix: number;
  enabledMix: number;
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackSec: number;
  releaseSec: number;
  bandCancelGain: number;
  compressedBandGain: number;
};

export function resolveSweetDeEsserParams(
  params: Record<string, unknown>,
  sampleRate: number,
  enabled = true,
): SweetDeEsserResolvedParams {
  const frequency = clamp(readNumber(params.frequency, 7200), 4500, Math.min(11000, sampleRate / 2 - 1));
  const amount = clamp01(readNumber(params.amount, 0.42));
  const sharpness = clamp01(readNumber(params.sharpness, 0.55));
  const mix = clamp01(readNumber(params.mix, 0.75));
  // Difference reconstruction is intentionally capped so a high Mix setting
  // cannot hollow out the vocal's consonants when the detector is hit hard.
  const enabledMix = enabled ? Math.min(mix, 0.42) : 0;

  return {
    frequency,
    amount,
    sharpness,
    mix,
    enabledMix,
    thresholdDb: -16 - amount * 22,
    kneeDb: 5 + (1 - sharpness) * 8,
    ratio: 2 + amount * 10,
    attackSec: 0.0025,
    releaseSec: 0.065 + (1 - sharpness) * 0.11,
    bandCancelGain: -enabledMix,
    compressedBandGain: enabledMix,
  };
}

function applySweetDeEsserState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    sibilanceFilter: BiquadFilterNode;
    compressor: DynamicsCompressorNode;
    bandCancelGain: GainNode;
    compressedBandGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const time = context.currentTime;
  const params = resolveSweetDeEsserParams(instance.params, context.sampleRate, instance.enabled);

  setAudioParam(node.dryGain.gain, 1, time, options.smooth);
  setAudioParam(node.sibilanceFilter.frequency, params.frequency, time, options.smooth);
  setAudioParam(node.sibilanceFilter.Q, 2 + params.sharpness * 8, time, options.smooth);
  setAudioParam(node.compressor.threshold, params.thresholdDb, time, options.smooth);
  setAudioParam(node.compressor.knee, params.kneeDb, time, options.smooth);
  setAudioParam(node.compressor.ratio, params.ratio, time, options.smooth);
  setAudioParam(node.compressor.attack, params.attackSec, time, options.smooth);
  setAudioParam(node.compressor.release, params.releaseSec, time, options.smooth);
  setAudioParam(node.bandCancelGain.gain, params.bandCancelGain, time, options.smooth);
  setAudioParam(node.compressedBandGain.gain, params.compressedBandGain, time, options.smooth);
}

export type SweetVocalDuckInsertParams = {
  frequencyHz: number;
  q: number;
  staticDryGain: number;
  staticWetGain: number;
};

export function resolveSweetVocalDuckInsertParams(
  params: Record<string, unknown>,
  sampleRate: number,
): SweetVocalDuckInsertParams {
  return {
    frequencyHz: clamp(readNumber(params.frequencyHz, 2500), 400, Math.min(8000, sampleRate / 2 - 1)),
    q: clamp(readNumber(params.q, 1.1), 0.25, 6),
    staticDryGain: 1,
    staticWetGain: 0,
  };
}

function applySweetVocalDuckEqState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    duckFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const time = context.currentTime;
  const params = resolveSweetVocalDuckInsertParams(instance.params, context.sampleRate);

  setAudioParam(node.duckFilter.frequency, params.frequencyHz, time, options.smooth);
  setAudioParam(node.duckFilter.Q, params.q, time, options.smooth);
  // Track routing owns the dynamic reduction. Keeping the insert neutral here
  // avoids a permanent 2.5kHz dip plus a second duck while vocals are active.
  setAudioParam(node.duckFilter.gain, 0, time, options.smooth);
  setAudioParam(node.dryGain.gain, params.staticDryGain, time, options.smooth);
  setAudioParam(node.wetGain.gain, params.staticWetGain, time, options.smooth);
}

function applySweetGateState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    shaper: WaveShaperNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const threshold = clamp01(readNumber(params.threshold, 0.12));
  const floor = clamp01(readNumber(params.floor, 0.18));
  const softness = clamp01(readNumber(params.softness, 0.55));
  const mix = clamp01(readNumber(params.mix, 0.8));
  const enabledMix = instance.enabled ? mix : 0;

  node.shaper.curve = makeGateCurve(0.006 + threshold * 0.18, floor, softness);
  setAudioParam(node.dryGain.gain, 1 - enabledMix, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix, time, options.smooth);
}

function applySweetChorusState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    delay: DelayNode;
    feedbackGain: GainNode;
    toneFilter: BiquadFilterNode;
    wetGain: GainNode;
    lfo: OscillatorNode;
    depthGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const rate = clamp01(readNumber(params.rate, 0.28));
  const depth = clamp01(readNumber(params.depth, 0.42));
  const feedback = clamp01(readNumber(params.feedback, 0.18));
  const mix = clamp01(readNumber(params.mix, 0.28));
  const enabledMix = instance.enabled ? mix : 0;

  setAudioParam(node.delay.delayTime, 0.012 + depth * 0.018, time, options.smooth);
  setAudioParam(node.feedbackGain.gain, instance.enabled ? feedback * 0.45 : 0, time, options.smooth);
  setAudioParam(node.toneFilter.frequency, 4200 + depth * 5200, time, options.smooth);
  setAudioParam(node.lfo.frequency, 0.15 + rate * 5.5, time, options.smooth);
  setAudioParam(node.depthGain.gain, 0.001 + depth * 0.012, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.22, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.86, time, options.smooth);
}

function applySweetPhaserState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    filters: BiquadFilterNode[];
    feedbackGain: GainNode;
    wetGain: GainNode;
    lfo: OscillatorNode;
    depthGains: GainNode[];
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const rate = clamp01(readNumber(params.rate, 0.32));
  const depth = clamp01(readNumber(params.depth, 0.45));
  const feedback = clamp01(readNumber(params.feedback, 0.22));
  const mix = clamp01(readNumber(params.mix, 0.35));
  const enabledMix = instance.enabled ? mix : 0;

  node.filters.forEach((filter, index) => {
    setAudioParam(filter.frequency, 260 + index * 330 + depth * 700, time, options.smooth);
    setAudioParam(filter.Q, 0.65 + depth * 1.8, time, options.smooth);
    setAudioParam(node.depthGains[index].gain, depth * (65 + index * 35), time, options.smooth);
  });
  setAudioParam(node.lfo.frequency, 0.08 + rate * 4.2, time, options.smooth);
  setAudioParam(node.feedbackGain.gain, instance.enabled ? feedback * 0.55 : 0, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.45, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.82, time, options.smooth);
}

function applySweetStereoWidenerState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    delayL: DelayNode;
    delayR: DelayNode;
    panL: StereoPannerNode;
    panR: StereoPannerNode;
    toneFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const width = clamp01(readNumber(params.width, 0.45));
  const delayMs = clamp(readNumber(params.delayMs, 12), 2, 28);
  const tone = clamp01(readNumber(params.tone, 0.62));
  const mix = clamp01(readNumber(params.mix, 0.32));
  const enabledMix = instance.enabled ? mix : 0;

  setAudioParam(node.delayL.delayTime, delayMs / 1000, time, options.smooth);
  setAudioParam(node.delayR.delayTime, (delayMs + width * 9) / 1000, time, options.smooth);
  setAudioParam(node.panL.pan, -width, time, options.smooth);
  setAudioParam(node.panR.pan, width, time, options.smooth);
  setAudioParam(node.toneFilter.frequency, 2500 + tone * 1800, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.18, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.42, time, options.smooth);
}

export type SweetSupportWidenerRuntimeParams = {
  width: number;
  mix: number;
  delayMs: number;
  highPassHz: number;
  lowPassHz: number;
  lowMonoHz: number;
  tone: number;
  monoSafety: boolean;
};

export function resolveSweetSupportWidenerParams(params: Record<string, unknown>, sampleRate = 48000): SweetSupportWidenerRuntimeParams {
  const nyquist = Math.max(1000, sampleRate / 2 - 1);
  const width = clamp01(readNumber(params.width, 0.08));
  const mix = clamp(readNumber(params.mix, 0.06), 0, 0.18);
  const delayMs = clamp(readNumber(params.delayMs, 7), 3, 14);
  const lowMonoHz = clamp(readNumber(params.lowMonoHz, 120), 80, 220);
  const monoSafety = readBoolean(params.monoSafety, true);
  const highPassHz = clamp(Math.max(readNumber(params.highPassHz, 2500), monoSafety ? lowMonoHz : 20), 180, Math.min(8000, nyquist));
  const lowPassHz = clamp(readNumber(params.lowPassHz, 16000), Math.max(highPassHz + 400, 2000), Math.min(20000, nyquist));
  const tone = clamp01(readNumber(params.tone, 0.58));
  return {
    width,
    mix,
    delayMs,
    highPassHz,
    lowPassHz,
    lowMonoHz,
    tone,
    monoSafety,
  };
}

function applySweetSupportWidenerState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    highpass: BiquadFilterNode;
    lowpass: BiquadFilterNode;
    delayL: DelayNode;
    delayR: DelayNode;
    panL: StereoPannerNode;
    panR: StereoPannerNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = resolveSweetSupportWidenerParams(instance.params, context.sampleRate);
  const time = context.currentTime;
  const enabledMix = instance.enabled ? params.mix : 0;
  const toneLift = 1 + (params.tone - 0.5) * 0.18;

  setAudioParam(node.highpass.frequency, params.highPassHz, time, options.smooth);
  setAudioParam(node.highpass.Q, 0.72, time, options.smooth);
  setAudioParam(node.lowpass.frequency, params.lowPassHz, time, options.smooth);
  setAudioParam(node.lowpass.Q, 0.65, time, options.smooth);
  setAudioParam(node.delayL.delayTime, params.delayMs / 1000, time, options.smooth);
  setAudioParam(node.delayR.delayTime, (params.delayMs + params.width * 7) / 1000, time, options.smooth);
  setAudioParam(node.panL.pan, -params.width, time, options.smooth);
  setAudioParam(node.panR.pan, params.width, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.08, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.36 * toneLift, time, options.smooth);
}

function applySweetTransientShaperState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    attackFilter: BiquadFilterNode;
    attackShape: WaveShaperNode;
    attackGain: GainNode;
    sustainFilter: BiquadFilterNode;
    sustainComp: DynamicsCompressorNode;
    sustainGain: GainNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const attack = clamp01(readNumber(params.attack, 0.48));
  const sustain = clamp01(readNumber(params.sustain, 0.34));
  const tone = clamp01(readNumber(params.tone, 0.55));
  const mix = clamp01(readNumber(params.mix, 0.5));
  const enabledMix = instance.enabled ? mix : 0;

  node.attackShape.curve = makeSaturationCurve(1 + attack * 18);
  setAudioParam(node.attackFilter.frequency, 1100 + tone * 4200, time, options.smooth);
  setAudioParam(node.attackFilter.Q, 0.65 + attack * 0.8, time, options.smooth);
  setAudioParam(node.attackGain.gain, attack * 0.9, time, options.smooth);
  setAudioParam(node.sustainFilter.frequency, 1200 + tone * 2600, time, options.smooth);
  setAudioParam(node.sustainComp.threshold, -26 + sustain * 10, time, options.smooth);
  setAudioParam(node.sustainComp.knee, 12, time, options.smooth);
  setAudioParam(node.sustainComp.ratio, 1.4 + sustain * 5, time, options.smooth);
  setAudioParam(node.sustainComp.attack, 0.025 + sustain * 0.04, time, options.smooth);
  setAudioParam(node.sustainComp.release, 0.12 + sustain * 0.32, time, options.smooth);
  setAudioParam(node.sustainGain.gain, sustain * 0.62, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.32, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix, time, options.smooth);
}

function applySweetRhythmChopperState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    chopGain: GainNode;
    wetGain: GainNode;
    lfo: OscillatorNode;
    lfoDepth: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const bpm = options.bpm ?? 120;
  const depth = clamp01(readNumber(params.depth, 0.85));
  const accent = clamp01(readNumber(params.accent, 0.35));
  const mix = clamp01(readNumber(params.mix, 1));
  const enabledMix = instance.enabled ? mix : 0;
  const pattern = readString(params.pattern, "upDownMute");
  const rate = readString(params.rate, "1/16");
  const swing = rate === "1/16_swing" ? Math.max(0.08, clamp01(readNumber(params.swing, 0.03))) : clamp01(readNumber(params.swing, 0.03));
  const freq = getChopFrequencyHz(rate, bpm) * (1 - swing * 0.08);
  const patternBias = pattern === "pulse" ? 0.28 : pattern === "machine" ? 0.5 : pattern === "offbeat" ? 0.38 : 0.44;

  node.lfo.type = pattern === "pulse" ? "sine" : "square";
  setAudioParam(node.lfo.frequency, freq, time, options.smooth);
  setAudioParam(node.chopGain.gain, 1 - depth * (0.5 + patternBias * 0.5), time, options.smooth);
  setAudioParam(node.lfoDepth.gain, depth * (0.3 + accent * 0.35), time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix, time, options.smooth);
}

function applySweetGuitarizerState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    highpass: BiquadFilterNode;
    chopGain: GainNode;
    lfo: OscillatorNode;
    lfoDepth: GainNode;
    attackFilter: BiquadFilterNode;
    preGain: GainNode;
    shaper: WaveShaperNode;
    bodyFilter: BiquadFilterNode;
    cabFilter: BiquadFilterNode;
    gate: WaveShaperNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const bpm = options.bpm ?? 120;
  const chopEnabled = readBoolean(params.chopEnabled, true);
  const pickAttack = clamp01(readNumber(params.pickAttack, 0.65));
  const muteTightness = clamp01(readNumber(params.muteTightness, 0.82));
  const ampDrive = clamp01(readNumber(params.ampDrive, 0.18));
  const body = clamp01(readNumber(params.body, 0.42));
  const brightness = clamp01(readNumber(params.brightness, 0.62));
  const noiseGate = clamp01(readNumber(params.noiseGate, 0.35));
  const mix = clamp01(readNumber(params.mix, 0.95));
  const enabledMix = instance.enabled ? mix : 0;
  const cabinet = readString(params.cabinet, "cleanCombo");
  const chopRate = readString(params.chopRate, "1/16");

  node.shaper.curve = makeSaturationCurve(1.4 + ampDrive * 26);
  node.gate.curve = makeGateCurve(noiseGate * 0.08, 0.08 + (1 - muteTightness) * 0.35, 0.28);
  setAudioParam(node.highpass.frequency, 70 + body * 90, time, options.smooth);
  setAudioParam(node.chopGain.gain, chopEnabled ? 1 - muteTightness * 0.62 : 1, time, options.smooth);
  setAudioParam(node.lfo.frequency, getChopFrequencyHz(chopRate, bpm), time, options.smooth);
  setAudioParam(node.lfoDepth.gain, chopEnabled ? muteTightness * 0.42 : 0, time, options.smooth);
  setAudioParam(node.attackFilter.frequency, 950 + pickAttack * 3800, time, options.smooth);
  setAudioParam(node.attackFilter.Q, 0.7 + pickAttack * 1.2, time, options.smooth);
  setAudioParam(node.preGain.gain, 1 + ampDrive * 1.8, time, options.smooth);
  setAudioParam(node.bodyFilter.frequency, 420 + body * 820, time, options.smooth);
  setAudioParam(node.bodyFilter.Q, 0.7 + body * 1.2, time, options.smooth);
  setAudioParam(node.bodyFilter.gain, -2 + body * 7, time, options.smooth);
  configureCabinetFilter(node.cabFilter, cabinet, brightness, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.85, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * (0.8 + pickAttack * 0.22), time, options.smooth);
}

function applySweetVocalFormantState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    highpass: BiquadFilterNode;
    bodyFilter: BiquadFilterNode;
    throatFilter: BiquadFilterNode;
    formantFilter: BiquadFilterNode;
    presenceFilter: BiquadFilterNode;
    airFilter: BiquadFilterNode;
    shaper: WaveShaperNode;
    pitchDelay: DelayNode;
    pitchLayerGain: GainNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const pitchSemi = clamp(readNumber(params.pitchSemi, -4), -7, 4);
  const formantColor = clamp(readNumber(params.formantColor, -0.45), -1, 1);
  const body = clamp01(readNumber(params.body, 0.65));
  const throat = clamp01(readNumber(params.throat, 0.55));
  const air = clamp01(readNumber(params.air, 0.18));
  const presence = clamp01(readNumber(params.presence, 0.35));
  const saturation = clamp01(readNumber(params.saturation, 0.22));
  const guard = clamp01(readNumber(params.artifactGuard, 0.8));
  const mix = clamp01(readNumber(params.mix, 0.82));
  const enabledMix = instance.enabled ? mix : 0;

  node.shaper.curve = makeSaturationCurve(1 + saturation * 14);
  setAudioParam(node.highpass.frequency, 60 + guard * 80, time, options.smooth);
  setAudioParam(node.bodyFilter.frequency, 130 + body * 190, time, options.smooth);
  setAudioParam(node.bodyFilter.gain, body * 6 - air * 1.5, time, options.smooth);
  setAudioParam(node.throatFilter.frequency, 420 + throat * 380 + formantColor * 120, time, options.smooth);
  setAudioParam(node.throatFilter.Q, 0.9 + throat * 2.6, time, options.smooth);
  setAudioParam(node.throatFilter.gain, -1 + throat * 5.8, time, options.smooth);
  setAudioParam(node.formantFilter.frequency, 1050 + formantColor * 430 + presence * 250, time, options.smooth);
  setAudioParam(node.formantFilter.Q, 1.2 + Math.abs(formantColor) * 3.2, time, options.smooth);
  setAudioParam(node.formantFilter.gain, formantColor < 0 ? 3.5 : -1 + formantColor * 3, time, options.smooth);
  setAudioParam(node.presenceFilter.frequency, 2400 + presence * 1700, time, options.smooth);
  setAudioParam(node.presenceFilter.Q, 0.8 + presence * 1.1, time, options.smooth);
  setAudioParam(node.presenceFilter.gain, -1 + presence * 5, time, options.smooth);
  setAudioParam(node.airFilter.frequency, 7800 + air * 4400, time, options.smooth);
  setAudioParam(node.airFilter.gain, -2 + air * 7, time, options.smooth);
  setAudioParam(node.pitchDelay.delayTime, Math.abs(pitchSemi) * 0.0028 + 0.004, time, options.smooth);
  setAudioParam(node.pitchLayerGain.gain, enabledMix * Math.min(0.28, Math.abs(pitchSemi) * 0.035) * (1 - guard * 0.35), time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.7, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.9, time, options.smooth);
}

function applySweetIrSpaceState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    preDelay: DelayNode;
    preFilter: BiquadFilterNode;
    convolver: ConvolverNode;
    bodyFilter: BiquadFilterNode;
    toneFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const irType = readString(params.irType, "smallComboCab");
  const preDelayMs = clamp(readNumber(params.preDelayMs, 0), 0, 40);
  const tone = clamp01(readNumber(params.tone, 0.52));
  const body = clamp01(readNumber(params.body, 0.5));
  const width = clamp01(readNumber(params.width, 0.2));
  const mix = clamp01(readNumber(params.mix, 0.55));
  const enabledMix = instance.enabled ? mix : 0;

  node.convolver.buffer = makeIrImpulse(context, irType, width);
  setAudioParam(node.preDelay.delayTime, preDelayMs / 1000, time, options.smooth);
  setAudioParam(node.preFilter.frequency, irType === "phoneSpeaker" ? 260 : 45 + body * 80, time, options.smooth);
  setAudioParam(node.bodyFilter.frequency, irType === "phoneSpeaker" ? 950 : 240 + body * 580, time, options.smooth);
  setAudioParam(node.bodyFilter.Q, 0.7 + body * 1.4, time, options.smooth);
  setAudioParam(node.bodyFilter.gain, irType === "phoneSpeaker" ? -4 + body * 2 : -2 + body * 6, time, options.smooth);
  setAudioParam(node.toneFilter.frequency, getIrToneFrequency(irType, tone), time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.45, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * (irType === "phoneSpeaker" ? 1.1 : 0.82), time, options.smooth);
}

function applySweetVocoderState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    envelopeFilter: BiquadFilterNode;
    oscillator: OscillatorNode;
    formantFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const carrierHz = clamp(readNumber(params.carrierHz, 110), 40, 880);
  const formant = clamp01(readNumber(params.formant, 0.55));
  const robot = clamp01(readNumber(params.robot, 0.5));
  const mix = clamp01(readNumber(params.mix, 0.32));
  const enabledMix = instance.enabled ? mix : 0;

  setAudioParam(node.oscillator.frequency, carrierHz, time, options.smooth);
  setAudioParam(node.envelopeFilter.frequency, 220 + formant * 1600, time, options.smooth);
  setAudioParam(node.envelopeFilter.Q, 0.7 + robot * 5, time, options.smooth);
  setAudioParam(node.formantFilter.frequency, 520 + formant * 4200, time, options.smooth);
  setAudioParam(node.formantFilter.Q, 1 + robot * 7, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.78, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * (0.45 + robot * 0.7), time, options.smooth);
}

function applySweetPitchAssistState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    delayA: DelayNode;
    delayB: DelayNode;
    gainA: GainNode;
    gainB: GainNode;
    colorFilter: BiquadFilterNode;
    wetGain: GainNode;
    lfo: OscillatorNode;
    lfoDepthA: GainNode;
    lfoDepthB: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const amount = clamp01(readNumber(params.amount, 0.38));
  const color = clamp01(readNumber(params.color, 0.62));
  const mix = clamp01(readNumber(params.mix, 0.28));
  const enabledMix = instance.enabled ? mix : 0;

  setAudioParam(node.delayA.delayTime, 0.012 + amount * 0.012, time, options.smooth);
  setAudioParam(node.delayB.delayTime, 0.018 + amount * 0.018, time, options.smooth);
  setAudioParam(node.gainA.gain, 0.55, time, options.smooth);
  setAudioParam(node.gainB.gain, 0.45, time, options.smooth);
  setAudioParam(node.lfo.frequency, 4 + amount * 9, time, options.smooth);
  setAudioParam(node.lfoDepthA.gain, amount * 0.005, time, options.smooth);
  setAudioParam(node.lfoDepthB.gain, -amount * 0.004, time, options.smooth);
  setAudioParam(node.colorFilter.frequency, 3600 + color * 6200, time, options.smooth);
  setAudioParam(node.colorFilter.gain, -2 + color * 7, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.55, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.82, time, options.smooth);
}

function applySweetGranularState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    delayA: DelayNode;
    delayB: DelayNode;
    feedback: GainNode;
    spreadGain: GainNode;
    textureFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const size = clamp01(readNumber(params.size, 0.36));
  const spray = clamp01(readNumber(params.spray, 0.42));
  const texture = clamp01(readNumber(params.texture, 0.55));
  const mix = clamp01(readNumber(params.mix, 0.24));
  const enabledMix = instance.enabled ? mix : 0;

  setAudioParam(node.delayA.delayTime, 0.035 + size * 0.19, time, options.smooth);
  setAudioParam(node.delayB.delayTime, 0.07 + spray * 0.34, time, options.smooth);
  setAudioParam(node.feedback.gain, instance.enabled ? spray * 0.42 : 0, time, options.smooth);
  setAudioParam(node.spreadGain.gain, 0.55 + texture * 0.4, time, options.smooth);
  setAudioParam(node.textureFilter.frequency, 650 + texture * 6800, time, options.smooth);
  setAudioParam(node.textureFilter.Q, 0.8 + spray * 4.5, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.42, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.8, time, options.smooth);
}

function applySweetParallelCompState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    wetInputGain: GainNode;
    wetHPF: BiquadFilterNode;
    wetCompressor: DynamicsCompressorNode;
    wetLPF: BiquadFilterNode;
    wetTone: BiquadFilterNode;
    wetGain: GainNode;
    outputGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const mix = clamp01(readNumber(params.mix, 0.25));
  const enabledMix = instance.enabled ? mix : 0;
  const crush = clamp(readNumber(params.crush, 45), 0, 100) / 100;
  const attackMs = clamp(readNumber(params.attackMs, 10), 3, 50);
  const releaseMs = clamp(readNumber(params.releaseMs, 120), 40, 300);
  const tone = clamp(readNumber(params.tone, 0), -100, 100);
  const outputDb = clamp(readNumber(params.outputDb, 0), -12, 12);
  const wetHpfHz = clamp(readNumber(params.wetHpfHz, 100), 20, Math.min(500, context.sampleRate / 2 - 1));
  const wetLpfHz = clamp(readNumber(params.wetLpfHz, 12000), 1200, Math.min(20000, context.sampleRate / 2 - 1));
  const autoGain = params.autoGain !== false;

  const dry = enabledMix > 0 ? Math.cos(enabledMix * Math.PI / 2) : 1;
  const wet = enabledMix > 0 ? Math.sin(enabledMix * Math.PI / 2) : 0;
  const threshold = lerp(-12, -42, crush);
  const ratio = lerp(2, 12, crush);
  const knee = lerp(18, 6, crush);
  const wetInput = lerp(1, 2.5, crush);
  const toneNorm = tone / 100;
  const lpfHz = toneNorm < 0 ? lerp(wetLpfHz, Math.min(wetLpfHz, 6000), Math.abs(toneNorm)) : wetLpfHz;
  const toneGainDb = toneNorm > 0 ? toneNorm * 2.5 : toneNorm * 1.2;
  const compensationDb = autoGain ? -enabledMix * (1.1 + crush * 1.4) : 0;

  setAudioParam(node.dryGain.gain, dry, time, options.smooth);
  setAudioParam(node.wetGain.gain, wet, time, options.smooth);
  setAudioParam(node.wetInputGain.gain, wetInput, time, options.smooth);
  setAudioParam(node.wetHPF.frequency, wetHpfHz, time, options.smooth);
  setAudioParam(node.wetLPF.frequency, lpfHz, time, options.smooth);
  setAudioParam(node.wetTone.gain, toneGainDb, time, options.smooth);
  setAudioParam(node.wetCompressor.threshold, threshold, time, options.smooth);
  setAudioParam(node.wetCompressor.ratio, ratio, time, options.smooth);
  setAudioParam(node.wetCompressor.knee, knee, time, options.smooth);
  setAudioParam(node.wetCompressor.attack, attackMs / 1000, time, options.smooth);
  setAudioParam(node.wetCompressor.release, releaseMs / 1000, time, options.smooth);
  setAudioParam(node.outputGain.gain, dbToGain(outputDb + compensationDb), time, options.smooth);
}
function applySweetMultibandState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    lowComp: DynamicsCompressorNode;
    midComp: DynamicsCompressorNode;
    highComp: DynamicsCompressorNode;
    lowGain: GainNode;
    midGain: GainNode;
    highGain: GainNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const low = clamp01(readNumber(params.low, 0.35));
  const mid = clamp01(readNumber(params.mid, 0.3));
  const high = clamp01(readNumber(params.high, 0.28));
  const makeupDb = clamp(readNumber(params.makeupDb, 0), -6, 6);
  const mix = clamp01(readNumber(params.mix, 0.65));
  const enabledMix = instance.enabled ? mix : 0;

  applyBandCompressor(node.lowComp, low, time, options.smooth);
  applyBandCompressor(node.midComp, mid, time, options.smooth);
  applyBandCompressor(node.highComp, high, time, options.smooth);
  setAudioParam(node.lowGain.gain, 0.92 + low * 0.18, time, options.smooth);
  setAudioParam(node.midGain.gain, 0.9 + mid * 0.2, time, options.smooth);
  setAudioParam(node.highGain.gain, 0.88 + high * 0.22, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * dbToGain(makeupDb), time, options.smooth);
}

function applySweetWavetableCarrierState(
  context: BaseAudioContext,
  node: {
    dryGain: GainNode;
    oscillator: OscillatorNode;
    subOscillator: OscillatorNode;
    subGain: GainNode;
    toneFilter: BiquadFilterNode;
    wetGain: GainNode;
  },
  instance: PluginInstance,
  options: AudioParamApplyOptions = {},
) {
  const params = instance.params;
  const time = context.currentTime;
  const wave = readOscillatorType(params.wave);
  const frequency = clamp(readNumber(params.frequency, 110), 30, 2000);
  const sub = clamp01(readNumber(params.sub, 0.2));
  const tone = clamp01(readNumber(params.tone, 0.58));
  const mix = clamp01(readNumber(params.mix, 0.25));
  const enabledMix = instance.enabled ? mix : 0;

  node.oscillator.type = wave;
  node.subOscillator.type = wave === "sine" ? "sine" : "square";
  setAudioParam(node.oscillator.frequency, frequency, time, options.smooth);
  setAudioParam(node.subOscillator.frequency, frequency / 2, time, options.smooth);
  setAudioParam(node.subGain.gain, sub * 0.65, time, options.smooth);
  setAudioParam(node.toneFilter.frequency, 900 + tone * 8500, time, options.smooth);
  setAudioParam(node.dryGain.gain, 1 - enabledMix * 0.68, time, options.smooth);
  setAudioParam(node.wetGain.gain, enabledMix * 0.9, time, options.smooth);
}

function readFilterType(value: unknown): BiquadFilterType {
  return typeof value === "string" && FILTER_TYPES.includes(value as BiquadFilterType)
    ? (value as BiquadFilterType)
    : "lowpass";
}

function readOscillatorType(value: unknown): OscillatorType {
  const types: OscillatorType[] = ["sine", "sawtooth", "square", "triangle"];
  return typeof value === "string" && types.includes(value as OscillatorType) ? (value as OscillatorType) : "sawtooth";
}

function readSweetClipperMode(value: unknown): SoftClipperMode {
  return value === "medium" || value === "hard" || value === "soft" ? value : "soft";
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function makeReverbImpulse(context: BaseAudioContext, durationSec: number, damp: number, width = 0.45) {
  const key = `reverb:${roundForCache(durationSec, 3)}:${roundForCache(damp, 3)}:${roundForCache(width, 3)}`;
  return getCachedImpulse(context, key, () => {
    const sampleRate = context.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const impulse = context.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    const decay = 2 + damp * 6;
    const stereoWidth = clamp01(width);

    for (let index = 0; index < length; index += 1) {
      const t = index / length;
      const envelope = (1 - t) ** decay;
      const monoNoise = pseudoNoise(index);
      const sideNoise = pseudoNoise(index + 7919);
      left[index] = finiteSample(monoNoise * envelope);
      right[index] = finiteSample((monoNoise * (1 - stereoWidth) + sideNoise * stereoWidth) * envelope);
    }

    return impulse;
  });
}

function makeIrImpulse(context: BaseAudioContext, irType: string, width: number) {
  const key = `ir:${irType}:${roundForCache(width, 3)}`;
  return getCachedImpulse(context, key, () => {
    const sampleRate = context.sampleRate;
    const durationSec = irType === "darkPlate" ? 1.4 : irType === "smallRoom" ? 0.55 : irType === "phoneSpeaker" ? 0.08 : 0.18;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const impulse = context.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    const decay = irType === "darkPlate" ? 3.2 : irType === "smallRoom" ? 6 : 10;
    const toneSkew = irType === "phoneSpeaker" ? 0.38 : irType === "smallComboCab" ? 0.62 : 0.82;

    for (let index = 0; index < length; index += 1) {
      const t = index / length;
      const envelope = (1 - t) ** decay;
      const early = index < sampleRate * 0.012 ? 1 : 0.35;
      const valueL = pseudoNoise(index) * envelope * early * toneSkew;
      const valueR = pseudoNoise(index + 1777) * envelope * early * (toneSkew + width * 0.18);
      left[index] = finiteSample(valueL);
      right[index] = finiteSample(width > 0 ? valueR : valueL);
    }

    return impulse;
  });
}

function getChopFrequencyHz(rate: string, bpm: number) {
  const beatsPerSec = Math.max(30, Math.min(260, bpm)) / 60;
  if (rate === "1/4") return beatsPerSec;
  if (rate === "1/8") return beatsPerSec * 2;
  if (rate === "1/32") return beatsPerSec * 8;
  if (rate === "triplet") return beatsPerSec * 3;
  return beatsPerSec * 4;
}

function configureCabinetFilter(filter: BiquadFilterNode, cabinet: string, brightness: number, time: number, smooth = false) {
  const base =
    cabinet === "phoneSpeaker"
      ? 2200
      : cabinet === "cleanCombo"
        ? 5200
        : cabinet === "smallCombo"
          ? 3600
          : 3100;
  setAudioParam(filter.frequency, base + brightness * 2200, time, smooth);
  setAudioParam(filter.Q, cabinet === "phoneSpeaker" ? 1.6 : 0.9, time, smooth);
}

function getIrToneFrequency(irType: string, tone: number) {
  if (irType === "phoneSpeaker") return 1600 + tone * 1200;
  if (irType === "darkPlate") return 3200 + tone * 5200;
  if (irType === "smallRoom") return 3600 + tone * 6500;
  return 2200 + tone * 4200;
}

function makeSaturationCurve(drive: number) {
  const samples = 512;
  const shapedDrive = Math.max(1, drive);
  return getCachedWaveShaperCurve(`sat:${roundForCache(shapedDrive, 3)}`, samples, (safeSamples) => {
    const curve = new Float32Array(safeSamples);
    for (let index = 0; index < safeSamples; index += 1) {
      const x = (index * 2) / (safeSamples - 1) - 1;
      curve[index] = finiteSample(Math.tanh(x * shapedDrive) / Math.tanh(shapedDrive));
    }
    return curve;
  });
}

function makeEnvelopeFollowerCurve() {
  const samples = 1024;
  return getCachedWaveShaperCurve("envFollower:v1", samples, (safeSamples) => {
    const curve = new Float32Array(safeSamples);
    const deadband = 0.012;
    for (let index = 0; index < safeSamples; index += 1) {
      const x = (index * 2) / (safeSamples - 1) - 1;
      const opened = Math.max(0, Math.abs(x) - deadband) / (1 - deadband);
      curve[index] = opened <= 0 ? 0 : finiteSample(Math.sqrt(opened));
    }
    return curve;
  });
}

function makeAirBedNoiseBuffer(context: BaseAudioContext) {
  return getCachedImpulse(context, "airBedNoise:v1", () => {
    const sampleRate = context.sampleRate;
    const length = Math.max(2048, Math.floor(sampleRate * 0.75));
    const buffer = context.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let index = 0; index < length; index += 1) {
      const fade = Math.sin(Math.PI * index / Math.max(1, length - 1));
      left[index] = finiteSample(pseudoNoise(index + 17011) * 0.42 * fade);
      right[index] = finiteSample(pseudoNoise(index + 91009) * 0.42 * fade);
    }
    return buffer;
  });
}

function makeAirExciterCurve(amount: number, tone: number) {
  const samples = 2048;
  const shapedAmount = clamp01(amount);
  const shapedTone = clamp01(tone);
  const drive = 1.6 + shapedAmount * 7.5 + shapedTone * 1.2;
  const evenAmount = shapedAmount * (0.12 + shapedTone * 0.16);
  const denom = Math.tanh(drive);
  return getCachedWaveShaperCurve(`air:${roundForCache(shapedAmount, 3)}:${roundForCache(shapedTone, 3)}`, samples, (safeSamples) => {
    const curve = new Float32Array(safeSamples);
    for (let index = 0; index < safeSamples; index += 1) {
      const x = (index * 2) / (safeSamples - 1) - 1;
      const saturated = Math.tanh(x * drive) / denom;
      const even = (x * x - 0.34) * evenAmount;
      curve[index] = finiteSample(clamp(saturated + even, -0.92, 0.92));
    }
    return curve;
  });
}
function makeGateCurve(threshold: number, floor: number, softness: number) {
  const samples = 1024;
  const floorGain = clamp01(floor) * 0.5;
  const knee = 0.003 + clamp01(softness) * 0.08;
  return getCachedWaveShaperCurve(`gate:${roundForCache(threshold, 4)}:${roundForCache(floorGain, 4)}:${roundForCache(knee, 4)}`, samples, (safeSamples) => {
    const curve = new Float32Array(safeSamples);
    for (let index = 0; index < safeSamples; index += 1) {
      const x = (index * 2) / (safeSamples - 1) - 1;
      const level = Math.abs(x);
      const openness = clamp01((level - threshold + knee) / (knee * 2));
      const gain = floorGain + (1 - floorGain) * openness * openness * (3 - 2 * openness);
      curve[index] = finiteSample(x * gain);
    }
    return curve;
  });
}

function setAudioParam(param: AudioParam, value: number, time: number, smooth = false) {
  safeSetAudioParam(param, value, time, { smooth });
}

function applyBandCompressor(compressor: DynamicsCompressorNode, amount: number, time: number, smooth = false) {
  setAudioParam(compressor.threshold, -12 - amount * 30, time, smooth);
  setAudioParam(compressor.knee, 10, time, smooth);
  setAudioParam(compressor.ratio, 1.4 + amount * 6, time, smooth);
  setAudioParam(compressor.attack, 0.006 + amount * 0.018, time, smooth);
  setAudioParam(compressor.release, 0.08 + amount * 0.26, time, smooth);
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function pseudoNoise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * clamp01(amount);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
