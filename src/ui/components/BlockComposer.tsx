"use client";

import React, { useState } from "react";
import type { SoundBlock, SoundSpherePatch } from "@/types/soundSphere";
import { Trash2, Plus, Volume2 } from "lucide-react";

interface BlockComposerProps {
  blocks: SoundBlock[];
  savedPatches: SoundSpherePatch[];
  activePatchId: string | null;
  selectedBlockId: string | null;
  keyRoot: string;
  scale: string;
  currentBeat: number;
  isPlaying: boolean;
  onAddBlock: (lane: SoundBlock["blockType"], startBeat: number, patchId: string) => boolean;
  onUpdateBlock: (blockId: string, patch: Partial<SoundBlock>) => void;
  onDeleteBlock: (blockId: string) => void;
  onSelectBlock: (blockId: string | null) => void;
}

const LANES: Array<{ id: SoundBlock["blockType"]; label: string; color: string; desc: string }> = [
  { id: "chord", label: "Chord Lane", color: "border-daw-cyan bg-daw-cyan/10 text-daw-cyan", desc: "Polyphonic Chords only" },
  { id: "bass", label: "Bass Lane", color: "border-emerald-500 bg-emerald-500/10 text-emerald-400", desc: "Low-frequency root/fifth/octave" },
  { id: "texture", label: "Texture Lane", color: "border-blue-500 bg-blue-500/10 text-blue-400", desc: "Ambient drones & pads" },
  { id: "fx", label: "FX Lane", color: "border-rose-500 bg-rose-500/10 text-rose-400", desc: "Transition noise & crashes" },
];

const BEATS_COUNT = 16; // 4 bars (4 beats per bar)
const CHORD_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CHORD_QUALITIES = [
  { value: "Maj", label: "Major" },
  { value: "Min", label: "Minor" },
  { value: "7", label: "Dom 7th" },
  { value: "maj7", label: "Maj 7th" },
  { value: "min7", label: "Min 7th" },
  { value: "dim", label: "Diminished" },
  { value: "aug", label: "Augmented" },
];
const MOVEMENTS = [
  { value: "hold", label: "Sustained Hold" },
  { value: "arp", label: "Arpeggiated (1/8)" },
  { value: "pulse", label: "Rhythmic Pulse (1/4)" },
  { value: "strum", label: "Strummed Accent" },
  { value: "swell", label: "Slow Volume Swell" },
];

