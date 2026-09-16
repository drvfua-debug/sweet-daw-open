"use client";

import { useEffect, useRef } from "react";
import { fillRoundedRect } from "@/ui/canvas/safeCanvas";

type VuMeterProps = {
  rmsDb: number;
  peakDb: number;
  clipping?: boolean;
  width?: number;
  height?: number;
  orientation?: "vertical" | "horizontal";
};

const FLOOR_DB = -60;
const CEIL_DB = 3;

function dbToNorm(db: number): number {
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
}

export function VuMeter({
  rmsDb,
  peakDb,
  clipping = false,
  width = 8,
  height = 140,
  orientation = "vertical",
}: VuMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rmsRef = useRef(rmsDb);
  const peakRef = useRef(peakDb);
  const clippingRef = useRef(clipping);

  rmsRef.current = rmsDb;
  peakRef.current = peakDb;
  clippingRef.current = clipping;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = orientation === "vertical" ? width : height;
    const h = orientation === "vertical" ? height : width;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    let rafId: number;

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Background
      ctx.fillStyle = "rgba(8, 10, 15, 0.8)";
      ctx.beginPath();
      fillRoundedRect(ctx, 0, 0, w, h, 3);
      ctx.fill();

      const rmsNorm = dbToNorm(rmsRef.current);
      const peakNorm = dbToNorm(peakRef.current);

      if (orientation === "vertical") {
        // RMS bar (bottom to top)
        const rmsH = rmsNorm * h;
        const gradient = ctx.createLinearGradient(0, h, 0, 0);
        gradient.addColorStop(0, "#65f0a4");
        gradient.addColorStop(0.6, "#65f0a4");
        gradient.addColorStop(0.78, "#f4c95d");
        gradient.addColorStop(0.92, "#ff5f6d");
        gradient.addColorStop(1, "#ff5f6d");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        fillRoundedRect(ctx, 1, h - rmsH, w - 2, rmsH, 2);
        ctx.fill();

        // Peak indicator line
        const peakY = h - peakNorm * h;
        ctx.fillStyle = clippingRef.current ? "#ff5f6d" : "#ffffff";
        ctx.fillRect(0, peakY, w, 2);
      } else {
        // Horizontal mode
        const rmsW = rmsNorm * w;
        const gradient = ctx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, "#65f0a4");
        gradient.addColorStop(0.6, "#65f0a4");
        gradient.addColorStop(0.78, "#f4c95d");
        gradient.addColorStop(0.92, "#ff5f6d");
        gradient.addColorStop(1, "#ff5f6d");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        fillRoundedRect(ctx, 0, 1, rmsW, h - 2, 2);
        ctx.fill();

        const peakX = peakNorm * w;
        ctx.fillStyle = clippingRef.current ? "#ff5f6d" : "#ffffff";
        ctx.fillRect(peakX, 0, 2, h);
      }

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [width, height, orientation]);

  return (
    <canvas
      ref={canvasRef}
      className="block flex-shrink-0"
      style={{
        width: orientation === "vertical" ? width : height,
        height: orientation === "vertical" ? height : width,
      }}
      aria-hidden="true"
    />
  );
}
