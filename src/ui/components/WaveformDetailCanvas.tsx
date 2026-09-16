"use client";

import { useEffect, useRef } from "react";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Clip } from "@/daw/model/Project";
import type { SpectralRepairRegion } from "@/daw/repair/repairTypes";

type WaveformDetailCanvasProps = {
  clip: Clip | null;
  peaks?: PeakSummary;
  regions: SpectralRepairRegion[];
  selectedRegionId?: string;
  playheadSec: number;
  color?: string;
  onSelectRegion?: (regionId: string) => void;
};

export function WaveformDetailCanvas({
  clip,
  peaks,
  regions,
  selectedRegionId,
  playheadSec,
  color = "#4dd9ff",
  onSelectRegion,
}: WaveformDetailCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    drawWaveform(ctx, rect.width, rect.height, clip, peaks, regions, selectedRegionId, playheadSec, color);
  }, [clip, peaks, regions, selectedRegionId, playheadSec, color]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full min-h-[170px] w-full touch-none rounded-xl border border-daw-line bg-[#07101f]"
      onPointerDown={(event) => {
        if (!clip || regions.length === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const time = clip.timelineStartSec + (x / Math.max(1, rect.width)) * clip.durationSec;
        const hit = regions
          .filter((region) => region.clipId === clip.id || region.fileId === clip.fileId)
          .find((region) => time >= region.startSec && time <= region.endSec);
        if (hit) onSelectRegion?.(hit.id);
      }}
    />
  );
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: Clip | null,
  peaks: PeakSummary | undefined,
  regions: SpectralRepairRegion[],
  selectedRegionId: string | undefined,
  playheadSec: number,
  color: string,
) {
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0c1931");
  gradient.addColorStop(1, "#050915");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = (height / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (!clip || !peaks) {
    drawCenteredText(ctx, width, height, "Select a clip to inspect waveform detail");
    return;
  }

  const centerY = height / 2;
  const sourceStart = clip.sourceStartSec;
  const sourceEnd = clip.sourceStartSec + clip.durationSec;
  const startBin = Math.max(0, Math.floor((sourceStart / Math.max(0.001, peaks.durationSec)) * peaks.bins));
  const endBin = Math.max(startBin + 1, Math.min(peaks.bins - 1, Math.ceil((sourceEnd / Math.max(0.001, peaks.durationSec)) * peaks.bins)));
  const binsVisible = Math.max(1, endBin - startBin);

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const bin = startBin + Math.floor((x / Math.max(1, width - 1)) * binsVisible);
    const min = peaks.min[bin] ?? 0;
    const max = peaks.max[bin] ?? 0;
    const y1 = centerY - max * (height * 0.42);
    const y2 = centerY - min * (height * 0.42);
    ctx.moveTo(x + 0.5, y1);
    ctx.lineTo(x + 0.5, y2);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  const clipRegions = regions.filter((region) => region.clipId === clip.id || region.fileId === clip.fileId);
  for (const region of clipRegions) {
    const x = ((region.startSec - clip.timelineStartSec) / Math.max(0.001, clip.durationSec)) * width;
    const w = ((region.endSec - region.startSec) / Math.max(0.001, clip.durationSec)) * width;
    ctx.fillStyle = region.fixed ? "rgba(101,240,164,0.16)" : region.enabled ? "rgba(244,201,93,0.18)" : "rgba(255,255,255,0.08)";
    ctx.fillRect(x, 0, Math.max(2, w), height);
    ctx.strokeStyle = region.id === selectedRegionId ? "rgba(255,255,255,0.9)" : region.fixed ? "rgba(101,240,164,0.65)" : "rgba(244,201,93,0.55)";
    ctx.lineWidth = region.id === selectedRegionId ? 2 : 1;
    ctx.strokeRect(x, 0.5, Math.max(2, w), height - 1);
  }

  if (playheadSec >= clip.timelineStartSec && playheadSec <= clip.timelineStartSec + clip.durationSec) {
    const x = ((playheadSec - clip.timelineStartSec) / Math.max(0.001, clip.durationSec)) * width;
    ctx.strokeStyle = "rgba(255,111,168,0.9)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
}

function drawCenteredText(ctx: CanvasRenderingContext2D, width: number, height: number, text: string) {
  ctx.fillStyle = "rgba(244,247,251,0.56)";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);
}
