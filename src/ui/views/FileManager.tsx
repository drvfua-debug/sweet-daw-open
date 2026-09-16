"use client";

import { Archive, FolderOpen, Download, Save, Trash2, Bug, ChevronDown, Settings2, Upload, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Project } from "@/daw/model/Project";
import { downloadBlob, downloadProjectBackup } from "@/daw/project/ProjectSerializer";
import { ImportSheet } from "@/ui/components/ImportSheet";
import { TempoLockPanel } from "@/ui/tools/TempoLockPanel";
import { coerceExportSampleRateSetting } from "@/daw/export/ExportConsistency";

type FileManagerProps = {
  project: Project;
  isImporting: boolean;
  importProgress: { index: number; total: number; fileName: string } | null;
  isExporting: boolean;
  selectedTrackId: string | null;
  debugLog: string[];
  engineInfo: Record<string, string | number | null>;
  onImport: (files: File[] | FileList | null) => void;
  onImportReference: (files: File[] | FileList | null) => void;
  onCancelImport: () => void;
  onRestoreProject: (files: FileList | null) => void;
  onSaveLocalProject: () => void;
  onLoadLocalProject: () => void;
  onOpenLocalProject: (projectId: string) => void;
  onExportPackage: () => void;
  onExport: () => void;
  onExportSelectedTrack: () => void;
  onExportAllClips: () => void;
  onExportProcessedStemPackage: () => void;
  onExportReferenceRepair?: () => void;
  onDeleteEmptyTracks: () => void;
  onExportSettingsChange: (patch: Partial<Pick<Project["master"], "exportBitDepth" | "exportDither" | "exportSampleRate" | "exportNormalizePeak">>) => void;
  onClear: () => void;
  onBpmChange: (bpm: number | null) => void;
  onSnapChange: (snapMode: Project["snapMode"]) => void;
  recentProjects: Array<{ projectId: string; title: string; savedAt: string; assetCount: number; estimatedBytes: number }>;
  storageHealth: Record<string, string | number | null>;
};

