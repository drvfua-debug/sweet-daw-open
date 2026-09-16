"use client";

import { Power, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { getPluginDescriptor } from "@/audio/plugins/pluginRegistry";
import type { PluginInstance, PluginParams } from "@/daw/model/Plugin";

type PluginEditorSheetProps = {
  plugin: PluginInstance;
  onChange: (paramsPatch: PluginParams) => void;
  onToggle: () => void;
  onClose: () => void;
};

const FILTER_TYPES = ["lowpass", "highpass", "bandpass", "notch", "lowshelf", "highshelf"] as const;
const WAVE_TYPES = ["sine", "sawtooth", "square", "triangle"] as const;
const CHOP_RATES = ["1/4", "1/8", "1/16", "1/16_swing", "1/32", "triplet"] as const;
const CHOP_PATTERNS = ["upDownMute", "offbeat", "machine", "pulse"] as const;
const GUITAR_MODES = ["cutting", "lofi_amp"] as const;
const CABINET_TYPES = ["cleanCombo", "smallCombo", "phoneSpeaker", "smallComboCab", "smallRoom", "darkPlate"] as const;
const PEAK_MAX_MODES = ["clean", "punch", "loud", "streaming", "dense"] as const;
const PEAK_MAX_OVERSAMPLE = ["off", "2x", "4x"] as const;
const REVERB_MODES = ["air", "room", "tail"] as const;

type ParamField =
  | {
      kind: "slider";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      fallback: number;
      format: (value: number) => string;
    }
  | {
      kind: "select";
      key: string;
      label: string;
      fallback: string;
      options: readonly string[];
    }
  | {
      kind: "toggle";
      key: string;
      label: string;
      fallback: boolean;
    };

const GENERIC_PARAM_FIELDS: Partial<Record<PluginInstance["pluginId"], ParamField[]>> = {
  "sweet-aimix-glow": [
    { kind: "slider", key: "amount", label: "Amount", min: 0, max: 100, step: 1, fallback: 42, format: (value) => `${Math.round(value)}` },
    { kind: "slider", key: "recover", label: "Recover", min: 0, max: 100, step: 1, fallback: 34, format: (value) => `${Math.round(value)}` },
    { kind: "slider", key: "gloss", label: "Gloss", min: 0, max: 100, step: 1, fallback: 22, format: (value) => `${Math.round(value)}` },
    { kind: "slider", key: "air", label: "Air", min: 0, max: 100, step: 1, fallback: 18, format: (value) => `${Math.round(value)}` },
    { kind: "slider", key: "tame", label: "Tame", min: 0, max: 100, step: 1, fallback: 55, format: (value) => `${Math.round(value)}` },
    percentField("mix", "Mix", 0.42),
    { kind: "slider", key: "outputDb", label: "Output", min: -6, max: 3, step: 0.1, fallback: -0.3, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB` },
  ],
  "sweet-peak-maximizer": [
    { kind: "select", key: "mode", label: "Mode", fallback: "clean", options: PEAK_MAX_MODES },
    { kind: "slider", key: "inputDriveDb", label: "Drive", min: -3, max: 9, step: 0.1, fallback: 2, format: formatSignedDb },
    { kind: "slider", key: "ceilingDb", label: "Ceiling", min: -3, max: -0.3, step: 0.1, fallback: -1, format: formatSignedDb },
    { kind: "slider", key: "lookaheadMs", label: "Lookahead", min: 0.5, max: 5, step: 0.1, fallback: 2, format: formatMs },
    { kind: "slider", key: "releaseMs", label: "Release", min: 30, max: 300, step: 1, fallback: 90, format: formatMs },
    { kind: "slider", key: "transientProtect", label: "Transient", min: 0, max: 1, step: 0.01, fallback: 0.65, format: formatPercent },
    { kind: "slider", key: "stereoLink", label: "Stereo Link", min: 0, max: 1, step: 0.01, fallback: 1, format: formatPercent },
    { kind: "slider", key: "softClipGuard", label: "Clip Guard", min: 0, max: 0.5, step: 0.01, fallback: 0.18, format: formatPercent },
    { kind: "toggle", key: "truePeakGuard", label: "True Peak Guard", fallback: true },
    { kind: "select", key: "oversample", label: "Oversample", fallback: "4x", options: PEAK_MAX_OVERSAMPLE },
    { kind: "toggle", key: "autoDrive", label: "Auto Drive", fallback: false },
    { kind: "slider", key: "targetLufs", label: "Target", min: -16, max: -7, step: 0.5, fallback: -10, format: formatLoudnessTarget },
    { kind: "slider", key: "maxAutoDriveDb", label: "Max Auto", min: 0, max: 9, step: 0.5, fallback: 6, format: formatSignedDb },
  ],
  "sweet-reverb-lite": [
    { kind: "select", key: "mode", label: "Mode", fallback: "room", options: REVERB_MODES },
    percentField("room", "Room", 0.32),
    percentField("damp", "Damp", 0.62),
    { kind: "slider", key: "preDelayMs", label: "Pre Delay", min: 0, max: 80, step: 1, fallback: 18, format: (value) => `${Math.round(value)} ms` },
    { kind: "slider", key: "decaySec", label: "Decay", min: 0.12, max: 2.2, step: 0.01, fallback: 0.65, format: (value) => `${value.toFixed(2)} s` },
    { kind: "slider", key: "lowCutHz", label: "Low Cut", min: 20, max: 800, step: 1, fallback: 180, format: (value) => `${Math.round(value)} Hz` },
    { kind: "slider", key: "highCutHz", label: "High Cut", min: 1200, max: 20000, step: 10, fallback: 9000, format: (value) => `${Math.round(value)} Hz` },
    percentField("width", "Width", 0.32),
    percentField("ducking", "Ducking", 0.18),
    percentField("mix", "Mix", 0.07),
  ],
  "sweet-saturator": [
    percentField("drive", "Drive", 0.22),
    percentField("color", "Color", 0.48),
    { kind: "slider", key: "lowCutHz", label: "Low Cut", min: 20, max: 220, step: 1, fallback: 35, format: (value) => `${Math.round(value)} Hz` },
    percentField("mix", "Mix", 0.18),
    { kind: "slider", key: "outputDb", label: "Output", min: -12, max: 6, step: 0.1, fallback: 0, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB` },
  ],
  "sweet-utility": [
    { kind: "slider", key: "gainDb", label: "Gain", min: -18, max: 12, step: 0.1, fallback: 0, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB` },
    { kind: "slider", key: "width", label: "Width", min: 0, max: 1, step: 0.01, fallback: 1, format: (value) => `${Math.round(value * 100)}%` },
    { kind: "toggle", key: "mono", label: "Mono Check", fallback: false },
  ],
  "sweet-guitar-fx": [
    percentField("drive", "Drive", 0.48),
    percentField("tone", "Tone", 0.45),
    percentField("body", "Body", 0.55),
    percentField("mix", "Mix", 0.45),
  ],
  "sweet-guitar-drive": [
    percentField("drive", "Drive", 0.42),
    percentField("tone", "Tone", 0.52),
    percentField("mix", "Mix", 0.4),
  ],
  "sweet-guitar-amp": [
    percentField("drive", "Drive", 0.5),
    percentField("tone", "Tone", 0.48),
    percentField("body", "Body", 0.56),
    percentField("mix", "Mix", 0.5),
  ],
  "sweet-guitar-cab": [
    { kind: "select", key: "irType", label: "Cab", fallback: "smallComboCab", options: CABINET_TYPES },
    { kind: "slider", key: "preDelayMs", label: "Pre Delay", min: 0, max: 40, step: 1, fallback: 0, format: (value) => `${Math.round(value)} ms` },
    percentField("tone", "Tone", 0.52),
    percentField("body", "Body", 0.5),
    percentField("width", "Width", 0.18),
    percentField("mix", "Mix", 0.52),
  ],
  "sweet-guitar-rig": [
    { kind: "select", key: "mode", label: "Mode", fallback: "cutting", options: GUITAR_MODES },
    { kind: "toggle", key: "chopEnabled", label: "Chop", fallback: true },
    { kind: "select", key: "chopRate", label: "Chop Rate", fallback: "1/16", options: CHOP_RATES },
    percentField("pickAttack", "Pick Attack", 0.65),
    percentField("muteTightness", "Mute Tight", 0.82),
    percentField("ampDrive", "Amp Drive", 0.18),
    { kind: "select", key: "cabinet", label: "Cabinet", fallback: "cleanCombo", options: CABINET_TYPES },
    percentField("body", "Body", 0.42),
    percentField("brightness", "Brightness", 0.62),
    percentField("noiseGate", "Gate", 0.35),
    percentField("mix", "Mix", 0.95),
  ],
  "sweet-vocal-fx": [
    percentField("drive", "Drive", 0.14),
    percentField("body", "Body", 0.48),
    percentField("presence", "Presence", 0.52),
    percentField("air", "Air", 0.46),
    percentField("mix", "Mix", 0.1),
  ],
  "sweet-bass-enhancer": [
    percentField("sub", "Sub Guard", 0.22),
    percentField("harmonics", "Harmonics", 0.46),
    percentField("tight", "Tight", 0.56),
    percentField("tone", "Tone", 0.44),
    percentField("mix", "Mix", 0.24),
  ],
  "sweet-parallel-comp": [
    percentField("mix", "Amount / Mix", 0.12),
    { kind: "slider", key: "crush", label: "Crush", min: 0, max: 100, step: 1, fallback: 34, format: (value) => `${Math.round(value)}` },
    { kind: "slider", key: "attackMs", label: "Attack", min: 3, max: 50, step: 1, fallback: 24, format: (value) => `${Math.round(value)} ms` },
    { kind: "slider", key: "releaseMs", label: "Release", min: 40, max: 300, step: 1, fallback: 180, format: (value) => `${Math.round(value)} ms` },
    { kind: "slider", key: "tone", label: "Tone", min: -100, max: 100, step: 1, fallback: -12, format: (value) => `${value > 0 ? "+" : ""}${Math.round(value)}` },
    { kind: "slider", key: "outputDb", label: "Output", min: -12, max: 12, step: 0.1, fallback: 0, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB` },
    { kind: "slider", key: "wetHpfHz", label: "Wet HPF", min: 20, max: 250, step: 1, fallback: 100, format: (value) => `${Math.round(value)} Hz` },
    { kind: "slider", key: "wetLpfHz", label: "Wet LPF", min: 5000, max: 20000, step: 10, fallback: 11000, format: (value) => `${Math.round(value)} Hz` },
    { kind: "toggle", key: "autoGain", label: "Auto Gain", fallback: true },
  ],
  "sweet-vocal-duck-eq": [
    { kind: "slider", key: "frequencyHz", label: "Pocket Freq", min: 1200, max: 4800, step: 10, fallback: 2500, format: (value) => `${Math.round(value)} Hz` },
    { kind: "slider", key: "maxReductionDb", label: "Max Duck", min: 0, max: 4, step: 0.1, fallback: 1.6, format: (value) => `-${value.toFixed(1)} dB` },
    { kind: "slider", key: "q", label: "Q Width", min: 0.4, max: 3.5, step: 0.1, fallback: 1.1, format: (value) => value.toFixed(1) },
    { kind: "slider", key: "threshold", label: "Vocal Detect", min: 0.005, max: 0.16, step: 0.005, fallback: 0.035, format: (value) => `${Math.round(value * 1000) / 10}%` },
    { kind: "slider", key: "attackMs", label: "Attack", min: 5, max: 120, step: 1, fallback: 35, format: (value) => `${Math.round(value)} ms` },
    { kind: "slider", key: "releaseMs", label: "Release", min: 60, max: 500, step: 1, fallback: 180, format: (value) => `${Math.round(value)} ms` },
    percentField("mix", "Mix", 1),
  ],
  "sweet-de-esser": [
    { kind: "slider", key: "frequency", label: "Frequency", min: 4500, max: 11000, step: 10, fallback: 7200, format: (value) => `${Math.round(value)} Hz` },
    percentField("amount", "Amount", 0.3),
    percentField("sharpness", "Sharpness", 0.55),
    percentField("mix", "Mix", 0.65),
  ],
  "sweet-gate-lite": [
    percentField("threshold", "Threshold", 0.12),
    percentField("floor", "Floor", 0.18),
    percentField("softness", "Softness", 0.55),
    percentField("mix", "Mix", 0.8),
  ],
  "sweet-chorus": [
    percentField("rate", "Rate", 0.28),
    percentField("depth", "Depth", 0.42),
    percentField("feedback", "Feedback", 0.18),
    percentField("mix", "Mix", 0.28),
  ],
  "sweet-phaser": [
    percentField("rate", "Rate", 0.32),
    percentField("depth", "Depth", 0.45),
    percentField("feedback", "Feedback", 0.22),
    percentField("mix", "Mix", 0.35),
  ],
  "sweet-stereo-widener": [
    percentField("width", "Width", 0.22),
    { kind: "slider", key: "delayMs", label: "Delay", min: 2, max: 28, step: 0.5, fallback: 8, format: (value) => `${value.toFixed(1)} ms` },
    percentField("tone", "Tone", 0.56),
    percentField("mix", "Mix", 0.16),
  ],
  "sweet-transient-shaper": [
    percentField("attack", "Attack", 0.48),
    percentField("sustain", "Sustain", 0.34),
    percentField("tone", "Tone", 0.55),
    percentField("mix", "Mix", 0.5),
  ],
  "sweet-rhythm-chopper": [
    { kind: "select", key: "rate", label: "Rate", fallback: "1/16", options: CHOP_RATES },
    { kind: "select", key: "pattern", label: "Pattern", fallback: "upDownMute", options: CHOP_PATTERNS },
    percentField("depth", "Depth", 0.85),
    { kind: "slider", key: "attackMs", label: "Attack", min: 1, max: 40, step: 1, fallback: 4, format: (value) => `${Math.round(value)} ms` },
    { kind: "slider", key: "releaseMs", label: "Release", min: 8, max: 160, step: 1, fallback: 35, format: (value) => `${Math.round(value)} ms` },
    percentField("swing", "Swing", 0.03),
    percentField("humanize", "Humanize", 0.03),
    percentField("accent", "Accent", 0.35),
    percentField("mix", "Mix", 1),
  ],
  "sweet-guitarizer": [
    { kind: "select", key: "mode", label: "Mode", fallback: "cutting", options: GUITAR_MODES },
    { kind: "toggle", key: "chopEnabled", label: "Chop", fallback: true },
    { kind: "select", key: "chopRate", label: "Chop Rate", fallback: "1/16", options: CHOP_RATES },
    percentField("pickAttack", "Pick Attack", 0.65),
    percentField("muteTightness", "Mute Tight", 0.82),
    percentField("ampDrive", "Amp Drive", 0.18),
    { kind: "select", key: "cabinet", label: "Cabinet", fallback: "cleanCombo", options: CABINET_TYPES },
    percentField("body", "Body", 0.42),
    percentField("brightness", "Brightness", 0.62),
    percentField("noiseGate", "Gate", 0.35),
    percentField("mix", "Mix", 0.95),
  ],
  "sweet-vocal-formant-color": [
    { kind: "slider", key: "pitchSemi", label: "Pitch", min: -7, max: 4, step: 0.1, fallback: -4, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} st` },
    { kind: "slider", key: "formantColor", label: "Formant", min: -1, max: 1, step: 0.01, fallback: -0.45, format: (value) => value.toFixed(2) },
    percentField("body", "Body", 0.65),
    percentField("throat", "Throat", 0.55),
    percentField("air", "Air", 0.18),
    percentField("presence", "Presence", 0.35),
    percentField("saturation", "Saturation", 0.22),
    percentField("artifactGuard", "Guard", 0.8),
    percentField("mix", "Mix", 0.82),
  ],
  "sweet-ir-space": [
    { kind: "select", key: "irType", label: "Space", fallback: "smallComboCab", options: CABINET_TYPES },
    { kind: "slider", key: "preDelayMs", label: "Pre Delay", min: 0, max: 40, step: 1, fallback: 0, format: (value) => `${Math.round(value)} ms` },
    percentField("tone", "Tone", 0.52),
    percentField("body", "Body", 0.5),
    percentField("width", "Width", 0.2),
    percentField("mix", "Mix", 0.55),
  ],
  "sweet-vocoder-lite": [
    { kind: "slider", key: "carrierHz", label: "Carrier", min: 40, max: 880, step: 1, fallback: 110, format: (value) => `${Math.round(value)} Hz` },
    percentField("formant", "Formant", 0.55),
    percentField("robot", "Robot", 0.5),
    percentField("mix", "Mix", 0.32),
  ],
  "sweet-pitch-assist": [
    percentField("amount", "Amount", 0.38),
    percentField("color", "Color", 0.62),
    percentField("mix", "Mix", 0.28),
  ],
  "sweet-granular-texture": [
    percentField("size", "Size", 0.36),
    percentField("spray", "Spray", 0.42),
    percentField("texture", "Texture", 0.55),
    percentField("mix", "Mix", 0.24),
  ],
  "sweet-multiband-comp": [
    percentField("low", "Low", 0.35),
    percentField("mid", "Mid", 0.3),
    percentField("high", "High", 0.28),
    { kind: "slider", key: "makeupDb", label: "Makeup", min: -6, max: 6, step: 0.1, fallback: 0, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB` },
    percentField("mix", "Mix", 0.65),
  ],
  "sweet-wavetable-carrier": [
    { kind: "select", key: "wave", label: "Wave", fallback: "sawtooth", options: WAVE_TYPES },
    { kind: "slider", key: "frequency", label: "Frequency", min: 30, max: 2000, step: 1, fallback: 110, format: (value) => `${Math.round(value)} Hz` },
    percentField("sub", "Sub", 0.2),
    percentField("tone", "Tone", 0.58),
    percentField("mix", "Mix", 0.25),
  ],
};

