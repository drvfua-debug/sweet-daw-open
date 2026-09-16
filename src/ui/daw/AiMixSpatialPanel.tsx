"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Layers, RotateCcw, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import { DEFAULT_AIMIX_SPATIAL_OPTIONS, type AimixSpatialMode, type AimixSpatialOptions, type AimixSpatialPanMode, type SpatialPanScene } from "@/daw/aimixSpatial/aimixSpatialTypes";
import { useDawStore } from "@/daw/store/dawStore";

const MODE_OPTIONS: Array<{ id: AimixSpatialMode; label: string; description: string }> = [
  { id: "spatial", label: "Placement", description: "通常推奨。AIMIX後の音色を再加工せず、固定Track Panで左右の配置を整理します。" },
  { id: "clean-spatial", label: "Pro Image", description: "任意。配置に加えてMud/Boxinessを軽く整えます。AIMIX後は必要な時だけ使います。" },
  { id: "full", label: "Depth", description: "Pro Imageより少し奥行き寄り。広げすぎず、既存クリップのPan設計だけで距離感を作ります。" },
  { id: "clean", label: "Clean Only", description: "Panは変更せず、Mud/Boxinessと刺さりだけを軽く整えます。" },
];

const PAN_MODE_OPTIONS: Array<{ id: AimixSpatialPanMode; label: string; description: string }> = [
  { id: "off", label: "Off", description: "Panは変更しません。Clean処理だけを使いたい時に選びます。" },
  { id: "track", label: "Track", description: "トラック単位で基本位置を決めます。大きな配置を短時間で整える設定です。" },
  { id: "clip", label: "Clip", description: "トラック位置は維持し、クリップ単位のPan Automationだけを作ります。" },
  { id: "track-clip", label: "Track + Clip", description: "Track Panで基本位置、Clip Panで時間軸の動きを作ります。" },
  { id: "reference-plus", label: "Reference+", description: "ReferenceのSide/Mid傾向を参考にしつつ、安全範囲内でTrack + Clip Panを調整します。" },
];

const PAN_SCENE_OPTIONS: Array<{ id: SpatialPanScene; label: string; description: string }> = [
  { id: "pro-balanced", label: "Placement", description: "一番オーソドックス。Vocal/低域を中央に残し、伴奏とFXを自然に左右へ配置します。" },
  { id: "wide-hook", label: "Wide Support", description: "サビやHook向け。Synth/FX/SupportのClip Panを少し広めにします。" },
  { id: "vocal-focus", label: "Vocal Front", description: "ボーカルを前に置きたい時。伴奏の左右移動は控えめにします。" },
  { id: "cinematic-wide", label: "Depth", description: "奥行きを少し強めます。低域monoとcorrelation guardを優先します。" },
  { id: "manual", label: "Manual", description: "細かく手動調整するための基準シーンです。" },
];

const SPATIAL_AUTO_PRESET: AimixSpatialOptions = {
  ...DEFAULT_AIMIX_SPATIAL_OPTIONS,
  mode: "spatial",
  panMode: "track",
  panScene: "pro-balanced",
  clarity: 20,
  smooth: 18,
  space: 56,
  depth: 18,
  motion: 0,
  centerProtect: 85,
  gainMatch: true,
  monoSafe: true,
  editableLayers: false,
  removePreviousAimixLayers: true,
  panAmount: 64,
  trackPanAmount: 62,
  clipPanAmount: 0,
  referencePanFollow: false,
  protectLeadVocalPan: true,
  protectLowEndPan: true,
  resetPreviousSpatialPan: true,
};

const SPATIAL_REFERENCE_PRESET: AimixSpatialOptions = {
  ...SPATIAL_AUTO_PRESET,
  panMode: "track",
  space: 62,
  depth: 22,
  panAmount: 70,
  trackPanAmount: 60,
  clipPanAmount: 0,
  referencePanFollow: true,
};

const CONTROL_DESCRIPTIONS: Record<
  keyof Pick<AimixSpatialOptions, "clarity" | "smooth" | "space" | "depth" | "motion" | "centerProtect">,
  string
> = {
  clarity: "180-900Hzのこもりを必要な分だけ軽く引き、音像の見通しを整えます。",
  smooth: "AI音源の刺さりやザラつきを、艶を削りすぎない範囲で抑えます。",
  space: "左右配置の広さです。上げすぎると中央のまとまりが弱くなるため、通常は60前後が安全です。",
  depth: "奥行き感の量です。音を増やさず、既存クリップの配置で距離感を作ります。",
  motion: "Coming Soon: 時間軸の揺れや散らしを追加する予定です。",
  centerProtect: "Vocal / Kick / Bassの芯を中央に残す強さです。高域まで無理に中央寄せしません。",
};

