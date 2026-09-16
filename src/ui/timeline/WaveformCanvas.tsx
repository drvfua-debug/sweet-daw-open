"use client";

import { useEffect, useRef } from "react";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { fillRoundedRect } from "@/ui/canvas/safeCanvas";

type WaveformCanvasProps = {
  peaks: PeakSummary | undefined;
  color: string;
  height?: number;
  sourceStartSec?: number;
  durationSec?: number;
  detailMode?: boolean;
};

export function WaveformCanvas({ peaks, color, height = 64, sourceStartSec = 0, durationSec, detailMode = false }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    function render() {
      if (!canvas || !peaks) return;

      const parentWidth = canvas.clientWidth || 1;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(parentWidth * dpr);
      const h = Math.floor(height * dpr);

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, parentWidth, height);

      // Subtle background
      ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
      ctx.beginPath();
      fillRoundedRect(ctx, 0, 0, parentWidth, height, 4);
      ctx.fill();

      const middle = height / 2;
      const visibleDurationSec = Math.max(0.001, Math.min(durationSec ?? peaks.durationSec, peaks.durationSec));
      const visibleStartSec = Math.max(0, Math.min(sourceStartSec, Math.max(0, peaks.durationSec - visibleDurationSec)));
      const visibleEndSec = Math.min(peaks.durationSec, visibleStartSec + visibleDurationSec);
      const startBin = Math.max(0, Math.floor((visibleStartSec / peaks.durationSec) * peaks.bins));
      const endBin = Math.min(peaks.bins, Math.ceil((visibleEndSec / peaks.durationSec) * peaks.bins));
      const visibleBins = Math.max(1, endBin - startBin);
      const step = parentWidth / visibleBins;
      const drawEveryBin = detailMode && step >= 0.45;
      const lineWidth = drawEveryBin ? Math.max(0.75, Math.min(1.25, step * 0.75)) : Math.max(1, step * 0.65);

      // Gradient fill behind waveform
      const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
      fillGrad.addColorStop(0, `${color}18`);
      fillGrad.addColorStop(0.5, `${color}08`);
      fillGrad.addColorStop(1, `${color}18`);

      ctx.fillStyle = fillGrad;
      ctx.beginPath();
      ctx.moveTo(0, middle);
      for (let i = 0; i < visibleBins; i++) {
        const peakIndex = startBin + i;
        const x = i * step + step / 2;
        const maxY = middle + (peaks.max[peakIndex] ?? 0) * middle;
        ctx.lineTo(x, maxY);
      }
      for (let i = visibleBins - 1; i >= 0; i--) {
        const peakIndex = startBin + i;
        const x = i * step + step / 2;
        const minY = middle + (peaks.min[peakIndex] ?? 0) * middle;
        ctx.lineTo(x, minY);
      }
      ctx.closePath();
      ctx.fill();

      // Waveform lines
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = 0.85;
      ctx.lineCap = "round";
      ctx.beginPath();

      const stride = drawEveryBin ? 1 : Math.max(1, Math.floor(visibleBins / Math.max(1, parentWidth)));
      for (let i = 0; i < visibleBins; i += stride) {
        const peakIndex = startBin + i;
        const x = i * step + step / 2;
        const minVal = peaks.min[peakIndex] ?? 0;
        const maxVal = peaks.max[peakIndex] ?? 0;
        const minY = middle + minVal * middle;
        const maxY = middle + maxVal * middle;
        const clampMin = Math.max(2, Math.min(height - 2, minY));
        const clampMax = Math.max(2, Math.min(height - 2, maxY));
        ctx.moveTo(x, clampMin);
        ctx.lineTo(x, clampMax);
      }

      ctx.stroke();

      if (detailMode) {
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = "rgba(255,255,255,0.72)";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let i = 0; i < visibleBins; i += Math.max(1, Math.floor(stride * 4))) {
          const peakIndex = startBin + i;
          const x = i * step + step / 2;
          const minVal = peaks.min[peakIndex] ?? 0;
          const maxVal = peaks.max[peakIndex] ?? 0;
          const energy = Math.min(1, Math.max(Math.abs(minVal), Math.abs(maxVal)));
          const y = middle - energy * middle * 0.72;
          ctx.moveTo(x, y);
          ctx.lineTo(x, middle + energy * middle * 0.72);
        }
        ctx.stroke();
      }

      // Center line
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, middle);
      ctx.lineTo(parentWidth, middle);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }

    render();

    // ResizeObserver for responsive re-render
    if (typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(() => render());
      observerRef.current.observe(canvas);
    }

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [color, detailMode, durationSec, height, peaks, sourceStartSec]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      style={{ height }}
      aria-hidden="true"
    />
  );
}