const PLUGIN_PRESETS: Partial<Record<PluginInstance["pluginId"], Array<{ name: string; params: PluginParams }>>> = {
  "sweet-aimix-glow": [
    { name: "AI Stem Rescue", params: { preset: "AI Stem Rescue", amount: 42, recover: 34, gloss: 22, air: 18, tame: 55, mix: 0.42, outputDb: -0.3 } },
    { name: "Clean Glow", params: { preset: "Clean Glow", amount: 32, recover: 24, gloss: 16, air: 14, tame: 38, mix: 0.34, outputDb: -0.2 } },
    { name: "Vocal Breath", params: { preset: "Vocal Breath", amount: 45, recover: 42, gloss: 24, air: 22, tame: 48, mix: 0.38, outputDb: -0.4 } },
    { name: "Dark Gloss", params: { preset: "Dark Gloss", amount: 38, recover: 30, gloss: 28, air: 8, tame: 60, mix: 0.36, outputDb: -0.2 } },
    { name: "Bright Safe", params: { preset: "Bright Safe", amount: 36, recover: 26, gloss: 14, air: 30, tame: 68, mix: 0.32, outputDb: -0.6 } },
  ],
  "sweet-peak-maximizer": [
    { name: "Clean Lift", params: { preset: "Clean Lift", mode: "clean", inputDriveDb: 2, ceilingDb: -1, lookaheadMs: 2, releaseMs: 90, transientProtect: 0.65, stereoLink: 1, softClipGuard: 0.18, truePeakGuard: true, oversample: "4x", autoDrive: false, targetLufs: -10, maxAutoDriveDb: 6 } },
    { name: "Punch Preserve", params: { preset: "Punch Preserve", mode: "punch", inputDriveDb: 2.5, ceilingDb: -1, lookaheadMs: 1.2, releaseMs: 70, transientProtect: 0.85, stereoLink: 1, softClipGuard: 0.12, truePeakGuard: true, oversample: "4x", autoDrive: false, targetLufs: -10, maxAutoDriveDb: 6 } },
    { name: "Loud Clear", params: { preset: "Loud Clear", mode: "loud", inputDriveDb: 4, ceilingDb: -1, lookaheadMs: 2.5, releaseMs: 120, transientProtect: 0.55, stereoLink: 1, softClipGuard: 0.22, truePeakGuard: true, oversample: "4x", autoDrive: false, targetLufs: -10, maxAutoDriveDb: 6 } },
    { name: "Streaming Safe", params: { preset: "Streaming Safe", mode: "streaming", inputDriveDb: 1.5, ceilingDb: -1.2, lookaheadMs: 2, releaseMs: 110, transientProtect: 0.7, stereoLink: 1, softClipGuard: 0.1, truePeakGuard: true, oversample: "4x", autoDrive: true, targetLufs: -14, maxAutoDriveDb: 4 } },
    { name: "Dense Master", params: { preset: "Dense Master", mode: "dense", inputDriveDb: 5, ceilingDb: -0.8, lookaheadMs: 3, releaseMs: 150, transientProtect: 0.45, stereoLink: 1, softClipGuard: 0.25, truePeakGuard: true, oversample: "4x", autoDrive: false, targetLufs: -10, maxAutoDriveDb: 6 } },
  ],
  "sweet-reverb-lite": [
    { name: "Air Seat", params: { preset: "Air Seat", mode: "air", room: 0.18, damp: 0.72, preDelayMs: 8, decaySec: 0.24, lowCutHz: 240, highCutHz: 10500, width: 0.24, ducking: 0.22, mix: 0.025 } },
    { name: "Support Room", params: { preset: "Support Room", mode: "room", room: 0.32, damp: 0.62, preDelayMs: 18, decaySec: 0.65, lowCutHz: 180, highCutHz: 9000, width: 0.32, ducking: 0.18, mix: 0.07 } },
    { name: "Vocal Plate Safe", params: { preset: "Vocal Plate Safe", mode: "room", room: 0.36, damp: 0.72, preDelayMs: 24, decaySec: 0.75, lowCutHz: 220, highCutHz: 8200, width: 0.24, ducking: 0.28, mix: 0.055 } },
    { name: "FX Tail Safe", params: { preset: "FX Tail Safe", mode: "tail", room: 0.48, damp: 0.58, preDelayMs: 14, decaySec: 1.6, lowCutHz: 260, highCutHz: 11000, width: 0.48, ducking: 0.18, mix: 0.08 } },
  ],
  "sweet-parallel-comp": [
    { name: "Vocal Thick", params: { preset: "Vocal Thick", mix: 0.16, crush: 35, attackMs: 20, releaseMs: 160, tone: -10, outputDb: 0, wetHpfHz: 120, wetLpfHz: 10000, autoGain: true } },
    { name: "Drum Smash", params: { preset: "Drum Smash", mix: 0.22, crush: 70, attackMs: 6, releaseMs: 90, tone: 10, outputDb: -1, wetHpfHz: 60, wetLpfHz: 14000, autoGain: true } },
    { name: "Bass Hold", params: { preset: "Bass Hold", mix: 0.14, crush: 50, attackMs: 30, releaseMs: 180, tone: -20, outputDb: 0, wetHpfHz: 25, wetLpfHz: 8000, autoGain: true } },
    { name: "Glue Light", params: { preset: "Glue Light", mix: 0.1, crush: 30, attackMs: 25, releaseMs: 220, tone: -5, outputDb: 0, wetHpfHz: 100, wetLpfHz: 12000, autoGain: true } },
    { name: "Stem Repair", params: { preset: "Stem Repair", mix: 0.12, crush: 40, attackMs: 15, releaseMs: 140, tone: -15, outputDb: 0, wetHpfHz: 150, wetLpfHz: 9000, autoGain: true } },
    { name: "Music Density", params: { preset: "Music Density", mix: 0.08, crush: 60, attackMs: 10, releaseMs: 120, tone: -20, outputDb: -1, wetHpfHz: 140, wetLpfHz: 10000, autoGain: true } },
  ],
  "sweet-vocal-duck-eq": [
    { name: "Vocal Pocket 2.5k", params: { preset: "Vocal Pocket 2.5k", frequencyHz: 2500, q: 1.1, maxReductionDb: 1.4, threshold: 0.035, attackMs: 35, releaseMs: 190, mix: 0.9 } },
    { name: "Wide Music Guard", params: { preset: "Wide Music Guard", frequencyHz: 2800, q: 0.95, maxReductionDb: 1.1, threshold: 0.04, attackMs: 45, releaseMs: 220, mix: 0.75 } },
    { name: "Gentle Guitar Pocket", params: { preset: "Gentle Guitar Pocket", frequencyHz: 2300, q: 1.25, maxReductionDb: 0.9, threshold: 0.045, attackMs: 30, releaseMs: 170, mix: 0.7 } },
    { name: "Dense Synth Guard", params: { preset: "Dense Synth Guard", frequencyHz: 3000, q: 1.35, maxReductionDb: 1.8, threshold: 0.03, attackMs: 25, releaseMs: 240, mix: 1 } },
  ],
  "sweet-rhythm-chopper": [
    { name: "Tight 16th Cutting", params: { preset: "Tight 16th Cutting", rate: "1/16", pattern: "upDownMute", depth: 0.9, attackMs: 2, releaseMs: 24, swing: 0.03, accent: 0.45, mix: 1 } },
    { name: "Funky Offbeat Chop", params: { preset: "Funky Offbeat Chop", rate: "1/16", pattern: "offbeat", depth: 0.78, attackMs: 3, releaseMs: 45, swing: 0.12, accent: 0.55, mix: 0.95 } },
    { name: "Electro Stutter Gate", params: { preset: "Electro Stutter Gate", rate: "1/32", pattern: "machine", depth: 0.95, attackMs: 1, releaseMs: 18, swing: 0, accent: 0.2, mix: 1 } },
    { name: "Gentle Pulse", params: { preset: "Gentle Pulse", rate: "1/8", pattern: "pulse", depth: 0.45, attackMs: 8, releaseMs: 80, swing: 0, accent: 0.15, mix: 0.65 } },
  ],
  "sweet-guitarizer": [
    { name: "Clean Cutting Guitar", params: { preset: "Clean Cutting Guitar", mode: "cutting", chopEnabled: true, chopRate: "1/16", pickAttack: 0.65, muteTightness: 0.82, ampDrive: 0.18, cabinet: "cleanCombo", body: 0.42, brightness: 0.62, noiseGate: 0.35, mix: 0.95 } },
    { name: "Dirty Indie Chop", params: { preset: "Dirty Indie Chop", mode: "cutting", chopEnabled: true, chopRate: "1/16_swing", pickAttack: 0.58, muteTightness: 0.68, ampDrive: 0.48, cabinet: "smallCombo", body: 0.5, brightness: 0.55, noiseGate: 0.28, mix: 0.9 } },
    { name: "Radio Amp Rhythm", params: { preset: "Radio Amp Rhythm", mode: "lofi_amp", chopEnabled: true, chopRate: "1/8", pickAttack: 0.5, muteTightness: 0.62, ampDrive: 0.38, cabinet: "phoneSpeaker", body: 0.3, brightness: 0.42, noiseGate: 0.4, mix: 1 } },
  ],
  "sweet-guitar-rig": [
    { name: "Clean Cutting Guitar", params: { preset: "Clean Cutting Guitar", mode: "cutting", chopEnabled: true, chopRate: "1/16", pickAttack: 0.65, muteTightness: 0.82, ampDrive: 0.18, cabinet: "cleanCombo", body: 0.42, brightness: 0.62, noiseGate: 0.35, mix: 0.95 } },
    { name: "Dirty Indie Chop", params: { preset: "Dirty Indie Chop", mode: "cutting", chopEnabled: true, chopRate: "1/16_swing", pickAttack: 0.58, muteTightness: 0.68, ampDrive: 0.48, cabinet: "smallCombo", body: 0.5, brightness: 0.55, noiseGate: 0.28, mix: 0.9 } },
    { name: "Radio Amp Rhythm", params: { preset: "Radio Amp Rhythm", mode: "lofi_amp", chopEnabled: true, chopRate: "1/8", pickAttack: 0.5, muteTightness: 0.62, ampDrive: 0.38, cabinet: "phoneSpeaker", body: 0.3, brightness: 0.42, noiseGate: 0.4, mix: 1 } },
  ],
  "sweet-vocal-formant-color": [
    { name: "Dark Male-ish", params: { preset: "Dark Male-ish", pitchSemi: -4, formantColor: -0.45, body: 0.65, throat: 0.55, air: 0.18, presence: 0.35, saturation: 0.22, artifactGuard: 0.8, mix: 0.82 } },
    { name: "Low Spoken Rap", params: { preset: "Low Spoken Rap", pitchSemi: -2, formantColor: -0.28, body: 0.58, throat: 0.48, air: 0.25, presence: 0.45, saturation: 0.15, artifactGuard: 0.85, mix: 0.78 } },
    { name: "Robot Radio", params: { preset: "Robot Radio", pitchSemi: 0, formantColor: -0.15, body: 0.35, throat: 0.25, air: 0.12, presence: 0.5, saturation: 0.35, artifactGuard: 0.6, mix: 1 } },
    { name: "Soft Deep Body", params: { preset: "Soft Deep Body", pitchSemi: -1, formantColor: -0.22, body: 0.5, throat: 0.35, air: 0.3, presence: 0.42, saturation: 0.08, artifactGuard: 0.9, mix: 0.65 } },
  ],
  "sweet-ir-space": [
    { name: "Small Combo Cab", params: { preset: "Small Combo Cab", irType: "smallComboCab", preDelayMs: 0, tone: 0.52, body: 0.5, width: 0.2, mix: 0.55 } },
    { name: "Phone Speaker", params: { preset: "Phone Speaker", irType: "phoneSpeaker", preDelayMs: 0, tone: 0.35, body: 0.18, width: 0, mix: 0.9 } },
    { name: "Small Room", params: { preset: "Small Room", irType: "smallRoom", preDelayMs: 8, tone: 0.48, body: 0.42, width: 0.45, mix: 0.32 } },
    { name: "Dark Plate", params: { preset: "Dark Plate", irType: "darkPlate", preDelayMs: 18, tone: 0.42, body: 0.38, width: 0.65, mix: 0.28 } },
  ],
  "sweet-guitar-cab": [
    { name: "Small Combo Cab", params: { preset: "Small Combo Cab", irType: "smallComboCab", preDelayMs: 0, tone: 0.52, body: 0.5, width: 0.2, mix: 0.55 } },
    { name: "Phone Speaker", params: { preset: "Phone Speaker", irType: "phoneSpeaker", preDelayMs: 0, tone: 0.35, body: 0.18, width: 0, mix: 0.9 } },
    { name: "Small Room", params: { preset: "Small Room", irType: "smallRoom", preDelayMs: 8, tone: 0.48, body: 0.42, width: 0.45, mix: 0.32 } },
    { name: "Dark Plate", params: { preset: "Dark Plate", irType: "darkPlate", preDelayMs: 18, tone: 0.42, body: 0.38, width: 0.65, mix: 0.28 } },
  ],
};

