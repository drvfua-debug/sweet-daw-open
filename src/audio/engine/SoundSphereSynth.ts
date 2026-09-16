import type { SourceId } from "@/types/soundSphere";

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioContextCtor();
  }
  return sharedAudioCtx;
}

// Generate procedurally synthesized white noise buffer
let noiseBufferCache: AudioBuffer | null = null;
function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBufferCache) return noiseBufferCache;
  const bufferSize = ctx.sampleRate * 2; // 2 seconds of noise
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBufferCache = buffer;
  return buffer;
}

export class SoundSphereSynth {
  static playNote(
    frequency: number,
    durationSec: number,
    weights: Record<SourceId, number>,
    velocity = 80,
    mode: "chord" | "pluck" | "pad" | "bass" | "fx" | "texture" = "chord"
  ) {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    const gainFactor = velocity / 127;
    const mainGain = ctx.createGain();
    mainGain.gain.setValueAtTime(0, now);
    
    // Apply envelope based on mode
    let attack = 0.05;
    let decay = 0.15;
    let sustain = 0.5;
    let release = 0.3;

    if (mode === "pluck") {
      attack = 0.005;
      decay = 0.15;
      sustain = 0.01;
      release = 0.1;
    } else if (mode === "pad" || mode === "texture") {
      attack = 0.6;
      decay = 1.0;
      sustain = 0.8;
      release = 0.8;
    } else if (mode === "bass") {
      attack = 0.04;
      decay = 0.2;
      sustain = 0.7;
      release = 0.25;
    } else if (mode === "fx") {
      attack = 0.15;
      decay = 0.8;
      sustain = 0.1;
      release = 0.6;
    }

    mainGain.gain.linearRampToValueAtTime(0.15 * gainFactor, now + attack);
    mainGain.gain.setValueAtTime(0.15 * gainFactor, now + attack);
    mainGain.gain.setTargetAtTime(0.15 * gainFactor * sustain, now + attack, decay);
    
    const stopTime = now + durationSec;
    mainGain.gain.setValueAtTime(0.15 * gainFactor * sustain, stopTime);
    mainGain.gain.exponentialRampToValueAtTime(0.001, stopTime + release);

    mainGain.connect(ctx.destination);

    // Filter/limiting node to keep output clean and warm
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    // Adjust cutoff based on Mode
    filter.frequency.setValueAtTime(mode === "bass" ? 450 : mode === "pad" ? 1800 : 8000, now);
    filter.connect(mainGain);

    // Play 9 channels scaled by weights
    Object.keys(weights).forEach((sourceKey) => {
      const id = sourceKey as SourceId;
      const weight = weights[id] ?? 0;
      if (weight <= 0.01) return;

      const sourceGain = ctx.createGain();
      sourceGain.gain.setValueAtTime(weight, now);
      sourceGain.connect(filter);

      // Synthesize specific channels
      switch (id) {
        case "glass": {
          // Pure sine chime + high bell partials
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          osc1.type = "sine";
          osc2.type = "sine";
          osc1.frequency.setValueAtTime(frequency, now);
          osc2.frequency.setValueAtTime(frequency * 3.14, now); // Bell partial
          
          const g1 = ctx.createGain();
          const g2 = ctx.createGain();
          g1.gain.setValueAtTime(0.6, now);
          g2.gain.setValueAtTime(0.3, now);
          // Bell pluck decay
          g2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

          osc1.connect(g1);
          osc2.connect(g2);
          g1.connect(sourceGain);
          g2.connect(sourceGain);
          
          osc1.start(now);
          osc2.start(now);
          osc1.stop(stopTime + release + 0.1);
          osc2.stop(now + 0.15);
          break;
        }

        case "metal": {
          // Metallic ring: detuned high frequencies
          const freqs = [1, 1.414, 2.718, 4.08];
          freqs.forEach((mult, idx) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(frequency * mult, now);
            g.gain.setValueAtTime(0.25 / freqs.length, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.15 + idx * 0.05);

            osc.connect(g);
            g.connect(sourceGain);
            osc.start(now);
            osc.stop(now + 0.4);
          });
          break;
        }

        case "string": {
          // comb-filtered detuned sawtooth oscillators
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          osc1.type = "sawtooth";
          osc2.type = "sine";
          
          osc1.frequency.setValueAtTime(frequency + 1.5, now);
          osc2.frequency.setValueAtTime(frequency, now);
          
          const g1 = ctx.createGain();
          g1.gain.setValueAtTime(0.2, now);
          osc1.connect(g1);
          osc2.connect(sourceGain);
          g1.connect(sourceGain);
          
          osc1.start(now);
          osc2.start(now);
          osc1.stop(stopTime + release + 0.1);
          osc2.stop(stopTime + release + 0.1);
          break;
        }

        case "electric": {
          // Sawtooth buzz + resonant sweep
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(frequency, now);
          
          const synthFilter = ctx.createBiquadFilter();
          synthFilter.type = "lowpass";
          synthFilter.Q.setValueAtTime(5, now);
          synthFilter.frequency.setValueAtTime(frequency * 2, now);
          synthFilter.frequency.exponentialRampToValueAtTime(frequency * 5, now + 0.15);
          
          osc.connect(synthFilter);
          synthFilter.connect(sourceGain);
          
          osc.start(now);
          osc.stop(stopTime + release + 0.1);
          break;
        }

        case "stone": {
          // Soft percussive low frequency body
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(frequency * 0.5, now); // Octave down
          
          const dG = ctx.createGain();
          dG.gain.setValueAtTime(0.8, now);
          dG.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
          osc.connect(dG);
          dG.connect(sourceGain);
          
          osc.start(now);
          osc.stop(stopTime + release + 0.1);
          break;
        }

        case "air": {
          // Soft bandpass noise
          const noise = ctx.createBufferSource();
          noise.buffer = getNoiseBuffer(ctx);
          noise.loop = true;
          
          const bp = ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.setValueAtTime(frequency * 1.5, now);
          bp.Q.setValueAtTime(1.5, now);
          
          noise.connect(bp);
          bp.connect(sourceGain);
          
          noise.start(now);
          noise.stop(stopTime + release + 0.1);
          break;
        }

        case "fire": {
          // Sparks & crackle noise trigger
          const noise = ctx.createBufferSource();
          noise.buffer = getNoiseBuffer(ctx);
          noise.loop = true;
          
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass";
          hp.frequency.setValueAtTime(2500, now);
          
          const mod = ctx.createGain();
          mod.gain.setValueAtTime(0.4, now);
          // Modulate volume rapidly to create crackling sparks
          let sparkTime = now;
          while (sparkTime < stopTime + release) {
            mod.gain.setValueAtTime(Math.random() * 0.5 + 0.1, sparkTime);
            sparkTime += 0.03 + Math.random() * 0.05;
          }

          noise.connect(hp);
          hp.connect(mod);
          mod.connect(sourceGain);
          
          noise.start(now);
          noise.stop(stopTime + release + 0.1);
          break;
        }

        case "water": {
          // Smooth sweeping resonant lowpass fluid noise
          const noise = ctx.createBufferSource();
          noise.buffer = getNoiseBuffer(ctx);
          noise.loop = true;
          
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.Q.setValueAtTime(8, now);
          lp.frequency.setValueAtTime(600, now);
          lp.frequency.linearRampToValueAtTime(1400, now + durationSec * 0.5);
          lp.frequency.linearRampToValueAtTime(500, now + durationSec + release);
          
          noise.connect(lp);
          lp.connect(sourceGain);
          
          noise.start(now);
          noise.stop(stopTime + release + 0.1);
          break;
        }

        case "wood": {
          // Woodblock mallet short high-Q filter sweep
          const osc = ctx.createOscillator();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(frequency * 2.2, now);
          
          const wG = ctx.createGain();
          wG.gain.setValueAtTime(0.8, now);
          wG.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          
          osc.connect(wG);
          wG.connect(sourceGain);
          
          osc.start(now);
          osc.stop(now + 0.15);
          break;
        }
      }
    });
  }

  static playChord(
    root: string,
    quality: string,
    durationSec: number,
    weights: Record<SourceId, number>,
    velocity = 80,
    mode: any = "chord"
  ) {
    const semitoneMap: Record<string, number> = {
      C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11
    };

    const rootIdx = semitoneMap[root] ?? 0;
    // Base MIDI note for A3 = 57, C4 = 60
    const rootMidi = 60 + rootIdx;

    let intervals = [0, 4, 7]; // Major triad default
    if (quality === "Min") intervals = [0, 3, 7];
    else if (quality === "7") intervals = [0, 4, 7, 10];
    else if (quality === "maj7") intervals = [0, 4, 7, 11];
    else if (quality === "min7") intervals = [0, 3, 7, 10];
    else if (quality === "dim") intervals = [0, 3, 6];
    else if (quality === "aug") intervals = [0, 4, 8];

    // Trigger all notes in the chord voicing
    intervals.forEach((interval) => {
      const midi = rootMidi + interval;
      // Convert MIDI pitch to Hz frequency
      const freq = Math.pow(2, (midi - 69) / 12) * 440;
      SoundSphereSynth.playNote(freq, durationSec, weights, velocity, mode);
    });
  }
}
