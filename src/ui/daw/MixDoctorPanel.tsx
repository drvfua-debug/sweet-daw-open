"use client";

import React, { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Disc3, ScanLine, ShieldCheck, SlidersHorizontal, Sparkles, Stethoscope } from "lucide-react";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Project } from "@/daw/model/Project";
import { analyzeMixDoctor } from "@/daw/mix/mixDoctorEngine";
import { resolveStableExportSampleRate } from "@/daw/export/ExportConsistency";
import type {
  ArtifactProblem,
  AutoMixPlan,
  ExportModePlan,
  MasterFinishMode,
  MasterFinishReport,
  MixDoctorMode,
  MixDoctorReport,
  MixDoctorTarget,
  SpectralRepairReport,
} from "@/daw/mix/mixDoctorTypes";

type MixDoctorPanelProps = {
  project: Project;
  peaksByFileId: Record<string, PeakSummary>;
  report: MixDoctorReport | null;
  onReport: (report: MixDoctorReport) => void;
  onApplyPlan: (plan: AutoMixPlan) => void;
  onApplyArtifactFix: (problems: ArtifactProblem[]) => void;
  onApplyMasterFinish: (mode: MasterFinishMode) => void;
  onApplyExportMode: (plan: ExportModePlan) => void;
  onRunRenderGuard?: (report: MixDoctorReport) => Promise<void>;
  isRenderGuardRunning?: boolean;
  masterFinishReport: MasterFinishReport | null;
  spectralRepairReport: SpectralRepairReport | null;
  onCreateSpectralRepair: (problems: ArtifactProblem[], mode: MixDoctorMode) => void;
  onOpenRepairView?: () => void;
  auditionActive?: "before" | "after" | null;
  onAuditionChange?: (active: "before" | "after") => void;
  onClearAudition?: () => void;
  onToast?: (message: string) => void;
};

const TARGETS: Array<{ id: MixDoctorTarget; label: string; summary: string; description: string }> = [
  { id: "clean", label: "自然に整理", summary: "こもり/痛さを軽減", description: "元のバランスを保ちながら、こもり、刺さり、ピークの危険を軽く減らします。" },
  { id: "warm", label: "丸く温かく", summary: "薄さ/硬さを緩和", description: "Bodyを残し、高域の硬さを少し丸めます。薄い、硬い、痛いmix向けです。" },
  { id: "vocal_forward", label: "Vocal優先", summary: "歌を前に", description: "Lead Vocalを守り、周辺のMusic帯域を少し整理して歌の場所を作ります。" },
  { id: "wide_pop", label: "横幅を整理", summary: "支えだけ広げる", description: "Vocal、Kick、Bassをセンターに残し、支えのstemだけ高域側で少し広げます。" },
  { id: "reference_polish", label: "Reference比較", summary: "比較だけ", description: "Referenceを目安にします。音量、Air、Widthをそのままコピーせず安全上限内で使います。" },
  { id: "tight_rock", label: "Rockを締める", summary: "パンチ維持", description: "Drums/Guitarの勢いを残しつつ、耳に痛い上中域を避けます。" },
  { id: "club", label: "低域重視", summary: "Kick/Bass整理", description: "KickとBassをセンターに保ち、Subの濁りを整理し、全帯域の広げすぎを避けます。" },
];

const MASTER_FINISH_MODES: Array<{ id: MasterFinishMode; label: string; summary: string; description: string }> = [
  { id: "streaming_safe", label: "配信用安全", summary: "安全な天井", description: "オンライン公開向けにLimiterとExportを控えめで安全な設定にします。" },
  { id: "clean", label: "自然な仕上げ", summary: "軽くクリア", description: "Master EQとDynamicsを少しだけ動かし、自然なまま明瞭さを足します。" },
  { id: "warm", label: "温かい仕上げ", summary: "高域を丸く", description: "Bodyを少し足し、鋭すぎる高域をなめらかにします。" },
  { id: "vocal_forward", label: "Vocal仕上げ", summary: "歌の存在感", description: "全体を押し込みすぎず、Vocalの存在感を保ちます。" },
  { id: "wide_pop", label: "横幅仕上げ", summary: "高域側だけ", description: "BassとVocalを安全に保ち、支えの高域側だけを慎重に広げます。" },
  { id: "reference_polish", label: "Reference準備", summary: "比較用", description: "Referenceを参考にしつつ、コピーや過度なLimiterを避けて整えます。" },
  { id: "tight_rock", label: "Rock仕上げ", summary: "締まった押し", description: "Drums/Guitarの押しを保ちつつ、刺さりを抑えます。" },
  { id: "club", label: "低域仕上げ", summary: "Sub安全", description: "Dance系向けに、低域の制御と安全な天井を優先します。" },
  { id: "loud", label: "音量確認", summary: "強め確認", description: "迫力確認用に少し押します。ダイナミクスが平たくなるため注意してください。" },
];

