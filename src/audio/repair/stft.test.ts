import { describe, expect, it } from "vitest";
import { rmsOfChannel } from "./dspMath";
import { createDefaultStftOptions, istftMono, stftMono } from "./stft";

describe("repair stft", () => {
  it("uses one frame for input shorter than or equal to fftSize", () => {
    const sampleRate = 48000;
    const options = createDefaultStftOptions(sampleRate, 1024);

    expect(stftMono(new Float32Array(512), options)).toHaveLength(1);
    expect(stftMono(new Float32Array(1024), options)).toHaveLength(1);
  });

  it("reconstructs a basic sine without large RMS damage", () => {
    const sampleRate = 48000;
    const input = sine(440, sampleRate, 4096, 0.4);
    const options = createDefaultStftOptions(sampleRate, 1024);
    const frames = stftMono(input, options);
    const output = istftMono(frames, options, input.length);
    const error = new Float32Array(input.length);
    for (let index = 0; index < input.length; index += 1) error[index] = (input[index] ?? 0) - (output[index] ?? 0);
    expect(rmsOfChannel(error)).toBeLessThan(0.035);
  });
});

function sine(freq: number, sampleRate: number, length: number, gain: number) {
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) out[index] = Math.sin((2 * Math.PI * freq * index) / sampleRate) * gain;
  return out;
}
