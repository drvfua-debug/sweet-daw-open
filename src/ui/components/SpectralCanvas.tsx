"use client";

import { useEffect, useRef } from "react";
import type { SpectralTile } from "@/audio/analysis/SpectralTileBuilder";
import type { Clip } from "@/daw/model/Project";
import type { RepairViewMode, SpectralRepairRegion } from "@/daw/repair/repairTypes";
import type { SweetSpectralSelection } from "@/lib/audio/spectralEditorTypes";
import { createSweetSpectralSelection } from "@/lib/audio/spectralSelection";

type SpectralCanvasProps = {
  tile: SpectralTile | null;
  clip: Clip | null;
  regions: SpectralRepairRegion[];
  selectedRegionId?: string;
  viewMode: RepairViewMode;
  selection?: SweetSpectralSelection | null;
  onSelectionChange?: (selection: SweetSpectralSelection) => void;
  onSelectRegion?: (regionId: string) => void;
};

const PROBLEM_COLORS: Record<string, string> = {
  sibilance: "rgba(255,214,102,0.72)",
  metallic_high: "rgba(180,140,255,0.72)",
  hiss: "rgba(150,220,255,0.62)",
  mud: "rgba(255,143,95,0.66)",
  rumble: "rgba(101,240,164,0.62)",
  click: "rgba(255,111,168,0.74)",
  clipping: "rgba(255,80,96,0.78)",
  reverb_smear: "rgba(110,168,255,0.68)",
  phase_risk: "rgba(255,255,255,0.62)",
  vocal_plastic: "rgba(244,201,93,0.66)",
  low_end_blur: "rgba(101,240,164,0.62)",
};

export function SpectralCanvas({ tile, clip, regions, selectedRegionId, viewMode, selection, onSelectionChange, onSelectRegion }: SpectralCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ startTime: number; startHz: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSpectral(ctx, rect.width, rect.height, tile, clip, regions, selectedRegionId, viewMode, selection ?? null);
  }, [tile, clip, regions, selectedRegionId, viewMode, selection]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full min-h-[240px] w-full touch-none rounded-xl border border-daw-line bg-[#050915]"
      onPointerDown={(event) => {
        if (!clip) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const time = pointerToTime(event.clientX - rect.left, rect.width, clip);
        const hz = yToHz(event.clientY - rect.top, rect.height);
        const hit = regions
          .filter((region) => region.clipId === clip.id || region.fileId === clip.fileId)
          .find((region) => time >= region.startSec && time <= region.endSec && hz >= region.lowHz && hz <= region.highHz);
        if (hit) {
          onSelectRegion?.(hit.id);
          return;
        }
        if (!onSelectionChange) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { startTime: time, startHz: hz };
        onSelectionChange(createSweetSpectralSelection({ startSec: time, endSec: time + 0.05, minHz: hz, maxHz: hz + 120, shape: "brush" }));
      }}
      onPointerMove={(event) => {
        if (!clip || !dragRef.current || !onSelectionChange) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const time = pointerToTime(event.clientX - rect.left, rect.width, clip);
        const hz = yToHz(event.clientY - rect.top, rect.height);
        onSelectionChange(createSweetSpectralSelection({ startSec: dragRef.current.startTime, endSec: time, minHz: dragRef.current.startHz, maxHz: hz, shape: "rectangle" }));
      }}
      onPointerUp={(event) => {
        if (dragRef.current) {
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            // Pointer capture may already be released by the browser.
          }
        }
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    />
  );
}

