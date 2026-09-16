"use client";

import React from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { RepairHeatmapCell, SpectralEditOperation } from "@/daw/mix/mixDoctorTypes";

type RepairDetailPanelProps = {
  cell: RepairHeatmapCell | null;
  selectedCount: number;
  onPatchCell: (cellId: string, patch: Partial<Pick<RepairHeatmapCell, "suggestedOperation" | "suggestedGainDb" | "strength" | "softness" | "protectMain">>) => void;
  onApplySelected: () => void;
  canApplySelected: boolean;
};

const OPERATIONS: SpectralEditOperation[] = ["reduce", "smooth", "deess", "deharsh", "derumble", "declick", "protect"];

export function RepairDetailPanel({ cell, selectedCount, onPatchCell, onApplySelected, canApplySelected }: RepairDetailPanelProps) {
  const warnings = cell ? safetyWarnings(cell, selectedCount) : [];

  return (
    <aside className="max-h-[42dvh] shrink-0 overflow-y-auto border-t border-white/[0.07] bg-[#08111f]/95 p-3 sm:max-h-none sm:w-[320px] sm:border-l sm:border-t-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wider text-daw-text">Selected Region</h3>
          <p className="text-[10px] text-daw-muted">{selectedCount} selected region(s)</p>
        </div>
        <button
          type="button"
          onClick={onApplySelected}
          disabled={!canApplySelected}
          className="min-h-[34px] rounded-lg border border-emerald-300/35 bg-emerald-300/10 px-3 text-[10px] font-black uppercase tracking-wider text-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
        >
          Apply
        </button>
      </div>

      {cell ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <Info label="Track" value={cell.trackId} />
            <Info label="Role" value={cell.role} />
            <Info label="Time" value={`${cell.startTime.toFixed(2)}-${cell.endTime.toFixed(2)}s`} />
            <Info label="Freq" value={`${Math.round(cell.lowFreq)}-${Math.round(cell.highFreq)}Hz`} />
            <Info label="Before" value={cell.beforeScore.toFixed(1)} />
            <Info label="After" value={(cell.afterScore ?? cell.beforeScore).toFixed(1)} />
            <Info label="Difference" value={(cell.differenceScore ?? 0).toFixed(1)} />
            <Info label="Confidence" value={`${Math.round(cell.confidence * 100)}%`} />
          </div>

          <label className="block text-[10px] font-bold uppercase tracking-wider text-daw-muted">
            Operation
            <select
              value={cell.protectMain ? "protect" : cell.suggestedOperation}
              onChange={(event) => onPatchCell(cell.id, { suggestedOperation: event.currentTarget.value as SpectralEditOperation, protectMain: event.currentTarget.value === "protect" })}
              className="mt-1 min-h-[34px] w-full rounded-lg border border-white/[0.08] bg-black/35 px-2 text-[11px] text-daw-text"
            >
              {OPERATIONS.map((operation) => (
                <option key={operation} value={operation}>{operation}</option>
              ))}
            </select>
          </label>

          <Slider
            label="Gain dB"
            value={cell.suggestedGainDb}
            min={-6}
            max={0}
            step={0.1}
            disabled={cell.protectMain}
            format={(value) => `${value.toFixed(1)}dB`}
            onChange={(suggestedGainDb) => onPatchCell(cell.id, { suggestedGainDb })}
          />
          <Slider
            label="Strength"
            value={cell.strength}
            min={0}
            max={1}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(strength) => onPatchCell(cell.id, { strength })}
          />
          <Slider
            label="Softness"
            value={cell.softness}
            min={0}
            max={1}
            step={0.01}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={(softness) => onPatchCell(cell.id, { softness })}
          />

          <label className="flex min-h-[36px] items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.035] px-2 text-[10px] font-bold uppercase tracking-wider text-daw-muted">
            <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> Protect main</span>
            <input
              type="checkbox"
              checked={cell.protectMain}
              onChange={(event) => onPatchCell(cell.id, { protectMain: event.currentTarget.checked, suggestedOperation: event.currentTarget.checked ? "protect" : cell.suggestedOperation })}
            />
          </label>

          <div className="rounded-lg border border-white/[0.06] bg-black/25 p-2 text-[10px] leading-snug text-daw-muted">
            <div className="mb-1 font-black uppercase tracking-wider text-daw-text">Reason</div>
            {cell.reason}
          </div>

          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-2 text-[10px] leading-snug text-amber-100">
              <div className="mb-1 flex items-center gap-1 font-black uppercase tracking-wider">
                <AlertTriangle size={12} />
                Safety Guard
              </div>
              <ul className="list-disc space-y-0.5 pl-4">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-white/[0.06] bg-black/25 p-3 text-[10px] leading-snug text-daw-muted">
          Tap a hot region, drag to select a region, or double-tap a hot region to zoom in.
        </p>
      )}
    </aside>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/25 p-2">
      <div className="text-[8px] font-black uppercase tracking-wider text-daw-muted">{label}</div>
      <div className="truncate font-bold text-daw-text">{value}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`block text-[10px] font-bold uppercase tracking-wider ${disabled ? "text-daw-muted/50" : "text-daw-muted"}`}>
      <span className="flex items-center justify-between">
        {label}
        <span className="text-daw-text">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="mt-1 w-full accent-daw-cyan disabled:opacity-35"
      />
    </label>
  );
}

function safetyWarnings(cell: RepairHeatmapCell, selectedCount: number) {
  const warnings: string[] = [];
  if (cell.suggestedGainDb < -4.5) warnings.push("This repair may remove important musical content. Use Protect or reduce Strength.");
  if (cell.strength > 0.75) warnings.push("Strength is high; reduce it if the source feels hollow or phasey.");
  if (selectedCount > 24) warnings.push("More than 24 regions selected. Apply smaller groups first.");
  if (cell.role === "vocal" && cell.lowFreq >= 1500 && cell.highFreq <= 5000 && (cell.suggestedOperation === "reduce" || cell.suggestedOperation === "deharsh")) warnings.push("Vocal presence is protected in this range. Use Protect or very light Strength.");
  if (cell.role === "bass" && cell.lowFreq >= 60 && cell.highFreq <= 120 && cell.suggestedOperation === "reduce") warnings.push("Bass body is protected around 60-120Hz.");
  if (cell.role === "drums" && cell.lowFreq >= 60 && cell.highFreq <= 250 && cell.suggestedOperation === "reduce") warnings.push("Drum impact can disappear if this range is reduced too much.");
  if (cell.confidence < 0.45) warnings.push("Confidence is low. Preview before applying.");
  return warnings;
}
