"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Project } from "@/daw/model/Project";
import type { MixDoctorReport, RepairHeatmapCell, RepairHeatmapViewMode, SpectralEditOp, SpectralRepairReport } from "@/daw/mix/mixDoctorTypes";
import { buildRepairHeatmap, cellToSpectralEditOp } from "@/daw/mix/repair/repairHeatmapBuilder";
import { RepairDetailPanel } from "./RepairDetailPanel";
import { RepairHeatmapCanvas, type RepairSelectionRange, type RepairZoomState } from "./RepairHeatmapCanvas";
import { RepairMapLegend } from "./RepairMapLegend";
import { RepairMapToolbar } from "./RepairMapToolbar";

type RepairMapPanelProps = {
  project: Project;
  report: MixDoctorReport | null;
  spectralRepairReport: SpectralRepairReport | null;
  peaksByFileId: Record<string, PeakSummary>;
  onAnalyze: () => void;
  onApplySpectralRepair: (ops: SpectralEditOp[]) => void;
  onClose?: () => void;
  onToast?: (message: string) => void;
  variant?: "overlay" | "embedded";
};

const DEFAULT_MIN_FREQ = 20;
const DEFAULT_MAX_FREQ = 20000;

export function RepairMapPanel({
  project,
  report,
  spectralRepairReport,
  peaksByFileId,
  onAnalyze,
  onApplySpectralRepair,
  onClose,
  onToast,
  variant = "overlay",
}: RepairMapPanelProps) {
  const durationSec = useMemo(() => getProjectDuration(project), [project]);
  const initialCells = useMemo(() => {
    if (spectralRepairReport?.heatmapCells?.length) return spectralRepairReport.heatmapCells;
    return buildRepairHeatmap({
      project,
      problems: report?.problems ?? [],
      featureReports: report?.stemFeatureReports,
      contaminationReports: report?.contaminationReports,
      stemPurityReports: report?.stemPurityReports,
      peaksByFileId,
      ops: spectralRepairReport?.ops,
      mode: report?.mode ?? spectralRepairReport?.mode ?? "light",
    }).cells;
  }, [peaksByFileId, project, report, spectralRepairReport]);
  const [cells, setCells] = useState<RepairHeatmapCell[]>(initialCells);
  const [viewMode, setViewMode] = useState<RepairHeatmapViewMode>("before");
  const [selectedIds, setSelectedIds] = useState<string[]>(initialCells[0] ? [initialCells[0].id] : []);
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [zoom, setZoom] = useState<RepairZoomState>({
    visibleStartSec: 0,
    visibleEndSec: Math.max(0.25, durationSec),
    minFreq: DEFAULT_MIN_FREQ,
    maxFreq: DEFAULT_MAX_FREQ,
  });

  useEffect(() => {
    setCells(initialCells);
    setSelectedIds((current) => {
      const available = new Set(initialCells.map((cell) => cell.id));
      const kept = current.filter((id) => available.has(id));
      return kept.length > 0 ? kept : initialCells[0] ? [initialCells[0].id] : [];
    });
  }, [initialCells]);

  useEffect(() => {
    setZoom((current) => ({
      ...current,
      visibleStartSec: Math.min(current.visibleStartSec, Math.max(0, durationSec - 0.25)),
      visibleEndSec: Math.min(Math.max(0.25, durationSec), Math.max(current.visibleEndSec, 0.25)),
    }));
  }, [durationSec]);

  const filteredCells = useMemo(() => (trackFilter === "all" ? cells : cells.filter((cell) => cell.trackId === trackFilter)), [cells, trackFilter]);
  const selectedCells = useMemo(() => cells.filter((cell) => selectedIds.includes(cell.id)), [cells, selectedIds]);
  const primarySelected = selectedCells[0] ?? null;
  const summary = spectralRepairReport?.beforeSummary ?? {
    totalCells: cells.length,
    hotCells: cells.filter((cell) => cell.beforeScore >= 55).length,
    maxScore: cells.length ? Math.max(...cells.map((cell) => cell.beforeScore)) : 0,
    averageScore: cells.length ? cells.reduce((sum, cell) => sum + cell.beforeScore, 0) / cells.length : 0,
    notes: [],
  };

  const handleSelectCell = (cell: RepairHeatmapCell) => {
    setSelectedIds((current) => (current.includes(cell.id) ? current : [cell.id]));
  };

  const handleSelectRange = (range: RepairSelectionRange) => {
    const next = filteredCells
      .filter((cell) => cell.endTime >= range.startTime && cell.startTime <= range.endTime && cell.highFreq >= range.lowFreq && cell.lowFreq <= range.highFreq)
      .sort((a, b) => b.beforeScore - a.beforeScore)
      .slice(0, 24)
      .map((cell) => cell.id);
    if (next.length > 0) {
      setSelectedIds(next);
      onToast?.(`Selected ${next.length} repair region${next.length === 1 ? "" : "s"}.`);
    } else {
      onToast?.("No repair regions in that range.");
    }
  };

  const handlePatchCell = (
    cellId: string,
    patch: Partial<Pick<RepairHeatmapCell, "suggestedOperation" | "suggestedGainDb" | "strength" | "softness" | "protectMain">>,
  ) => {
    setCells((current) =>
      current.map((cell) => {
        if (cell.id !== cellId) return cell;
        const next = { ...cell, ...patch };
        const afterScore = predictAfterScore(next.beforeScore, next.protectMain ? "protect" : next.suggestedOperation, next.strength);
        return { ...next, afterScore, differenceScore: round1(next.beforeScore - afterScore) };
      }),
    );
  };

  const handleApplySelected = () => {
    const safeCells = selectedCells.filter((cell) => !cell.protectMain && cell.suggestedOperation !== "protect");
    if (safeCells.length === 0) {
      onToast?.("No active repair regions selected. Protected regions are metadata only.");
      return;
    }
    const limited = safeCells.slice(0, 24);
    const ops = limited.map((cell) => cellToSpectralEditOp(cell, "manual"));
    onApplySpectralRepair(ops);
    onToast?.(`Applied ${ops.length} fixed non-destructive repair region(s).`);
  };

  const handleZoomPreset = (preset: "fit" | "30s" | "5s" | "1s" | "0.25s") => {
    if (preset === "fit") {
      setZoom({ visibleStartSec: 0, visibleEndSec: Math.max(0.25, durationSec), minFreq: DEFAULT_MIN_FREQ, maxFreq: DEFAULT_MAX_FREQ });
      return;
    }
    const seconds = Number(preset.replace("s", ""));
    const center = (zoom.visibleStartSec + zoom.visibleEndSec) / 2;
    setZoom(clampZoom({ ...zoom, visibleStartSec: center - seconds / 2, visibleEndSec: center + seconds / 2 }, durationSec));
  };

  const tracksWithCells = useMemo(() => {
    const ids = new Set(cells.map((cell) => cell.trackId));
    return project.tracks.filter((track) => ids.has(track.id));
  }, [cells, project.tracks]);

  return (
    <div
      className={
        variant === "overlay"
          ? "fixed inset-0 z-[180] flex bg-[#020711]/95 text-daw-text backdrop-blur-md"
          : "flex min-h-[420px] overflow-hidden rounded-2xl border border-daw-line bg-[#020711]/65 text-daw-text"
      }
    >
      <div className={`${variant === "overlay" ? "safe-top safe-bottom" : ""} flex min-h-0 w-full flex-col`}>
        <RepairMapToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          zoomLabel={`${zoom.visibleStartSec.toFixed(1)}-${zoom.visibleEndSec.toFixed(1)}s / ${zoom.minFreq}-${zoom.maxFreq}Hz`}
          onZoomPreset={handleZoomPreset}
          onAnalyze={onAnalyze}
          onApplySelected={handleApplySelected}
          canAnalyze={Boolean(report && report.problems.length > 0)}
          canApplySelected={selectedCells.some((cell) => !cell.protectMain && cell.suggestedOperation !== "protect")}
          selectedCount={selectedCells.length}
          onClose={onClose}
        />

        <div className="grid shrink-0 gap-2 border-b border-white/[0.07] bg-black/20 p-2 text-[10px] text-daw-muted sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-lg bg-white/[0.04] px-2 py-1"><b className="text-daw-text">Hot Regions:</b> {summary.hotCells}</span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1"><b className="text-daw-text">Max:</b> {summary.maxScore.toFixed(1)}</span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1"><b className="text-daw-text">Avg:</b> {summary.averageScore.toFixed(1)}</span>
            <span className="rounded-lg bg-white/[0.04] px-2 py-1"><b className="text-daw-text">Preview:</b> predicted</span>
          </div>
          <label className="flex items-center gap-2">
            <span className="font-black uppercase tracking-wider">Track</span>
            <select
              value={trackFilter}
              onChange={(event) => setTrackFilter(event.currentTarget.value)}
              className="min-h-[32px] rounded-lg border border-white/[0.08] bg-black/35 px-2 text-daw-text"
            >
              <option value="all">All repair regions</option>
              {tracksWithCells.map((track) => (
                <option key={track.id} value={track.id}>{track.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
            <div className="min-h-0 flex-1">
              <RepairHeatmapCanvas
                cells={filteredCells}
                viewMode={viewMode}
                durationSec={durationSec}
                selectedCellIds={selectedIds}
                visibleStartSec={zoom.visibleStartSec}
                visibleEndSec={zoom.visibleEndSec}
                minFreq={zoom.minFreq}
                maxFreq={zoom.maxFreq}
                onSelectCell={handleSelectCell}
                onSelectRange={handleSelectRange}
                onZoomChange={(next) => setZoom(clampZoom(next, durationSec))}
              />
            </div>
            <RepairMapLegend />
          </main>
          <RepairDetailPanel
            cell={primarySelected}
            selectedCount={selectedCells.length}
            onPatchCell={handlePatchCell}
            onApplySelected={handleApplySelected}
            canApplySelected={selectedCells.some((cell) => !cell.protectMain && cell.suggestedOperation !== "protect")}
          />
        </div>
      </div>
    </div>
  );
}

function getProjectDuration(project: Project) {
  const clipEnd = project.clips.reduce((max, clip) => Math.max(max, clip.timelineStartSec + clip.durationSec), 0);
  const fileEnd = project.files.reduce((max, file) => Math.max(max, file.durationSec), 0);
  return Math.max(0.25, clipEnd, fileEnd, 30);
}

function predictAfterScore(beforeScore: number, operation: RepairHeatmapCell["suggestedOperation"], strength: number) {
  const efficiency = operation === "derumble" ? 0.62 : operation === "deess" ? 0.56 : operation === "deharsh" ? 0.52 : operation === "reduce" ? 0.45 : operation === "smooth" ? 0.35 : 0;
  return round1(Math.max(0, beforeScore * (1 - Math.max(0, Math.min(1, strength)) * efficiency)));
}

function clampZoom(next: RepairZoomState, durationSec: number): RepairZoomState {
  const visibleDuration = Math.min(Math.max(0.25, next.visibleEndSec - next.visibleStartSec), Math.max(0.25, durationSec));
  const visibleStartSec = Math.max(0, Math.min(next.visibleStartSec, Math.max(0, durationSec - visibleDuration)));
  const visibleEndSec = Math.min(durationSec, visibleStartSec + visibleDuration);
  const minFreq = Math.max(DEFAULT_MIN_FREQ, Math.min(DEFAULT_MAX_FREQ - 1, next.minFreq));
  const maxFreq = Math.max(minFreq + 1, Math.min(DEFAULT_MAX_FREQ, next.maxFreq));
  return { visibleStartSec: round2(visibleStartSec), visibleEndSec: round2(visibleEndSec), minFreq: Math.round(minFreq), maxFreq: Math.round(maxFreq) };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
