"use client";

export type MeterReading = {
  rms: number;
  peak: number;
  clipping: boolean;
};

export type SpectrumReading = {
  sampleRate: number;
  fftSize: number;
  minDb: number;
  maxDb: number;
  magnitudes: Float32Array;
};

export type WaveformReading = {
  sampleRate: number;
  fftSize: number;
  samples: Float32Array;
};

const FFT_SIZE = 256;
const SPECTRUM_FFT_SIZE = 2048;
const CLIPPING_THRESHOLD_DB = -0.5;
const FLOOR_DB = -60;

export class MeterBridge {
  private analysers = new Map<string, AnalyserNode>();
  private dataArrays = new Map<string, Float32Array<ArrayBuffer>>();
  private spectrumArrays = new Map<string, Float32Array<ArrayBuffer>>();
  private waveformArrays = new Map<string, Float32Array<ArrayBuffer>>();
  private context: BaseAudioContext | null = null;

  attach(context: BaseAudioContext) {
    this.context = context;
  }

  createAnalyser(id: string): AnalyserNode | null {
    if (!this.context) return null;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    this.analysers.set(id, analyser);
    this.dataArrays.set(id, new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT)));
    return analyser;
  }

  createSpectrumAnalyser(id: string): AnalyserNode | null {
    if (!this.context) return null;
    const analyser = this.context.createAnalyser();
    analyser.fftSize = SPECTRUM_FFT_SIZE;
    analyser.minDecibels = -96;
    analyser.maxDecibels = -18;
    analyser.smoothingTimeConstant = 0.74;
    this.analysers.set(id, analyser);
    this.spectrumArrays.set(
      id,
      new Float32Array(new ArrayBuffer(analyser.frequencyBinCount * Float32Array.BYTES_PER_ELEMENT)),
    );
    this.waveformArrays.set(
      id,
      new Float32Array(new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT)),
    );
    return analyser;
  }

  read(id: string): MeterReading {
    const analyser = this.analysers.get(id);
    const dataArray = this.dataArrays.get(id);
    if (!analyser || !dataArray) {
      return { rms: FLOOR_DB, peak: FLOOR_DB, clipping: false };
    }

    analyser.getFloatTimeDomainData(dataArray);

    let sumSq = 0;
    let peakAbs = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const sample = dataArray[i]!;
      sumSq += sample * sample;
      const abs = Math.abs(sample);
      if (abs > peakAbs) peakAbs = abs;
    }

    const rmsLinear = Math.sqrt(sumSq / dataArray.length);
    const rmsDb = rmsLinear > 0 ? 20 * Math.log10(rmsLinear) : FLOOR_DB;
    const peakDb = peakAbs > 0 ? 20 * Math.log10(peakAbs) : FLOOR_DB;

    return {
      rms: Math.max(FLOOR_DB, rmsDb),
      peak: Math.max(FLOOR_DB, peakDb),
      clipping: peakDb >= CLIPPING_THRESHOLD_DB,
    };
  }

  getAnalyser(id: string): AnalyserNode | null {
    return this.analysers.get(id) ?? null;
  }

  readSpectrum(id: string): SpectrumReading | null {
    const analyser = this.analysers.get(id);
    const dataArray = this.spectrumArrays.get(id);
    if (!analyser || !dataArray || !this.context) return null;

    analyser.getFloatFrequencyData(dataArray);
    return {
      sampleRate: this.context.sampleRate,
      fftSize: analyser.fftSize,
      minDb: analyser.minDecibels,
      maxDb: analyser.maxDecibels,
      magnitudes: dataArray,
    };
  }

  readWaveform(id: string): WaveformReading | null {
    const analyser = this.analysers.get(id);
    const dataArray = this.waveformArrays.get(id);
    if (!analyser || !dataArray || !this.context) return null;

    analyser.getFloatTimeDomainData(dataArray);
    return {
      sampleRate: this.context.sampleRate,
      fftSize: analyser.fftSize,
      samples: dataArray,
    };
  }

  remove(id: string) {
    const analyser = this.analysers.get(id);
    if (analyser) {
      try { analyser.disconnect(); } catch { /* already disconnected */ }
    }
    this.analysers.delete(id);
    this.dataArrays.delete(id);
    this.spectrumArrays.delete(id);
    this.waveformArrays.delete(id);
  }

  clear() {
    for (const [id] of this.analysers) {
      this.remove(id);
    }
  }
}

export const meterBridge = new MeterBridge();
