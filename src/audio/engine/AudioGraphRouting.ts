export type AudioNodePair = {
  input: AudioNode;
  output: AudioNode;
};

export type PostInsertPathInput = {
  insertOutput: AudioNode;
  vocalDuck: AudioNodePair | null;
  vocalImageLayer: AudioNodePair | null;
  pan: StereoPannerNode | null;
  gain: GainNode;
};

export function connectPostInsertPath(input: PostInsertPathInput) {
  let source = input.insertOutput;

  if (input.vocalDuck) {
    source.connect(input.vocalDuck.input);
    source = input.vocalDuck.output;
  }

  if (input.vocalImageLayer) {
    source.connect(input.vocalImageLayer.input);
    source = input.vocalImageLayer.output;
  }

  if (input.pan) {
    source.connect(input.pan);
    input.pan.connect(input.gain);
  } else {
    source.connect(input.gain);
  }
}