export function MixDoctorPanel({
  project,
  peaksByFileId,
  report,
  onReport,
  onApplyPlan,
  onApplyArtifactFix,
  onApplyMasterFinish,
  onApplyExportMode,
  onRunRenderGuard,
  isRenderGuardRunning = false,
  masterFinishReport,
  spectralRepairReport,
  onCreateSpectralRepair,
  onOpenRepairView,
  auditionActive,
  onAuditionChange,
  onClearAudition,
  onToast,
}: MixDoctorPanelProps) {
  const [mode, setMode] = useState<MixDoctorMode>("light");
  const [target, setTarget] = useState<MixDoctorTarget>("clean");
  const [masterFinishMode, setMasterFinishMode] = useState<MasterFinishMode>("clean");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const canAnalyze = project.tracks.some((track) => track.role !== "reference" && !track.mute);
  const topProblems = report?.problems.slice(0, 4) ?? [];
  const selectedTargetInfo = TARGETS.find((entry) => entry.id === target) ?? TARGETS[0];
  const selectedMasterFinishInfo = MASTER_FINISH_MODES.find((entry) => entry.id === masterFinishMode) ?? MASTER_FINISH_MODES[1];

  const handleAnalyze = async () => {
    if (!canAnalyze) {
      onToast?.("AIMIX診断の前にstemを読み込むか、muteを解除してください。");
      return;
    }

    setIsAnalyzing(true);
    try {
      let renderedMetrics = null;
      if (project.clips.length > 0) {
        try {
          const [{ renderProjectOffline }, { analyzeRenderedBuffer }] = await Promise.all([
            import("@/audio/engine/OfflineRenderer"),
            import("@/daw/mix/renderDamageGuard"),
          ]);
          const sampleRate = resolveStableExportSampleRate(project);
          const renderedBuffer = await renderProjectOffline(project, undefined, {
            sampleRate,
            renderPaddingSec: 0,
            maxDurationSec: 60,
          });
          renderedMetrics = analyzeRenderedBuffer(renderedBuffer);
        } catch (error) {
          onToast?.(`Rendered analysis skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const nextReport = analyzeMixDoctor(project, peaksByFileId, { mode, target, renderedMetrics });
      onReport(nextReport);
      onToast?.(
        renderedMetrics
          ? `AIMIX診断: ${nextReport.masterReadiness.overall}/100 (rendered mix measured)`
          : `AIMIX診断: ${nextReport.masterReadiness.overall}/100`,
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyPlan = () => {
    if (!report) return;
    onApplyPlan(report.autoMixPlan);
    onToast?.("VolumeとPanの提案を適用しました。戻す場合はUndoを使ってください。");
  };

  const handleApplyArtifactFix = () => {
    if (!report || report.problems.length === 0) {
      onToast?.("整理対象の大きな問題はありません。");
      return;
    }
    onApplyArtifactFix(report.problems);
    onToast?.("軽いノイズ/濁り整理を適用しました。A/Bで確認してください。");
  };

  const handleApplyMasterFinish = () => {
    onApplyMasterFinish(masterFinishMode);
    onToast?.(`最終Master Toneを適用しました: ${MASTER_FINISH_MODES.find((entry) => entry.id === masterFinishMode)?.label ?? masterFinishMode}`);
  };

  const handleApplyExportMode = () => {
    if (!report?.exportModePlan) return;
    onApplyExportMode(report.exportModePlan);
    onToast?.(`Updated export settings: ${report.exportModePlan.mode.replace(/_/g, " ")}`);
  };

  const handleRunRenderGuard = () => {
    if (!report || !onRunRenderGuard) return;
    void onRunRenderGuard(report);
  };

  const handleCreateSpectralRepair = () => {
    if (!report || report.problems.length === 0) {
      onToast?.("Run Analyze Mix first, or no frequency cleanup issue was found.");
      return;
    }
    onCreateSpectralRepair(report.problems, mode);
    onOpenRepairView?.();
    onToast?.("Repair analyzed. Open Repair to inspect and apply selected regions.");
  };

  const handleAudition = (active: "before" | "after") => {
    onAuditionChange?.(active);
    onToast?.(active === "before" ? "A/B: Hear Before" : "A/B: Hear After");
  };

  return (
    <>
    <section className="rounded-xl border border-daw-cyan/20 bg-daw-cyan/[0.045] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-daw-cyan/25 bg-daw-cyan/10 text-daw-cyan">
            <Stethoscope size={16} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-xs font-black uppercase tracking-wider text-daw-cyan">AIMIX診断</h3>
            <p className="text-[9px] leading-tight text-daw-muted">実際のmixを測定し、安全な提案だけを選んで適用します。</p>
          </div>
        </div>
        {report && (
          <span className="rounded-lg bg-black/35 px-2 py-1 text-[10px] font-black text-daw-text">
            {report.masterReadiness.overall}/100
          </span>
        )}
      </div>

      <div className="mb-2 rounded-xl border border-daw-cyan/15 bg-black/25 px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
        <div className="mb-1 font-black uppercase tracking-wider text-daw-cyan">安全な流れ</div>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
          <span>1. AIMIX診断</span>
          <span>2. Before/After安全確認</span>
          <span>3. 良いものだけ適用</span>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl border border-white/[0.04] bg-black/30 p-1">
        {(["light", "balanced", "strong"] as MixDoctorMode[]).map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setMode(entry)}
            className={`rounded-lg py-1.5 text-[9px] font-black uppercase transition-all ${
              mode === entry ? "bg-daw-cyan text-black shadow-glow-cyan" : "text-daw-muted"
            }`}
          >
            {entry}
          </button>
        ))}
      </div>
      <div className="mb-2 rounded-xl border border-white/[0.05] bg-black/25 px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
        強さ: Lightは最小提案、Balancedは標準、Strongは強めです。Strongは書き出し前にBefore/After安全確認をしてください。
      </div>

      <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {TARGETS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTarget(entry.id)}
            className={`rounded-lg border px-2 py-1.5 text-left transition-all ${
              target === entry.id
                ? "border-daw-cyan bg-daw-cyan/15 text-daw-cyan"
                : "border-white/[0.05] bg-black/20 text-daw-muted"
            }`}
          >
            <span className="block text-[9px] font-black uppercase tracking-wider">{entry.label}</span>
            <span className="mt-0.5 block text-[8px] font-bold opacity-75">{entry.summary}</span>
          </button>
        ))}
      </div>
      <div className="mb-2 rounded-xl border border-white/[0.05] bg-black/25 px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
        <span className="font-black text-daw-text">Target: {selectedTargetInfo.label}</span>
        <p className="mt-0.5">{selectedTargetInfo.description}</p>
      </div>

      <button
        type="button"
        onClick={handleAnalyze}
        disabled={!canAnalyze || isAnalyzing}
        className="mb-2 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-daw-cyan text-xs font-black text-black shadow-glow-cyan disabled:cursor-not-allowed disabled:opacity-35"
      >
        <Activity size={15} />
        {isAnalyzing ? "測定中..." : "AIMIX診断"}
      </button>

      {report ? (
        <div className="flex flex-col gap-2">
          <MasterReadinessMeter readiness={report.masterReadiness} />

          <div className="grid grid-cols-2 gap-1.5">
            <ScorePill label="Master" value={report.masterReadiness.overall} />
            <ScorePill label="Artifact" value={report.masterReadiness.aiArtifact} />
            <ScorePill label="Vocal" value={report.masterReadiness.vocalPresence} />
            <ScorePill label="Low End" value={report.masterReadiness.lowEnd} />
            <ScorePill label="Stereo" value={report.masterReadiness.stereoImage} />
            <ScorePill label="Peak" value={report.masterReadiness.peakSafety} />
          </div>

          {report.perceptualScoreReport && (
            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
                <Activity size={12} />
                Listening Quality Scores
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <ScorePill label="Clarity" value={report.perceptualScoreReport.clarity} />
                <ScorePill label="Body" value={report.perceptualScoreReport.body} />
                <ScorePill label="Vocal" value={report.perceptualScoreReport.vocalFocus} />
                <ScorePill label="Low Tight" value={report.perceptualScoreReport.lowEndTightness} />
                <ScorePill label="Stereo" value={report.perceptualScoreReport.stereoImage} />
                <ScorePill label="Harsh" value={report.perceptualScoreReport.harshness} />
                <ScorePill label="Mud" value={report.perceptualScoreReport.mud} />
                <ScorePill label="Reverb" value={report.perceptualScoreReport.reverbCleanliness} />
              </div>
            </div>
          )}

          {report.philosophyScore && (
            <div className="rounded-xl border border-daw-cyan/10 bg-daw-cyan/[0.045] p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-cyan">
                <Activity size={12} />
                Mix Philosophy
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <ScorePill label="Overall" value={report.philosophyScore.overall} />
                <ScorePill label="Low Translate" value={report.philosophyScore.lowTranslation} />
                <ScorePill label="Vocal Focus" value={report.philosophyScore.vocalClarity} />
                <ScorePill label="Stage" value={report.philosophyScore.stagePlacement} />
                <ScorePill label="Space Clean" value={report.philosophyScore.reverbCleanliness} />
                <ScorePill label="Contrast" value={report.philosophyScore.loudnessByContrast} />
              </div>
              <p className="mt-1 text-[9px] leading-snug text-daw-muted">
                {report.philosophyScore.notes[0] ?? "Role, band, placement, and contrast are checked before limiter loudness."}
              </p>
            </div>
          )}

          {report.renderedMixMetrics && (
            <div className="rounded-xl border border-daw-cyan/15 bg-daw-cyan/[0.055] p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-cyan">
                <Activity size={12} />
                Current Rendered Mix
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                <MetricPill label="Peak" value={`${report.renderedMixMetrics.peakDb.toFixed(1)} dB`} />
                <MetricPill label="RMS" value={`${report.renderedMixMetrics.rmsDb.toFixed(1)} dB`} />
                <MetricPill label="Crest" value={`${report.renderedMixMetrics.crestFactorDb.toFixed(1)} dB`} />
                <MetricPill label="Side/Mid" value={`${report.renderedMixMetrics.sideMidRatioDb.toFixed(1)} dB`} />
                <MetricPill label="Presence" value={`${report.renderedMixMetrics.presenceDb.toFixed(1)} dB`} />
                <MetricPill label="Air" value={`${report.renderedMixMetrics.airDb.toFixed(1)} dB`} />
              </div>
              <p className="mt-1.5 text-[9px] leading-snug text-daw-muted">
                AIMIX診断はraw stem推定だけでなく、実際の再生/書き出し経路に近いrender結果も見ています。
              </p>
            </div>
          )}

          {(report.referenceProfile || report.loudnessMatchReport || report.referenceDelta || report.referenceRepair) && (
            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
                <CheckCircle2 size={12} />
                Reference
              </div>
              <div className="space-y-1.5 text-[9px] leading-snug text-daw-muted">
                <div className="rounded-lg bg-white/[0.025] px-2 py-1.5">
                  <span className="font-black text-daw-text">{report.referenceProfile?.trackName ?? "No reference loaded"}</span>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1">
                    <span>Role: {report.referenceProfile?.sourceRole ?? "none"}</span>
                    {report.referenceProfile && <span>Ref LUFS: {report.referenceProfile.integratedLufsApprox.toFixed(1)}</span>}
                  </div>
                </div>
                {report.loudnessMatchReport && (
                  <div className="rounded-lg bg-white/[0.025] px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-daw-text">Loudness Match</span>
                      <span className="font-black text-amber-100">{report.loudnessMatchReport.appliedGainDb > 0 ? "+" : ""}{report.loudnessMatchReport.appliedGainDb} dB</span>
                    </div>
                    <p className="mt-0.5">
                      {report.loudnessMatchReport.currentLufsApprox.toFixed(1)} {"->"} {report.loudnessMatchReport.referenceLufsApprox.toFixed(1)} LUFS approx
                    </p>
                  </div>
                )}
                {report.referenceDelta && (
                  <div className="rounded-lg bg-white/[0.025] px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-daw-text">Delta</span>
                      <span>Air {formatDelta(report.referenceDelta.airDeltaDb)} / Body {formatDelta(report.referenceDelta.bodyDeltaDb)}</span>
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                      {report.referenceDelta.advisory.slice(0, 2).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.referenceDelta && <ReferenceDeltaMeter delta={report.referenceDelta} />}
                {report.referenceRepair && (
                  <div className={`rounded-lg border px-2 py-1.5 ${
                    report.referenceRepair.severity === "critical"
                      ? "border-rose-300/25 bg-rose-400/10 text-rose-100"
                      : report.referenceRepair.severity === "warning"
                        ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
                        : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black">Direct WAV Repair</span>
                      <span className="font-black uppercase">{report.referenceRepair.status.replace(/_/g, " ")}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      <MetricPill label="RMS diff" value={formatDelta(report.referenceRepair.rmsDiffDb)} />
                      <MetricPill label="Peak diff" value={formatDelta(report.referenceRepair.peakDiffDb)} />
                      <MetricPill label="Crest diff" value={formatDelta(report.referenceRepair.crestDiffDb)} />
                      <MetricPill label="Side/Mid" value={formatDelta(report.referenceRepair.sideMidDiffDb)} />
                    </div>
                    <p className="mt-1 rounded-md bg-black/20 px-2 py-1 text-[9px] leading-snug text-daw-text">
                      {report.referenceRepair.messages[0]}
                    </p>
                    <p className="mt-1 text-[9px] leading-snug">
                      Suggested: {report.referenceRepair.recommendedChain.slice(0, 4).join(" -> ")}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {report.kickBassRoleReport && (
            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
                <AlertTriangle size={12} />
                Kick / Bass
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                <ScorePill label="Overlap" value={report.kickBassRoleReport.lowEndOverlapScore} />
                <ScorePill label="Mono Risk" value={report.kickBassRoleReport.monoRisk} />
                <ScorePill label="Timing" value={report.kickBassRoleReport.timingCollisionScore} />
                <ScorePill label="Phase" value={report.kickBassRoleReport.phaseRisk} />
              </div>
              <div className="mt-1 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
                {report.kickBassRoleReport.recommendations.slice(0, 3).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
          )}

          {(report.lowEndKingReport || report.peakCulpritReport) && (
            <DecisionLayerCards
              lowEndKingReport={report.lowEndKingReport ?? null}
              peakCulpritReport={report.peakCulpritReport ?? null}
            />
          )}

          {report.stemPurityReports && report.stemPurityReports.length > 0 && (
            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
                <ShieldCheck size={12} />
                Stem Purity
              </div>
              <p className="hidden">
                Checks whether each imported stem looks clean enough for mixing, or whether it may contain bleed, noise, harshness, or role confusion.
              </p>
              <div className="max-h-36 overflow-y-auto pr-1">
                {report.stemPurityReports.slice(0, 5).map((stem) => (
                  <div key={stem.stemId} className="mb-1 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-daw-text">{stem.trackName}</span>
                      <span className={stem.purityScore >= 75 ? "text-emerald-200" : stem.purityScore >= 45 ? "text-amber-200" : "text-rose-200"}>
                        {stem.purityScore.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-daw-muted">{stem.mode.replace(/_/g, " ")}</p>
                    <p className="truncate text-daw-muted">{stem.notes[0]}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(report.contaminationReports?.length ?? 0) > 0 && (
            <StemContaminationCleanerCard
              contaminationReports={report.contaminationReports ?? []}
              dirtyStemPlans={report.dirtyStemPlans ?? []}
            />
          )}

          {(report.autoPluginPlan || report.kickBassRoleReport || report.lowEndKingReport) && (
            <UnmaskSuggestionCard report={report} />
          )}

          {(report.problems.length > 0 || (spectralRepairReport?.ops.length ?? 0) > 0) && (
            <ResonanceSuggestionCard report={report} spectralRepairReport={spectralRepairReport} />
          )}

          {report.autoPluginPlan && (
            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
                <SlidersHorizontal size={12} />
                Suggested Plug-in Moves
              </div>
              <p className="hidden">
                AIMIX診断が追加候補にするPlug-inです。安全確認で弱めたりBypassするため、強制ではなく提案として扱います。
              </p>
              <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
                AIMIX診断が提案する追加Plug-inです。強制処理ではなく、Before/After Safetyで必要に応じて弱めたりバイパスできる候補として扱います。
              </p>
              {report.ambienceSeatPlan && (
                <p className="mb-2 rounded-lg border border-daw-cyan/15 bg-daw-cyan/[0.06] px-2 py-1.5 text-[9px] leading-snug text-daw-cyan">
                  {report.ambienceSeatPlan.recommendations[0]}
                </p>
              )}
              <div className="max-h-44 overflow-y-auto pr-1">
                {report.autoPluginPlan.trackPlans.slice(0, 5).map((plan) => (
                  <div key={plan.trackId} className="mb-1 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-daw-text">{plan.trackName}</span>
                      <span className="text-daw-muted">Purity {plan.purityScore.toFixed(1)}</span>
                    </div>
                    <p className="text-daw-muted">{plan.insertPlans.map((insert) => `${insert.enabled ? "" : "Bypass "}${insert.name}`).join(" / ") || "No insert plan"}</p>
                    {plan.insertPlans.some((insert) => insert.params.damageGuard === "weakened") && <p className="text-amber-200">Before/After Safety weakened inserts.</p>}
                    {plan.insertPlans.some((insert) => insert.routePreference === "send") && <p className="text-daw-muted">Send-style FX uses low-mix fallback until shared buses are available.</p>}
                    {plan.sendPlans.length > 0 && <p className="text-daw-muted">Send: {plan.sendPlans[0].targetBusName}</p>}
                    <p className="truncate text-daw-muted">{plan.notes[0]}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {report.damageGuardReport && (
            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
                <ShieldCheck size={12} />
                Before/After Safety
              </div>
              <div className={`rounded-lg px-2 py-1.5 text-[9px] font-black uppercase tracking-wider ${report.damageGuardReport.allowed ? "bg-emerald-300/10 text-emerald-100" : "bg-amber-300/10 text-amber-100"}`}>
                {report.damageGuardReport.allowed ? "Allowed" : "Weaken or bypass"}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                <ScorePill label="Before" value={report.damageGuardReport.before.clarity} />
                <ScorePill label="After" value={report.damageGuardReport.after.clarity} />
                <ScorePill label="Mud" value={report.damageGuardReport.after.mud} />
                <ScorePill label="Peak" value={report.damageGuardReport.after.peakSafety} />
              </div>
              <div className="mt-1 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
                {report.damageGuardReport.warnings.slice(0, 2).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              {report.abCompareReport && (
                <div className="mt-1 rounded-lg border border-daw-cyan/15 bg-daw-cyan/[0.06] px-2 py-1.5 text-[9px] leading-snug text-daw-cyan">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black">Before/After Level Match</span>
                    <span>{report.abCompareReport.gainCompensationDb > 0 ? "+" : ""}{report.abCompareReport.gainCompensationDb} dB</span>
                  </div>
                  <p className="mt-0.5">{report.abCompareReport.loudnessMatched ? "Loudness matched" : "Use gain compensation before judging quality"}</p>
                </div>
              )}
              <p className="mt-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
                Renders a short before/after comparison and checks whether the planned changes made the mix dull, harsh, muddy, or too close to clipping. This is a check only; it does not change the mix.
              </p>
              <button
                type="button"
                onClick={handleRunRenderGuard}
                disabled={!onRunRenderGuard || isRenderGuardRunning}
                className="mt-2 flex min-h-[36px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-[10px] font-black uppercase tracking-wider text-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ShieldCheck size={13} />
                {isRenderGuardRunning ? "Checking Audio..." : "Check Before/After Safety"}
              </button>
            </div>
          )}

          {report.exportModePlan && (
            <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
              <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
                <Disc3 size={12} />
                Recommended Export Settings
              </div>
              <div className="rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-daw-text">{report.exportModePlan.mode}</span>
                  <span>{report.exportModePlan.bitDepth}</span>
                </div>
                <p className="mt-0.5">Limiter {report.exportModePlan.limiterEnabled ? "on" : "off"} / Normalize {report.exportModePlan.normalizePeak ? "on" : "off"}</p>
                <p className="mt-0.5">{report.exportModePlan.notes[0]}</p>
              </div>
              <p className="mt-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
                AIMIX診断の推奨をExport設定へ写します。Limiter、Peak Normalize、Bit depth、Sample rateを変えるだけで、ここでは音声を書き出しません。
              </p>
              <button
                type="button"
                onClick={handleApplyExportMode}
                className="mt-2 flex min-h-[36px] w-full items-center justify-center gap-2 rounded-xl border border-daw-cyan/30 bg-daw-cyan/10 text-[10px] font-black uppercase tracking-wider text-daw-cyan"
              >
                <Disc3 size={13} />
                推奨Export設定を適用
              </button>
            </div>
          )}

          <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
            <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
              <AlertTriangle size={12} />
              Detected Mix Issues
            </div>
            <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
              These are the biggest problems found in the mix. Broad Track Cleanup changes track-level EQ/FX. Repair Regions only affect selected time/frequency ranges.
            </p>
            {topProblems.length > 0 ? (
              <div className="flex flex-col gap-1">
                {topProblems.map((problem) => (
                  <div key={problem.id} className="rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-daw-text">{problem.type.replace(/_/g, " ")}</span>
                      <span className="font-black text-amber-200">{problem.score}</span>
                    </div>
                    <p className="mt-0.5 text-daw-muted">{problem.suggestedFix}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 rounded-lg bg-emerald-400/10 px-2 py-1.5 text-[9px] font-bold text-emerald-200">
                <CheckCircle2 size={12} />
                No major repair issue detected.
              </div>
            )}
            <button
              type="button"
              onClick={handleApplyArtifactFix}
              disabled={report.problems.length === 0}
              className="mt-2 flex min-h-[38px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/10 text-[10px] font-black uppercase tracking-wider text-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Sparkles size={13} />
              Apply Broad Track Cleanup
            </button>
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
            <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
              <Disc3 size={12} />
              最終Master Tone
            </div>
            <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
              最終Master Tone changes the master bus, not individual clips. It can set gentle master EQ, compression, limiter behavior, and loudness-safe finishing.
            </p>
            <div className="mb-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {MASTER_FINISH_MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setMasterFinishMode(entry.id)}
                  className={`rounded-lg border px-2 py-1.5 text-[9px] font-bold transition-all ${
                    masterFinishMode === entry.id
                      ? "border-daw-cyan bg-daw-cyan/15 text-daw-cyan"
                      : "border-white/[0.05] bg-black/20 text-daw-muted"
                  }`}
                >
                  <span className="block text-[9px] font-black uppercase tracking-wider">{entry.label}</span>
                  <span className="mt-0.5 block text-[8px] font-bold opacity-75">{entry.summary}</span>
                </button>
              ))}
            </div>
            <div className="mb-2 rounded-xl border border-white/[0.05] bg-black/25 px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
              <span className="font-black text-daw-text">Selected: {selectedMasterFinishInfo.label}</span>
              <p className="mt-0.5">{selectedMasterFinishInfo.description}</p>
            </div>
            <button
              type="button"
              onClick={handleApplyMasterFinish}
              className="flex min-h-[38px] w-full items-center justify-center gap-2 rounded-xl border border-amber-300/35 bg-amber-300/10 text-[10px] font-black uppercase tracking-wider text-amber-100"
            >
              <Disc3 size={13} />
              Apply 最終Master Tone
            </button>
            {masterFinishReport && (
              <div className="mt-2 rounded-lg border border-white/[0.05] bg-white/[0.025] p-2 text-[9px] leading-snug text-daw-muted">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-black text-daw-text">{masterFinishReport.label}</span>
                  <span className="font-black text-amber-100">{masterFinishReport.ceilingDb} dBTP</span>
                </div>
                <p>{masterFinishReport.targetLoudness}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {masterFinishReport.damageChecks.slice(0, 3).map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
                {masterFinishReport.warnings.length > 0 && (
                  <div className="mt-1 rounded-md bg-amber-300/10 px-2 py-1 font-bold text-amber-100">
                    {masterFinishReport.warnings[0]}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
            <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
              <ScanLine size={12} />
              Repair
            </div>
            <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
              Shows harshness, mud, rumble, metallic AI tone, or bleed over time and frequency. Open Repair to zoom, compare Before/After, and apply selected regions.
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleCreateSpectralRepair}
                disabled={!report || report.problems.length === 0}
                className="flex min-h-[36px] items-center justify-center gap-1 rounded-lg border border-daw-cyan/30 bg-daw-cyan/10 px-2 text-[9px] font-black uppercase text-daw-cyan disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ScanLine size={12} />
                Analyze Repair
              </button>
              <button
                type="button"
                onClick={onOpenRepairView}
                disabled={(!report && !spectralRepairReport) || !onOpenRepairView}
                className="flex min-h-[36px] items-center justify-center gap-1 rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2 text-[9px] font-black uppercase text-emerald-100 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <Sparkles size={12} />
                Open Repair
              </button>
            </div>
            {spectralRepairReport ? (
              <div className="mt-2 rounded-lg border border-white/[0.05] bg-white/[0.025] p-2 text-[9px] leading-snug text-daw-muted">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-black text-daw-text">
                    {spectralRepairReport.beforeSummary?.hotCells ?? spectralRepairReport.ops.length} hot regions / {spectralRepairReport.ops.length} repair regions
                  </span>
                  <span className="font-black text-daw-cyan">{spectralRepairReport.mode}</span>
                </div>
                <div className="max-h-24 overflow-y-auto pr-1">
                  {spectralRepairReport.ops.slice(0, 5).map((op) => (
                    <div key={op.id} className="mb-1 rounded-md bg-black/25 px-2 py-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-daw-text">{op.operation}</span>
                        <span>{op.lowFreq}-{op.highFreq}Hz</span>
                      </div>
                      <p className="truncate">{op.role} / {op.startTime}s-{op.endTime}s</p>
                    </div>
                  ))}
                </div>
                <div className="mt-1 rounded-md bg-amber-300/10 px-2 py-1 font-bold text-amber-100">
                  Difference preview is predicted here; the Repair screen can play Before/After/Removed/Delta previews. Apply Selected Regions stores fixed non-destructive repair regions used by export.
                </div>
              </div>
            ) : (
              <p className="mt-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
                Analyze Repair finds likely harsh, muddy, boomy, or metallic areas. Open Repair to inspect and apply only selected time/frequency regions.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
            <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
              <SlidersHorizontal size={12} />
              Suggested Fader / Pan Layout
            </div>
            <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
              Shows suggested track gain, pan, and width placement. Applying it changes the mixer balance only; it does not render/export audio.
            </p>
            <div className="max-h-36 overflow-y-auto pr-1">
              {report.autoMixPlan.trackPlans.slice(0, 12).map((plan) => (
                <div key={plan.trackId} className="mb-1 grid grid-cols-[1fr_auto] gap-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px]">
                  <span className="truncate font-bold text-daw-text">{plan.trackName}</span>
                  <span className="text-daw-muted">
                    {plan.volumeTrimDb > 0 ? "+" : ""}
                    {plan.volumeTrimDb}dB / pan {plan.pan}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleApplyPlan}
              className="mt-2 flex min-h-[38px] w-full items-center justify-center gap-2 rounded-xl border border-daw-cyan/35 bg-daw-cyan/15 text-[10px] font-black uppercase tracking-wider text-daw-cyan"
            >
              <SlidersHorizontal size={13} />
              Apply Fader / Pan Layout
            </button>
            {auditionActive && (
              <div className="mt-2 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => handleAudition("before")}
                  className={`rounded-lg border px-2 py-1.5 text-[9px] font-black uppercase ${
                    auditionActive === "before"
                      ? "border-amber-300 bg-amber-300/15 text-amber-100"
                      : "border-white/[0.05] bg-black/25 text-daw-muted"
                  }`}
                >
                  Hear Before
                </button>
                <button
                  type="button"
                  onClick={() => handleAudition("after")}
                  className={`rounded-lg border px-2 py-1.5 text-[9px] font-black uppercase ${
                    auditionActive === "after"
                      ? "border-daw-cyan bg-daw-cyan/15 text-daw-cyan"
                      : "border-white/[0.05] bg-black/25 text-daw-muted"
                  }`}
                >
                  Hear After
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearAudition?.();
                    onToast?.("A/B cleared");
                  }}
                  className="rounded-lg border border-white/[0.05] bg-black/25 px-2 py-1.5 text-[9px] font-black uppercase text-daw-muted"
                >
                  Stop A/B
                </button>
              </div>
            )}
            <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-daw-cyan/15 bg-daw-cyan/[0.06] px-2 py-1.5 text-[9px] text-daw-cyan">
              <ShieldCheck size={12} className="mt-0.5 shrink-0" />
              Light apply only: gain, pan, and safe high-side width. A/B does not add Undo steps.
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.04] bg-black/20 p-2 text-[9px] leading-relaxed text-daw-muted">
          Run Analyze Mix first. Sweet DAW will measure the current rendered mix, show the biggest risks, then let you apply only the cleanup, master tone, export setting, or fader/pan suggestion you choose.
        </div>
      )}
    </section>
    </>
  );
}

function MasterReadinessMeter({ readiness }: { readiness: MixDoctorReport["masterReadiness"] }) {
  const rows = [
    { label: "Loudness", value: readiness.loudness },
    { label: "Tone", value: readiness.tonalBalance },
    { label: "Low End", value: readiness.lowEnd },
    { label: "Vocal", value: readiness.vocalPresence },
    { label: "Stereo", value: readiness.stereoImage },
    { label: "Peak", value: readiness.peakSafety },
    { label: "Mud", value: readiness.mud },
    { label: "Harsh", value: readiness.harshness },
  ];

  return (
    <div className="rounded-xl border border-daw-cyan/15 bg-daw-cyan/[0.055] p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-cyan">
          <Activity size={12} />
          Master Readiness
        </div>
        <span className="rounded-md bg-black/30 px-2 py-0.5 text-[9px] font-black text-daw-text">{readiness.overall}/100</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {rows.map((row) => (
          <ScorePill key={row.label} label={row.label} value={row.value} />
        ))}
      </div>
      {readiness.notes.length > 0 && (
        <div className="mt-1.5 rounded-lg bg-black/25 px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
          {readiness.notes.slice(0, 3).map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ReferenceDeltaMeter({ delta }: { delta: NonNullable<MixDoctorReport["referenceDelta"]> }) {
  const status = classifyReferenceDelta(delta);
  return (
    <div className={`rounded-lg border px-2 py-1.5 ${statusCardClass(status.status)}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-black">Reference Delta Meter</span>
        <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[8px] font-black uppercase">{status.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 text-[9px] sm:grid-cols-3">
        <MetricPill label="LUFS" value={formatDelta(delta.loudnessDeltaDb)} />
        <MetricPill label="True Peak" value={formatDelta(delta.peakDeltaDb)} />
        <MetricPill label="Crest" value={formatDelta(delta.crestFactorDeltaDb)} />
        <MetricPill label="Low" value={formatDelta(delta.lowEndDeltaDb)} />
        <MetricPill label="Body" value={formatDelta(delta.bodyDeltaDb)} />
        <MetricPill label="Presence" value={formatDelta(delta.presenceDeltaDb)} />
        <MetricPill label="Air" value={formatDelta(delta.airDeltaDb)} />
        <MetricPill label="Width" value={formatSigned(delta.stereoWidthDelta, 2)} />
        <MetricPill label="Corr" value={formatSigned(delta.correlationDelta, 2)} />
      </div>
      <p className="mt-1.5 rounded-md bg-black/20 px-2 py-1 text-[9px] leading-snug">{status.reason}</p>
    </div>
  );
}

function StemContaminationCleanerCard({
  contaminationReports,
  dirtyStemPlans,
}: {
  contaminationReports: NonNullable<MixDoctorReport["contaminationReports"]>;
  dirtyStemPlans: NonNullable<MixDoctorReport["dirtyStemPlans"]>;
}) {
  const topReports = contaminationReports
    .map((item) => ({
      ...item,
      risk: Math.max(
        item.vocalBleedScore,
        item.cymbalMetallicScore,
        item.roomWashScore,
        item.lowEndContaminationScore,
        item.artifactScore,
      ),
    }))
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
      <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
        <ShieldCheck size={12} />
        Stem Contamination Cleaner
      </div>
      <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
        Finds bleed, metallic cymbal wash, room smear, and low-end contamination. High-risk stems should use component-safe moves first.
      </p>
      <div className="max-h-40 overflow-y-auto pr-1">
        {topReports.map((item) => {
          const plan = dirtyStemPlans.find((entry) => entry.trackId === item.trackId);
          return (
            <div key={item.trackId} className="mb-1 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-black text-daw-text">{item.trackName}</span>
                <span className={item.risk >= 70 ? "text-rose-200" : item.risk >= 45 ? "text-amber-200" : "text-emerald-200"}>{item.risk}</span>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <MetricPill label="Bleed" value={`${item.vocalBleedScore}`} />
                <MetricPill label="Metal" value={`${item.cymbalMetallicScore}`} />
                <MetricPill label="Room" value={`${item.roomWashScore}`} />
                <MetricPill label="Low Dirt" value={`${item.lowEndContaminationScore}`} />
              </div>
              <p className="mt-1 truncate text-daw-muted">{plan?.notes[0] ?? item.warnings[0] ?? "No strong contamination action required."}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UnmaskSuggestionCard({ report }: { report: MixDoctorReport }) {
  const duckingPlans =
    report.autoPluginPlan?.trackPlans
      .flatMap((track) =>
        track.insertPlans
          .filter((insert) => /duck|unmask|side|dynamic|eq/i.test(`${insert.pluginId} ${insert.name} ${insert.reason}`))
          .map((insert) => ({
            trackName: track.trackName,
            name: insert.name,
            reason: insert.reason,
            confidence: insert.confidence,
          })),
      )
      .slice(0, 4) ?? [];

  return (
    <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
      <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
        <SlidersHorizontal size={12} />
        Sweet Unmask / Dynamic EQ Guide
      </div>
      <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
        Shows ducking and band-cleanup candidates for protecting vocal, kick, and bass space. This card is advisory and avoids strong automatic processing.
      </p>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {report.lowEndKingReport && (
          <div className={`rounded-lg border px-2 py-1.5 text-[9px] leading-snug ${statusCardClass(report.lowEndKingReport.status)}`}>
            <div className="font-black">Low-End Conflict</div>
            <p>{report.lowEndKingReport.recommendations[0] ?? "Kick/Bass ownership is stable."}</p>
          </div>
        )}
        {report.kickBassRoleReport && (
          <div className="rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
            <div className="font-black text-daw-text">Kick/Bass Role</div>
            <p>{report.kickBassRoleReport.recommendations[0] ?? "No major kick/bass role issue."}</p>
          </div>
        )}
      </div>
      {duckingPlans.length > 0 ? (
        <div className="mt-2 max-h-28 overflow-y-auto pr-1">
          {duckingPlans.map((plan) => (
            <div key={`${plan.trackName}-${plan.name}`} className="mb-1 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-black text-daw-text">{plan.trackName}</span>
                <span className="text-daw-muted">{Math.round(plan.confidence * 100)}%</span>
              </div>
              <p className="text-daw-muted">{plan.name}: {plan.reason}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
          No strong Dynamic EQ candidate yet. Fader/Pan and gentle EQ cleanup should be enough for this pass.
        </p>
      )}
    </div>
  );
}

function ResonanceSuggestionCard({
  report,
  spectralRepairReport,
}: {
  report: MixDoctorReport;
  spectralRepairReport: SpectralRepairReport | null;
}) {
  const frequencyProblems = report.problems
    .filter((problem) => problem.lowFreq || problem.highFreq)
    .slice(0, 4);
  const ops = spectralRepairReport?.ops.slice(0, 4) ?? [];

  return (
    <div className="rounded-xl border border-white/[0.05] bg-black/25 p-2">
      <div className="mb-1 flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-daw-muted">
        <ScanLine size={12} />
        Resonance Finder / Spectral Retouch Lite
      </div>
      <p className="mb-2 rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug text-daw-muted">
        Lists likely muddy, harsh, metallic, or boomy ranges. Prepare a repair draft first, then apply only gentle cleanup if needed.
      </p>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {frequencyProblems.map((problem) => (
          <div key={problem.id} className="rounded-lg bg-white/[0.025] px-2 py-1.5 text-[9px] leading-snug">
            <div className="flex items-center justify-between gap-2">
              <span className="font-black text-daw-text">{problem.type.replace(/_/g, " ")}</span>
              <span className="text-amber-200">{problem.score}</span>
            </div>
            <p className="text-daw-muted">{formatFrequencyRange(problem.lowFreq, problem.highFreq)} / {problem.suggestedFix}</p>
          </div>
        ))}
        {ops.map((op) => (
          <div key={op.id} className="rounded-lg border border-daw-cyan/15 bg-daw-cyan/[0.06] px-2 py-1.5 text-[9px] leading-snug text-daw-cyan">
            <div className="flex items-center justify-between gap-2">
              <span className="font-black">{op.operation}</span>
              <span>{op.lowFreq}-{op.highFreq}Hz</span>
            </div>
            <p>{op.reason}</p>
          </div>
        ))}
      </div>
      {frequencyProblems.length === 0 && ops.length === 0 && (
        <div className="flex items-center gap-1.5 rounded-lg bg-emerald-400/10 px-2 py-1.5 text-[9px] font-bold text-emerald-200">
          <CheckCircle2 size={12} />
          No strong resonance candidate.
        </div>
      )}
    </div>
  );
}

function DecisionLayerCards({
  lowEndKingReport,
  peakCulpritReport,
}: {
  lowEndKingReport: MixDoctorReport["lowEndKingReport"] | null;
  peakCulpritReport: MixDoctorReport["peakCulpritReport"] | null;
}) {
  const peakTop = peakCulpritReport?.topCulprits[0] ?? null;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {lowEndKingReport && (
        <div className={`rounded-xl border p-2 ${statusCardClass(lowEndKingReport.status)}`}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[9px] font-black uppercase tracking-wider">
              <ShieldCheck size={12} className="shrink-0" />
              <span>Low-End King</span>
            </div>
            <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[8px] font-black uppercase">{lowEndKingReport.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[9px]">
            <MetricPill label="Owner" value={lowEndKingReport.owner} />
            <MetricPill label="Low risk" value={`${lowEndKingReport.monoLowRisk}`} />
            <MetricPill label="20-35" value={`${lowEndKingReport.sub2035Db.toFixed(1)} dB`} />
            <MetricPill label="35-60" value={`${lowEndKingReport.sub3560Db.toFixed(1)} dB`} />
          </div>
          <p className="mt-1.5 rounded-lg bg-black/20 px-2 py-1.5 text-[9px] leading-snug">
            {lowEndKingReport.recommendations[0] ?? "20-60Hz owner is stable."}
          </p>
        </div>
      )}

      {peakCulpritReport && (
        <div className={`rounded-xl border p-2 ${statusCardClass(peakCulpritReport.status)}`}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-[9px] font-black uppercase tracking-wider">
              <AlertTriangle size={12} className="shrink-0" />
              <span>Peak Culprit</span>
            </div>
            <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[8px] font-black uppercase">{peakCulpritReport.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[9px]">
            <MetricPill label="Limiter risk" value={`${peakCulpritReport.limiterLoadRisk}`} />
            <MetricPill label="Density" value={peakCulpritReport.densityShortfallLikely ? "before gain" : "ok"} />
            <MetricPill label="Top" value={peakTop?.trackName ?? "none"} />
            <MetricPill label="Action" value={peakTop?.action.replace(/_/g, " ") ?? "leave"} />
          </div>
          <p className="mt-1.5 rounded-lg bg-black/20 px-2 py-1.5 text-[9px] leading-snug">
            {peakCulpritReport.recommendations[0] ?? "No strong limiter culprit detected."}
          </p>
        </div>
      )}
    </div>
  );
}

function statusCardClass(status: "pass" | "warn" | "fail") {
  if (status === "fail") return "border-rose-300/25 bg-rose-400/10 text-rose-100";
  if (status === "warn") return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
}

function classifyReferenceDelta(delta: NonNullable<MixDoctorReport["referenceDelta"]>): {
  status: "pass" | "warn" | "fail";
  label: string;
  reason: string;
} {
  const peakRisk = delta.peakDeltaDb > 0.8;
  const muffleRisk = delta.presenceDeltaDb < -1.2 || delta.airDeltaDb < -1.8 || delta.bodyDeltaDb > 1.4;
  const harshRisk = delta.presenceDeltaDb > 2 || delta.airDeltaDb > 2.2;
  const nearReference =
    Math.abs(delta.loudnessDeltaDb) <= 0.7 &&
    Math.abs(delta.lowEndDeltaDb) <= 1.2 &&
    Math.abs(delta.bodyDeltaDb) <= 1.2 &&
    Math.abs(delta.presenceDeltaDb) <= 1.2 &&
    Math.abs(delta.airDeltaDb) <= 1.5 &&
    Math.abs(delta.correlationDelta) <= 0.08;

  if (peakRisk) {
    return { status: "fail", label: "Peak Risk", reason: "Peak is higher than the reference. Check ceiling or trim before export." };
  }
  if (muffleRisk) {
    return { status: "warn", label: "Muffle Risk", reason: "Presence or air is low, or body is too high. The mix may sound covered." };
  }
  if (harshRisk) {
    return { status: "warn", label: "Harsh Risk", reason: "Presence or air is above the reference. Watch for harshness or hiss." };
  }
  if (nearReference) {
    return { status: "pass", label: "Reference Match", reason: "Loudness, tone, and stereo image are close to the reference range." };
  }
  return { status: "warn", label: "Check Balance", reason: "No major failure, but the reference deltas still need listening confirmation." };
}

function ScorePill({ label, value }: { label: string; value: number }) {
  const color = value >= 75 ? "text-emerald-200" : value >= 55 ? "text-amber-200" : "text-rose-200";
  return (
    <div className="rounded-lg border border-white/[0.05] bg-black/25 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2 text-[9px]">
        <span className="text-daw-muted">{label}</span>
        <span className={`font-black ${color}`}>{value}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-daw-cyan" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-black/25 px-2 py-1.5">
      <span className="text-daw-muted">{label}</span>
      <span className="font-black text-daw-text">{value}</span>
    </div>
  );
}

function formatDelta(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;
}

function formatSigned(value: number, digits = 1) {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatFrequencyRange(lowFreq?: number, highFreq?: number) {
  if (lowFreq && highFreq) return `${Math.round(lowFreq)}-${Math.round(highFreq)}Hz`;
  if (lowFreq) return `${Math.round(lowFreq)}Hz+`;
  if (highFreq) return `-${Math.round(highFreq)}Hz`;
  return "wide band";
}