export const BlockComposer: React.FC<BlockComposerProps> = ({
  blocks,
  savedPatches,
  activePatchId,
  selectedBlockId,
  keyRoot,
  scale,
  currentBeat,
  isPlaying,
  onAddBlock,
  onUpdateBlock,
  onDeleteBlock,
  onSelectBlock,
}) => {
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const handleGridClick = (laneId: SoundBlock["blockType"], beatIndex: number) => {
    if (!activePatchId) {
      triggerToast("⚠️ First, save your current Sound Sphere as a Patch!");
      return;
    }

    const success = onAddBlock(laneId, beatIndex, activePatchId);
    if (!success) {
      triggerToast("🚫 CRITICAL RULE: This Patch is NOT chord-suitable! Cymbal bursts, fire crackles, and extreme harsh noise cannot become Chords.");
    }
  };

  const triggerToast = (msg: string) => {
    setErrorToast(msg);
    setTimeout(() => {
      setErrorToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId);
  const selectedPatch = selectedBlock
    ? savedPatches.find((p) => p.id === selectedBlock.patchId)
    : null;

  return (
    <div className="glass-panel rounded-2xl p-5 flex flex-col gap-4 text-daw-text relative overflow-hidden">
      {/* Toast Alert */}
      {errorToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 glass-panel border-red-500/40 bg-red-950/80 text-red-300 py-2.5 px-5 rounded-xl shadow-2xl text-xs font-bold transition-all max-w-[90%] text-center animate-bounce">
          {errorToast}
        </div>
      )}

      <div className="flex items-center justify-between border-b border-white/[0.05] pb-2">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-daw-cyan animate-pulse" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Block Composer Lanes</h3>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500 uppercase tracking-widest">
          <span>Loop: 16 Beats</span>
          <span>•</span>
          <span>Grid Snap: 1 Beat</span>
        </div>
      </div>

      {/* Grid lanes view */}
      <div className="flex flex-col gap-3 relative z-10 select-none">
        {/* Playhead overlay bar */}
        {isPlaying && (
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-daw-cyan z-20 pointer-events-none shadow-glow-cyan transition-all duration-75"
            style={{
              left: `${132 + (currentBeat % BEATS_COUNT) * ((100 - 15) / BEATS_COUNT)}%`,
            }}
          />
        )}

        {LANES.map((lane) => {
          const laneBlocks = blocks.filter((b) => b.blockType === lane.id);

          return (
            <div key={lane.id} className="flex items-stretch min-h-[58px] gap-2">
              {/* Lane Info Label Header */}
              <div className="w-[124px] shrink-0 glass-panel bg-black/30 border-white/[0.03] rounded-xl p-2 flex flex-col justify-center">
                <span className={`text-xs font-bold ${lane.id === "chord" ? "text-daw-cyan" : lane.id === "bass" ? "text-emerald-400" : lane.id === "texture" ? "text-blue-400" : "text-rose-400"}`}>
                  {lane.label}
                </span>
                <span className="text-[9px] text-zinc-500 leading-tight">{lane.desc}</span>
              </div>

              {/* Grid cell tracks */}
              <div className="flex-1 rounded-xl bg-black/40 border border-white/[0.02] flex relative overflow-hidden">
                {/* Visual Beat Separators */}
                {Array.from({ length: BEATS_COUNT }).map((_, beatIdx) => {
                  const isBarBoundary = beatIdx % 4 === 0;
                  return (
                    <div
                      key={beatIdx}
                      onClick={() => handleGridClick(lane.id, beatIdx)}
                      className={`flex-1 border-r border-white/[0.02] cursor-pointer hover:bg-white/[0.03] transition-colors relative ${
                        isBarBoundary ? "border-r-white/[0.07]" : ""
                      }`}
                    >
                      {beatIdx === 0 && (
                        <span className="absolute top-0.5 left-0.5 text-[7px] font-mono text-zinc-600">Bar 1</span>
                      )}
                      {beatIdx === 4 && (
                        <span className="absolute top-0.5 left-0.5 text-[7px] font-mono text-zinc-600">Bar 2</span>
                      )}
                      {beatIdx === 8 && (
                        <span className="absolute top-0.5 left-0.5 text-[7px] font-mono text-zinc-600">Bar 3</span>
                      )}
                      {beatIdx === 12 && (
                        <span className="absolute top-0.5 left-0.5 text-[7px] font-mono text-zinc-600">Bar 4</span>
                      )}
                    </div>
                  );
                })}

                {/* Placed blocks render */}
                {laneBlocks.map((block) => {
                  const patch = savedPatches.find((p) => p.id === block.patchId);
                  const isBlockSelected = selectedBlockId === block.id;

                  const startPct = (block.startBeat / BEATS_COUNT) * 100;
                  const widthPct = (block.durationBeats / BEATS_COUNT) * 100;

                  return (
                    <div
                      key={block.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectBlock(isBlockSelected ? null : block.id);
                      }}
                      className={`absolute inset-y-1 border rounded-lg p-1.5 flex flex-col justify-between cursor-pointer transition-all ${
                        isBlockSelected
                          ? `${lane.color} shadow-glow-cyan/15 z-30`
                          : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] z-10"
                      }`}
                      style={{
                        left: `${startPct}%`,
                        width: `${widthPct}%`,
                      }}
                    >
                      <div className="flex items-center justify-between gap-1 overflow-hidden min-w-0">
                        <span className="text-[10px] font-bold truncate leading-tight">
                          {patch?.name || "Unloaded Patch"}
                        </span>
                        {isBlockSelected && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteBlock(block.id);
                            }}
                            className="text-red-400 hover:text-red-300"
                            title="Delete Block"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[8px] font-bold text-zinc-500">
                        <span>{block.chord ? `${block.chord.root}${block.chord.quality}` : "Mono"}</span>
                        <span>{block.durationBeats} Beats</span>
                      </div>

                      {/* Resize drag handles (Mocked visual indicator for resize) */}
                      <div
                        className="absolute top-0 bottom-0 right-0 w-1.5 cursor-ew-resize rounded-r-lg bg-white/10 hover:bg-white/20"
                        title="Drag blocks in lanes is handled by beats increment input below"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grid editor settings for the selected block */}
      {selectedBlock && (
        <div className="glass-panel bg-black/25 rounded-2xl p-4 border border-white/[0.04] grid gap-4 md:grid-cols-3">
          {/* Block basic settings */}
          <div className="flex flex-col gap-2">
            <h4 className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Block Placement</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-zinc-500 font-bold">Start Beat</label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  value={selectedBlock.startBeat}
                  onChange={(e) => onUpdateBlock(selectedBlock.id, { startBeat: Math.max(0, Math.min(15, parseInt(e.target.value) || 0)) })}
                  className="rounded-lg bg-black/35 border border-white/[0.08] px-2 py-1 font-mono text-daw-cyan font-bold"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-zinc-500 font-bold">Duration (Beats)</label>
                <input
                  type="number"
                  min="1"
                  max="16"
                  value={selectedBlock.durationBeats}
                  onChange={(e) => onUpdateBlock(selectedBlock.id, { durationBeats: Math.max(1, Math.min(16, parseInt(e.target.value) || 1)) })}
                  className="rounded-lg bg-black/35 border border-white/[0.08] px-2 py-1 font-mono text-daw-cyan font-bold"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1 mt-1 text-xs">
              <label className="text-zinc-500 font-bold">Velocity (0-127)</label>
              <input
                type="range"
                min="1"
                max="127"
                value={selectedBlock.velocity}
                onChange={(e) => onUpdateBlock(selectedBlock.id, { velocity: parseInt(e.target.value) })}
                className="daw-range w-full"
              />
            </div>
          </div>

          {/* Lane specialized settings */}
          {selectedBlock.blockType === "chord" && (
            <div className="flex flex-col gap-2">
              <h4 className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Chord Harmony Voicing</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex flex-col gap-1">
                  <label className="text-zinc-500 font-bold">Chord Root</label>
                  <select
                    value={selectedBlock.chord?.root || "C"}
                    onChange={(e) => onUpdateBlock(selectedBlock.id, { chord: { root: e.target.value, quality: selectedBlock.chord?.quality || "Maj" } })}
                    className="rounded-lg bg-black/35 border border-white/[0.08] px-2 py-1 text-zinc-300 font-bold"
                  >
                    {CHORD_ROOTS.map((root) => (
                      <option key={root} value={root}>{root}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-zinc-500 font-bold">Chord Quality</label>
                  <select
                    value={selectedBlock.chord?.quality || "Maj"}
                    onChange={(e) => onUpdateBlock(selectedBlock.id, { chord: { root: selectedBlock.chord?.root || "C", quality: e.target.value } })}
                    className="rounded-lg bg-black/35 border border-white/[0.08] px-2 py-1 text-zinc-300 font-bold"
                  >
                    {CHORD_QUALITIES.map((q) => (
                      <option key={q.value} value={q.value}>{q.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-xs">
                <label className="text-zinc-500 font-bold">Chord Movement Style</label>
                <select
                  value={selectedBlock.movement || "hold"}
                  onChange={(e) => onUpdateBlock(selectedBlock.id, { movement: e.target.value as any })}
                  className="rounded-lg bg-black/35 border border-white/[0.08] px-2.5 py-1 text-zinc-300 font-bold"
                >
                  {MOVEMENTS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {selectedBlock.blockType === "bass" && (
            <div className="flex flex-col gap-2">
              <h4 className="text-[10px] uppercase font-bold tracking-widest text-zinc-400">Bassline Style</h4>
              <div className="flex flex-col gap-1 text-xs">
                <label className="text-zinc-500 font-bold">Arpeggiator / Movement Pattern</label>
                <select
                  value={selectedBlock.movement || "hold"}
                  onChange={(e) => onUpdateBlock(selectedBlock.id, { movement: e.target.value as any })}
                  className="rounded-lg bg-black/35 border border-white/[0.08] px-2.5 py-1 text-zinc-300 font-bold"
                >
                  <option value="hold">Root Low Hold</option>
                  <option value="pulse">Rhythmic Octave Pulse</option>
                  <option value="fifth">Root-Fifth Arpeggiation</option>
                </select>
              </div>
            </div>
          )}

          {/* Patch overview information */}
          <div className="flex flex-col gap-1.5 text-xs text-zinc-400 justify-center">
            <div className="font-semibold text-white">Selected Block Patch Metadata</div>
            <div>Name: <span className="text-daw-cyan font-bold">{selectedPatch?.name}</span></div>
            <div>Recommended Lane: <span className="text-emerald-400 font-bold">{selectedPatch?.recommendedLane.toUpperCase()}</span></div>
            <div>Chordable Suitability: <span className="font-mono">{(selectedPatch?.chordableScore ?? 0 * 100).toFixed(0)}%</span></div>
          </div>
        </div>
      )}
    </div>
  );
};
