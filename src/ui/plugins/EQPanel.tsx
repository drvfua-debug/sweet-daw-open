"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Power, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { applyEQPreset, EQ_PRESETS } from "@/audio/presets/eqPresets";
import {
  buildEqCurvePoints,
  type EqCurvePoint,
  frequencyToNormalizedX,
  MAX_EQ_GAIN_DB,
  MAX_EQ_Q,
  MIN_EQ_GAIN_DB,
  MIN_EQ_Q,
  normalizedXToFrequency,
  sanitizeEqBand,
  sanitizeParametricEQState,
} from "@/audio/fx/ParametricEQ";
import type { SpectrumReading, WaveformReading } from "@/audio/engine/MeterBridge";
import type { EQBand, EQBandType, ParametricEQState } from "@/daw/model/Project";

type EQPanelProps = {
  title: string;
  subtitle?: string;
  color?: string;
  eq: ParametricEQState;
  onChange: (eq: ParametricEQState) => void;
  onClose: () => void;
  readSpectrum?: () => SpectrumReading | null;
  readWaveform?: () => WaveformReading | null;
  insertChain?: Array<{
    label: string;
    active: boolean;
    detail?: string;
  }>;
};

const EQ_TYPES: EQBandType[] = ["highpass", "lowshelf", "peaking", "notch", "highshelf", "lowpass"];
const FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GAIN_LABELS = [-18, -12, -6, 0, 6, 12, 18];

