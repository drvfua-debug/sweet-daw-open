"use client";

import React from "react";
import type { SourceId } from "@/types/soundSphere";

interface SourceInfluenceMeterProps {
  mutedSources: SourceId[];
  sourceWeights: Record<SourceId, number>;
  onToggleMute: (sourceId: SourceId) => void;
}

const SOURCE_DETAILS: Record<SourceId, { label: string; colorClass: string }> = {
  metal: { label: "Metal", colorClass: "bg-zinc-400" },
  fire: { label: "Fire", colorClass: "bg-red-500" },
  water: { label: "Water", colorClass: "bg-blue-500" },
  glass: { label: "Glass", colorClass: "bg-teal-400" },
  wood: { label: "Wood", colorClass: "bg-amber-600" },
  stone: { label: "Stone", colorClass: "bg-stone-500" },
  electric: { label: "Electric", colorClass: "bg-lime-400" },
  air: { label: "Air", colorClass: "bg-indigo-400" },
  string: { label: "String", colorClass: "bg-rose-500" },
};

export const SourceInfluenceMeter: React.FC<SourceInfluenceMeterProps> = ({
  mutedSources,
  sourceWeights,
  onToggleMute,
}) => {
  const sortedSources = (Object.keys(SOURCE_DETAILS) as SourceId[]).map((id) => {
    const isMuted = mutedSources.includes(id);
    const weight = sourceWeights[id] ?? 0;
    return {
      id,
      weight,
      isMuted,
      ...SOURCE_DETAILS[id],
    };
  }).sort((a, b) => {
    if (a.isMuted && !b.isMuted) return 1;
    if (!a.isMuted && b.isMuted) return -1;
    return b.weight - a.weight; // Sort by dominant weight first
  });

  return (
    <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 text-daw-text relative overflow-hidden h-full">
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Source Influence (Weights)</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">9 Sources</span>
      </div>

      <div className="flex flex-col gap-2.5 max-h-[300px] overflow-y-auto pr-1 custom-scroll">
        {sortedSources.map((src) => {
          const percent = src.isMuted ? 0 : Math.round(src.weight * 100);

          return (
            <div
              key={src.id}
              className={`flex items-center justify-between gap-3 text-xs p-1.5 rounded-xl border border-transparent transition-all ${
                src.isMuted ? "opacity-35 bg-black/10" : "bg-white/[0.015] hover:bg-white/[0.03]"
              }`}
            >
              {/* Name & Badge */}
              <div className="w-[84px] shrink-0 font-semibold flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${src.colorClass}`} />
                <span className={src.isMuted ? "line-through text-zinc-600" : ""}>{src.label}</span>
              </div>

              {/* Progress Level bar */}
              <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden border border-white/[0.02]">
                <div
                  className={`h-full transition-all duration-300 ease-out ${src.colorClass}`}
                  style={{ width: `${percent}%` }}
                />
              </div>

              {/* Percentage Indicator */}
              <div className="w-10 text-right font-mono font-bold text-zinc-300">
                {src.isMuted ? "CUT" : `${percent}%`}
              </div>

              {/* Toggle ON/CUT Button */}
              <button
                type="button"
                onClick={() => onToggleMute(src.id)}
                className={`min-w-[50px] min-h-[26px] py-0.5 px-2 rounded-lg text-[9px] font-bold tracking-widest transition-all ${
                  src.isMuted
                    ? "border border-red-500/35 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                    : "border border-white/[0.08] bg-white/[0.04] text-zinc-400 hover:border-zinc-500/40 hover:text-white"
                }`}
              >
                {src.isMuted ? "RESTORE" : "CUT"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
