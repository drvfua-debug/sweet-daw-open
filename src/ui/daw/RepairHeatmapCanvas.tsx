"use client";

import React, { useEffect, useMemo, useRef } from "react";
import type { RepairHeatmapCell, RepairHeatmapViewMode } from "@/daw/mix/mixDoctorTypes";

export type RepairSelectionRange = {
  startTime: number;
  endTime: number;
  lowFreq: number;
  highFreq: number;
};

export type RepairZoomState = {
  visibleStartSec: number;
  visibleEndSec: number;
  minFreq: number;
  maxFreq: number;
};

type RepairHeatmapCanvasProps = {
  cells: RepairHeatmapCell[];
  viewMode: RepairHeatmapViewMode;
  durationSec: number;
  selectedCellIds: string[];
  visibleStartSec: number;
  visibleEndSec: number;
  minFreq: number;
  maxFreq: number;
  onSelectCell: (cell: RepairHeatmapCell) => void;
  onSelectRange: (range: RepairSelectionRange) => void;
  onZoomChange: (next: RepairZoomState) => void;
};

type PointerPoint = {
  x: number;
  y: number;
};

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DOUBLE_TAP_MS = 320;

export function RepairHeatmapCanvas({
  cells,
  viewMode,
  durationSec,
  selectedCellIds,
  visibleStartSec,
  visibleEndSec,
  minFreq,
  maxFreq,
  onSelectCell,
  onSelectRange,
  onZoomChange,
}: RepairHeatmapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectedSet = useMemo(() => new Set(selectedCellIds), [selectedCellIds]);
  const dragRef = useRef<{ start: PointerPoint; last: PointerPoint; selecting: boolean; longPressId: number | null } | null>(null);
  const pointersRef = useRef(new Map<number, PointerPoint>());
  const pinchRef = useRef<{ distance: number; visibleStartSec: number; visibleEndSec: number } | null>(null);
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.floor(rect.width * dpr));
    const height = Math.max(220, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHeatmap(context, rect.width, rect.height, {
      cells,
      viewMode,
      selectedSet,
      visibleStartSec,
      visibleEndSec,
      minFreq,
      maxFreq,
    });
  }, [cells, maxFreq, minFreq, selectedSet, viewMode, visibleEndSec, visibleStartSec]);

  const toLocalPoint = (event: React.PointerEvent<HTMLCanvasElement>): PointerPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toLocalPoint(event);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      if (first && second) {
        pinchRef.current = {
          distance: Math.max(1, Math.abs(first.x - second.x)),
          visibleStartSec,
          visibleEndSec,
        };
      }
      return;
    }
    const longPressId = window.setTimeout(() => {
      if (dragRef.current) dragRef.current.selecting = true;
    }, 420);
    dragRef.current = { start: point, last: point, selecting: false, longPressId };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toLocalPoint(event);
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [first, second] = Array.from(pointersRef.current.values());
      if (!first || !second) return;
      const distance = Math.max(1, Math.abs(first.x - second.x));
      const scale = pinchRef.current.distance / distance;
      const center = (pinchRef.current.visibleStartSec + pinchRef.current.visibleEndSec) / 2;
      const nextDuration = clamp((pinchRef.current.visibleEndSec - pinchRef.current.visibleStartSec) * scale, 0.25, Math.max(0.25, durationSec));
      onZoomChange(clampZoom({ visibleStartSec: center - nextDuration / 2, visibleEndSec: center + nextDuration / 2, minFreq, maxFreq }, durationSec));
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const dx = point.x - drag.last.x;
    const dy = point.y - drag.last.y;
    drag.last = point;
    if (drag.selecting) return;
    if (Math.abs(point.x - drag.start.x) + Math.abs(point.y - drag.start.y) < 6) return;
    if (drag.longPressId != null) {
      window.clearTimeout(drag.longPressId);
      drag.longPressId = null;
    }
    const secondsPerPx = (visibleEndSec - visibleStartSec) / Math.max(1, rect.width);
    const nextStart = visibleStartSec - dx * secondsPerPx;
    const nextEnd = visibleEndSec - dx * secondsPerPx;
    const freqShift = dy / Math.max(1, rect.height);
    const logSpan = Math.log10(maxFreq) - Math.log10(minFreq);
    const nextMinLog = Math.log10(minFreq) + freqShift * logSpan;
    const nextMaxLog = Math.log10(maxFreq) + freqShift * logSpan;
    onZoomChange(clampZoom({
      visibleStartSec: nextStart,
      visibleEndSec: nextEnd,
      minFreq: 10 ** nextMinLog,
      maxFreq: 10 ** nextMaxLog,
    }, durationSec));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = toLocalPoint(event);
    pointersRef.current.delete(event.pointerId);
    pinchRef.current = null;
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.longPressId != null) window.clearTimeout(drag.longPressId);
    dragRef.current = null;
    const moved = Math.hypot(point.x - drag.start.x, point.y - drag.start.y);
    const rect = event.currentTarget.getBoundingClientRect();
    if (drag.selecting && moved > 8) {
      const start = pointToTimeFreq(drag.start, rect.width, rect.height, visibleStartSec, visibleEndSec, minFreq, maxFreq);
      const end = pointToTimeFreq(point, rect.width, rect.height, visibleStartSec, visibleEndSec, minFreq, maxFreq);
      onSelectRange({
        startTime: round2(Math.min(start.time, end.time)),
        endTime: round2(Math.max(start.time + 0.02, end.time)),
        lowFreq: Math.round(Math.min(start.freq, end.freq)),
        highFreq: Math.round(Math.max(start.freq + 10, end.freq)),
      });
      return;
    }

    if (moved < 8) {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && now - last.at < DOUBLE_TAP_MS && Math.hypot(point.x - last.x, point.y - last.y) < 28) {
        zoomToNearestHotCell(point, rect.width, rect.height);
        lastTapRef.current = null;
      } else {
        const nearest = findNearestCell(point, rect.width, rect.height);
        if (nearest) onSelectCell(nearest);
        lastTapRef.current = { at: now, x: point.x, y: point.y };
      }
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.shiftKey) {
      const factor = event.deltaY > 0 ? 1.18 : 0.84;
      const centerLog = (Math.log10(minFreq) + Math.log10(maxFreq)) / 2;
      const span = clamp((Math.log10(maxFreq) - Math.log10(minFreq)) * factor, 0.08, Math.log10(MAX_FREQ) - Math.log10(MIN_FREQ));
      onZoomChange(clampZoom({ visibleStartSec, visibleEndSec, minFreq: 10 ** (centerLog - span / 2), maxFreq: 10 ** (centerLog + span / 2) }, durationSec));
      return;
    }
    const factor = event.deltaY > 0 ? 1.18 : 0.84;
    const pointer = toLocalPoint(event as unknown as React.PointerEvent<HTMLCanvasElement>);
    const center = visibleStartSec + (pointer.x / Math.max(1, rect.width)) * (visibleEndSec - visibleStartSec);
    const nextDuration = clamp((visibleEndSec - visibleStartSec) * factor, 0.25, Math.max(0.25, durationSec));
    onZoomChange(clampZoom({ visibleStartSec: center - nextDuration / 2, visibleEndSec: center + nextDuration / 2, minFreq, maxFreq }, durationSec));
  };

  const findNearestCell = (point: PointerPoint, width: number, height: number) => {
    let best: RepairHeatmapCell | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cell of cells) {
      if (cell.endTime < visibleStartSec || cell.startTime > visibleEndSec || cell.highFreq < minFreq || cell.lowFreq > maxFreq) continue;
      const cx = ((Math.max(cell.startTime, visibleStartSec) + Math.min(cell.endTime, visibleEndSec)) / 2 - visibleStartSec) / Math.max(0.001, visibleEndSec - visibleStartSec) * width;
      const cy = (freqToY(Math.sqrt(cell.lowFreq * cell.highFreq), height, minFreq, maxFreq));
      const distance = Math.hypot(cx - point.x, cy - point.y);
      if (distance < bestDistance) {
        best = cell;
        bestDistance = distance;
      }
    }
    return bestDistance <= 44 ? best : null;
  };

  const zoomToNearestHotCell = (point: PointerPoint, width: number, height: number) => {
    const hotCells = cells.filter((cell) => cell.beforeScore >= 55);
    const candidate = findNearestCell(point, width, height) ?? hotCells[0];
    if (!candidate) return;
    const currentDuration = visibleEndSec - visibleStartSec;
    const nextDuration = currentDuration > 30 ? 30 : currentDuration > 5 ? 5 : currentDuration > 1 ? 1 : 0.25;
    const center = (candidate.startTime + candidate.endTime) / 2;
    onZoomChange(clampZoom({
      visibleStartSec: center - nextDuration / 2,
      visibleEndSec: center + nextDuration / 2,
      minFreq: Math.max(MIN_FREQ, candidate.lowFreq / 1.6),
      maxFreq: Math.min(MAX_FREQ, candidate.highFreq * 1.6),
    }, durationSec));
    onSelectCell(candidate);
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-full min-h-[300px] w-full touch-none rounded-lg border border-white/[0.07] bg-[#06111c]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      aria-label="Repair heatmap"
    />
  );
}

