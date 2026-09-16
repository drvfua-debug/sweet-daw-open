"use client";

import { RotateCcw, Sparkles, X } from "lucide-react";
import { getCharacterModeDefaults, getCharacterModeLabel } from "@/audio/fx/Character";
import type { CharacterPluginMode, CharacterPluginState } from "@/daw/model/Project";

type CharacterPanelProps = {
  title: string;
  subtitle?: string;
  color?: string;
  state: CharacterPluginState;
  onChange: (patch: Partial<CharacterPluginState>) => void;
  onClose: () => void;
};

const MODES: Array<{
  id: CharacterPluginMode;
  description: string;
}> = [
  { id: "drumPunch", description: "Brighter snap and parallel bite for drums." },
  { id: "drumAir", description: "Crisp top and lighter room-like sheen." },
  { id: "bassTight", description: "Harder edge and controlled low punch for bass." },
  { id: "bassDrive", description: "More growl and mid-forward bass grit." },
  { id: "vocalShine", description: "Adds controlled air to vocal stems." },
  { id: "vocalWarm", description: "Thicker low-mid warmth for vocals." },
  { id: "synthTransform", description: "Drive and airy tone for stronger synth color." },
  { id: "synthWide", description: "Brighter animated synth color without full replacement." },
  { id: "loFiColor", description: "Darker filtered tone with stronger saturation." },
  { id: "warmTape", description: "Gentle tape-like density and warmth." },
  { id: "brightExciter", description: "High-frequency excitement for dull stems." },
];

export function CharacterPanel({
  title,
  subtitle,
  color = "#65f0a4",
  state,
  onChange,
  onClose,
}: CharacterPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-daw-bg/80 p-2 backdrop-blur-md sm:items-center sm:justify-center">
      <section className="view-enter flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-panel shadow-2xl">
        <header className="flex min-h-[52px] items-center justify-between border-b border-daw-line px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-daw-green/25 bg-daw-green/10 text-daw-green">
              <Sparkles size={16} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-bold">{title}</h2>
              {subtitle && <p className="truncate text-[11px] text-daw-muted">{subtitle}</p>}
            </div>
          </div>
          <button type="button" className="daw-btn daw-btn-ghost !min-h-[36px] !rounded-lg" onClick={onClose} aria-label="Close tone panel">
            <X size={16} />
          </button>
        </header>

        <div className="daw-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
          <div className="flex items-center justify-between rounded-xl border border-daw-line bg-daw-panel2 p-3">
            <div>
              <p className="text-xs font-bold">Sweet Character</p>
              <p className="mt-0.5 text-[11px] text-daw-muted">Track insert tone transform</p>
            </div>
            <button
              type="button"
              onClick={() => onChange({ enabled: !state.enabled })}
              className={`daw-btn !min-h-[40px] !rounded-lg text-[11px] ${
                state.enabled ? "border-daw-green/35 bg-daw-green/15 text-daw-green" : "daw-btn-ghost"
              }`}
            >
              {state.enabled ? "On" : "Off"}
            </button>
          </div>

          <div className="grid gap-2">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onChange({ mode: mode.id, enabled: true, ...getCharacterModeDefaults(mode.id) })}
                className={`rounded-xl border p-3 text-left active:bg-daw-green/15 ${
                  state.mode === mode.id
                    ? "border-daw-green/45 bg-daw-green/12 text-daw-green"
                    : "border-daw-line bg-daw-panel2 text-daw-text"
                }`}
              >
                <span className="block text-sm font-bold">{getCharacterModeLabel(mode.id)}</span>
                <span className="mt-1 block text-[11px] text-daw-muted">{mode.description}</span>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-daw-line bg-daw-panel2 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-daw-muted">Tone controls</span>
              <button
                type="button"
                className="daw-btn daw-btn-ghost !min-h-[32px] !rounded-lg text-[10px]"
                onClick={() => onChange(getCharacterModeDefaults(state.mode))}
              >
                <RotateCcw size={13} />
                Reset
              </button>
            </div>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(state.amount * 100)}%`,
                  background: `linear-gradient(90deg, ${color}, #65f0a4)`,
                }}
              />
            </div>
            <div className="space-y-4">
              <SliderRow
                label="Amount"
                valueLabel={`${Math.round(state.amount * 100)}%`}
                value={state.amount}
                onChange={(amount) => onChange({ amount })}
              />
              <SliderRow
                label="Tone"
                valueLabel={`${Math.round(state.tone * 100)}%`}
                value={state.tone}
                onChange={(tone) => onChange({ tone })}
              />
              <SliderRow
                label="Mix"
                valueLabel={`${Math.round(state.mix * 100)}%`}
                value={state.mix}
                onChange={(mix) => onChange({ mix })}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SliderRow({
  label,
  value,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  valueLabel: string;
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
        className="daw-range w-full"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
