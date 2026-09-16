"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, EyeOff, Play, ScanSearch, ShieldCheck, SlidersHorizontal, Square } from "lucide-react";
import { audioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { useDawStore } from "@/daw/store/dawStore";
import { SWEET_MASKING_BANDS } from "@/daw/aimixUnmask/maskingBands";
import { analyzeAimixUnmask } from "@/daw/aimixUnmask/unmaskAnalysis";
import { buildClipUnmaskPreview, type UnmaskPreviewResult } from "@/daw/aimixUnmask/unmaskDsp";
import { summarizeReferenceDelta, type AimixUnmaskMode, type SweetUnmaskOperation, type SweetUnmaskPreviewMode } from "@/daw/aimixUnmask/aimixUnmaskTypes";

const MODE_OPTIONS: Array<{ id: AimixUnmaskMode; label: string; description: string }> = [
  { id: "safe", label: "Safe", description: "小さく空ける。歌や低域を削りすぎない確認用。" },
  { id: "balanced", label: "Balanced", description: "通常はこちら。邪魔な帯域だけを自然に少し引く。" },
  { id: "strong", label: "Strong", description: "混雑が強い素材用。Removed-onlyを確認してからFIX。" },
];

const PREVIEW_OPTIONS: Array<{ id: SweetUnmaskPreviewMode; label: string }> = [
  { id: "original", label: "Original" },
  { id: "unmask", label: "Unmask" },
  { id: "removed", label: "Removed" },
  { id: "delta", label: "Delta" },
];

export function AimixUnmaskMatrixPanel() {
  const { project, waveformPeaks, mixDoctorReport, setAimixUnmaskState, updateAimixUnmaskState, toggleAimixUnmaskOperation, fixAimixUnmaskOperation } = useDawStore();
  const [mode, setMode] = useState<AimixUnmaskMode>("balanced");
  const [analysisNote, setAnalysisNote] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<UnmaskPreviewResult | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const state = project.aimixUnmaskState;
  const tracksById = useMemo(() => new Map(project.tracks.map((track) => [track.id, track])), [project.tracks]);
  const visibleOperations = state.operations.slice(0, 12);
  const fixedCount = state.operations.filter((operation) => operation.fixed).length;
  const enabledCount = state.operations.filter((operation) => operation.enabled).length;

  const stopPreview = () => {
    const source = previewSourceRef.current;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { }
      source.disconnect();
    }
    previewSourceRef.current = null;
    setIsPlaying(false);
    setPreviewingId(null);
  };

  useEffect(() => {
    return () => {
      stopPreview();
      void previewContextRef.current?.close();
      previewContextRef.current = null;
    };
  }, []);

  const runAnalysis = () => {
    const referenceDelta = summarizeReferenceDelta(mixDoctorReport?.referenceDelta ?? undefined);
    const next = analyzeAimixUnmask(project, waveformPeaks, { mode, referenceDelta });
    setAimixUnmaskState(next);
    setPreviewResult(null);
    setAnalysisNote(next.operations.length > 0
      ? `${next.operations.length}件のUnmask候補を作成しました。Previewで確認し、良いものだけFIXしてください。`
      : "Unmask候補は見つかりませんでした。Peak cacheがない場合は音声を読み込み直してください。");
  };

  const playOperation = async (operation: SweetUnmaskOperation) => {
    stopPreview();
    const clip = project.clips.find((candidate) => candidate.trackId === operation.targetTrackId && rangesOverlap(candidate.timelineStartSec, candidate.timelineStartSec + candidate.durationSec, operation.startSec, operation.endSec));
    if (!clip) {
      setPreviewResult(emptyPreviewResult("Preview対象のclipが見つかりません。"));
      return;
    }
    const sourceBuffer = audioBufferRegistry.getBuffer(clip.fileId);
    if (!sourceBuffer) {
      setPreviewResult(emptyPreviewResult("Source audio is not decoded yet. Re-import or restore the asset first."));
      return;
    }
    const result = buildClipUnmaskPreview(sourceBuffer, clip, [operation], { previewMode: state.previewMode, equalLoudness: state.equalLoudness });
    setPreviewResult(result);
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setPreviewResult({ ...result, warnings: [...result.warnings, "This browser does not support AudioContext preview."] });
      return;
    }
    const context = previewContextRef.current ?? new AudioContextCtor();
    previewContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    const audioBuffer = createPreviewAudioBuffer(context, result.preview, sourceBuffer.sampleRate);
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.onended = () => {
      previewSourceRef.current = null;
      setIsPlaying(false);
      setPreviewingId(null);
    };
    previewSourceRef.current = source;
    setPreviewingId(operation.id);
    setIsPlaying(true);
    source.start();
  };

  return (
    <section className="rounded-2xl border border-cyan-300/15 bg-slate-950/70 p-3 text-slate-100 shadow-inner shadow-cyan-950/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-200/75"><Activity size={14} /> AIMIX Unmask Matrix v0.3a</div>
          <h4 className="mt-1 text-base font-black">帯域のぶつかりを必要な時だけ避ける</h4>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">Cross-track maskingを解析し、主役を守るために相手トラックの該当帯域だけを軽く下げます。FIXした項目だけWAV書き出しへ反映されます。</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[11px]"><MetricPill label="候補" value={`${state.operations.length}`} /><MetricPill label="ON" value={`${enabledCount}`} /><MetricPill label="FIX" value={`${fixedCount}`} /></div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {MODE_OPTIONS.map((option) => (
          <button key={option.id} type="button" onClick={() => setMode(option.id)} className={`rounded-xl border px-3 py-2 text-left text-xs transition ${mode === option.id ? "border-cyan-300/70 bg-cyan-300/15 text-cyan-50" : "border-white/10 bg-white/[0.04] text-slate-300"}`}>
            <span className="block font-black">{option.label}</span><span className="mt-1 block leading-relaxed text-slate-400">{option.description}</span>
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={runAnalysis} className="min-h-10 rounded-xl border border-cyan-200/50 bg-cyan-300/14 px-3 py-2 text-xs font-black text-cyan-50"><ScanSearch size={15} className="mr-1 inline" /> Analyze Unmask</button>
        {PREVIEW_OPTIONS.map((option) => (
          <button key={option.id} type="button" onClick={() => updateAimixUnmaskState({ previewMode: option.id })} className={`min-h-9 rounded-xl border px-3 py-2 text-[11px] font-bold ${state.previewMode === option.id ? "border-emerald-300/70 bg-emerald-300/15 text-emerald-50" : "border-white/10 bg-slate-900/80 text-slate-300"}`}>{option.label}</button>
        ))}
        <button type="button" onClick={() => updateAimixUnmaskState({ equalLoudness: !state.equalLoudness })} className={`min-h-9 rounded-xl border px-3 py-2 text-[11px] font-bold ${state.equalLoudness ? "border-fuchsia-300/60 bg-fuchsia-300/15 text-fuchsia-50" : "border-white/10 bg-slate-900/80 text-slate-300"}`}>Equal-loudness A/B {state.equalLoudness ? "ON" : "OFF"}</button>
        {isPlaying ? <button type="button" onClick={stopPreview} className="min-h-9 rounded-xl border border-rose-300/40 bg-rose-400/12 px-3 py-2 text-[11px] font-black text-rose-100"><Square size={13} className="mr-1 inline" /> Stop</button> : null}
      </div>

      {analysisNote ? <p className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">{analysisNote}</p> : null}
      {state.warnings.length > 0 ? <WarningList warnings={state.warnings} /> : null}

      <div className="mt-3 grid gap-2">
        {visibleOperations.length > 0 ? visibleOperations.map((operation) => {
          const winner = tracksById.get(operation.winnerTrackId);
          const target = tracksById.get(operation.targetTrackId);
          const band = SWEET_MASKING_BANDS[operation.bandId];
          const active = previewingId === operation.id;
          return (
            <div key={operation.id} className={`rounded-xl border p-3 text-xs ${operation.fixed ? "border-emerald-300/35 bg-emerald-400/10" : "border-white/10 bg-white/[0.035]"}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-cyan-300/12 px-2 py-1 font-black text-cyan-100">{band.label}</span><span className="font-semibold text-slate-100">{winner?.name ?? "Winner"} → {target?.name ?? "Target"}</span></div>
                  <p className="mt-1 leading-relaxed text-slate-300">{operation.description}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><MetricPill label="Duck" value={`${operation.reductionDb.toFixed(1)}dB`} /><MetricPill label="Time" value={`${operation.startSec.toFixed(1)}-${operation.endSec.toFixed(1)}s`} /><MetricPill label="Attack" value={`${operation.attackMs}ms`} /><MetricPill label="Release" value={`${operation.releaseMs}ms`} /></div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <button type="button" onClick={() => playOperation(operation)} className="min-h-9 rounded-xl border border-sky-300/40 bg-sky-400/12 px-3 py-2 font-black text-sky-100"><Play size={13} className="mr-1 inline" /> {active ? "Playing" : "Preview"}</button>
                  <button type="button" onClick={() => fixAimixUnmaskOperation(operation.id)} className="min-h-9 rounded-xl border border-emerald-300/40 bg-emerald-400/12 px-3 py-2 font-black text-emerald-100"><CheckCircle2 size={13} className="mr-1 inline" /> {operation.fixed ? "Unfix" : "FIX"}</button>
                  <button type="button" onClick={() => toggleAimixUnmaskOperation(operation.id)} className="min-h-9 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 font-black text-slate-200"><EyeOff size={13} className="mr-1 inline" /> {operation.enabled ? "Bypass" : "Enable"}</button>
                </div>
              </div>
              {operation.warnings.length > 0 ? <WarningList warnings={operation.warnings} compact /> : null}
            </div>
          );
        }) : <div className="rounded-xl border border-dashed border-white/10 bg-black/15 px-3 py-4 text-center text-xs text-slate-400">まだUnmask候補がありません。AIMIX Standard後、必要に応じてAnalyze Unmaskを実行してください。</div>}
      </div>

      {previewResult ? (
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-2 font-black text-slate-100"><SlidersHorizontal size={14} /> Preview metrics</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><MetricPill label="Original" value={`${previewResult.metrics.originalRmsDb.toFixed(1)}dB`} /><MetricPill label="Processed" value={`${previewResult.metrics.processedRmsDb.toFixed(1)}dB`} /><MetricPill label="Delta" value={`${previewResult.metrics.rmsDeltaDb.toFixed(1)}dB`} /><MetricPill label="Match" value={`${previewResult.metrics.matchGainDb.toFixed(1)}dB`} /></div>
          {previewResult.warnings.length > 0 ? <WarningList warnings={previewResult.warnings} compact /> : null}
        </div>
      ) : null}

      <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs leading-relaxed text-emerald-100"><ShieldCheck size={14} className="mr-1 inline" /> Export hook connected: FIX済みUnmaskだけがPreviewと同じDSPでWAV書き出しへ反映されます。</div>
    </section>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-1"><div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div><div className="mt-0.5 font-black text-slate-100">{value}</div></div>;
}

function WarningList({ warnings, compact = false }: { warnings: string[]; compact?: boolean }) {
  if (warnings.length === 0) return null;
  return <ul className={`mt-2 space-y-1 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-amber-100 ${compact ? "text-[11px]" : "text-xs"}`}>{warnings.slice(0, 5).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>;
}

function createPreviewAudioBuffer(context: BaseAudioContext, channels: Float32Array[], sampleRate: number) {
  const channelCount = Math.max(1, channels.length);
  const frameCount = Math.max(1, channels[0]?.length ?? 1);
  const buffer = context.createBuffer(channelCount, frameCount, sampleRate);
  channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
  return buffer;
}

function emptyPreviewResult(message: string): UnmaskPreviewResult {
  return { original: [], processed: [], removed: [], preview: [], appliedOperationIds: [], warnings: [message], metrics: { originalRmsDb: -180, processedRmsDb: -180, rmsDeltaDb: 0, matchGainDb: 0 } };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}