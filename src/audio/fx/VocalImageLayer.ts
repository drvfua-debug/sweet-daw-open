import type { MasterState, Track, VocalImageDistance, VocalImageTrackState } from "@/daw/model/Project";

export type VocalImageLayerNodes = {
  input: GainNode;
  output: GainNode;
  signature: string;
  apply: (state: VocalImageTrackState, options?: { smooth?: boolean }) => void;
  dispose: () => void;
};

type VocalImageConfig = {
  amount: number;
  sideGain: number;
  leftDelaySec: number;
  rightDelaySec: number;
  leftPan: number;
  rightPan: number;
  highpassHz: number;
  lowpassHz: number;
  signature: string;
};

export function isVocalImageLayerActive(master: MasterState, track: Track) {
  return Boolean(master.vocalImageLayer.enabled && track.vocalImage.enabled && track.vocalImage.amount > 0);
}

export function getVocalImageLayerSignature(master: MasterState, track: Track) {
  if (!isVocalImageLayerActive(master, track)) return "vocal-image:off";
  return "vocal-image:on";
}

export function createVocalImageLayer(context: BaseAudioContext, state: VocalImageTrackState): VocalImageLayerNodes {
  const input = context.createGain();
  const output = context.createGain();
  const highpass = context.createBiquadFilter();
  const lowpass = context.createBiquadFilter();
  const leftDelay = context.createDelay(0.08);
  const rightDelay = context.createDelay(0.08);
  const leftGain = context.createGain();
  const rightGain = context.createGain();
  const leftPan = "createStereoPanner" in context ? context.createStereoPanner() : null;
  const rightPan = "createStereoPanner" in context ? context.createStereoPanner() : null;
  let signature = "";

  highpass.type = "highpass";
  highpass.Q.value = 0.7;
  lowpass.type = "lowpass";
  lowpass.Q.value = 0.7;

  const apply = (nextState: VocalImageTrackState, options: { smooth?: boolean } = {}) => {
    const config = getVocalImageConfig(nextState);
    signature = config.signature;
    setParam(context, highpass.frequency, config.highpassHz, Boolean(options.smooth));
    setParam(context, lowpass.frequency, config.lowpassHz, Boolean(options.smooth));
    setParam(context, leftDelay.delayTime, config.leftDelaySec, Boolean(options.smooth));
    setParam(context, rightDelay.delayTime, config.rightDelaySec, Boolean(options.smooth));
    setParam(context, leftGain.gain, config.sideGain, Boolean(options.smooth));
    setParam(context, rightGain.gain, config.sideGain, Boolean(options.smooth));
    if (leftPan) setParam(context, leftPan.pan, config.leftPan, Boolean(options.smooth));
    if (rightPan) setParam(context, rightPan.pan, config.rightPan, Boolean(options.smooth));
  };

  apply(state);

  input.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(leftDelay);
  lowpass.connect(rightDelay);
  leftDelay.connect(leftGain);
  rightDelay.connect(rightGain);

  if (leftPan && rightPan) {
    leftGain.connect(leftPan);
    rightGain.connect(rightPan);
    leftPan.connect(output);
    rightPan.connect(output);
  } else {
    leftGain.connect(output);
    rightGain.connect(output);
  }

  return {
    input,
    output,
    get signature() {
      return signature;
    },
    apply,
    dispose: () => {
      input.disconnect();
      highpass.disconnect();
      lowpass.disconnect();
      leftDelay.disconnect();
      rightDelay.disconnect();
      leftGain.disconnect();
      rightGain.disconnect();
      leftPan?.disconnect();
      rightPan?.disconnect();
      output.disconnect();
    },
  };
}

function getVocalImageConfig(state: VocalImageTrackState): VocalImageConfig {
  const amount = clamp(state.amount, 0, 100);
  const distance = state.distance;
  const profile = getDistanceProfile(distance, state.monoSafety);
  const supportLevelDb = -18 + (amount - 20) * 0.08;
  const earlySideTrimDb = -1.5;
  const monoSafetyTrimDb = state.monoSafety ? -1.0 : 0;
  const sideGain = amount <= 0 ? 0 : dbToGain(supportLevelDb + earlySideTrimDb + profile.levelTrimDb + monoSafetyTrimDb);

  return {
    amount,
    sideGain,
    leftDelaySec: profile.leftDelayMs / 1000,
    rightDelaySec: profile.rightDelayMs / 1000,
    leftPan: -profile.pan,
    rightPan: profile.pan,
    highpassHz: profile.highpassHz,
    lowpassHz: profile.lowpassHz,
    signature: [
      "vocal-image:on",
      amount.toFixed(0),
      distance,
      state.monoSafety ? 1 : 0,
      profile.leftDelayMs,
      profile.rightDelayMs,
      profile.pan.toFixed(2),
      profile.highpassHz,
      profile.lowpassHz,
    ].join(":"),
  };
}

function getDistanceProfile(distance: VocalImageDistance, monoSafety: boolean) {
  if (distance === "close") {
    return {
      leftDelayMs: 8,
      rightDelayMs: 16,
      pan: monoSafety ? 0.55 : 0.62,
      highpassHz: 200,
      lowpassHz: 6500,
      levelTrimDb: -2,
    };
  }

  if (distance === "wide") {
    return {
      leftDelayMs: 16,
      rightDelayMs: 28,
      pan: monoSafety ? 0.78 : 0.9,
      highpassHz: 220,
      lowpassHz: 7600,
      levelTrimDb: -0.5,
    };
  }

  return {
    leftDelayMs: 12,
    rightDelayMs: 24,
    pan: monoSafety ? 0.75 : 0.8,
    highpassHz: 180,
    lowpassHz: 8000,
    levelTrimDb: 0,
  };
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function setParam(context: BaseAudioContext, param: AudioParam, value: number, smooth: boolean) {
  const now = context.currentTime;
  if (!smooth) {
    param.value = value;
    return;
  }

  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, 0.015);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
