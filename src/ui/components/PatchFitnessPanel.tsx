"use client";

import React from "react";
import type { SoundSpherePatch } from "@/types/soundSphere";

interface PatchFitnessPanelProps {
  chordableScore: number;
  fxScore: number;
  sustainScore: number;
  transientScore: number;
  harshnessRisk: number;
  recommendedLane: SoundSpherePatch["recommendedLane"];
  harmonicFit: SoundSpherePatch["harmonicFit"];
  durationFit: SoundSpherePatch["durationFit"];
}

export const PatchFitnessPanel: React.FC<PatchFitnessPanelProps> = ({
  chordableScore,
  fxScore,
  sustainScore,
  transientScore,
  harshnessRisk,
  recommendedLane,
  harmonicFit,
  durationFit,
}) => {
  // Generate descriptive, colorful warning and advice tags
  const tags = React.useMemo(() => {
    const list: Array<{ text: string; bg: string; border: string; textClass: string }> = [];

    // 1. Chordable validation
    if (chordableScore < 0.4) {
      list.push({
        text: "🚫 Chord Lane不可 (Not Chordable)",
        bg: "bg-red-500/10",
        border: "border-red-500/25",
        textClass: "text-red-400",
      });
    } else if (chordableScore >= 0.6) {
      list.push({
        text: "🎵 コード向き (Ideal for Chords)",
        bg: "bg-daw-cyan/15",
        border: "border-daw-cyan/35",
        textClass: "text-daw-cyan",
      });
    }

    // 2. Harshness alert
    if (harshnessRisk >= 0.6) {
      list.push({
        text: "⚠️ 高域注意 (High Harshness)",
        bg: "bg-amber-500/10",
        border: "border-amber-500/25",
        textClass: "text-amber-400 animate-pulse",
      });
    }

    // 3. Sustain fit
    if (sustainScore >= 0.5) {
      list.push({
        text: "🌊 長く伸ばせる (Sustained Texture)",
        bg: "bg-blue-500/10",
        border: "border-blue-500/25",
        textClass: "text-blue-400",
      });
    }

    // 4. Transient accent
    if (transientScore >= 0.5) {
      list.push({
        text: "⚡ 短いアクセント向き (Percussive Pluck)",
        bg: "bg-lime-500/10",
        border: "border-lime-500/25",
        textClass: "text-lime-400",
      });
    }

    // 5. FX recommendations
    if (fxScore >= 0.5) {
      list.push({
        text: "🔥 FX向き (Transition Sweep / Noise)",
        bg: "bg-rose-500/10",
        border: "border-rose-500/25",
        textClass: "text-rose-400",
      });
    }

    return list;
  }, [chordableScore, harshnessRisk, sustainScore, transientScore, fxScore]);

  return (
    <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 text-daw-text relative overflow-hidden h-full">
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Patch Fitness</h3>
        <span className="text-[10px] text-daw-cyan uppercase font-bold tracking-widest">
          Fit: {recommendedLane.toUpperCase()}
        </span>
      </div>

      {/* Numerical Metrics Bars */}
      <div className="flex flex-col gap-3">
        {/* Chordable */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-semibold">
            <span>Chordable Suitability</span>
            <span className={chordableScore < 0.4 ? "text-red-400 font-bold" : "text-daw-cyan font-bold"}>
              {(chordableScore * 100).toFixed(0)}% ({harmonicFit.toUpperCase()})
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.03] overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${chordableScore < 0.4 ? "bg-red-500" : "bg-daw-cyan"}`}
              style={{ width: `${chordableScore * 100}%` }}
            />
          </div>
        </div>

        {/* FX Suitability */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-semibold">
            <span>FX Suitability</span>
            <span className="text-rose-400 font-bold">{(fxScore * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.03] overflow-hidden">
            <div
              className="h-full bg-rose-500 transition-all duration-300"
              style={{ width: `${fxScore * 100}%` }}
            />
          </div>
        </div>

        {/* Sustain Fit */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-semibold">
            <span>Sustain Fit</span>
            <span className="text-blue-400 font-bold">{(sustainScore * 100).toFixed(0)}% ({durationFit.toUpperCase()})</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.03] overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${sustainScore * 100}%` }}
            />
          </div>
        </div>

        {/* Transient Accent */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-semibold">
            <span>Transient Accent</span>
            <span className="text-lime-400 font-bold">{(transientScore * 100).toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.03] overflow-hidden">
            <div
              className="h-full bg-lime-500 transition-all duration-300"
              style={{ width: `${transientScore * 100}%` }}
            />
          </div>
        </div>

        {/* Harshness Risk */}
        <div className="flex flex-col gap-1">
          <div className="flex justify-between text-xs font-semibold">
            <span>Harshness / Noise Risk</span>
            <span className={harshnessRisk >= 0.6 ? "text-amber-400 font-bold animate-pulse" : "text-zinc-400 font-bold"}>
              {(harshnessRisk * 100).toFixed(0)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.03] overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${harshnessRisk >= 0.6 ? "bg-amber-500" : "bg-zinc-500"}`}
              style={{ width: `${harshnessRisk * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Advisory Badges */}
      <div className="flex flex-col gap-1.5 mt-1">
        <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500">Acoustic Classifications</span>
        {tags.length === 0 ? (
          <span className="text-zinc-500 text-xs italic">Acoustically balanced</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, idx) => (
              <span
                key={idx}
                className={`py-1 px-2.5 rounded-xl border text-[10px] font-bold ${tag.bg} ${tag.border} ${tag.textClass}`}
              >
                {tag.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