export function FileManager({
  project,
  isImporting,
  importProgress,
  isExporting,
  selectedTrackId,
  debugLog,
  engineInfo,
  onImport,
  onImportReference,
  onCancelImport,
  onRestoreProject,
  onSaveLocalProject,
  onLoadLocalProject,
  onOpenLocalProject,
  onExportPackage,
  onExport,
  onExportSelectedTrack,
  onExportAllClips,
  onExportProcessedStemPackage,
  onExportReferenceRepair,
  onDeleteEmptyTracks,
  onExportSettingsChange,
  onClear,
  onBpmChange,
  onSnapChange,
  recentProjects,
  storageHealth,
}: FileManagerProps) {
  const [showDebug, setShowDebug] = useState(false);
  const exportProfile = getExportProfile(project);
  const hasReferenceTrack = project.tracks.some((track) => track.role === "reference" || track.type === "reference");
  const hasWorkClips = project.clips.some((clip) => {
    const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
    return track && track.role !== "reference" && track.type !== "reference";
  });
  const lastExportReport = project.exportReports?.[0] ?? null;
  const lastExportAppliedCount = lastExportReport?.appliedOperations.filter((operation) => operation.exportStatus === "applied").length ?? 0;
  const lastExportNotWiredCount = lastExportReport?.appliedOperations.filter((operation) => operation.exportStatus === "not-wired").length ?? 0;
  const lastExportStability = lastExportReport?.stability;
  const lastExportReportJson = lastExportReport ? JSON.stringify(lastExportReport, null, 2) : "";
  const copyLastExportReport = () => {
    if (!lastExportReportJson || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(lastExportReportJson);
  };
  const downloadLastExportReport = () => {
    if (!lastExportReportJson) return;
    downloadBlob(new Blob([lastExportReportJson], { type: "application/json" }), "sweet-daw-export-report.json");
  };

  return (
    <section className="view-enter flex h-full w-full flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 pb-[calc(112px+env(safe-area-inset-bottom,0px))] sm:p-4 sm:pb-32" style={{ WebkitOverflowScrolling: "touch" }}>
      {/* Top Quick Actions */}
      <div className="sticky top-0 z-20 -mx-3 -mt-3 border-b border-daw-line bg-daw-bg/95 px-3 pb-3 pt-3 backdrop-blur-md sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={project.clips.length === 0 || isExporting}
            className="daw-btn daw-btn-accent gap-1.5 py-3 !rounded-xl text-xs font-extrabold shadow-glow-cyan"
          >
            <Download size={17} />
            {isExporting ? "Rendering..." : "WAV"}
          </button>
          <button
            type="button"
            onClick={onExportPackage}
            disabled={project.files.length === 0 || isExporting}
            className="daw-btn daw-btn-primary gap-1.5 py-3 !rounded-xl text-xs font-extrabold"
          >
            <Archive size={17} />
            SWTD
          </button>
          <button
            type="button"
            onClick={() => downloadProjectBackup(project)}
            disabled={project.files.length === 0 && project.tracks.length === 0}
            className="daw-btn daw-btn-ghost gap-1.5 py-3 !rounded-xl text-xs font-extrabold"
          >
            <Save size={17} />
            JSON
          </button>
        </div>
        <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-4">
          <label className="space-y-1.5">
            <span className="font-medium text-daw-muted">WAV Quality</span>
            <select
              value={project.master.exportBitDepth}
              onChange={(event) => onExportSettingsChange({ exportBitDepth: event.currentTarget.value as Project["master"]["exportBitDepth"] })}
              className="h-10 w-full rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs text-daw-text"
            >
              <option value="pcm16">16-bit PCM</option>
              <option value="pcm24">24-bit PCM</option>
              <option value="float32">32-bit Float</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="font-medium text-daw-muted">Sample Rate</span>
            <select
              value={String(coerceExportSampleRateSetting(project.master.exportSampleRate))}
              onChange={(event) => {
                const value = event.currentTarget.value;
                onExportSettingsChange({ exportSampleRate: coerceExportSampleRateSetting(value) });
              }}
              className="h-10 w-full rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs text-daw-text"
            >
              <option value="48000">48 kHz Stable</option>
              <option value="44100">44.1 kHz Explicit</option>
              
            </select>
          </label>
          <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-daw-line bg-white/[0.03] px-3">
            <span className="font-medium text-daw-muted">Normalize -1dB</span>
            <input
              type="checkbox"
              checked={project.master.exportNormalizePeak}
              onChange={(event) => onExportSettingsChange({ exportNormalizePeak: event.currentTarget.checked })}
            />
          </label>
          <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-daw-line bg-white/[0.03] px-3">
            <span className="font-medium text-daw-muted">16-bit Dither</span>
            <input
              type="checkbox"
              disabled={project.master.exportBitDepth !== "pcm16"}
              checked={project.master.exportDither}
              onChange={(event) => onExportSettingsChange({ exportDither: event.currentTarget.checked })}
            />
          </label>
        </div>
        <div className={`mt-2 rounded-xl border px-3 py-2 text-[10px] leading-4 ${exportProfile.className}`}>
          <div className="font-black uppercase tracking-wider">{exportProfile.label}</div>
          <div>{exportProfile.description}</div>
        </div>
        {lastExportReport ? (
          <>
            <div className="mt-2 rounded-xl border border-daw-cyan/20 bg-daw-cyan/[0.06] px-3 py-2 text-[10px] leading-4 text-daw-muted">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-black uppercase tracking-wider text-daw-cyan">Last Export Report</div>
                  <div>
                    Applied {lastExportAppliedCount} / Not wired {lastExportNotWiredCount} / Warnings {lastExportReport.warnings.length}
                  </div>
                  {lastExportStability ? (
                    <div>
                      Stability {lastExportStability.strategy} / {lastExportStability.risk} / {lastExportStability.estimatedPeakMemoryMb}MB &lt;= {lastExportStability.memoryBudgetMb}MB
                    </div>
                  ) : null}
                  <div>
                    LUFS {lastExportReport.loudnessApprox?.after ?? "--"} / Peak {lastExportReport.truePeakEstimate?.after ?? "--"} dBTP
                  </div>
                </div>
                {lastExportReport.pluginQuality ? (
                  <div className="min-w-[116px] rounded-lg border border-daw-line bg-white/[0.03] px-2 py-1 text-right font-semibold">
                    <div className="font-black text-daw-cyan">Plugin Quality</div>
                    <div>CPU {lastExportReport.pluginQuality.cpuScore}</div>
                    <div>Heavy {lastExportReport.pluginQuality.highCpuCount} / Master {lastExportReport.pluginQuality.masterRiskCount}</div>
                  </div>
                ) : null}
                <div className="grid shrink-0 gap-1">
                  <button type="button" onClick={copyLastExportReport} className="rounded-lg border border-daw-line px-2 py-1 font-bold text-daw-text">
                    Copy
                  </button>
                  <button type="button" onClick={downloadLastExportReport} className="rounded-lg border border-daw-line px-2 py-1 font-bold text-daw-text">
                    JSON
                  </button>
                </div>
              </div>
            </div>
            <div className="hidden">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-black uppercase tracking-wider text-daw-cyan">Last Export Report</div>
                <div>
                  Applied {lastExportAppliedCount} / Not wired {lastExportNotWiredCount} / Warnings {lastExportReport.warnings.length}
                </div>
                {lastExportStability ? (
                  <div>
                    Stability {lastExportStability.strategy} / {lastExportStability.risk} · {lastExportStability.estimatedPeakMemoryMb}MB → {lastExportStability.memoryBudgetMb}MB
                  </div>
                ) : null}
                <div>
                  LUFS {lastExportReport.loudnessApprox?.after ?? "--"} · Peak {lastExportReport.truePeakEstimate?.after ?? "--"} dBTP
                </div>
              </div>
              {lastExportReport.pluginQuality ? (
                <div className="min-w-[116px] rounded-lg border border-daw-line bg-white/[0.03] px-2 py-1 text-right font-semibold">
                  <div className="font-black text-daw-cyan">Plugin Quality</div>
                  <div>CPU {lastExportReport.pluginQuality.cpuScore}</div>
                  <div>Heavy {lastExportReport.pluginQuality.highCpuCount} / Master {lastExportReport.pluginQuality.masterRiskCount}</div>
                </div>
              ) : null}
              <div className="grid shrink-0 gap-1">
                <button type="button" onClick={copyLastExportReport} className="rounded-lg border border-daw-line px-2 py-1 font-bold text-daw-text">
                  Copy
                </button>
                <button type="button" onClick={downloadLastExportReport} className="rounded-lg border border-daw-line px-2 py-1 font-bold text-daw-text">
                  JSON
                </button>
              </div>
            </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Workflow Guide Card */}
      <div className="glass-panel-sm p-3.5 border border-daw-cyan/20 bg-daw-cyan/[0.04] rounded-2xl flex gap-2.5 items-start text-xs leading-relaxed animate-fade-in">
        <Sparkles className="h-5 w-5 shrink-0 text-daw-cyan mt-0.5 animate-pulse" />
        <div>
          <h3 className="font-extrabold text-daw-cyan tracking-wider uppercase text-[10px]">Quick DAW Guide</h3>
          <p className="mt-1 text-[11px] text-daw-muted leading-relaxed">
            1. <strong className="text-daw-text">Import Audio</strong> loads stems, loops, one-shots, and ZIP projects.<br />
            2. <strong className="text-daw-text">Arrange / Mix</strong> adjusts order, role, level, pan, and plugins.<br />
            3. <strong className="text-daw-cyan">AIMIX / Spatial / Mastering</strong> applies only the needed fixes before WAV or SWTD export.
          </p>
        </div>
      </div>
      {/* Import */}
      <div className="glass-panel-sm p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FolderOpen size={16} className="text-daw-cyan" />
          Import Audio
        </div>
        <ImportSheet
          isImporting={isImporting}
          fileCount={project.files.length}
          onImport={onImport}
        />
        {isImporting && importProgress && (
          <div className="mt-3 rounded-xl border border-daw-cyan/25 bg-daw-cyan/10 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-[11px]">
                <div className="font-extrabold text-daw-cyan">
                  Importing {Math.min(importProgress.index, importProgress.total)}/{importProgress.total}
                </div>
                <div className="mt-0.5 truncate text-daw-muted">{importProgress.fileName}</div>
              </div>
              <button
                type="button"
                onClick={onCancelImport}
                className="min-h-10 shrink-0 rounded-lg border border-rose-300/25 bg-rose-400/10 px-3 text-[11px] font-extrabold text-rose-100"
              >
                Cancel
              </button>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-daw-cyan"
                style={{
                  width: `${importProgress.total > 0 ? Math.max(5, (importProgress.index / importProgress.total) * 100) : 5}%`,
                }}
              />
            </div>
          </div>
        )}
        <label className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-daw-amber/25 bg-daw-amber/10 px-3 text-xs font-extrabold text-daw-amber">
          <Upload size={15} />
          Import Reference Mix
          <input
            type="file"
            accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif,.flac,.zip,application/zip"
            multiple
            disabled={isImporting}
            className="sr-only"
            onChange={(event) => {
              onImportReference(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <p className="mt-2 text-[10px] leading-4 text-daw-muted">
          このボタンで読み込んだ音源は、ファイル名に関係なくReferenceとして扱います。AIMIX解析・比較の目標に使い、通常再生、通常の自動Plugin/EQ変更、最終WAV書き出しからは除外します。
        </p>
      </div>

      {/* Local Projects */}
      <div className="glass-panel-sm p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Local Projects</div>
          <button
            type="button"
            onClick={onSaveLocalProject}
            disabled={project.files.length === 0 && project.tracks.length === 0}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-daw-cyan/20 bg-daw-cyan/10 px-2.5 text-[10px] font-bold text-daw-cyan disabled:opacity-35"
          >
            <Save size={14} />
            Save Local
          </button>
        </div>
        {recentProjects.length === 0 ? (
          <p className="text-[11px] text-daw-muted">No saved local projects yet.</p>
        ) : (
          <div className="space-y-2">
            {recentProjects.slice(0, 5).map((item) => (
              <button
                key={item.projectId}
                type="button"
                onClick={() => onOpenLocalProject(item.projectId)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-daw-line bg-white/[0.03] px-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold">{item.title}</span>
                  <span className="mt-0.5 block text-[10px] text-daw-muted">
                    {item.assetCount} asset(s) - {(item.estimatedBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-daw-muted">
                  {new Date(item.savedAt).toLocaleTimeString()}
                </span>
              </button>
            ))}
          </div>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          {Object.entries(storageHealth).map(([key, value]) => (
            <div key={key} className="rounded-lg bg-white/[0.03] px-2.5 py-2">
              <dt className="text-daw-muted">{key}</dt>
              <dd className="mt-0.5 font-bold text-daw-text">{String(value ?? "--")}</dd>
            </div>
          ))}
        </dl>
        {Number(storageHealth.missingAssets ?? 0) > 0 && (
          <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
            Missing audio assets: {storageHealth.missingAssets}. Re-import the original files or restore from a complete
            .swtd package before exporting.
          </div>
        )}
        {Number(storageHealth.recoverableAssets ?? 0) > 0 && (
          <div className="mt-3 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-[11px] leading-relaxed text-cyan-100">
            Recoverable audio assets: {storageHealth.recoverableAssets}. These files are available in local storage and
            can be used for package export even if they are not currently in memory.
          </div>
        )}
      </div>

      {/* Imported Assets */}
      {project.files.length > 0 && (
        <div className="glass-panel-sm p-4">
          <div className="mb-3 text-sm font-semibold">
            Imported Stems
          </div>
          <div className="space-y-2">
            {project.files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold">{file.name}</div>
                  <div className="mt-0.5 text-[10px] text-daw-muted">
                    {file.durationSec.toFixed(2)}s &middot; {file.sampleRate}Hz &middot; {file.channelCount}ch
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {project.files.length > 0 && <TempoLockPanel />}

      {/* Project Settings */}
      <div className="glass-panel-sm p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Settings2 size={16} className="text-daw-muted" />
          Project Settings
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-daw-muted">BPM</span>
            <input
              type="number"
              min={20}
              max={300}
              value={project.bpm ?? ""}
              onChange={(e) =>
                onBpmChange(e.target.value ? Number(e.target.value) : null)
              }
              className="h-10 w-full rounded-xl border border-daw-line bg-white/[0.03] px-3 text-sm text-daw-text outline-none focus:border-daw-cyan"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium text-daw-muted">Snap</span>
            <select
              value={project.snapMode}
              onChange={(e) =>
                onSnapChange(e.target.value as Project["snapMode"])
              }
              className="h-10 w-full rounded-xl border border-daw-line bg-white/[0.03] px-3 text-sm text-daw-text outline-none focus:border-daw-cyan"
            >
              <option value="off">Off</option>
              <option value="beat">Beat</option>
              <option value="bar">Bar</option>
            </select>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onExportSelectedTrack}
            disabled={!selectedTrackId || isExporting}
            className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-daw-cyan/20 bg-daw-cyan/10 px-3 text-xs font-bold text-daw-cyan disabled:opacity-35"
          >
            <Download size={15} />
            Selected Track WAV
          </button>
          <button
            type="button"
            onClick={onExportAllClips}
            disabled={project.clips.length === 0 || isExporting}
            className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-daw-cyan/20 bg-daw-cyan/10 px-3 text-xs font-bold text-daw-cyan disabled:opacity-35"
          >
            <Download size={15} />
            All Clips WAVs
          </button>
          <button
            type="button"
            onClick={onDeleteEmptyTracks}
            disabled={project.tracks.length === 0}
            className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs font-bold text-daw-muted disabled:opacity-35"
          >
            <Trash2 size={15} />
            Delete Empty Tracks
          </button>
        </div>
      </div>

      {/* Export */}
      <div className="glass-panel-sm p-4">
        <div className="mb-3 text-sm font-semibold">Export</div>
        <div className="mb-3 grid gap-2 text-[11px] sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="font-medium text-daw-muted">WAV Quality</span>
            <select
              value={project.master.exportBitDepth}
              onChange={(event) => onExportSettingsChange({ exportBitDepth: event.currentTarget.value as Project["master"]["exportBitDepth"] })}
              className="h-10 w-full rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs text-daw-text"
            >
              <option value="pcm16">16-bit PCM</option>
              <option value="pcm24">24-bit PCM</option>
              <option value="float32">32-bit Float</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="font-medium text-daw-muted">Sample Rate</span>
            <select
              value={String(coerceExportSampleRateSetting(project.master.exportSampleRate))}
              onChange={(event) => {
                const value = event.currentTarget.value;
                onExportSettingsChange({ exportSampleRate: coerceExportSampleRateSetting(value) });
              }}
              className="h-10 w-full rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs text-daw-text"
            >
              <option value="48000">48 kHz Stable</option>
              <option value="44100">44.1 kHz Explicit</option>
              
            </select>
          </label>
          <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-daw-line bg-white/[0.03] px-3">
            <span className="font-medium text-daw-muted">Normalize -1dB</span>
            <input
              type="checkbox"
              checked={project.master.exportNormalizePeak}
              onChange={(event) => onExportSettingsChange({ exportNormalizePeak: event.currentTarget.checked })}
            />
          </label>
          <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-daw-line bg-white/[0.03] px-3">
            <span className="font-medium text-daw-muted">16-bit Dither</span>
            <input
              type="checkbox"
              disabled={project.master.exportBitDepth !== "pcm16"}
              checked={project.master.exportDither}
              onChange={(event) => onExportSettingsChange({ exportDither: event.currentTarget.checked })}
            />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={project.clips.length === 0 || isExporting}
            className="daw-btn daw-btn-accent gap-1.5 px-2"
          >
            <Download size={16} />
            {isExporting ? "Rendering..." : "WAV"}
          </button>
          <button
            type="button"
            onClick={onExportPackage}
            disabled={project.files.length === 0 || isExporting}
            className="daw-btn daw-btn-primary gap-1.5 px-2"
          >
            <Archive size={16} />
            SWTD
          </button>
          <button
            type="button"
            onClick={() => downloadProjectBackup(project)}
            disabled={project.files.length === 0}
            className="daw-btn daw-btn-ghost gap-1.5 px-2"
          >
            <Save size={16} />
            JSON
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-daw-muted">
          .swtd includes project data and audio assets. JSON is metadata only.
        </p>
        <div className="mt-2 rounded-xl border border-daw-amber/20 bg-daw-amber/10 px-3 py-2 text-[10px] leading-4 text-daw-amber">
          Safe export guide: keep the final peak around -1.0 dB. Clean Stem Export is best with 24-bit PCM and Normalize off; Loud Demo may sound flatter if the limiter is pushed too hard.
        </div>
        <button
          type="button"
          onClick={onExportProcessedStemPackage}
          disabled={!hasWorkClips || isExporting}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-extrabold text-emerald-100 disabled:opacity-35"
        >
          <Archive size={16} />
          Export Processed Stems ZIP
        </button>
        <p className="mt-1 text-[10px] leading-4 text-daw-muted">
          Includes master WAV, track-processed stems, separate ambience bus, manifest, and project JSON. Reference tracks and master processing are excluded from the stem files.
        </p>
        <div className={`mt-2 rounded-xl border px-3 py-2 text-[10px] leading-4 ${exportProfile.className}`}>
          <div className="font-black uppercase tracking-wider">{exportProfile.label}</div>
          <div>{exportProfile.description}</div>
        </div>
        <div className="hidden">
          Reference Compare Pack is available inside Debug Info for development checks.
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs font-bold text-daw-muted">
            <Upload size={15} />
            Import .swtd Project
            <input
              type="file"
              accept=".swtd,.json,application/json"
              className="sr-only"
              onChange={(event) => {
                onRestoreProject(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={onLoadLocalProject}
            className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-daw-line bg-white/[0.03] px-3 text-xs font-bold text-daw-muted"
          >
            <FolderOpen size={15} />
            Local
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-4 text-daw-muted text-center">
          .swtd includes project data and audio assets. JSON is metadata only.
        </p>
      </div>

      {/* Reset */}
      <button
        type="button"
        onClick={onClear}
        className="daw-btn daw-btn-ghost gap-2 text-daw-red"
      >
        <Trash2 size={16} />
        Reset Project
      </button>

      {/* Debug panel (collapsible) */}
      <div className="glass-panel-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setShowDebug(!showDebug)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-daw-muted"
        >
          <div className="flex items-center gap-2">
            <Bug size={14} />
            Debug Info
          </div>
          <ChevronDown
            size={16}
            className={`transition-transform ${showDebug ? "rotate-180" : ""}`}
          />
        </button>
        {showDebug && (
          <div className="animate-slide-up border-t border-daw-line p-4">
            <dl className="mb-3 grid grid-cols-2 gap-2 text-xs">
              {Object.entries(engineInfo).map(([key, value]) => (
                <div
                  key={key}
                  className="flex justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2"
                >
                  <dt className="text-daw-muted">{key}</dt>
                  <dd className="text-right text-daw-text">{String(value ?? "--")}</dd>
                </div>
              ))}
            </dl>
            {onExportReferenceRepair ? (
              <div className="mb-3 rounded-xl border border-daw-amber/25 bg-daw-amber/10 p-3">
                <button
                  type="button"
                  onClick={onExportReferenceRepair}
                  disabled={!hasReferenceTrack || !hasWorkClips || isExporting}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-daw-amber/25 bg-daw-amber/10 px-3 text-xs font-bold text-daw-amber disabled:opacity-35"
                >
                  <Sparkles size={15} />
                  Reference Compare Pack
                </button>
                <p className="mt-2 text-[10px] leading-4 text-daw-amber">
                  開発/検証用です。Reference Mixとstem sumを比較し、stem_sum / residual / candidate_stem_sum / 解析レポートを書き出します。
                </p>
              </div>
            ) : null}
            <div className="daw-scrollbar max-h-40 overflow-y-auto rounded-lg bg-white/[0.02] p-3 text-[11px] leading-5 text-daw-muted">
              {debugLog.length === 0 ? (
                <p>No events yet.</p>
              ) : (
                debugLog.map((line, i) => <p key={`${line}-${i}`}>{line}</p>)
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function getExportProfile(project: Project) {
  const masteringSafe =
    project.master.exportBitDepth !== "pcm16" &&
    !project.master.exportNormalizePeak &&
    !project.master.limiterEnabled;
  const loudPreview =
    project.master.exportNormalizePeak ||
    project.master.limiterEnabled ||
    project.master.exportBitDepth === "pcm16";

  if (masteringSafe) {
    return {
      label: "Mix For Mastering",
      description: "Limiter and normalize are off. Best for later mastering or external mix checks.",
      className: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
    };
  }

  if (loudPreview) {
    return {
      label: "Preview Loud / Share",
      description: "Limiter, normalize, or 16-bit export is active. Good for checking loudness, but dynamics can flatten.",
      className: "border-daw-amber/20 bg-daw-amber/10 text-daw-amber",
    };
  }

  return {
    label: "Custom Export",
    description: "Manual export settings are active. Check peak safety before sharing or mastering.",
    className: "border-daw-cyan/20 bg-daw-cyan/10 text-daw-cyan",
  };
}