function drawHeatmap(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: {
    cells: RepairHeatmapCell[];
    viewMode: RepairHeatmapViewMode;
    selectedSet: Set<string>;
    visibleStartSec: number;
    visibleEndSec: number;
    minFreq: number;
    maxFreq: number;
  },
) {
  context.clearRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#081927");
  gradient.addColorStop(1, "#020711");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  drawGrid(context, width, height, state.visibleStartSec, state.visibleEndSec, state.minFreq, state.maxFreq);

  for (const cell of state.cells) {
    if (cell.endTime < state.visibleStartSec || cell.startTime > state.visibleEndSec || cell.highFreq < state.minFreq || cell.lowFreq > state.maxFreq) continue;
    const x1 = timeToX(Math.max(cell.startTime, state.visibleStartSec), width, state.visibleStartSec, state.visibleEndSec);
    const x2 = timeToX(Math.min(cell.endTime, state.visibleEndSec), width, state.visibleStartSec, state.visibleEndSec);
    const y1 = freqToY(Math.min(cell.highFreq, state.maxFreq), height, state.minFreq, state.maxFreq);
    const y2 = freqToY(Math.max(cell.lowFreq, state.minFreq), height, state.minFreq, state.maxFreq);
    const score = state.viewMode === "after" ? cell.afterScore ?? cell.beforeScore : state.viewMode === "difference" ? cell.differenceScore ?? 0 : cell.beforeScore;
    context.globalAlpha = clamp(0.25 + cell.confidence * 0.7, 0.2, 0.95);
    context.fillStyle = colorForCell(cell, score, state.viewMode);
    context.fillRect(x1, y1, Math.max(2, x2 - x1), Math.max(2, y2 - y1));
    context.globalAlpha = 1;
    if (cell.protectMain) {
      context.strokeStyle = "#7c5cff";
      context.lineWidth = 1;
      context.strokeRect(x1 + 0.5, y1 + 0.5, Math.max(2, x2 - x1) - 1, Math.max(2, y2 - y1) - 1);
    }
    if (state.selectedSet.has(cell.id)) {
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.strokeRect(x1 + 1, y1 + 1, Math.max(2, x2 - x1) - 2, Math.max(2, y2 - y1) - 2);
    }
  }
  context.globalAlpha = 1;
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, startSec: number, endSec: number, minFreq: number, maxFreq: number) {
  context.strokeStyle = "rgba(255,255,255,0.07)";
  context.lineWidth = 1;
  const duration = Math.max(0.001, endSec - startSec);
  const step = duration > 60 ? 30 : duration > 20 ? 10 : duration > 5 ? 1 : 0.25;
  for (let time = Math.ceil(startSec / step) * step; time <= endSec; time += step) {
    const x = timeToX(time, width, startSec, endSec);
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (const freq of [20, 35, 60, 120, 250, 500, 900, 1500, 3000, 5000, 9000, 12000, 16000, 20000]) {
    if (freq < minFreq || freq > maxFreq) continue;
    const y = freqToY(freq, height, minFreq, maxFreq);
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    context.fillStyle = "rgba(244,247,251,0.45)";
    context.font = "10px system-ui";
    context.fillText(freq >= 1000 ? `${freq / 1000}k` : String(freq), 6, Math.max(10, y - 3));
  }
}

function colorForCell(cell: RepairHeatmapCell, score: number, mode: RepairHeatmapViewMode) {
  if (cell.protectMain || cell.suggestedOperation === "protect") return "#7c5cff";
  if (mode === "difference") {
    if ((cell.suggestedGainDb ?? 0) < -4.5 || cell.strength > 0.75) return "#6d4a7c";
    if (score > 18) return "#46e0a5";
    if (score > 3) return "#4aa8ff";
    if (score < -1) return "#ef3b46";
    return "#5b6570";
  }
  if (mode === "after") {
    if (score < 20) return "#06111c";
    if (score < 40) return "#0b3c4a";
    if (score < 55) return "#1f9f8a";
    if (score < 75) return "#d7b84a";
    return "#ef3b46";
  }
  if (score < 20) return "#06111c";
  if (score < 40) return "#0d3750";
  if (score < 55) return "#d7b84a";
  if (score < 75) return "#e87832";
  return "#ef3b46";
}

function pointToTimeFreq(point: PointerPoint, width: number, height: number, startSec: number, endSec: number, minFreq: number, maxFreq: number) {
  return {
    time: startSec + clamp(point.x / Math.max(1, width), 0, 1) * (endSec - startSec),
    freq: yToFreq(point.y, height, minFreq, maxFreq),
  };
}

function timeToX(time: number, width: number, startSec: number, endSec: number) {
  return ((time - startSec) / Math.max(0.001, endSec - startSec)) * width;
}

function freqToY(freq: number, height: number, minFreq: number, maxFreq: number) {
  const minLog = Math.log10(Math.max(MIN_FREQ, minFreq));
  const maxLog = Math.log10(Math.min(MAX_FREQ, maxFreq));
  const value = (Math.log10(clamp(freq, minFreq, maxFreq)) - minLog) / Math.max(0.001, maxLog - minLog);
  return height - value * height;
}

function yToFreq(y: number, height: number, minFreq: number, maxFreq: number) {
  const minLog = Math.log10(Math.max(MIN_FREQ, minFreq));
  const maxLog = Math.log10(Math.min(MAX_FREQ, maxFreq));
  const value = 1 - clamp(y / Math.max(1, height), 0, 1);
  return 10 ** (minLog + value * (maxLog - minLog));
}

function clampZoom(next: RepairZoomState, durationSec: number): RepairZoomState {
  const visibleDuration = clamp(next.visibleEndSec - next.visibleStartSec, 0.25, Math.max(0.25, durationSec));
  let start = clamp(next.visibleStartSec, 0, Math.max(0, durationSec - visibleDuration));
  let end = start + visibleDuration;
  if (end > durationSec) {
    end = durationSec;
    start = Math.max(0, end - visibleDuration);
  }
  const minLog = Math.log10(MIN_FREQ);
  const maxLog = Math.log10(MAX_FREQ);
  const requestedMin = clamp(next.minFreq, MIN_FREQ, MAX_FREQ);
  const requestedMax = clamp(next.maxFreq, MIN_FREQ, MAX_FREQ);
  let lowLog = Math.log10(Math.min(requestedMin, requestedMax - 1));
  let highLog = Math.log10(Math.max(requestedMax, requestedMin + 1));
  const span = clamp(highLog - lowLog, 0.08, maxLog - minLog);
  const center = clamp((lowLog + highLog) / 2, minLog + span / 2, maxLog - span / 2);
  lowLog = center - span / 2;
  highLog = center + span / 2;
  return {
    visibleStartSec: round2(start),
    visibleEndSec: round2(end),
    minFreq: Math.round(10 ** lowLog),
    maxFreq: Math.round(10 ** highLog),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
