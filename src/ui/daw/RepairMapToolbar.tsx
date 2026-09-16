"use client";

import React from "react";
import { ScanLine, X } from "lucide-react";
import type { RepairHeatmapViewMode } from "@/daw/mix/mixDoctorTypes";

type RepairMapToolbarProps = {
  viewMode: RepairHeatmapViewMode;
  onViewModeChange: (mode: RepairHeatmapViewMode) => void;
  zoomLabel: string;
  onZoomPreset: (preset: "fit" | "30s" | "5s" | "1s" | "0.25s") => void;
  onAnalyze: () => void;
  onApplySelected: () => void;
  canAnalyze: boolean;
  canApplySelected: boolean;
  selectedCount: number;
  onClose?: () => void;
};

const VIEW_MODES: Array<{ id: RepairHeatmapViewMode; label: string }> = [
  { id: "before", label: "Before" },
  { id: "after", label: "After" },
  { id: "difference", label: "Difference" },
];

const ZOOM_PRESETS: Array<{ id: "fit" | "30s" | "5s" | "1s" | "0.25s"; label: string }> = [
  { id: "fit", label: "Fit" },
  { id: "30s", label: "30s" },
  { id: "5s", label: "5s" },
  { id: "1s", label: "1s" },
  { id: "0.25s", label: "0.25s" },
];

export function RepairMapToolbar({
  viewMode,
  onViewModeChange,
  zoomLabel,
  onZoomPreset,
  onAnalyze,
  onApplySelected,
  canAnalyze,
  canApplySelected,
  selectedCount,
  onClose,
}: RepairMapToolbarProps) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-white/[0.07] bg-[#08111f]/95 p-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-daw-cyan/30 bg-daw-cyan/10 text-daw-cyan">
          <ScanLine size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-black uppercase tracking-wider text-daw-text">Repair</h2>
          <p className="text-[10px] leading-tight text-daw-muted">Time x log-frequency repair regions. After/Difference are predicted until rendered preview is generated.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/[0.06] bg-black/25 p-1">
          {VIEW_MODES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onViewModeChange(entry.id)}
              className={`min-h-[30px] rounded-md px-2 text-[9px] font-black uppercase tracking-wider ${
                viewMode === entry.id ? "bg-daw-cyan text-black" : "text-daw-muted hover:bg-white/[0.06]"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-black/25 p-1">
          {ZOOM_PRESETS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => onZoomPreset(entry.id)}
              className="min-h-[30px] rounded-md px-2 text-[9px] font-black uppercase tracking-wider text-daw-muted hover:bg-white/[0.06] hover:text-daw-text"
            >
              {entry.label}
            </button>
          ))}
          <span className="hidden rounded-md bg-white/[0.04] px-2 py-1 text-[9px] font-bold text-daw-muted sm:inline">{zoomLabel}</span>
        </div>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={!canAnalyze}
          className="min-h-[34px] rounded-lg border border-daw-cyan/30 bg-daw-cyan/10 px-3 text-[10px] font-black uppercase tracking-wider text-daw-cyan disabled:cursor-not-allowed disabled:opacity-35"
        >
          Analyze Repair
        </button>
        <button
          type="button"
          onClick={onApplySelected}
          disabled={!canApplySelected}
          className="min-h-[34px] rounded-lg border border-emerald-300/35 bg-emerald-300/10 px-3 text-[10px] font-black uppercase tracking-wider text-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
        >
          Apply Selected Regions {selectedCount > 0 ? `(${selectedCount})` : ""}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-daw-muted hover:text-daw-text"
            aria-label="Close Repair"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