export function PluginEditorSheet({ plugin, onChange, onToggle, onClose }: PluginEditorSheetProps) {
  const descriptor = getPluginDescriptor(plugin.pluginId);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-daw-bg/80 p-2 backdrop-blur-md sm:items-center sm:justify-center">
      <section className="view-enter flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-panel shadow-2xl">
        <header className="flex min-h-[52px] items-center justify-between border-b border-daw-line px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-daw-green/25 bg-daw-green/10 text-daw-green">
              <SlidersHorizontal size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold">{descriptor?.name ?? plugin.name}</h2>
              <p className="truncate text-[11px] text-daw-muted">{plugin.enabled ? "Enabled" : "Bypassed"}</p>
            </div>
          </div>
          <button type="button" className="daw-btn daw-btn-ghost !min-h-[36px] !rounded-lg" onClick={onClose} aria-label="Close plug-in editor">
            <X size={16} />
          </button>
        </header>

        <div className="daw-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
          <div className="flex items-center justify-between rounded-xl border border-daw-line bg-daw-panel2 p-3">
            <div>
              <p className="text-xs font-bold">Slot State</p>
              <p className="mt-0.5 text-[11px] text-daw-muted">Bypass keeps the slot but removes the effect.</p>
            </div>
            <button
              type="button"
              onClick={onToggle}
              className={`daw-btn !min-h-[40px] !rounded-lg text-[11px] ${
                plugin.enabled ? "border-daw-green/35 bg-daw-green/15 text-daw-green" : "daw-btn-ghost"
              }`}
            >
              <Power size={14} />
              {plugin.enabled ? "On" : "Off"}
            </button>
          </div>

          <div className="rounded-xl border border-daw-line bg-daw-panel2 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-daw-muted">Parameters</span>
              {descriptor && (
                <button
                  type="button"
                  className="daw-btn daw-btn-ghost !min-h-[32px] !rounded-lg text-[10px]"
                  onClick={() => onChange(descriptor.createDefaultParams())}
                >
                  <RotateCcw size={13} />
                  Reset
                </button>
              )}
            </div>

            {PLUGIN_PRESETS[plugin.pluginId] && (
              <div className="mb-4 grid grid-cols-2 gap-2">
                {PLUGIN_PRESETS[plugin.pluginId]?.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => onChange(preset.params)}
                    className={`min-h-[38px] rounded-lg border px-2 text-left text-[10px] font-bold ${
                      plugin.params.preset === preset.name
                        ? "border-daw-cyan/45 bg-daw-cyan/15 text-daw-cyan"
                        : "border-daw-line bg-daw-panel text-daw-muted"
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            )}

            {plugin.pluginId === "sweet-vocal-formant-color" && (
              <p className="mb-3 rounded-lg border border-daw-amber/20 bg-daw-amber/10 px-3 py-2 text-[11px] leading-4 text-daw-amber">
                This changes vocal color. It is not voice cloning or natural gender conversion.
              </p>
            )}

            {plugin.pluginId === "sweet-filter" && <SweetFilterEditor params={plugin.params} onChange={onChange} />}
            {plugin.pluginId === "sweet-drive" && <SweetDriveEditor params={plugin.params} onChange={onChange} />}
            {plugin.pluginId === "sweet-delay-lite" && <SweetDelayEditor params={plugin.params} onChange={onChange} />}
            {GENERIC_PARAM_FIELDS[plugin.pluginId] && (
              <GenericPluginEditor pluginId={plugin.pluginId} fields={GENERIC_PARAM_FIELDS[plugin.pluginId] ?? []} params={plugin.params} onChange={onChange} />
            )}
            {!["sweet-filter", "sweet-drive", "sweet-delay-lite"].includes(plugin.pluginId) && !GENERIC_PARAM_FIELDS[plugin.pluginId] && (
              <p className="text-sm text-daw-muted">This fixed plug-in is edited from its dedicated panel.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SweetFilterEditor({ params, onChange }: { params: PluginParams; onChange: (paramsPatch: PluginParams) => void }) {
  const type = typeof params.type === "string" ? params.type : "lowpass";

  return (
    <div className="space-y-4">
      <label className="block space-y-1.5 text-[11px] font-semibold text-daw-muted">
        Type
        <select
          className="min-h-[40px] w-full rounded-lg border border-daw-line bg-daw-panel px-2 text-sm text-daw-text"
          value={type}
          onChange={(event) => onChange({ type: event.target.value })}
        >
          {FILTER_TYPES.map((filterType) => (
            <option key={filterType} value={filterType}>
              {filterType}
            </option>
          ))}
        </select>
      </label>
      <SliderRow label="Frequency" value={readNumber(params.frequency, 12000)} valueLabel={`${Math.round(readNumber(params.frequency, 12000))} Hz`} min={20} max={20000} step={1} onChange={(frequency) => onChange({ frequency })} />
      <SliderRow label="Resonance" value={readNumber(params.q, 0.8)} valueLabel={readNumber(params.q, 0.8).toFixed(1)} min={0.1} max={12} step={0.1} onChange={(q) => onChange({ q })} />
      <SliderRow label="Gain" value={readNumber(params.gainDb, 0)} valueLabel={`${readNumber(params.gainDb, 0).toFixed(1)} dB`} min={-18} max={18} step={0.1} onChange={(gainDb) => onChange({ gainDb })} />
    </div>
  );
}

function SweetDriveEditor({ params, onChange }: { params: PluginParams; onChange: (paramsPatch: PluginParams) => void }) {
  return (
    <div className="space-y-4">
      <SliderRow label="Drive" value={readNumber(params.drive, 0.35)} valueLabel={`${Math.round(readNumber(params.drive, 0.35) * 100)}%`} min={0} max={1} step={0.01} onChange={(drive) => onChange({ drive })} />
      <SliderRow label="Tone" value={readNumber(params.tone, 0.55)} valueLabel={`${Math.round(readNumber(params.tone, 0.55) * 100)}%`} min={0} max={1} step={0.01} onChange={(tone) => onChange({ tone })} />
      <SliderRow label="Mix" value={readNumber(params.mix, 0.35)} valueLabel={`${Math.round(readNumber(params.mix, 0.35) * 100)}%`} min={0} max={1} step={0.01} onChange={(mix) => onChange({ mix })} />
    </div>
  );
}

function SweetDelayEditor({ params, onChange }: { params: PluginParams; onChange: (paramsPatch: PluginParams) => void }) {
  return (
    <div className="space-y-4">
      <SliderRow label="Time" value={readNumber(params.timeSec, 0.25)} valueLabel={`${Math.round(readNumber(params.timeSec, 0.25) * 1000)} ms`} min={0.01} max={1.5} step={0.01} onChange={(timeSec) => onChange({ timeSec })} />
      <SliderRow label="Feedback" value={readNumber(params.feedback, 0.25)} valueLabel={`${Math.round(readNumber(params.feedback, 0.25) * 100)}%`} min={0} max={0.85} step={0.01} onChange={(feedback) => onChange({ feedback })} />
      <SliderRow label="Mix" value={readNumber(params.mix, 0.18)} valueLabel={`${Math.round(readNumber(params.mix, 0.18) * 100)}%`} min={0} max={1} step={0.01} onChange={(mix) => onChange({ mix })} />
    </div>
  );
}

function GenericPluginEditor({
  pluginId,
  fields,
  params,
  onChange,
}: {
  pluginId: PluginInstance["pluginId"];
  fields: ParamField[];
  params: PluginParams;
  onChange: (paramsPatch: PluginParams) => void;
}) {
  return (
    <div className="space-y-4">
      {(pluginId === "sweet-rhythm-chopper" || pluginId === "sweet-guitarizer") && (
        <PatternPreview pattern={String(params.pattern ?? params.chopRate ?? "upDownMute")} />
      )}
      {fields.map((field) => {
        if (field.kind === "select") {
          const value = typeof params[field.key] === "string" ? String(params[field.key]) : field.fallback;
          return (
            <label key={field.key} className="block space-y-1.5 text-[11px] font-semibold text-daw-muted">
              {field.label}
              <select
                className="min-h-[40px] w-full rounded-lg border border-daw-line bg-daw-panel px-2 text-sm text-daw-text"
                value={value}
                onChange={(event) => onChange({ [field.key]: event.target.value })}
              >
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        }

        if (field.kind === "toggle") {
          const value = typeof params[field.key] === "boolean" ? Boolean(params[field.key]) : field.fallback;
          return (
            <label key={field.key} className="flex min-h-[40px] items-center justify-between rounded-lg border border-daw-line bg-daw-panel px-3 text-[11px] font-semibold text-daw-muted">
              {field.label}
              <input
                type="checkbox"
                checked={value}
                onChange={(event) => onChange({ [field.key]: event.target.checked })}
                className="h-5 w-5 accent-daw-cyan"
              />
            </label>
          );
        }

        const value = readNumber(params[field.key], field.fallback);
        return (
          <SliderRow
            key={field.key}
            label={field.label}
            value={value}
            valueLabel={field.format(value)}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(nextValue) => onChange({ [field.key]: nextValue })}
          />
        );
      })}
    </div>
  );
}

function PatternPreview({ pattern }: { pattern: string }) {
  const levels = Array.from({ length: 16 }, (_, index) => getPatternLevel(pattern, index));
  return (
    <div
      className="grid gap-1 rounded-lg border border-daw-line bg-daw-panel p-2"
      style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}
      aria-hidden="true"
    >
      {levels.map((level, index) => (
        <span
          key={index}
          className="h-7 rounded-sm bg-daw-cyan/20"
          style={{
            opacity: 0.25 + level * 0.75,
            transform: `scaleY(${0.35 + level * 0.65})`,
          }}
        />
      ))}
    </div>
  );
}

function getPatternLevel(pattern: string, step: number) {
  if (pattern === "offbeat") return step % 4 === 2 ? 1 : step % 2 === 1 ? 0.62 : 0.18;
  if (pattern === "machine") return step % 2 === 0 ? 1 : 0.08;
  if (pattern === "pulse") return step % 4 === 0 ? 1 : 0.5;
  return step % 4 === 0 ? 1 : step % 2 === 0 ? 0.58 : 0.16;
}

function SliderRow({
  label,
  value,
  valueLabel,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1.5 text-[11px] font-semibold text-daw-muted">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="timecode text-daw-text">{valueLabel}</span>
      </span>
      <input
        type="range"
        className="daw-range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function percentField(key: string, label: string, fallback: number): ParamField {
  return {
    kind: "slider",
    key,
    label,
    min: 0,
    max: 1,
    step: 0.01,
    fallback,
    format: (value) => `${Math.round(value * 100)}%`,
  };
}

function formatSignedDb(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function formatMs(value: number) {
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatLoudnessTarget(value: number) {
  return `${value.toFixed(1)} LU target`;
}