export function AiMixSpatialPanel() {
  const { project, applyAimixSpatial, removeAimixSpatialLayers, aimixSpatialReport, mixDoctorReport } = useDawStore();
  const [options, setOptions] = useState<AimixSpatialOptions>(SPATIAL_AUTO_PRESET);
  const [manualOpen, setManualOpen] = useState(false);
  const referenceAnalysisReady = project.tracks.some((track) => track.role === "reference") && Boolean(mixDoctorReport?.referenceProfile);

  const summary = useMemo(() => {
    const legacyTracks = project.tracks.filter((track) => track.aimixSpatial?.isAimixSpatialGenerated).length;
    const legacyClips = project.clips.filter((clip) => clip.aimixSpatial?.isAimixSpatialGenerated).length;
    const targetTracks = project.tracks.filter(
      (track) => !track.mute && track.role !== "reference" && !track.aimixSpatial?.isAimixSpatialGenerated,
    ).length;
    const protectedTracks = project.tracks.filter((track) => ["vocal", "bass", "drums"].includes(track.role)).length;
    return { legacyTracks, legacyClips, targetTracks, protectedTracks };
  }, [project.tracks, project.clips]);

  const canApply = project.clips.length > 0 && project.tracks.length > 0;

  const setOption = <K extends keyof AimixSpatialOptions>(key: K, value: AimixSpatialOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const resetOptions = () => {
    setOptions(SPATIAL_AUTO_PRESET);
    setManualOpen(false);
  };

  const applySpatialAuto = () => {
    setOptions(SPATIAL_AUTO_PRESET);
    setManualOpen(false);
    applyAimixSpatial(SPATIAL_AUTO_PRESET);
  };

  const applySpatialReference = () => {
    setOptions(SPATIAL_REFERENCE_PRESET);
    setManualOpen(false);
    applyAimixSpatial(SPATIAL_REFERENCE_PRESET);
  };

  useEffect(() => {
    if (referenceAnalysisReady) return;
    setOptions((current) => {
      if (current.panMode !== "reference-plus" && !current.referencePanFollow) return current;
      return {
        ...current,
        panMode: current.panMode === "reference-plus" ? "track" : current.panMode,
        referencePanFollow: false,
      };
    });
  }, [referenceAnalysisReady]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-surface/95 text-daw-text">
      <div className="shrink-0 border-b border-daw-line bg-daw-panel/80 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-daw-cyan">
              <Sparkles size={16} />
              AIMIX Spatial v2
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-daw-muted">
              AIMIXで音量・帯域を整えた後に使う定位画面です。通常設定は音色を重ねて補正せず、既存Trackの固定Panだけを安全に整理します。Clip PanはManualで任意に選べます。
            </p>
          </div>
          <button
            type="button"
            onClick={resetOptions}
            className="daw-btn daw-btn-ghost !min-h-[34px] !rounded-xl px-2 text-[11px]"
            title="Spatial settings reset"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <StatusPill label="Target Track" value={summary.targetTracks} />
          <StatusPill label="Center Guard" value={summary.protectedTracks} />
          <StatusPill label="Legacy Track" value={summary.legacyTracks} />
          <StatusPill label="Legacy Clip" value={summary.legacyClips} />
        </div>
      </div>

      <div className="daw-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
        <div className="rounded-2xl border border-daw-cyan/20 bg-daw-cyan/10 p-3 text-[11px] leading-relaxed text-daw-muted">
          <span className="font-black text-daw-cyan">Workflow:</span> Step 1 AIMIXでReferenceに近い音量・帯域へ整える → Step 2 Spatialで左右/奥行き/Clip Panを整理 → Step 3 Masteringで最終音圧と書き出しを行います。
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            disabled={!canApply}
            onClick={applySpatialAuto}
            className="rounded-2xl border border-daw-cyan/50 bg-daw-cyan/15 p-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="block text-xs font-black text-daw-cyan">Spatial Auto</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-daw-muted">
              通常推奨。AIMIX後のEQを変えず、Vocal/Bass/Drumsを中央に守ってSupport/FXを固定配置します。
            </span>
          </button>
          <button
            type="button"
            disabled={!canApply || !referenceAnalysisReady}
            onClick={applySpatialReference}
            className="rounded-2xl border border-emerald-300/35 bg-emerald-300/10 p-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="block text-xs font-black text-emerald-100">Reference Spatial</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-daw-muted">
              任意。Reference解析後だけ使えます。ReferenceのSide/Mid方向へ固定Track Panを小さく調整します。
            </span>
          </button>
          <button
            type="button"
            onClick={() => setManualOpen((open) => !open)}
            className="rounded-2xl border border-daw-line bg-daw-panel/65 p-3 text-left text-daw-muted transition active:scale-[0.99]"
          >
            <span className="block text-xs font-black text-daw-text">Spatial Manual</span>
            <span className="mt-1 block text-[11px] leading-relaxed">
              Placement / Depth / Pro Image / Track Pan / Clip Panを細かく調整します。
            </span>
          </button>
        </div>

        {manualOpen ? (
          <>
            <div className="grid gap-2">
              {MODE_OPTIONS.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setOption("mode", mode.id)}
                  className={`rounded-xl border p-3 text-left transition ${
                    options.mode === mode.id
                      ? "border-daw-cyan/70 bg-daw-cyan/15 text-daw-text shadow-[0_0_18px_rgba(77,217,255,0.18)]"
                      : "border-daw-line bg-daw-panel/65 text-daw-muted"
                  }`}
                >
                  <span className="block text-xs font-black text-daw-text">{mode.label}</span>
                  <span className="mt-1 block text-[11px] leading-relaxed">{mode.description}</span>
                </button>
              ))}
            </div>

            <div className="rounded-2xl border border-daw-line bg-daw-panel/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-daw-muted">
                <SlidersHorizontal size={14} />
                Controls
              </div>
              <SliderRow label="Clarity" value={options.clarity} description={CONTROL_DESCRIPTIONS.clarity} onChange={(value) => setOption("clarity", value)} />
              <SliderRow label="Smooth" value={options.smooth} description={CONTROL_DESCRIPTIONS.smooth} onChange={(value) => setOption("smooth", value)} />
              <SliderRow label="Space" value={options.space} description={CONTROL_DESCRIPTIONS.space} onChange={(value) => setOption("space", value)} />
              <SliderRow label="Depth" value={options.depth} description={CONTROL_DESCRIPTIONS.depth} onChange={(value) => setOption("depth", value)} />
              <SliderRow label="Motion" value={options.motion} description={CONTROL_DESCRIPTIONS.motion} disabled onChange={(value) => setOption("motion", value)} />
              <SliderRow label="Center Protect" value={options.centerProtect} description={CONTROL_DESCRIPTIONS.centerProtect} onChange={(value) => setOption("centerProtect", value)} />
            </div>

            <div className="rounded-2xl border border-daw-line bg-daw-panel/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-daw-muted">
                <SlidersHorizontal size={14} />
                Pan Mix
              </div>
              <div className="grid gap-2">
                {PAN_MODE_OPTIONS.map((mode) => {
                  const referenceOnly = mode.id === "reference-plus";
                  const disabled = referenceOnly && !referenceAnalysisReady;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        setOption("panMode", mode.id);
                      }}
                      className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-45 ${options.panMode === mode.id ? "border-daw-cyan/70 bg-daw-cyan/15 text-daw-text" : "border-daw-line bg-daw-panel/65 text-daw-muted"}`}
                    >
                      <span className="block text-xs font-black text-daw-text">{mode.label}</span>
                      <span className="mt-1 block text-[11px] leading-relaxed">
                        {mode.description}
                        {disabled ? " Reference analysis required." : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              {options.panMode !== "off" ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <div className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-daw-muted">Pan Scene</div>
                    <div className="grid gap-2">
                      {PAN_SCENE_OPTIONS.map((scene) => (
                        <button
                          key={scene.id}
                          type="button"
                          onClick={() => setOption("panScene", scene.id)}
                          className={`rounded-xl border p-3 text-left transition ${options.panScene === scene.id ? "border-daw-cyan/70 bg-daw-cyan/15 text-daw-text" : "border-daw-line bg-daw-bg/45 text-daw-muted"}`}
                        >
                          <span className="block text-xs font-black text-daw-text">{scene.label}</span>
                          <span className="mt-1 block text-[11px] leading-relaxed">{scene.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <SliderRow label="Pan Amount" value={options.panAmount} description="Track PanとClip Pan全体の強さです。上げすぎると左右に散りすぎます。" onChange={(value) => setOption("panAmount", value)} />
                  <SliderRow label="Track Pan" value={options.trackPanAmount} description="トラック単位の基本配置量です。Vocal/Bass/Drumsは中央保護されます。" onChange={(value) => setOption("trackPanAmount", value)} />
                  <SliderRow label="Clip Pan" value={options.clipPanAmount} description="クリップ単位の時間軸Pan Automation量です。後からArrangeのPan Editorで編集できます。" onChange={(value) => setOption("clipPanAmount", value)} />
                  <ToggleRow label="Reference Pan Follow" description={referenceAnalysisReady ? "Referenceがある場合、Side/MidとCorrelationの傾向へ安全に寄せます。" : "Reference analysis required. Standard Spatial does not use this."} checked={referenceAnalysisReady && options.referencePanFollow} onChange={(value) => {
                    if (!referenceAnalysisReady) return;
                    setOption("referencePanFollow", value);
                  }} />
                  <ToggleRow label="Protect Lead Vocal" description="Lead Vocalを中央に保護します。" checked={options.protectLeadVocalPan} onChange={(value) => setOption("protectLeadVocalPan", value)} />
                  <ToggleRow label="Protect Low End" description="Bass/Drumsなど低域の芯を中央に保護します。" checked={options.protectLowEndPan} onChange={(value) => setOption("protectLowEndPan", value)} />
                  <ToggleRow label="Reset Previous Spatial Pan" description="再適用時に、前回Spatialが変更したPanだけを元へ戻してから作り直します。" checked={options.resetPreviousSpatialPan} onChange={(value) => setOption("resetPreviousSpatialPan", value)} />
                </div>
              ) : null}
            </div>

            <div className="grid gap-2">
              <ToggleRow label="Gain Match" description="配置変更で音量が不自然に変わらないよう、Masterを無理に押し上げません。" checked={options.gainMatch} onChange={(value) => setOption("gainMatch", value)} />
              <ToggleRow label="Mono Safe" description="Bass/Kick/Subの低域が左右に広がりすぎないよう中央を保護します。" checked={options.monoSafe} onChange={(value) => setOption("monoSafe", value)} />
              <ToggleRow label="Clean Legacy Layers" description="旧バージョンで作られたAIMIX Spatial L/Rレイヤーだけを再適用前に削除します。元stemは削除しません。" checked={options.removePreviousAimixLayers} onChange={(value) => setOption("removePreviousAimixLayers", value)} />
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-daw-line bg-daw-panel/55 p-3 text-[11px] leading-relaxed text-daw-muted">
            まずSpatial Autoを使い、必要な時だけManualでPan Scene、Track Pan、Clip Panを調整します。
          </div>
        )}

        {aimixSpatialReport && (
          <div className="rounded-2xl border border-daw-line bg-daw-panel/70 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-daw-cyan">
              <ShieldCheck size={14} />
              Result
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <StatusPill label="Clean" value={aimixSpatialReport.cleanedTracks} />
              <StatusPill label="Created Track" value={aimixSpatialReport.generatedTracks} />
              <StatusPill label="Created Clip" value={aimixSpatialReport.generatedClips} />
              <StatusPill label="Legacy Removed" value={aimixSpatialReport.removedTracks} />
              <StatusPill label="Pan Track" value={aimixSpatialReport.pannedTracks} />
              <StatusPill label="Pan Clip" value={aimixSpatialReport.pannedClips} />
              <StatusPill label="Restored Pan" value={aimixSpatialReport.restoredPannedTracks + aimixSpatialReport.restoredPannedClips} />
            </div>
            <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-daw-muted">
              {aimixSpatialReport.actions.slice(0, 6).map((action, index) => (
                <li key={`${action}-${index}`}>- {action}</li>
              ))}
              {aimixSpatialReport.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`} className="text-daw-amber">
                  - {warning}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-daw-line bg-daw-panel/90 p-3">
        <button
          type="button"
          disabled={!canApply}
          onClick={() => applyAimixSpatial(options)}
          className="daw-btn w-full !min-h-[44px] !rounded-xl border-daw-cyan/60 bg-daw-cyan/15 text-sm font-black text-daw-cyan disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles size={16} />
          Apply Spatial Manual
        </button>
        <button
          type="button"
          disabled={summary.legacyTracks === 0 && summary.legacyClips === 0}
          onClick={removeAimixSpatialLayers}
          className="daw-btn daw-btn-ghost mt-2 w-full !min-h-[40px] !rounded-xl text-xs disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Layers size={15} />
          Remove Legacy Spatial Layers
        </button>
      </div>
    </section>
  );
}

function StatusPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-daw-line bg-daw-bg/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-daw-muted">{label}</div>
      <div className="mt-1 text-sm font-black text-daw-text">{value}</div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  description,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  description: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`block border-t border-daw-line/60 py-3 first:border-t-0 first:pt-1 ${disabled ? "opacity-55" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-daw-text">{label}</span>
        <span className="rounded-lg bg-daw-bg px-2 py-1 text-[11px] font-black text-daw-cyan">
          {disabled ? "Soon" : value}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="mt-2 w-full accent-cyan-300 disabled:cursor-not-allowed"
      />
      <div className="mt-1 text-[10px] leading-relaxed text-daw-muted">{description}</div>
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-daw-line bg-daw-panel/60 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-1 h-5 w-5 shrink-0 accent-cyan-300"
      />
      <span>
        <span className="block text-xs font-black text-daw-text">{label}</span>
        <span className="mt-1 block text-[11px] leading-relaxed text-daw-muted">{description}</span>
      </span>
    </label>
  );
}
