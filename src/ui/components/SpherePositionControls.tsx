"use client";

import React from "react";
import type { SoundSpherePatch } from "@/types/soundSphere";

interface SpherePositionControlsProps {
  x: number;
  y: number;
  z: number;
  activeMode: SoundSpherePatch["mode"];
  onChangePoint: (point: { x?: number; y?: number; z?: number }) => void;
  onChangeMode: (mode: SoundSpherePatch["mode"]) => void;
}

const MODES: Array<{ value: SoundSpherePatch["mode"]; label: string }> = [
  { value: "chord", label: "Poly Chord" },
  { value: "pluck", label: "Pluck Accent" },
  { value: "pad", label: "Ambient Pad" },
  { value: "bass", label: "Sub Bass" },
  { value: "fx", label: "Transition FX" },
  { value: "texture", label: "Sustained Wash" },
];

export const SpherePositionControls: React.FC<SpherePositionControlsProps> = ({
  x,
  y,
  z,
  activeMode,
  onChangePoint,
  onChangeMode,
}) => {
  return (
    <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 text-daw-text relative overflow-hidden h-full">
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Position & Play Mode</h3>
        <button
          type="button"
          onClick={() => onChangePoint({ x: 0, y: 0, z: 0 })}
          className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold text-daw-cyan hover:bg-daw-cyan/15 hover:border-daw-cyan/35 transition-all"
        >
          Recenter (0,0,0)
        </button>
      </div>

      {/* X Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-daw-cyan">X-Axis (Left ↔ Right)</span>
          <span className="font-mono text-zinc-400">{x.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={x}
          onChange={(e) => onChangePoint({ x: parseFloat(e.target.value) })}
          className="daw-range w-full"
          aria-label="X-Axis"
        />
      </div>

      {/* Y Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-emerald-400">Y-Axis (Back ↔ Front)</span>
          <span className="font-mono text-zinc-400">{y.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={y}
          onChange={(e) => onChangePoint({ y: parseFloat(e.target.value) })}
          className="daw-range w-full"
          aria-label="Y-Axis"
          style={{ accentColor: "#10b981" }}
        />
      </div>

      {/* Z Slider */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs font-semibold">
          <span className="text-purple-400">Z-Axis (Deep ↔ High)</span>
          <span className="font-mono text-zinc-400">{z.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={z}
          onChange={(e) => onChangePoint({ z: parseFloat(e.target.value) })}
          className="daw-range w-full"
          aria-label="Z-Axis"
          style={{ accentColor: "#8b5cf6" }}
        />
      </div>

      {/* Mode Selector */}
      <div className="flex flex-col gap-2 mt-2">
        <label className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Synthesis Patch Mode</label>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => onChangeMode(mode.value)}
              className={`min-h-[38px] rounded-xl border text-[11px] font-bold transition-all px-2 text-center ${
                activeMode === mode.value
                  ? "border-daw-cyan/50 bg-daw-cyan/15 text-daw-cyan shadow-glow-cyan/20"
                  : "border-white/[0.06] bg-white/[0.03] text-zinc-400 hover:bg-white/[0.07] hover:text-white"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
