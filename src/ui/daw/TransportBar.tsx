"use client";

import { Download, Pause, Play, Repeat2, Square, Undo2 } from "lucide-react";
import { getProjectDurationSec } from "@/audio/engine/TrackGraph";
import type { Project } from "@/daw/model/Project";

type TransportBarProps = {
  project: Project;
  isPlaying: boolean;
  positionSec: number;
  loopEnabled: boolean;
  isExporting: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onLoopToggle: () => void;
  onSeek: (positionSec: number) => void;
  onExport: () => void;
  canUndo: boolean;
  onUndo: () => void;
};

export function TransportBar({
  project,
  isPlaying,
  positionSec,
  loopEnabled,
  isExporting,
  onPlay,
  onPause,
  onStop,
  onLoopToggle,
  onSeek,
  onExport,
  canUndo,
  onUndo,
}: TransportBarProps) {
  const durationSec = Math.max(0, getProjectDurationSec(project));
  const hasClips = project.clips.length > 0;

  return (
    <div className="glass-panel flex min-w-0 max-w-full items-center gap-2 overflow-hidden px-3 py-2 sm:gap-3 sm:px-4" style={{ borderRadius: "16px 16px 0 0" }}>
      {/* Play / Pause */}
      <button
        type="button"
        onClick={isPlaying ? onPause : onPlay}
        disabled={!hasClips}
        className={`daw-btn shrink-0 !h-12 !w-12 !rounded-full ${
          isPlaying ? "daw-btn-primary animate-pulse-glow" : "daw-btn-primary"
        }`}
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause size={20} fill="currentColor" />
        ) : (
          <Play size={20} fill="currentColor" className="ml-0.5" />
        )}
      </button>

      {/* Stop */}
      <button
        type="button"
        onClick={onStop}
        className="daw-btn daw-btn-ghost shrink-0 !h-10 !w-10 !rounded-full"
        aria-label="Stop"
      >
        <Square size={16} fill="currentColor" />
      </button>

      <button
        type="button"
        onClick={onLoopToggle}
        className={`daw-btn shrink-0 !h-10 !w-10 !rounded-full ${
          loopEnabled ? "border-daw-cyan/40 bg-daw-cyan/15 text-daw-cyan" : "daw-btn-ghost"
        }`}
        aria-label={loopEnabled ? "Disable loop" : "Enable loop"}
        title={loopEnabled ? "Loop on" : "Loop off"}
      >
        <Repeat2 size={16} />
      </button>

      {/* Time + Seek */}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center justify-between">
          <span className="timecode text-xs text-daw-text">{formatTime(positionSec)}</span>
          <span className="timecode text-[10px] text-daw-muted">{formatTime(durationSec)}</span>
        </div>
        <input
          type="range"
          className="daw-range w-full"
          min={0}
          max={Math.max(0.1, durationSec)}
          step={0.01}
          value={Math.min(positionSec, Math.max(0, durationSec))}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Seek timeline"
        />
      </div>

      <button
        type="button"
        onClick={onExport}
        disabled={!hasClips || isExporting}
        className="daw-btn daw-btn-accent shrink-0 !h-10 px-3.5 !rounded-full flex items-center gap-1.5 shadow-[0_0_12px_rgba(77,217,255,0.15)] hover:brightness-110"
        aria-label="Export WAV"
        title="Export WAV"
      >
        <Download size={14} />
        <span className="text-[10px] font-extrabold uppercase tracking-wider">{isExporting ? "..." : "WAV"}</span>
      </button>

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="daw-btn daw-btn-ghost shrink-0 !h-10 !w-10 !rounded-full"
        aria-label="Undo"
        title="Undo"
      >
        <Undo2 size={15} />
      </button>
    </div>
  );
}

function formatTime(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe % 1) * 100);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${centiseconds.toString().padStart(2, "0")}`;
}
