"use client";

import { Copy, Paintbrush, Plus, ShieldAlert } from "lucide-react";
import type { SweetSpectralBrushOperationKind, SweetSpectralProblemHeatmapFrame, SweetSpectralSelection } from "@/lib/audio/spectralEditorTypes";
import { updateSweetSpectralSelection } from "@/lib/audio/spectralSelection";

const BRUSH_OPTIONS: Array<{ id: SweetSpectralBrushOperationKind; label: string; description: string }> = [
  { id: "attenuate", label: "Attenuate", description: "時間範囲をフェード付きで浅く下げます。" },
  { id: "band-attenuate", label: "Band Attenuate", description: "選択帯域を軽く抑えます。" },
  { id: "click-smooth", label: "Click Smooth", description: "短いクリックを局所補間します。" },
  { id: "tone-reduce", label: "Tone Reduce", description: "細い鳴きやringingを狭めに抑えます。" },
  { id: "chirp-soften", label: "Chirp Soften", description: "AI由来の高域chirpを軽く丸めます。" },
  { id: "harsh-soften", label: "Harsh Soften", description: "2〜8kHzの刺さりを控えめに抑えます。" },
  { id: "sustain-shorten", label: "Sustain Shorten", description: "尾を少し短くします。" },
  { id: "low-end-tighten", label: "Low-End Tighten", description: "低域のSide/ぼやけを軽く締めます。" },
];

type SpectralEditorPanelProps = {
  disabled?: boolean;
  selection: SweetSpectralSelection;
  brushKind: SweetSpectralBrushOperationKind;
  brushAmount: number;
  heatmapFrames: SweetSpectralProblemHeatmapFrame[];
  onSelectionChange: (selection: SweetSpectralSelection) => void;
  onBrushKindChange: (kind: SweetSpectralBrushOperationKind) => void;
  onBrushAmountChange: (amount: number) => void;
  onCreateRegion: () => void;
  onDuplicateSelected?: () => void;
};

export function SpectralEditorPanel({
  disabled = false,
  selection,
  brushKind,
  brushAmount,
  heatmapFrames,
  onSelectionChange,
  onBrushKindChange,
  onBrushAmountChange,
  onCreateRegion,
  onDuplicateSelected,
}: SpectralEditorPanelProps) {
  const summary = summarizeHeatmap(heatmapFrames);

  return (
    <div className="rounded-xl border border-daw-cyan/25 bg-daw-cyan/[0.055] p-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-daw-cyan">Spectral Editor Pro Lite v0.6</p>
          <p className="mt-1 text-[11px] leading-relaxed text-daw-muted">
            Time/Frequency selection, brush operation, problem heatmap, and non-destructive RepairRegion creation.
          </p>
        </div>
        <Paintbrush size={16} className="shrink-0 text-daw-cyan" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1">
        {BRUSH_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            onClick={() => onBrushKindChange(option.id)}
            className={`min-h-[38px] rounded-lg border px-2 py-1 text-left text-[10px] font-bold disabled:opacity-40 ${brushKind === option.id ? "border-daw-cyan bg-daw-cyan/15 text-daw-cyan" : "border-white/[0.07] bg-white/[0.035] text-daw-text"}`}
            title={option.description}
          >
            <span className="block">{option.label}</span>
            <span className="block truncate font-normal text-daw-muted">{option.description}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 grid gap-2 text-[11px]">
        <EditorNumber label="Start" value={selection.startSec} min={0} max={Math.max(selection.endSec - 0.01, 0.01)} step={0.01} suffix="s" onChange={(value) => onSelectionChange(updateSweetSpectralSelection(selection, { startSec: value }))} />
        <EditorNumber label="End" value={selection.endSec} min={selection.startSec + 0.01} max={3600} step={0.01} suffix="s" onChange={(value) => onSelectionChange(updateSweetSpectralSelection(selection, { endSec: value }))} />
        <EditorNumber label="Min Hz" value={selection.minHz ?? 20} min={20} max={(selection.maxHz ?? 20000) - 10} step={10} suffix="Hz" onChange={(value) => onSelectionChange(updateSweetSpectralSelection(selection, { minHz: value, shape: "rectangle" }))} />
        <EditorNumber label="Max Hz" value={selection.maxHz ?? 20000} min={(selection.minHz ?? 20) + 10} max={20000} step={10} suffix="Hz" onChange={(value) => onSelectionChange(updateSweetSpectralSelection(selection, { maxHz: value, shape: "rectangle" }))} />
        <EditorNumber label="Brush Amount" value={brushAmount} min={0} max={1} step={0.01} onChange={onBrushAmountChange} />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
        {summary.map((item) => (
          <div key={item.label} className="rounded-lg border border-white/[0.06] bg-black/20 px-2 py-1">
            <span className="text-daw-muted">{item.label}</span>
            <span className="ml-1 font-mono text-daw-text">{Math.round(item.value * 100)}%</span>
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1">
        <button type="button" disabled={disabled} onClick={onCreateRegion} className="daw-btn daw-btn-primary !min-h-[34px] text-[10px] font-bold disabled:opacity-40">
          <Plus size={14} /> Add Brush Region
        </button>
        <button type="button" disabled={disabled || !onDuplicateSelected} onClick={onDuplicateSelected} className="daw-btn daw-btn-ghost !min-h-[34px] text-[10px] font-bold disabled:opacity-40">
          <Copy size={14} /> Duplicate
        </button>
      </div>

      <p className="mt-2 flex gap-2 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-100">
        <ShieldAlert size={14} className="mt-0.5 shrink-0" />
        完全inpaintingではありません。FIXしたRegionは既存のRepair export経路へ渡され、未FIXはpreview確認用です。
      </p>
    </div>
  );
}

function EditorNumber({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1">
      <span className="flex justify-between text-daw-muted"><span>{label}</span><span>{Number(value).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}{suffix ?? ""}</span></span>
      <input type="range" min={min} max={Math.max(min, max)} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} className="accent-daw-cyan" />
    </label>
  );
}

function summarizeHeatmap(frames: SweetSpectralProblemHeatmapFrame[]) {
  const keys = [
    ["Clip", "clipRisk"],
    ["Click", "clickRisk"],
    ["Chirp", "chirpRisk"],
    ["Harsh", "harshRisk"],
    ["Mud", "mudRisk"],
    ["Side Low", "sideLowRisk"],
    ["Smear", "reverbSmearRisk"],
    ["Mask", "maskingRisk"],
  ] as const;
  return keys.map(([label, key]) => ({
    label,
    value: frames.reduce((max, frame) => Math.max(max, frame.scores[key] ?? 0), 0),
  }));
}