export function EQPanel({
  title,
  subtitle,
  color = "#4dd9ff",
  eq,
  onChange,
  onClose,
  readSpectrum,
  readWaveform,
  insertChain = [],
}: EQPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedBandId, setSelectedBandId] = useState(eq.bands[0]?.id ?? "");
  const [draggingBandId, setDraggingBandId] = useState<string | null>(null);
  const safeEq = useMemo(() => sanitizeParametricEQState(eq), [eq]);
  const curvePoints = useMemo(() => buildEqCurvePoints(safeEq, 48000, 256), [safeEq]);

  const selectedBand = useMemo(() => {
    return safeEq.bands.find((band) => band.id === selectedBandId) ?? safeEq.bands[0] ?? null;
  }, [safeEq.bands, selectedBandId]);

  useEffect(() => {
    if (!selectedBand && safeEq.bands[0]) setSelectedBandId(safeEq.bands[0].id);
  }, [safeEq.bands, selectedBand]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const waveformCanvas = waveformCanvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let lastFrame = 0;
    const draw = (now = 0) => {
      const shouldAnimate = Boolean(readSpectrum || readWaveform);
      if (shouldAnimate && now - lastFrame < 33) {
        rafId = window.requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;
      const spectrum = readSpectrum?.() ?? null;
      const waveform = readWaveform?.() ?? null;
      drawEqCanvas(canvas, safeEq, selectedBandId, color, curvePoints, spectrum);
      if (waveformCanvas) {
        drawWaveformCanvas(waveformCanvas, waveform, color, safeEq.analyzerMode);
      }
      if (shouldAnimate) {
        rafId = window.requestAnimationFrame(draw);
      }
    };
    const drawNow = () => draw(performance.now());
    drawNow();
    window.addEventListener("resize", drawNow);
    return () => {
      window.removeEventListener("resize", drawNow);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [color, curvePoints, readSpectrum, readWaveform, safeEq, selectedBandId]);

  const updateBand = (bandId: string, patch: Partial<EQBand>) => {
    onChange(
      sanitizeParametricEQState({
        ...safeEq,
        bands: safeEq.bands.map((band) => (band.id === bandId ? sanitizeEqBand({ ...band, ...patch }) : sanitizeEqBand(band))),
      }),
    );
  };

  const updateSelectedFromPointer = (event: React.PointerEvent<HTMLCanvasElement>, bandId: string) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const band = safeEq.bands.find((candidate) => candidate.id === bandId);
    if (!band) return;

    const gainCapable = supportsGain(band.type);
    updateBand(bandId, {
      frequency: Math.round(normalizedXToFrequency(x)),
      gainDb: gainCapable ? Math.round(clamp(18 - y * 36, MIN_EQ_GAIN_DB, MAX_EQ_GAIN_DB) * 10) / 10 : band.gainDb,
      q: gainCapable ? band.q : Math.round(clamp(yToQ(y), MIN_EQ_Q, MAX_EQ_Q) * 10) / 10,
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const picked = pickNearestBand(safeEq, rect.width, rect.height, x, y);
    const bandId = picked?.id ?? selectedBand?.id;
    if (!bandId) return;

    setSelectedBandId(bandId);
    setDraggingBandId(bandId);
    canvas.setPointerCapture(event.pointerId);
    updateSelectedFromPointer(event, bandId);
  };

  const resetEq = () => {
    onChange(sanitizeParametricEQState({
      ...safeEq,
      enabled: false,
      bands: safeEq.bands.map((band) => ({
        ...band,
        gainDb: 0,
        enabled: true,
        solo: false,
      })),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-daw-bg/80 p-2 backdrop-blur-md sm:items-center sm:justify-center">
      <section className="view-enter flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-panel shadow-2xl">
        <header className="flex min-h-[52px] items-center justify-between border-b border-daw-line px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-daw-cyan/25 bg-daw-cyan/10 text-daw-cyan">
              <SlidersHorizontal size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold">{title}</h2>
              {subtitle && <p className="truncate text-[11px] text-daw-muted">{subtitle}</p>}
            </div>
          </div>
          <button type="button" className="daw-btn daw-btn-ghost !min-h-[36px] !rounded-lg" onClick={onClose} aria-label="Close EQ">
            <X size={16} />
          </button>
        </header>

        <div className="daw-scrollbar min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-3">
              {insertChain.length > 0 && (
                <div className="rounded-xl border border-daw-line bg-daw-panel2 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-daw-muted">Insert Chain</span>
                    <span className="text-[10px] text-daw-muted">{safeEq.analyzerMode.toUpperCase()} monitor</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {insertChain.map((insert, index) => (
                      <div
                        key={`${insert.label}-${index}`}
                        className={`flex min-h-[32px] items-center justify-between rounded-lg border px-2 text-[11px] ${
                          insert.active
                            ? "border-daw-cyan/35 bg-daw-cyan/12 text-daw-cyan"
                            : "border-daw-line bg-white/[0.02] text-daw-muted"
                        }`}
                      >
                        <span className="font-semibold">{index + 1}. {insert.label}</span>
                        <span className="timecode text-[10px]">{insert.detail ?? (insert.active ? "ON" : "OFF")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-daw-line bg-[#071017] p-2">
                <canvas
                  ref={canvasRef}
                  className="block h-[230px] w-full touch-none rounded-lg"
                  onPointerDown={handlePointerDown}
                  onPointerMove={(event) => {
                    if (draggingBandId) updateSelectedFromPointer(event, draggingBandId);
                  }}
                  onPointerUp={(event) => {
                    setDraggingBandId(null);
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                  onPointerCancel={() => setDraggingBandId(null)}
                  aria-label="Parametric EQ graph"
                />
              </div>

              <div className="rounded-xl border border-daw-line bg-[#071017] p-2">
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-[10px] font-bold text-daw-muted">Realtime waveform</span>
                  <span className="text-[10px] text-daw-muted">{readWaveform ? "LIVE" : "WAITING"}</span>
                </div>
                <canvas
                  ref={waveformCanvasRef}
                  className="block h-[72px] w-full rounded-lg"
                  aria-label="Realtime waveform monitor"
                />
              </div>

              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                {safeEq.bands.map((band, index) => (
                  <button
                    key={band.id}
                    type="button"
                    onClick={() => setSelectedBandId(band.id)}
                    className={`daw-btn !min-h-[38px] !rounded-lg text-[10px] ${
                      band.id === selectedBand?.id ? "border-daw-cyan/50 bg-daw-cyan/15 text-daw-cyan" : "daw-btn-ghost"
                    } ${!band.enabled ? "opacity-45" : ""}`}
                  >
                    B{index + 1}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-daw-line bg-daw-panel2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-daw-muted">Presets</span>
                  <button type="button" className="daw-btn daw-btn-ghost !min-h-[32px] !rounded-lg text-[10px]" onClick={resetEq}>
                    <RotateCcw size={13} />
                    Reset
                  </button>
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {EQ_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="rounded-lg border border-daw-line bg-white/[0.03] px-2 py-2 text-left text-[11px] text-daw-text active:bg-daw-cyan/15"
                      onClick={() => onChange(applyEQPreset(safeEq, preset))}
                      title={preset.description}
                    >
                      <span className="block truncate font-semibold">{preset.name}</span>
                      <span className="block truncate text-[10px] text-daw-muted">{preset.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-daw-line bg-daw-panel2 p-3">
              {selectedBand ? (
                <BandEditor
                  band={selectedBand}
                  eqEnabled={safeEq.enabled}
                  analyzerEnabled={true}
                  analyzerMode={safeEq.analyzerMode}
                  onEqEnabledChange={(enabled) => onChange(sanitizeParametricEQState({ ...safeEq, enabled, analyzerEnabled: true }))}
                  onAnalyzerModeChange={(analyzerMode) => onChange(sanitizeParametricEQState({ ...safeEq, analyzerMode, analyzerEnabled: true }))}
                  onBandChange={(patch) => updateBand(selectedBand.id, patch)}
                />
              ) : (
                <div className="text-sm text-daw-muted">No EQ bands available</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function drawWaveformCanvas(
  canvas: HTMLCanvasElement,
  waveform: WaveformReading | null,
  accent: string,
  mode: ParametricEQState["analyzerMode"],
) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#05090d";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(218,232,240,0.4)";
  ctx.font = "10px Inter, sans-serif";
  ctx.fillText(mode.toUpperCase(), 8, 14);

  if (!waveform) {
    ctx.fillStyle = "rgba(218,232,240,0.38)";
    ctx.fillText("Play audio to monitor waveform", 8, height - 10);
    return;
  }

  const samples = waveform.samples;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let x = 0; x < width; x += 1) {
    const index = Math.floor((x / Math.max(1, width - 1)) * (samples.length - 1));
    const sample = clamp(samples[index] ?? 0, -1, 1);
    const y = height / 2 - sample * (height * 0.42);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function BandEditor({
  band,
  eqEnabled,
  analyzerEnabled,
  analyzerMode,
  onEqEnabledChange,
  onAnalyzerModeChange,
  onBandChange,
}: {
  band: EQBand;
  eqEnabled: boolean;
  analyzerEnabled: boolean;
  analyzerMode: ParametricEQState["analyzerMode"];
  onEqEnabledChange: (enabled: boolean) => void;
  onAnalyzerModeChange: (mode: ParametricEQState["analyzerMode"]) => void;
  onBandChange: (patch: Partial<EQBand>) => void;
}) {
  const gainCapable = supportsGain(band.type);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold">Selected Band</p>
          <p className="timecode mt-0.5 text-[11px] text-daw-muted">{formatFrequency(band.frequency)}</p>
        </div>
        <button
          type="button"
          onClick={() => onEqEnabledChange(!eqEnabled)}
          className={`daw-btn !min-h-[36px] !rounded-lg text-[11px] ${
            eqEnabled ? "border-daw-green/35 bg-daw-green/15 text-daw-green" : "daw-btn-ghost"
          }`}
        >
          <Power size={14} />
          {eqEnabled ? "On" : "Off"}
        </button>
      </div>

      <div className="rounded-xl border border-daw-line bg-daw-panel p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-daw-muted">
            <Activity size={13} />
            Spectrum
          </span>
          <span
            className={`rounded-lg border px-2 py-1 text-[10px] font-bold ${
              analyzerEnabled ? "border-daw-green/35 bg-daw-green/15 text-daw-green" : "border-daw-line bg-white/[0.03] text-daw-muted"
            }`}
          >
            Always On
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["pre", "post"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`daw-btn !min-h-[32px] !rounded-lg text-[10px] ${
                analyzerMode === mode ? "border-daw-cyan/35 bg-daw-cyan/15 text-daw-cyan" : "daw-btn-ghost"
              }`}
              onClick={() => onAnalyzerModeChange(mode)}
            >
              {mode.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <label className="block space-y-1.5 text-[11px] font-semibold text-daw-muted">
        Type
        <select
          className="min-h-[40px] w-full rounded-lg border border-daw-line bg-daw-panel px-2 text-sm text-daw-text"
          value={band.type}
          onChange={(event) => onBandChange({ type: event.target.value as EQBandType })}
        >
          {EQ_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <SliderRow
        label="Frequency"
        valueLabel={formatFrequency(band.frequency)}
        min={0}
        max={1000}
        step={1}
        value={Math.round(frequencyToNormalizedX(band.frequency) * 1000)}
        onChange={(value) => onBandChange({ frequency: Math.round(normalizedXToFrequency(value / 1000)) })}
      />

      <SliderRow
        label="Gain"
        valueLabel={`${band.gainDb > 0 ? "+" : ""}${band.gainDb.toFixed(1)} dB`}
        min={-18}
        max={18}
        step={0.1}
        value={band.gainDb}
        disabled={!gainCapable}
        onChange={(value) => onBandChange({ gainDb: value })}
      />

      <SliderRow
        label="Q"
        valueLabel={band.q.toFixed(1)}
        min={0.1}
        max={12}
        step={0.1}
        value={band.q}
        onChange={(value) => onBandChange({ q: value })}
      />

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className={`daw-btn !min-h-[40px] !rounded-lg text-[11px] ${
            band.enabled ? "border-daw-cyan/35 bg-daw-cyan/15 text-daw-cyan" : "daw-btn-ghost"
          }`}
          onClick={() => onBandChange({ enabled: !band.enabled })}
        >
          Band {band.enabled ? "On" : "Off"}
        </button>
        <button
          type="button"
          className={`daw-btn !min-h-[40px] !rounded-lg text-[11px] ${
            band.solo ? "border-daw-amber/45 bg-daw-amber/15 text-daw-amber" : "daw-btn-ghost"
          }`}
          onClick={() => onBandChange({ solo: !band.solo })}
        >
          Solo
        </button>
        <button
          type="button"
          className="daw-btn daw-btn-ghost !min-h-[40px] !rounded-lg text-[11px]"
          onClick={() => onBandChange({ gainDb: 0, q: 1 })}
        >
          Flat
        </button>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1.5 text-[11px] font-semibold text-daw-muted">
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="timecode text-daw-text">{valueLabel}</span>
      </span>
      <input
        type="range"
        className="daw-range w-full disabled:opacity-35"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function drawEqCanvas(
  canvas: HTMLCanvasElement,
  eq: ParametricEQState,
  selectedBandId: string,
  accent: string,
  curvePoints: EqCurvePoint[],
  spectrum: SpectrumReading | null,
) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0b1a24");
  gradient.addColorStop(1, "#05090d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "rgba(218,232,240,0.45)";
  ctx.font = "10px Inter, sans-serif";

  for (const frequency of FREQ_LABELS) {
    const x = frequencyToNormalizedX(frequency) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    if (frequency !== 20 && frequency !== 20000) {
      ctx.fillText(formatFrequency(frequency), x + 3, height - 8);
    }
  }

  for (const gain of GAIN_LABELS) {
    const y = dbToY(gain, height);
    ctx.strokeStyle = gain === 0 ? "rgba(77,217,255,0.28)" : "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    if (gain !== 0) ctx.fillText(`${gain}`, 6, y - 3);
  }

  if (spectrum) {
    drawSpectrumOverlay(ctx, width, height, spectrum, accent);
  }

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = eq.enabled ? accent : "rgba(218,232,240,0.38)";
  ctx.beginPath();
  for (let index = 0; index < curvePoints.length; index += 1) {
    const point = curvePoints[index];
    const x = point.x * width;
    const y = dbToY(clamp(point.db, -18, 18), height);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  for (let index = 0; index < eq.bands.length; index += 1) {
    const band = eq.bands[index];
    const point = getBandPoint(band, width, height);
    const selected = band.id === selectedBandId;
    ctx.beginPath();
    ctx.fillStyle = selected ? accent : "rgba(218,232,240,0.86)";
    ctx.strokeStyle = selected ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.7)";
    ctx.lineWidth = selected ? 2 : 1;
    ctx.arc(point.x, point.y, selected ? 9 : 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = selected ? "#061017" : "#111820";
    ctx.font = "bold 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), point.x, point.y + 0.5);
  }
}

function drawSpectrumOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spectrum: SpectrumReading,
  accent: string,
) {
  const { magnitudes, sampleRate, fftSize, minDb, maxDb } = spectrum;
  if (magnitudes.length === 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, height);

  for (let index = 1; index < magnitudes.length; index += 2) {
    const frequency = (index * sampleRate) / fftSize;
    if (frequency < 20 || frequency > 20000) continue;
    const x = frequencyToNormalizedX(frequency) * width;
    const normalized = clamp(((magnitudes[index] ?? minDb) - minDb) / (maxDb - minDb), 0, 1);
    const y = height - normalized * height * 0.86;
    ctx.lineTo(x, y);
  }

  ctx.lineTo(width, height);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, `${accent}66`);
  fill.addColorStop(1, `${accent}08`);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  for (let index = 1; index < magnitudes.length; index += 4) {
    const frequency = (index * sampleRate) / fftSize;
    if (frequency < 20 || frequency > 20000) continue;
    const x = frequencyToNormalizedX(frequency) * width;
    const normalized = clamp(((magnitudes[index] ?? minDb) - minDb) / (maxDb - minDb), 0, 1);
    const y = height - normalized * height * 0.86;
    if (index === 1) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `${accent}88`;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function pickNearestBand(eq: ParametricEQState, width: number, height: number, x: number, y: number) {
  let best: { band: EQBand; distance: number } | null = null;
  for (const band of eq.bands) {
    const point = getBandPoint(band, width, height);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance) best = { band, distance };
  }

  return best && best.distance < 42 ? best.band : null;
}

function getBandPoint(band: EQBand, width: number, height: number) {
  const x = frequencyToNormalizedX(band.frequency) * width;
  const y = supportsGain(band.type) ? dbToY(band.gainDb, height) : qToY(band.q, height);
  return { x, y };
}

function dbToY(db: number, height: number) {
  return ((18 - clamp(db, -18, 18)) / 36) * height;
}

function supportsGain(type: EQBandType) {
  return type === "peaking" || type === "lowshelf" || type === "highshelf";
}

function qToY(q: number, height: number) {
  const normalized = (clamp(q, 0.1, 12) - 0.1) / 11.9;
  return (1 - normalized) * height;
}

function yToQ(normalizedY: number) {
  return 0.1 + (1 - clamp(normalizedY, 0, 1)) * 11.9;
}

function formatFrequency(frequency: number) {
  if (frequency >= 1000) return `${(frequency / 1000).toFixed(frequency >= 10000 ? 0 : 1)}k`;
  return `${Math.round(frequency)}Hz`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
