"use client";

import { useMemo, useState } from "react";
import { buildPeakSummary } from "@/audio/analysis/PeakBuilder";
import { useDawStore } from "@/daw/store/dawStore";
import type { AudioFileRef, Project, StemRole } from "@/daw/model/Project";
import { audioBufferRegistry, type AudioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import type { TempoLockAnalysis, TempoLockMode } from "@/audio/tempo/TempoLock";

type TempoLockReport = {
  renderedCount: number;
  skippedCount: number;
  referenceName: string;
  targetBpm: number;
  estimatedBpm: number;
  confidence: number;
  maxWarpPercent: number;
  outputDurationSec: number;
  warning?: string;
};

type TempoLockRenderTarget = {
  track: Project["tracks"][number];
  clip: Project["clips"][number];
  file: AudioFileRef;
  role: StemRole;
  buffer: AudioBuffer;
  referenceScore: number;
};

type TempoLockReferenceSource = {
  file: AudioFileRef;
  buffer: AudioBuffer;
  sourceKind: "reference" | "stem";
  referenceScore: number;
};

const GENERATED_BPM_LOCK_RE = /_bpm-lock_/i;

export function TempoLockPanel() {
  const project = useDawStore((state) => state.project);
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [report, setReport] = useState<TempoLockReport | null>(null);
  const [mode, setMode] = useState<TempoLockMode>("tight");
  const [isExpanded, setIsExpanded] = useState(false);
  const eligibleTimelineCount = useMemo(() => countEligibleTimelineStems(project, audioBufferRegistry), [project]);
  const targetBpm = typeof project.bpm === "number" && Number.isFinite(project.bpm) ? project.bpm : null;
  const canRun = Boolean(targetBpm && eligibleTimelineCount > 0 && !isRunning);
  const showDetails = isExpanded || isRunning || Boolean(statusText) || Boolean(report);

  const handleRun = async () => {
    const current = useDawStore.getState();
    const bpm = current.project.bpm;
    if (!bpm || !Number.isFinite(bpm)) {
      setStatusText("Project BPMを先に設定してください。");
      current.addDebug("BPM Lock skipped: Project BPM is not set.");
      return;
    }

    setIsRunning(true);
    setReport(null);
    setStatusText("Preparing local tempo lock...");
    current.addDebug("BPM Lock: starting browser-local linked stem render.");

    try {
      const [registryModule, tempoModule, wavModule, storageModule] = await Promise.all([
        import("@/audio/engine/AudioBufferRegistry"),
        import("@/audio/tempo/TempoLock"),
        import("@/audio/export/WavEncoder"),
        import("@/storage/ProjectStorage"),
      ]);

      const targets = collectTempoLockTargets(current.project, registryModule.audioBufferRegistry);
      if (targets.length === 0) {
        throw new Error("No full-length unmuted stems are ready for BPM Lock. Use imported Suno-style stems before arranging/trimming.");
      }

      const referenceSources = collectTempoLockReferenceSources(current.project, registryModule.audioBufferRegistry);
      const reference = chooseTempoLockReference(targets, referenceSources);
      setStatusText(`Analyzing tempo map from ${reference.file.name}${reference.sourceKind === "reference" ? " (Reference)" : ""}...`);
      await yieldToBrowser();

      const tempoMap = tempoModule.createTempoLockMap(reference.buffer, {
        targetBpm: bpm,
        downbeatOffsetSec: current.project.downbeatOffsetSec,
        mode,
        maxAnalysisSec: Math.min(300, Math.max(90, reference.buffer.duration)),
      });
      const tempoSafety = evaluateTempoMapSafety(tempoMap.analysis, reference.sourceKind);
      if (tempoSafety.blocked) {
        current.addDebug(`BPM Lock blocked: ${tempoSafety.message}`);
        throw new Error(tempoSafety.message);
      }
      const reportWarning = [tempoMap.analysis.warning, tempoSafety.warning].filter(Boolean).join(" ");

      current.addDebug(
        `BPM Lock map: ref=${reference.file.name} (${reference.sourceKind}), target=${bpm.toFixed(2)}, estimated=${tempoMap.analysis.estimatedBpm.toFixed(2)}, confidence=${Math.round(tempoMap.analysis.confidence * 100)}%, maxWarp=${tempoMap.analysis.maxWarpPercent.toFixed(2)}%`,
      );

      const rendered: Array<{ sourceTrackId: string; fileRef: AudioFileRef; peaks: ReturnType<typeof buildPeakSummary> }> = [];

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        setStatusText(`Rendering ${index + 1}/${targets.length}: ${target.file.name}`);
        await yieldToBrowser();

        const lockedBuffer = tempoModule.renderTempoLockedBuffer(target.buffer, tempoMap, {
          grainMs: target.role === "drums" || target.role === "loop" ? 30 : 42,
          hopRatio: 0.5,
        });
        const fileName = buildTempoLockedFileName(target.file.name, bpm);
        const wavBlob = wavModule.encodeWavFromAudioBuffer(lockedBuffer, { normalizePeak: false, bitDepth: "pcm24" });
        const fileObject = new File([wavBlob], fileName, { type: "audio/wav" });
        const decoded = registryModule.audioBufferRegistry.register(fileObject, lockedBuffer);
        const fileRef: AudioFileRef = {
          ...decoded.fileRef,
          role: target.role,
          originalName: fileName,
          byteLength: fileObject.size,
        };

        await storageModule.saveAudioAssetToIndexedDb(fileRef, fileObject);
        rendered.push({
          sourceTrackId: target.track.id,
          fileRef,
          peaks: buildPeakSummary(lockedBuffer),
        });
      }

      const latestStore = useDawStore.getState();
      rendered.forEach((item) => {
        latestStore.addRenderedStem(item.sourceTrackId, item.fileRef, item.peaks, true);
      });

      const skippedCount = current.project.tracks.length - targets.length;
      const nextReport: TempoLockReport = {
        renderedCount: rendered.length,
        skippedCount: Math.max(0, skippedCount),
        referenceName: reference.file.name,
        targetBpm: bpm,
        estimatedBpm: tempoMap.analysis.estimatedBpm,
        confidence: tempoMap.analysis.confidence,
        maxWarpPercent: tempoMap.analysis.maxWarpPercent,
        outputDurationSec: tempoMap.analysis.outputDurationSec,
        warning: reportWarning || undefined,
      };
      setReport(nextReport);
      setStatusText(`BPM Lock complete: ${rendered.length} linked stem(s) rendered.`);
      latestStore.addDebug(`BPM Lock complete: rendered ${rendered.length} linked stem(s); originals muted.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusText(`BPM Lock failed: ${message}`);
      useDawStore.getState().addDebug(`BPM Lock failed: ${message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="glass-panel-sm border border-daw-line bg-white/[0.025] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-extrabold tracking-wider text-daw-muted">Advanced BPM Lock</div>
            <span className="rounded-full border border-daw-amber/25 bg-daw-amber/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-daw-amber">
              Optional
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-daw-muted">
            一定BPMのSuno STEMをグリッドへ軽く寄せる補助機能です。曲中でテンポが変わる曲、Reference自体が大きく揺れる曲では使わないでください。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-daw-text"
          aria-expanded={showDetails}
        >
          {showDetails ? "Hide" : "Show"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
        <Metric label="Target" value={targetBpm ? `${formatBpm(targetBpm)} BPM` : "--"} />
        <Metric label="Ready" value={`${eligibleTimelineCount} stem(s)`} />
        <Metric label="Mode" value={modeLabel(mode)} />
      </div>

      {showDetails && (
        <>
          <div className="mt-3 rounded-xl border border-daw-amber/25 bg-daw-amber/10 px-3 py-2 text-[10px] leading-4 text-daw-amber">
            Use only when the song is basically one BPM. If the reference or stems intentionally speed up, slow down, or change BPM by section, do not run whole-song BPM Lock.
          </div>

          <label className="mt-3 block space-y-1.5 text-[10px]">
            <span className="font-bold uppercase tracking-wider text-daw-muted">Mode</span>
            <select
              value={mode}
              disabled={isRunning}
              onChange={(event) => setMode(event.currentTarget.value as TempoLockMode)}
              className="h-10 w-full rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs font-bold text-daw-text outline-none focus:border-daw-cyan disabled:opacity-50"
            >
              <option value="gentle">Gentle - safest for vocal/reverb-heavy stems</option>
              <option value="tight">Tight - recommended for stable BPM stems</option>
              <option value="hard">Hard - strongest grid lock, use carefully</option>
            </select>
          </label>

          <button
            type="button"
            onClick={handleRun}
            disabled={!canRun}
            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl border border-daw-cyan/35 bg-daw-cyan/15 px-3 text-xs font-extrabold text-daw-cyan shadow-[0_0_18px_rgba(77,217,255,0.12)] disabled:cursor-not-allowed disabled:border-daw-line disabled:bg-white/[0.03] disabled:text-daw-muted disabled:shadow-none"
          >
            {isRunning ? "Locking BPM..." : targetBpm ? `Render BPM-Locked Stems @ ${formatBpm(targetBpm)}` : "Set Project BPM First"}
          </button>

          <p className="mt-2 text-[10px] leading-4 text-daw-muted">
            Referenceがある場合はTempo Map作成に優先使用しますが、Reference音声はレンダー対象や書き出しへ混ぜません。Track/Clipプラグインは音声へ焼き込まず、補正後トラックへ設定を引き継いで後段適用します。
          </p>

          {statusText && (
            <div className="mt-3 rounded-xl border border-daw-line bg-black/20 px-3 py-2 text-[10px] leading-4 text-daw-text">
              {statusText}
            </div>
          )}

          {report && (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
              <Metric label="Reference" value={report.referenceName} />
              <Metric label="Target" value={`${formatBpm(report.targetBpm)} BPM`} />
              <Metric label="Estimated" value={`${formatBpm(report.estimatedBpm)} BPM`} />
              <Metric label="Confidence" value={`${Math.round(report.confidence * 100)}%`} />
              <Metric label="Max Warp" value={`${report.maxWarpPercent.toFixed(2)}%`} />
              <Metric label="Output" value={`${report.outputDurationSec.toFixed(2)}s`} />
              <Metric label="Rendered" value={`${report.renderedCount} stem(s)`} />
              <Metric label="Skipped" value={`${report.skippedCount} track(s)`} />
              {report.warning && (
                <div className="col-span-2 rounded-xl border border-daw-amber/25 bg-daw-amber/10 px-3 py-2 text-daw-amber">
                  {report.warning}
                </div>
              )}
            </dl>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.05] bg-white/[0.03] px-2.5 py-2">
      <dt className="text-daw-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-black text-daw-text">{value}</dd>
    </div>
  );
}

function collectTempoLockTargets(project: Project, registry: AudioBufferRegistry): TempoLockRenderTarget[] {
  const filesById = new Map(project.files.map((file) => [file.id, file]));
  const clipsByTrackId = new Map<string, Project["clips"]>();

  project.clips.forEach((clip) => {
    const list = clipsByTrackId.get(clip.trackId) ?? [];
    list.push(clip);
    clipsByTrackId.set(clip.trackId, list);
  });

  const targets: TempoLockRenderTarget[] = [];
  project.tracks.forEach((track) => {
    if (track.mute || track.role === "reference") return;
    const clips = clipsByTrackId.get(track.id) ?? [];
    if (clips.length !== 1) return;

    const clip = clips[0];
    const file = filesById.get(clip.fileId);
    if (!file || GENERATED_BPM_LOCK_RE.test(file.name)) return;
    if (!isFullSourceClip(clip, file)) return;

    const buffer = registry.getBuffer(file.id);
    if (!buffer || buffer.duration < 4) return;

    const role = clip.role ?? track.role ?? file.role;
    targets.push({
      track,
      clip,
      file,
      role,
      buffer,
      referenceScore: scoreReferenceRole(role, buffer.duration),
    });
  });

  return targets;
}

function collectTempoLockReferenceSources(project: Project, registry: AudioBufferRegistry): TempoLockReferenceSource[] {
  const filesById = new Map(project.files.map((file) => [file.id, file]));
  const tracksById = new Map(project.tracks.map((track) => [track.id, track]));
  const sources: TempoLockReferenceSource[] = [];

  project.clips.forEach((clip) => {
    const track = tracksById.get(clip.trackId);
    const file = filesById.get(clip.fileId);
    if (!track || !file) return;
    if (track.role !== "reference" && clip.role !== "reference" && file.role !== "reference") return;
    if (GENERATED_BPM_LOCK_RE.test(file.name)) return;
    if (!isFullSourceClip(clip, file)) return;

    const buffer = registry.getBuffer(file.id);
    if (!buffer || buffer.duration < 8) return;

    sources.push({
      file,
      buffer,
      sourceKind: "reference",
      referenceScore: 1_000 + Math.min(60, buffer.duration / 3),
    });
  });

  return sources.sort((a, b) => b.referenceScore - a.referenceScore);
}

function countEligibleTimelineStems(project: Project, registry: AudioBufferRegistry) {
  const filesById = new Map(project.files.map((file) => [file.id, file]));
  return project.tracks.filter((track) => {
    if (track.mute || track.role === "reference") return false;
    const clips = project.clips.filter((clip) => clip.trackId === track.id);
    if (clips.length !== 1) return false;
    const clip = clips[0];
    const file = filesById.get(clip.fileId);
    return Boolean(file && !GENERATED_BPM_LOCK_RE.test(file.name) && isFullSourceClip(clip, file) && registry.getBuffer(file.id));
  }).length;
}

function isFullSourceClip(clip: Project["clips"][number], file: AudioFileRef) {
  const durationTolerance = Math.max(0.2, file.durationSec * 0.015);
  return (
    clip.timelineStartSec <= 0.05 &&
    clip.sourceStartSec <= 0.05 &&
    Math.abs(clip.durationSec - file.durationSec) <= durationTolerance
  );
}

function chooseTempoLockReference(targets: TempoLockRenderTarget[], referenceSources: TempoLockReferenceSource[]): TempoLockReferenceSource {
  const explicitReference = referenceSources[0];
  if (explicitReference) return explicitReference;

  const reference = [...targets]
    .sort((a, b) => b.referenceScore - a.referenceScore)
    .map((target): TempoLockReferenceSource => ({
      file: target.file,
      buffer: target.buffer,
      sourceKind: "stem",
      referenceScore: target.referenceScore,
    }))[0];
  if (!reference) {
    throw new Error("No valid tempo reference was found.");
  }
  return reference;
}

function scoreReferenceRole(role: StemRole, durationSec: number) {
  const roleScore: Record<StemRole, number> = {
    drums: 120,
    loop: 108,
    music: 96,
    bass: 72,
    guitar: 42,
    synth: 38,
    keys: 34,
    other: 24,
    fx: 12,
    backingVocal: 8,
    vocal: 4,
    reference: 0,
  };
  return (roleScore[role] ?? 0) + Math.min(36, durationSec / 4);
}

function buildTempoLockedFileName(sourceName: string, bpm: number) {
  const withoutExt = sourceName.replace(/\.[^.]+$/, "");
  const bpmLabel = formatBpm(bpm).replace(".", "_");
  return `${withoutExt}_bpm-lock_${bpmLabel}.wav`;
}

function formatBpm(bpm: number) {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function modeLabel(mode: TempoLockMode) {
  if (mode === "gentle") return "Gentle";
  if (mode === "hard") return "Hard";
  return "Tight";
}

function evaluateTempoMapSafety(
  analysis: TempoLockAnalysis,
  sourceKind: TempoLockReferenceSource["sourceKind"],
): { blocked: boolean; message: string; warning?: string } {
  const lowConfidence = analysis.confidence < 0.38;
  const highMaxWarp = analysis.maxWarpPercent >= 7.2;
  const highMedianWarp = analysis.medianWarpPercent >= 2.8;

  if (sourceKind === "reference" && (lowConfidence || (highMaxWarp && highMedianWarp))) {
    return {
      blocked: true,
      message:
        `Referenceのテンポ揺れが大きいためBPM Lockを停止しました。` +
        ` confidence=${Math.round(analysis.confidence * 100)}%, maxWarp=${analysis.maxWarpPercent.toFixed(2)}%, medianWarp=${analysis.medianWarpPercent.toFixed(2)}%。` +
        ` 意図的なテンポ変化の可能性があるため、曲全体へ一括適用せず、手動BPMまたは区間分割で確認してください。`,
    };
  }

  if (lowConfidence) {
    return {
      blocked: false,
      message: "",
      warning:
        `Tempo Map confidence is low (${Math.round(analysis.confidence * 100)}%). Check the BPM-locked stems before using them.`,
    };
  }

  if (highMaxWarp || highMedianWarp) {
    return {
      blocked: false,
      message: "",
      warning:
        `Tempo drift is noticeable (max ${analysis.maxWarpPercent.toFixed(2)}%, median ${analysis.medianWarpPercent.toFixed(2)}%). This is suitable for small wobble correction, but not for intentional tempo changes.`,
    };
  }

  return { blocked: false, message: "" };
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    window.setTimeout(resolve, 0);
  });
}