function drawSpectral(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tile: SpectralTile | null,
  clip: Clip | null,
  regions: SpectralRepairRegion[],
  selectedRegionId: string | undefined,
  viewMode: RepairViewMode,
  selection: SweetSpectralSelection | null,
) {
  ctx.clearRect(0, 0, width, height);
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#081426");
  background.addColorStop(1, "#030712");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  if (!clip) {
    drawCenteredText(ctx, width, height, "Select a clip to build a spectrogram");
    return;
  }

  if (!tile) {
    drawCenteredText(ctx, width, height, "Building lightweight STFT view...");
    return;
  }

  const cellW = width / tile.timeBins;
  const cellH = height / tile.freqBins;
  for (let y = 0; y < tile.freqBins; y += 1) {
    for (let x = 0; x < tile.timeBins; x += 1) {
      const value = tile.values[y * tile.timeBins + x] ?? 0;
      ctx.fillStyle = viewMode === "artifact_heatmap" ? heatColor(value) : spectralColor(value);
      ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 1;
  for (const hz of [60, 120, 250, 500, 1000, 3000, 8000, 12000]) {
    const y = hzToY(hz, height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (selection) drawSelection(ctx, width, height, clip, selection);

  const clipRegions = regions.filter((region) => region.clipId === clip.id || region.fileId === clip.fileId);
  for (const region of clipRegions) {
    const x = ((region.startSec - clip.timelineStartSec) / Math.max(0.001, clip.durationSec)) * width;
    const w = ((region.endSec - region.startSec) / Math.max(0.001, clip.durationSec)) * width;
    const y1 = hzToY(region.highHz, height);
    const y2 = hzToY(region.lowHz, height);
    ctx.fillStyle = region.enabled ? (PROBLEM_COLORS[region.problemType] ?? "rgba(244,201,93,0.45)") : "rgba(255,255,255,0.08)";
    ctx.globalAlpha = region.fixed ? 0.18 : 0.28;
    ctx.fillRect(x, y1, Math.max(2, w), Math.max(2, y2 - y1));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = region.id === selectedRegionId ? "rgba(255,255,255,0.95)" : region.fixed ? "rgba(101,240,164,0.75)" : "rgba(244,201,93,0.72)";
    ctx.lineWidth = region.id === selectedRegionId ? 2 : 1;
    ctx.strokeRect(x, y1, Math.max(2, w), Math.max(2, y2 - y1));
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, width: number, height: number, clip: Clip, selection: SweetSpectralSelection) {
  const x = ((selection.startSec - clip.timelineStartSec) / Math.max(0.001, clip.durationSec)) * width;
  const w = ((selection.endSec - selection.startSec) / Math.max(0.001, clip.durationSec)) * width;
  const lowHz = selection.minHz ?? 20;
  const highHz = selection.maxHz ?? 20000;
  const y1 = hzToY(highHz, height);
  const y2 = hzToY(lowHz, height);
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = "rgba(103,232,249,0.95)";
  ctx.fillStyle = "rgba(103,232,249,0.12)";
  ctx.lineWidth = 2;
  ctx.fillRect(x, y1, Math.max(2, w), Math.max(2, y2 - y1));
  ctx.strokeRect(x, y1, Math.max(2, w), Math.max(2, y2 - y1));
  ctx.restore();
}

function pointerToTime(x: number, width: number, clip: Clip) {
  return clip.timelineStartSec + (x / Math.max(1, width)) * clip.durationSec;
}

function spectralColor(value: number) {
  const t = value / 255;
  const r = Math.round(20 + t * 80);
  const g = Math.round(60 + t * 170);
  const b = Math.round(100 + t * 140);
  return `rgb(${r},${g},${b})`;
}

function heatColor(value: number) {
  const t = value / 255;
  const r = Math.round(30 + t * 225);
  const g = Math.round(35 + Math.sin(t * Math.PI) * 180);
  const b = Math.round(70 + (1 - t) * 120);
  return `rgba(${r},${g},${b},0.95)`;
}

function hzToY(hz: number, height: number) {
  const minHz = 20;
  const maxHz = 20000;
  const ratio = Math.log(Math.max(minHz, Math.min(maxHz, hz)) / minHz) / Math.log(maxHz / minHz);
  return height * (1 - ratio);
}

function yToHz(y: number, height: number) {
  const minHz = 20;
  const maxHz = 20000;
  const ratio = 1 - y / Math.max(1, height);
  return minHz * (maxHz / minHz) ** ratio;
}

function drawCenteredText(ctx: CanvasRenderingContext2D, width: number, height: number, text: string) {
  ctx.fillStyle = "rgba(244,247,251,0.62)";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}