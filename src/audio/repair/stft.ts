import { clamp, sanitizeFloat32 } from "./dspMath";

export type StftOptions = {
  sampleRate: number;
  fftSize: 1024 | 2048 | 4096;
  hopSize: number;
  windowType: "hann";
};

export type StftFrame = {
  timeSec: number;
  real: Float32Array;
  imag: Float32Array;
  magnitude: Float32Array;
};

export function createDefaultStftOptions(sampleRate: number, fftSize: 1024 | 2048 | 4096 = 2048): StftOptions {
  return { sampleRate, fftSize, hopSize: Math.max(1, Math.floor(fftSize / 4)), windowType: "hann" };
}

export function stftMono(input: Float32Array, options: StftOptions): StftFrame[] {
  const fftSize = options.fftSize;
  const hopSize = Math.max(1, Math.floor(options.hopSize));
  const window = hannWindow(fftSize);
  const frameCount = input.length <= fftSize ? 1 : Math.ceil((input.length - fftSize) / hopSize) + 1;
  const frames: StftFrame[] = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = frameIndex * hopSize;
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      real[index] = sanitizeFloat32((input[offset + index] ?? 0) * window[index]);
    }
    fft(real, imag, false);
    const magnitude = new Float32Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      magnitude[index] = Math.hypot(real[index] ?? 0, imag[index] ?? 0);
    }
    frames.push({ timeSec: offset / Math.max(1, options.sampleRate), real, imag, magnitude });
  }
  return frames;
}

export function istftMono(frames: StftFrame[], options: StftOptions, outputLength: number): Float32Array {
  const fftSize = options.fftSize;
  const hopSize = Math.max(1, Math.floor(options.hopSize));
  const window = hannWindow(fftSize);
  const output = new Float32Array(Math.max(1, outputLength));
  const norm = new Float32Array(output.length);

  frames.forEach((frame, frameIndex) => {
    const real = new Float32Array(frame.real);
    const imag = new Float32Array(frame.imag);
    fft(real, imag, true);
    const offset = frameIndex * hopSize;
    for (let index = 0; index < fftSize; index += 1) {
      const target = offset + index;
      if (target >= output.length) break;
      const w = window[index] ?? 0;
      output[target] += sanitizeFloat32((real[index] ?? 0) * w);
      norm[target] += w * w;
    }
  });

  for (let index = 0; index < output.length; index += 1) {
    const divisor = norm[index] ?? 0;
    output[index] = sanitizeFloat32(divisor > 1e-8 ? output[index] / divisor : output[index]);
  }
  return output;
}

export function binToFrequency(bin: number, sampleRate: number, fftSize: number): number {
  return (bin * sampleRate) / Math.max(1, fftSize);
}

export function frequencyToBin(frequency: number, sampleRate: number, fftSize: number): number {
  return clamp(Math.round((frequency / Math.max(1, sampleRate)) * fftSize), 0, Math.floor(fftSize / 2));
}

function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(1, size - 1)));
  }
  return window;
}

function fft(real: Float32Array, imag: Float32Array, inverse: boolean) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i] ?? 0;
      const ti = imag[i] ?? 0;
      real[i] = real[j] ?? 0;
      imag[i] = imag[j] ?? 0;
      real[j] = tr;
      imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wLenR = Math.cos(angle);
    const wLenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wR = 1;
      let wI = 0;
      for (let j = 0; j < len / 2; j += 1) {
        const evenR = real[i + j] ?? 0;
        const evenI = imag[i + j] ?? 0;
        const oddR = real[i + j + len / 2] ?? 0;
        const oddI = imag[i + j + len / 2] ?? 0;
        const uR = evenR;
        const uI = evenI;
        const vR = oddR * wR - oddI * wI;
        const vI = oddR * wI + oddI * wR;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR;
        imag[i + j + len / 2] = uI - vI;
        const nextWR = wR * wLenR - wI * wLenI;
        wI = wR * wLenI + wI * wLenR;
        wR = nextWR;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < n; index += 1) {
      real[index] = sanitizeFloat32((real[index] ?? 0) / n);
      imag[index] = sanitizeFloat32((imag[index] ?? 0) / n);
    }
  }
}
