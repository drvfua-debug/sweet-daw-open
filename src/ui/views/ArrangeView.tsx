"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Download, Layers, Lock, Plus, Power, Scissors, SlidersHorizontal, Trash2, Unlock, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { getProjectDurationSec } from "@/audio/engine/TrackGraph";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { STEM_ROLES, createId, type Clip, type ClipPanAutomation, type PanAnchorPoint, type Project, type StemRole } from "@/daw/model/Project";
import type { BuiltinPluginId, PluginInstance } from "@/daw/model/Plugin";
import { getPluginDescriptor } from "@/audio/plugins/pluginRegistry";
import { xToTime } from "@/ui/timeline/timelineMath";
import { WaveformCanvas } from "@/ui/timeline/WaveformCanvas";

type ArrangeViewProps = {
  project: Project;
  peaksByFileId: Record<string, PeakSummary>;
  positionSec: number;
  onSeek: (positionSec: number) => void;
  onAddSectionMarker: (label: string, timeSec: number) => void;
  onDeleteSectionMarker: (markerId: string) => void;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  onSelectTrack: (trackId: string | null) => void;
  onMoveTrack: (trackId: string, direction: "up" | "down") => void;
  onDeleteTrack: (trackId: string) => void;
  onSelectClip: (clipId: string | null) => void;
  onMoveClip: (clipId: string, timelineStartSec: number, options?: { snap?: boolean }) => void;
  onTrimClip: (clipId: string, edge: "start" | "end", timeSec: number, options?: { snap?: boolean }) => void;
  onSplitClip: (clipId: string, splitAtSec: number) => void;
  onDuplicateClip: (clipId: string) => void;
  onDuplicateTrackBelow: (trackId: string, selectedClipOnly?: boolean) => void;
  onDeleteClip: (clipId: string) => void;
  onCreateArtifactClip: (clipId: string) => void;
  onMuteArtifactClip: (clipId: string, muted: boolean) => void;
  onReduceClipGain: (clipId: string, amountDb?: number) => void;
  onCreateSmartGapFill: (clipId: string) => void;
  onApplyAutoClipPanMix: (clipIds?: string[]) => void;
  onUpdateClipPanAutomation: (clipId: string, automation: ClipPanAutomation | undefined) => void;
  onResetClipPanAutomation: (clipId: string) => void;
  onExportSelectedClip: () => void;
  onSetAllClipsMovementLocked: (locked: boolean) => void;
  onFreezeClip: (clipId: string) => void;
  onUnfreezeClip: (clipId: string) => void;
  onClipRoleChange: (clipId: string, role: StemRole) => void;
  onAddClipIntentTag: (clipId: string, tag: string) => void;
  onRemoveClipIntentTag: (clipId: string, tag: string) => void;
  onAddClipPluginChain: (clipId: string, pluginIds: BuiltinPluginId[], label: string) => void;
  onImportToTrack: (trackId: string, files: File[] | FileList | null, timelineStartSec?: number) => void;
  onAddClipPlugin: (clipId: string, pluginId: BuiltinPluginId) => void;
  onOpenClipPluginBrowser: (clipId: string) => void;
  onOpenClipPluginEditor: (clipId: string, pluginInstanceId: string) => void;
  onToggleClipPlugin: (clipId: string, pluginInstanceId: string) => void;
  onRemoveClipPlugin: (clipId: string, pluginInstanceId: string) => void;
  onImport: (files: File[] | FileList | null) => void;
};

type ClipDragState = {
  clipId: string;
  mode: "move" | "trim-start" | "trim-end";
  startClientX: number;
  originStartSec: number;
  originDurationSec: number;
};

const SECTION_LABELS = ["Intro", "Verse", "Pre", "Hook", "Bridge", "Outro", "Drop", "Break"];

export function ArrangeView({
  project,
  peaksByFileId,
  positionSec,
  onSeek,
  onAddSectionMarker,
  onDeleteSectionMarker,
  selectedTrackId,
  selectedClipId,
  onSelectTrack,
  onMoveTrack,
  onDeleteTrack,
  onSelectClip,
  onMoveClip,
  onTrimClip,
  onSplitClip,
  onDuplicateClip,
  onDuplicateTrackBelow,
  onDeleteClip,
  onCreateArtifactClip,
  onMuteArtifactClip,
  onReduceClipGain,
  onCreateSmartGapFill,
  onApplyAutoClipPanMix,
  onUpdateClipPanAutomation,
  onResetClipPanAutomation,
  onExportSelectedClip,
  onSetAllClipsMovementLocked,
  onFreezeClip,
  onUnfreezeClip,
  onClipRoleChange,
  onAddClipIntentTag,
  onRemoveClipIntentTag,
  onAddClipPluginChain,
  onImportToTrack,
  onAddClipPlugin,
  onOpenClipPluginBrowser,
  onOpenClipPluginEditor,
  onToggleClipPlugin,
  onRemoveClipPlugin,
  onImport,
}: ArrangeViewProps) {
  const [zoom, setZoom] = useState(1);
  const [sectionLabel, setSectionLabel] = useState("Hook");
  const [showClipMeta, setShowClipMeta] = useState(false);
  const [showPanEditor, setShowPanEditor] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const lastPinchAtRef = useRef(0);
  const clipDragRef = useRef<ClipDragState | null>(null);
  const trackDeletePressRef = useRef<number | null>(null);
  const [deleteTrackConfirmId, setDeleteTrackConfirmId] = useState<string | null>(null);
  const durationSec = Math.max(1, getProjectDurationSec(project));
  const viewDuration = durationSec * 1.15;
  const playheadPercent = Math.min(100, Math.max(0, (positionSec / viewDuration) * 100));
  const minZoom = 0.5;
  const maxZoom = 24;
  const isEmpty = project.tracks.length === 0;
  const trackLabelWidth = isEmpty ? 0 : 118;
  const contentWidth = isEmpty ? 360 : Math.max(720, 1200 * zoom);
  const pixelsPerSecond = contentWidth / viewDuration;
  const isMaxDetailZoom = zoom >= maxZoom * 0.96;

  useEffect(() => {
    setShowPanEditor(false);
  }, [selectedClipId]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(maxZoom, z * 1.4));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(minZoom, z / 1.4));
  }, []);

  const handleTimelineTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 2) return;
      pinchRef.current = {
        distance: getTouchDistance(event.touches[0], event.touches[1]),
        zoom,
      };
      lastPinchAtRef.current = Date.now();
    },
    [zoom],
  );

  const handleTimelineTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();

      const distance = getTouchDistance(event.touches[0], event.touches[1]);
      const ratio = distance / Math.max(1, pinchRef.current.distance);
      setZoom(Math.max(minZoom, Math.min(maxZoom, pinchRef.current.zoom * ratio)));
      lastPinchAtRef.current = Date.now();
    },
    [],
  );

  const handleTimelineTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  const handleTimelineClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      if (Date.now() - lastPinchAtRef.current < 250) return;
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const clientX = "touches" in e ? (e.touches[0]?.clientX ?? 0) : e.clientX;
      const timeSec = xToTime(clientX, rect.left, {
        scrollLeftPx: target.scrollLeft ?? 0,
        pixelsPerSecond: contentWidth / viewDuration,
        leftPaddingPx: trackLabelWidth,
        devicePixelRatio: window.devicePixelRatio,
      });
      onSeek(Math.max(0, Math.min(viewDuration, timeSec)));
    },
    [contentWidth, onSeek, trackLabelWidth, viewDuration],
  );

  const selectedClip = selectedClipId ? project.clips.find((clip) => clip.id === selectedClipId) : null;
  const selectedClipTrack = selectedClip ? project.tracks.find((track) => track.id === selectedClip.trackId) : null;
  const selectedClipFile = selectedClip ? project.files.find((file) => file.id === selectedClip.fileId) : null;
  const allClipsMovementLocked = project.clips.length > 0 && project.clips.every((clip) => clip.movementLocked);
  const selectedClipCanSplit =
    Boolean(selectedClip) &&
    positionSec > (selectedClip?.timelineStartSec ?? 0) + 0.02 &&
    positionSec < (selectedClip?.timelineStartSec ?? 0) + (selectedClip?.durationSec ?? 0) - 0.02;

  const cancelTrackDeletePress = useCallback(() => {
    if (trackDeletePressRef.current !== null) {
      window.clearTimeout(trackDeletePressRef.current);
      trackDeletePressRef.current = null;
    }
  }, []);

  const beginTrackDeletePress = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, trackId: string) => {
      event.stopPropagation();
      cancelTrackDeletePress();
      trackDeletePressRef.current = window.setTimeout(() => {
        setDeleteTrackConfirmId(trackId);
        trackDeletePressRef.current = null;
      }, 520);
    },
    [cancelTrackDeletePress],
  );

  const beginClipDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>, clip: Clip, mode: ClipDragState["mode"]) => {
      event.stopPropagation();
      onSelectTrack(clip.trackId);
      onSelectClip(clip.id);
      if (mode === "move" && clip.movementLocked) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      clipDragRef.current = {
        clipId: clip.id,
        mode,
        startClientX: event.clientX,
        originStartSec: clip.timelineStartSec,
        originDurationSec: clip.durationSec,
      };
    },
    [onSelectClip, onSelectTrack],
  );

  const handleClipPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const drag = clipDragRef.current;
      if (!drag) return;

      event.preventDefault();
      event.stopPropagation();
      const deltaSec = (event.clientX - drag.startClientX) / pixelsPerSecond;
      if (drag.mode === "move") {
        onMoveClip(drag.clipId, drag.originStartSec + deltaSec, { snap: false });
        return;
      }

      if (drag.mode === "trim-start") {
        onTrimClip(drag.clipId, "start", drag.originStartSec + deltaSec, { snap: false });
        return;
      }

      onTrimClip(drag.clipId, "end", drag.originStartSec + drag.originDurationSec + deltaSec, { snap: false });
    },
    [onMoveClip, onTrimClip, pixelsPerSecond],
  );

  const endClipDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    clipDragRef.current = null;
  }, []);

  return (
    <section className="view-enter flex h-full min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-panel">
      {/* Header */}
      <div className="flex min-h-[44px] items-center justify-between border-b border-daw-line px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Layers size={16} className="text-daw-cyan" />
          <span className="hidden sm:inline">Arrange</span>
        </div>
        <div className="flex items-center gap-1">
          <label
            className="daw-btn daw-btn-primary !min-h-[36px] !rounded-lg px-2.5 text-[10px] font-bold"
            onClick={(event) => event.stopPropagation()}
          >
            <Upload size={14} className="sm:mr-1" />
            <span className="hidden sm:inline">Upload</span>
            <span className="sm:hidden">UP</span>
            <input
              type="file"
              multiple
              accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif,.flac,.zip,application/zip"
              className="sr-only"
              onChange={(event) => {
                onImport(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
          <select
            value={sectionLabel}
            onChange={(event) => setSectionLabel(event.currentTarget.value)}
            className="hidden h-9 rounded-lg border border-daw-line bg-daw-panel px-2 text-[10px] font-bold text-daw-text sm:block"
            aria-label="Section type"
          >
            {SECTION_LABELS.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onAddSectionMarker(sectionLabel, positionSec)}
            className="daw-btn daw-btn-ghost !min-h-[36px] !rounded-lg text-[10px]"
          >
            +Section
          </button>
          <button
            type="button"
            disabled={!selectedClip}
            onClick={() => setShowClipMeta((visible) => !visible)}
            className={`daw-btn !min-h-[36px] !rounded-lg text-[10px] disabled:opacity-30 ${
              showClipMeta ? "border-daw-cyan/35 bg-daw-cyan/15 text-daw-cyan" : "daw-btn-ghost"
            }`}
            aria-label="Show clip tags and history"
          >
            Tags/History
          </button>
          <span className="mr-2 text-[11px] text-daw-muted">
            {project.bpm ?? "--"} BPM - {durationSec.toFixed(1)}s
          </span>
          <button
            type="button"
            onClick={handleZoomOut}
            className="daw-btn daw-btn-ghost !min-h-[36px] !min-w-[36px] !rounded-lg"
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            className="daw-btn daw-btn-ghost !min-h-[36px] !min-w-[36px] !rounded-lg"
            aria-label="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      {selectedClip && selectedClipTrack && (
        <div className="daw-scrollbar max-h-[52vh] overflow-y-auto overscroll-contain border-b border-daw-line bg-daw-bg/55 px-3 py-2 sm:max-h-[58vh]">
          <div className="flex min-h-[44px] items-center gap-2 overflow-x-auto">
            <div className="min-w-[120px] flex-1">
              <div className="truncate text-[11px] font-semibold text-daw-text">
                {selectedClipTrack.name} clip
              </div>
              <div className="text-[10px] text-daw-muted">
                {selectedClip.timelineStartSec.toFixed(2)}s - {(selectedClip.timelineStartSec + selectedClip.durationSec).toFixed(2)}s
              </div>
            </div>
            <select
              value={selectedClip.role}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => onClipRoleChange(selectedClip.id, event.currentTarget.value as StemRole)}
              className="h-9 shrink-0 rounded-lg border border-daw-line bg-daw-panel px-2 text-[10px] font-bold text-daw-text"
              aria-label="Clip role"
            >
              {STEM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <ClipActionButton label="Split at playhead" disabled={!selectedClipCanSplit} onClick={() => onSplitClip(selectedClip.id, positionSec)}>
              <Scissors size={15} />
            </ClipActionButton>
            <ClipActionButton label="Duplicate clip" disabled={false} onClick={() => onDuplicateClip(selectedClip.id)}>
              <Copy size={15} />
            </ClipActionButton>
            <ClipActionButton label="Copy selected clip to track below" disabled={false} onClick={() => onDuplicateTrackBelow(selectedClip.trackId, true)}>
              <Layers size={15} />
            </ClipActionButton>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateArtifactClip(selectedClip.id);
              }}
              className="min-h-9 shrink-0 rounded-lg border border-daw-amber/25 bg-daw-amber/10 px-2.5 text-[10px] font-bold text-daw-amber"
            >
              Artifact
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMuteArtifactClip(selectedClip.id, !(selectedClip.artifact?.isMuted ?? false));
              }}
              className={`min-h-9 shrink-0 rounded-lg border px-2.5 text-[10px] font-bold ${
                selectedClip.artifact?.isMuted
                  ? "border-daw-red/35 bg-daw-red/15 text-daw-red"
                  : "border-white/[0.08] bg-white/[0.04] text-daw-muted"
              }`}
            >
              {selectedClip.artifact?.isMuted ? "Muted" : "Mute Art"}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onReduceClipGain(selectedClip.id, 3);
              }}
              className="min-h-9 shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[10px] font-bold text-daw-muted"
            >
              -3dB
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCreateSmartGapFill(selectedClip.id);
              }}
              className="min-h-9 shrink-0 rounded-lg border border-daw-cyan/20 bg-daw-cyan/10 px-2.5 text-[10px] font-bold text-daw-cyan"
            >
              Smart Fill
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setShowPanEditor((visible) => !visible);
              }}
              className={`min-h-9 shrink-0 rounded-lg border px-2.5 text-[10px] font-black ${
                showPanEditor
                  ? "border-daw-cyan/45 bg-daw-cyan/15 text-daw-cyan shadow-[0_0_14px_rgba(77,217,255,0.18)]"
                  : selectedClip.panAutomation?.enabled
                    ? "border-daw-cyan/25 bg-daw-cyan/10 text-daw-cyan"
                    : "border-white/[0.08] bg-white/[0.04] text-daw-muted"
              }`}
              aria-pressed={showPanEditor}
              title="Show clip pan editor"
            >
              PAN
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onApplyAutoClipPanMix([selectedClip.id]);
              }}
              className="min-h-9 shrink-0 rounded-lg border border-daw-cyan/20 bg-daw-cyan/10 px-2.5 text-[10px] font-bold text-daw-cyan"
            >
              Auto Pan
            </button>
            {selectedClip.panAutomation && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onResetClipPanAutomation(selectedClip.id);
                }}
                className="min-h-9 shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-[10px] font-bold text-daw-muted"
              >
                Reset Pan
              </button>
            )}
            <ClipActionButton label="Export selected clip WAV" disabled={false} onClick={onExportSelectedClip}>
              <Download size={15} />
            </ClipActionButton>
            <label
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-daw-cyan/25 bg-daw-cyan/10 text-daw-cyan"
              title="Import WAV/audio to this track at playhead"
              aria-label="Import audio to selected track"
              onClick={(event) => event.stopPropagation()}
            >
              <Upload size={15} />
              <input
                type="file"
                accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif,.flac,.zip,application/zip"
                className="sr-only"
                onChange={(event) => {
                  onImportToTrack(selectedClip.trackId, event.currentTarget.files, positionSec);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <button
              type="button"
              disabled={!selectedClip.isFrozen && selectedClip.insertChain.length === 0}
              onClick={(event) => {
                event.stopPropagation();
                if (selectedClip.isFrozen) onUnfreezeClip(selectedClip.id);
                else onFreezeClip(selectedClip.id);
              }}
              className="min-h-9 shrink-0 rounded-lg border border-daw-amber/30 bg-daw-amber/10 px-2.5 text-[10px] font-bold text-daw-amber disabled:opacity-30"
            >
              {selectedClip.isFrozen ? "Unfreeze" : "Freeze FX"}
            </button>
          </div>

          <div className="mt-2 flex min-w-0 items-center gap-2">
            <div className="daw-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
              {getOneTapActions(selectedClip.role).map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddClipPluginChain(selectedClip.id, action.pluginIds, action.label);
                  }}
                  className="min-h-8 shrink-0 rounded-lg border border-daw-amber/25 bg-daw-amber/10 px-2.5 text-[10px] font-bold text-daw-amber"
                  title={`Adds ${action.pluginIds.join(", ")}`}
                >
                  {action.label}
                </button>
              ))}
              {getRecommendedClipPlugins(selectedClip.role).map((action) => (
                <button
                  key={action.pluginId}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddClipPlugin(selectedClip.id, action.pluginId);
                  }}
                  className="min-h-8 shrink-0 rounded-lg border border-daw-cyan/20 bg-daw-cyan/10 px-2.5 text-[10px] font-bold text-daw-cyan"
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenClipPluginBrowser(selectedClip.id);
                }}
                className="min-h-8 shrink-0 rounded-lg border border-daw-line bg-white/[0.04] px-2.5 text-[10px] font-bold text-daw-muted"
              >
                <span className="inline-flex items-center gap-1"><Plus size={12} /> All FX</span>
              </button>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 pb-1">
              <IconActionButton
                label="Hide selected clip"
                danger
                onClick={() => onDeleteClip(selectedClip.id)}
              >
                <Trash2 size={15} />
              </IconActionButton>
              <IconActionButton
                label={allClipsMovementLocked ? "Unlock clip movement" : "Lock clip movement"}
                active={allClipsMovementLocked}
                onClick={() => onSetAllClipsMovementLocked(!allClipsMovementLocked)}
              >
                {allClipsMovementLocked ? <Lock size={15} /> : <Unlock size={15} />}
              </IconActionButton>
            </div>
          </div>

          {selectedClip.insertChain.length > 0 && (
            <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
              {selectedClip.insertChain.map((plugin) => (
                <ClipPluginPill
                  key={plugin.id}
                  plugin={plugin}
                  onEdit={() => onOpenClipPluginEditor(selectedClip.id, plugin.id)}
                  onToggle={() => onToggleClipPlugin(selectedClip.id, plugin.id)}
                  onRemove={() => onRemoveClipPlugin(selectedClip.id, plugin.id)}
                />
              ))}
            </div>
          )}

          {showPanEditor && (
            <ClipPanEditor
              clip={selectedClip}
              fileName={selectedClipFile?.name ?? selectedClipTrack.name}
              color={selectedClipTrack.color}
              peaks={peaksByFileId[selectedClip.fileId]}
              onAuto={() => onApplyAutoClipPanMix([selectedClip.id])}
              onReset={() => onResetClipPanAutomation(selectedClip.id)}
              onUpdate={(automation) => onUpdateClipPanAutomation(selectedClip.id, automation)}
            />
          )}

          {showClipMeta && (
          <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.55fr)]">
            <div className="rounded-xl border border-daw-line bg-white/[0.025] p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase text-daw-muted">Intent Tags</span>
                <span className="text-[9px] text-daw-muted">{selectedClip.intentTags.length}/16</span>
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {selectedClip.intentTags.length === 0 ? (
                  <span className="text-[10px] text-daw-muted">No tags yet</span>
                ) : (
                  selectedClip.intentTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveClipIntentTag(selectedClip.id, tag);
                      }}
                      className="rounded-full border border-daw-cyan/25 bg-daw-cyan/10 px-2 py-1 text-[10px] font-bold text-daw-cyan"
                      title="Tap to remove"
                    >
                      {tag} x
                    </button>
                  ))
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {getIntentTagSuggestions(selectedClip.role)
                  .filter((tag) => !selectedClip.intentTags.includes(tag))
                  .slice(0, 8)
                  .map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onAddClipIntentTag(selectedClip.id, tag);
                      }}
                      className="min-h-8 shrink-0 rounded-lg border border-daw-line bg-white/[0.04] px-2 text-[10px] font-bold text-daw-muted"
                    >
                      + {tag}
                    </button>
                  ))}
              </div>
            </div>

            <div className="rounded-xl border border-daw-line bg-white/[0.025] p-2">
              <div className="mb-2 text-[10px] font-bold uppercase text-daw-muted">History</div>
              <div className="space-y-1">
                {(selectedClip.actionHistory ?? []).slice(0, 5).map((item) => (
                  <div key={item.id} className="rounded-lg bg-black/15 px-2 py-1.5">
                    <div className="truncate text-[10px] font-semibold text-daw-text">{item.label}</div>
                    <div className="text-[9px] text-daw-muted">{new Date(item.createdAt).toLocaleTimeString()}</div>
                  </div>
                ))}
                {(selectedClip.actionHistory ?? []).length === 0 && (
                  <div className="text-[10px] text-daw-muted">No history yet</div>
                )}
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Timeline area */}
      <div
        ref={scrollRef}
        className="daw-scrollbar relative min-h-0 min-w-0 max-w-full flex-1 touch-auto overflow-x-auto overflow-y-auto overscroll-contain"
        onClick={handleTimelineClick}
        onTouchStart={handleTimelineTouchStart}
        onTouchMove={handleTimelineTouchMove}
        onTouchEnd={handleTimelineTouchEnd}
        onTouchCancel={handleTimelineTouchEnd}
      >
        <div
          className="relative"
          style={{
            width: contentWidth + trackLabelWidth,
            minHeight: Math.max(project.tracks.length * 58 + 128, 360),
          }}
        >
          {/* Time ruler */}
          <div className="sticky top-0 z-30 flex h-7 border-b border-daw-line bg-daw-bg/80 backdrop-blur-sm">
            <div style={{ width: trackLabelWidth }} className="shrink-0" />
          <div className="relative flex-1">
            <TimeRuler durationSec={viewDuration} width={contentWidth} bpm={project.bpm} />
            {project.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteSectionMarker(section.id);
                }}
                className="absolute top-1 z-20 rounded-md border border-daw-amber/35 bg-daw-amber/20 px-1.5 py-0.5 text-[9px] font-bold text-daw-amber"
                style={{ left: `${Math.min(98, Math.max(0, (section.timeSec / viewDuration) * 100))}%` }}
                title="Tap to delete section marker"
              >
                {section.label}
              </button>
            ))}
          </div>
          </div>

          {/* Playhead */}
          <div
            className="playhead absolute bottom-0 z-20 w-[2px] rounded-full bg-daw-cyan shadow-glow-cyan"
            style={{
              top: 28,
              left: trackLabelWidth + (playheadPercent / 100) * contentWidth,
            }}
          />

          {/* Beat grid */}
          <div
            className="pointer-events-none absolute bottom-0"
            style={{ top: 28, left: trackLabelWidth, width: contentWidth }}
          >
            <BeatGrid durationSec={viewDuration} bpm={project.bpm} />
          </div>

          {/* Tracks */}
          {project.tracks.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-daw-muted">
              <p>Import audio stems to get started</p>
              <label
                onClick={(event) => event.stopPropagation()}
                className="daw-btn daw-btn-primary flex cursor-pointer items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl"
              >
                <Upload size={14} />
                <span>Upload stems</span>
                <input
                  type="file"
                  multiple
                  accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif,.flac,.zip,application/zip"
                  className="sr-only"
                  onChange={(event) => {
                    onImport(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
          ) : (
            <div
              className="relative z-10 space-y-1 pt-2"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)" }}
            >
              {project.tracks.map((track, index) => {
                const clips = project.clips
                  .filter((clip) => clip.trackId === track.id)
                  .sort((a, b) => a.timelineStartSec - b.timelineStartSec);
                const firstFile = clips[0] ? project.files.find((file) => file.id === clips[0]?.fileId) : null;
                const isSelected = selectedTrackId === track.id;
                const isDeleteConfirmOpen = deleteTrackConfirmId === track.id;

                return (
                  <div key={track.id} className={`flex items-stretch gap-0 ${isDeleteConfirmOpen ? "relative z-[110]" : "relative z-10"}`}>
                    {/* Track label */}
                    <div
                      style={{ width: trackLabelWidth }}
                      className={`sticky left-0 flex shrink-0 items-center gap-1.5 border-r border-daw-line bg-daw-panel px-2 transition-colors relative ${
                        isDeleteConfirmOpen ? "z-[120]" : "z-40"
                      } ${
                        isSelected
                          ? "text-daw-cyan shadow-[inset_3px_0_0_rgba(77,217,255,0.7)]"
                          : "text-daw-text hover:bg-daw-panel2"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTrackConfirmId(null);
                          onSelectTrack(isSelected ? null : track.id);
                        }}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        aria-label={`Select ${track.name}`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: track.color }}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[11px] font-semibold leading-tight">
                            {track.name}
                          </div>
                          <div className="mt-0.5 inline-flex rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-bold uppercase text-daw-muted">
                            {track.role}
                          </div>
                          {firstFile && (
                            <div className="truncate text-[9px] text-daw-muted">
                              {clips.length} clip{clips.length === 1 ? "" : "s"} - {firstFile.channelCount}ch
                            </div>
                          )}
                        </div>
                      </button>
                      <div className="grid shrink-0 grid-cols-2 gap-1">
                        <TrackOrderButton
                          label={`Copy ${track.name} below`}
                          disabled={clips.length === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDuplicateTrackBelow(track.id, false);
                          }}
                        >
                          <Copy size={12} />
                        </TrackOrderButton>
                        <TrackOrderButton
                          label={`Move ${track.name} up`}
                          disabled={index === 0}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMoveTrack(track.id, "up");
                          }}
                        >
                          <ChevronUp size={13} />
                        </TrackOrderButton>
                        <TrackOrderButton
                          label={`Move ${track.name} down`}
                          disabled={index === project.tracks.length - 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            onMoveTrack(track.id, "down");
                          }}
                        >
                          <ChevronDown size={13} />
                        </TrackOrderButton>
                        <button
                          type="button"
                          aria-label={`Delete ${track.name}`}
                          title="Track delete"
                          onPointerDown={(event) => beginTrackDeletePress(event, track.id)}
                          onPointerUp={cancelTrackDeletePress}
                          onPointerCancel={cancelTrackDeletePress}
                          onPointerLeave={cancelTrackDeletePress}
                          onClick={(event) => {
                            event.stopPropagation();
                            cancelTrackDeletePress();
                            setDeleteTrackConfirmId((current) => (current === track.id ? null : track.id));
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-md border border-red-300/20 bg-red-500/10 text-daw-red"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      {isDeleteConfirmOpen && (
                        <div
                          className="absolute left-2 top-[calc(100%-2px)] z-[130] w-44 rounded-xl border border-red-300/30 bg-daw-bg p-2 shadow-2xl shadow-black/70"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="mb-2 text-[10px] font-bold leading-snug text-daw-text">
                            {track.name}を削除しますか？
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              className="min-h-8 rounded-lg border border-red-300/35 bg-red-500/15 px-2 text-[10px] font-black text-daw-red"
                              onClick={(event) => {
                                event.stopPropagation();
                                onDeleteTrack(track.id);
                                setDeleteTrackConfirmId(null);
                              }}
                            >
                              削除
                            </button>
                            <button
                              type="button"
                              className="min-h-8 rounded-lg border border-daw-line bg-white/[0.04] px-2 text-[10px] font-bold text-daw-muted"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteTrackConfirmId(null);
                              }}
                            >
                              戻る
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Clip lane */}
                    <div className="relative min-h-[52px] flex-1 border-b border-white/[0.03]">
                      {clips.map((clip) => {
                        const clipWidthPercent = Math.max(1, (clip.durationSec / viewDuration) * 100);
                        const clipLeftPercent = (clip.timelineStartSec / viewDuration) * 100;
                        const isClipSelected = selectedClipId === clip.id;
                        const file = project.files.find((candidate) => candidate.id === clip.fileId);

                        return (
                          <div
                            key={clip.id}
                            className={`absolute inset-y-1 overflow-hidden rounded-lg border transition-colors duration-150 ${
                              clip.movementLocked ? "touch-auto cursor-default" : "touch-none cursor-grab active:cursor-grabbing"
                            }`}
                            style={{
                              left: `${clipLeftPercent}%`,
                              width: `${clipWidthPercent}%`,
                              borderColor: isClipSelected ? track.color : "rgba(255,255,255,0.08)",
                              background: isClipSelected ? `${track.color}18` : "rgba(255,255,255,0.02)",
                              boxShadow: isClipSelected ? `0 0 0 1px ${track.color}55` : undefined,
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={`Clip ${file?.name ?? track.name}`}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => beginClipDrag(event, clip, "move")}
                            onPointerMove={handleClipPointerMove}
                            onPointerUp={endClipDrag}
                            onPointerCancel={endClipDrag}
                          >
                            <button
                              type="button"
                              aria-label="Trim clip start"
                              className="absolute inset-y-0 left-0 z-10 w-4 cursor-ew-resize rounded-l-lg bg-white/10"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => beginClipDrag(event, clip, "trim-start")}
                              onPointerMove={handleClipPointerMove}
                              onPointerUp={endClipDrag}
                              onPointerCancel={endClipDrag}
                            />
                            <WaveformCanvas
                              peaks={peaksByFileId[clip.fileId]}
                              color={track.color}
                              height={50}
                              sourceStartSec={clip.sourceStartSec}
                              durationSec={clip.durationSec}
                              detailMode={isMaxDetailZoom}
                            />
                            {clip.movementLocked && (
                              <div className="pointer-events-none absolute right-2 top-1 flex items-center gap-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[8px] font-bold uppercase text-daw-amber">
                                <Lock size={9} />
                                Lock
                              </div>
                            )}
                            {clip.isFrozen && (
                              <div className="pointer-events-none absolute left-2 top-1 rounded-full bg-daw-amber/90 px-1.5 py-0.5 text-[8px] font-bold uppercase text-black">
                                Frozen
                              </div>
                            )}
                            <div className="pointer-events-none absolute inset-x-4 bottom-1 flex items-center justify-between gap-2 text-[9px] text-white/75">
                              <span className="truncate">{file?.name.replace(/\.[^.]+$/, "") ?? "Clip"}</span>
                              <span className="shrink-0">{clip.durationSec.toFixed(1)}s</span>
                            </div>
                            {zoom > 1.2 && clip.intentTags.length > 0 && (
                              <div className="pointer-events-none absolute left-4 top-1 flex max-w-[70%] gap-1 overflow-hidden">
                                {clip.intentTags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="truncate rounded-full bg-black/45 px-1.5 py-0.5 text-[8px] font-bold text-white/75">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              aria-label="Trim clip end"
                              className="absolute inset-y-0 right-0 z-10 w-4 cursor-ew-resize rounded-r-lg bg-white/10"
                              onClick={(event) => event.stopPropagation()}
                              onPointerDown={(event) => beginClipDrag(event, clip, "trim-end")}
                              onPointerMove={handleClipPointerMove}
                              onPointerUp={endClipDrag}
                              onPointerCancel={endClipDrag}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
function getTouchDistance(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function ClipActionButton({
  label,
  disabled,
  danger,
  children,
  onClick,
}: {
  label: string;
  disabled: boolean;
  danger?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-daw-text disabled:opacity-30 ${
        danger ? "border-red-400/30 bg-red-500/10" : "border-white/[0.08] bg-white/[0.04]"
      }`}
    >
      {children}
    </button>
  );
}

function IconActionButton({
  label,
  active,
  danger,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
        danger
          ? "border-red-400/30 bg-red-500/10 text-daw-red"
          : active
            ? "border-daw-amber/35 bg-daw-amber/12 text-daw-amber"
            : "border-daw-cyan/20 bg-daw-cyan/10 text-daw-cyan"
      }`}
    >
      {children}
    </button>
  );
}

function ClipPanEditor({
  clip,
  fileName,
  color,
  peaks,
  onAuto,
  onReset,
  onUpdate,
}: {
  clip: Clip;
  fileName: string;
  color: string;
  peaks: PeakSummary | undefined;
  onAuto: () => void;
  onReset: () => void;
  onUpdate: (automation: ClipPanAutomation | undefined) => void;
}) {
  const durationSec = Math.max(0.1, clip.durationSec);
  const [isLargeEdit, setIsLargeEdit] = useState(false);
  const compactHeight = 54;
  const largeHeight = clip.role === "vocal" || clip.role === "backingVocal" ? 270 : 250;
  const editorHeight = isLargeEdit ? largeHeight : compactHeight;
  const [draft, setDraft] = useState<ClipPanAutomation>(() => normalizePanAutomation(clip.panAutomation, durationSec));
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragPointIdRef = useRef<string | null>(null);
  const draftRef = useRef(draft);

  useEffect(() => {
    const next = normalizePanAutomation(clip.panAutomation, durationSec);
    draftRef.current = next;
    setDraft(next);
    setIsLargeEdit(false);
    setSelectedPointId((current) => (current && next.anchorPoints.some((point) => point.id === current) ? current : next.anchorPoints[0]?.id ?? null));
  }, [clip.id, clip.panAutomation, durationSec]);

  const setDraftAutomation = useCallback((next: ClipPanAutomation, commit = false) => {
    const normalized = normalizePanAutomation(next, durationSec);
    draftRef.current = normalized;
    setDraft(normalized);
    if (commit) {
      onUpdate(normalized);
    }
  }, [durationSec, onUpdate]);

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const time = clampNumber(((event.clientX - rect.left) / Math.max(1, rect.width)) * durationSec, 0, durationSec);
    const pan = clampNumber(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1, -1, 1);
    return { time, pan };
  }, [durationSec]);

  const updatePointFromEvent = useCallback((pointId: string, event: React.PointerEvent<HTMLElement>, commit = false) => {
    const nextPoint = pointFromEvent(event);
    if (!nextPoint) return;
    const next = {
      ...draftRef.current,
      enabled: true,
      bypassed: false,
      anchorPoints: draftRef.current.anchorPoints.map((point) =>
        point.id === pointId
          ? {
              ...point,
              time: nextPoint.time,
              pan: nextPoint.pan,
            }
          : point,
      ),
    };
    setDraftAutomation(next, commit);
  }, [pointFromEvent, setDraftAutomation]);

  const handleSurfacePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!isLargeEdit) {
      setIsLargeEdit(true);
      return;
    }
    const nextPoint = pointFromEvent(event);
    if (!nextPoint) return;
    const point: PanAnchorPoint = {
      id: createId("pan"),
      time: nextPoint.time,
      pan: nextPoint.pan,
      curve: "smooth",
    };
    const next = normalizePanAutomation({
      ...draftRef.current,
      enabled: true,
      bypassed: false,
      anchorPoints: [...draftRef.current.anchorPoints, point],
    }, durationSec);
    dragPointIdRef.current = point.id;
    setSelectedPointId(point.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftAutomation(next, false);
  }, [durationSec, isLargeEdit, pointFromEvent, setDraftAutomation]);

  const handlePointPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>, pointId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setIsLargeEdit(true);
    dragPointIdRef.current = pointId;
    setSelectedPointId(pointId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleSurfacePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pointId = dragPointIdRef.current;
    if (!pointId) return;
    event.preventDefault();
    event.stopPropagation();
    updatePointFromEvent(pointId, event, false);
  }, [updatePointFromEvent]);

  const handleSurfacePointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!dragPointIdRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    dragPointIdRef.current = null;
    onUpdate(draftRef.current);
  }, [onUpdate]);

  const updateDraftPatch = useCallback((patch: Partial<ClipPanAutomation>) => {
    setDraftAutomation({
      ...draftRef.current,
      ...patch,
      enabled: patch.enabled ?? true,
    }, true);
  }, [setDraftAutomation]);

  const centerAutomation = useCallback(() => {
    const next = createCenterPanAutomation(durationSec, true);
    setSelectedPointId(next.anchorPoints[0]?.id ?? null);
    setDraftAutomation(next, true);
  }, [durationSec, setDraftAutomation]);

  const removeSelectedPoint = useCallback(() => {
    if (!selectedPointId || draft.anchorPoints.length <= 2) return;
    const next = normalizePanAutomation({
      ...draft,
      enabled: true,
      anchorPoints: draft.anchorPoints.filter((point) => point.id !== selectedPointId),
    }, durationSec);
    setSelectedPointId(next.anchorPoints[0]?.id ?? null);
    setDraftAutomation(next, true);
  }, [draft, durationSec, selectedPointId, setDraftAutomation]);

  const points = draft.anchorPoints;
  const selectedPoint = selectedPointId ? points.find((point) => point.id === selectedPointId) : points[0];
  const spatialPanInfo = getClipSpatialPanInfo(clip);
  const hasAutoPan = clip.intentTags.includes("aimix-spatial-pan") || Boolean(spatialPanInfo);
  const isCenterProtectedRole = clip.role === "vocal" || clip.role === "bass" || clip.role === "drums";
  const svgPoints = points
    .map((point) => `${(point.time / durationSec) * 100},${(point.pan + 1) * 50}`)
    .join(" ");
  const panStats = summarizePanAutomation(points);

  return (
    <div className="mt-2 rounded-xl border border-daw-cyan/20 bg-black/20 p-2 shadow-inner shadow-black/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="truncate text-[10px] font-black uppercase tracking-[0.08em] text-daw-cyan">Clip Pan Automation</div>
            {hasAutoPan && (
              <span className="shrink-0 rounded-full border border-daw-cyan/25 bg-daw-cyan/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em] text-daw-cyan">
                Auto Pan
              </span>
            )}
          </div>
          <div className="truncate text-[10px] text-daw-muted">
            {fileName.replace(/\.[^.]+$/, "")} / {points.length} anchors / {draft.enabled && !draft.bypassed ? "active" : "off"} / {isLargeEdit ? "large edit" : "compact"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] font-bold text-daw-muted">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5">
              Actual {panStats.rangeLabel}
            </span>
            <span className={`rounded-full border px-1.5 py-0.5 ${panStats.scoreClass}`}>
              Score {panStats.score}
            </span>
          </div>
          {spatialPanInfo && (
            <div className="truncate text-[10px] text-daw-muted">
              Scene {spatialPanInfo.scene} / {spatialPanInfo.template} / role {spatialPanInfo.role}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsLargeEdit((current) => !current);
            }}
            className={`min-h-8 rounded-lg border px-2 text-[10px] font-black ${
              isLargeEdit ? "border-daw-cyan/35 bg-daw-cyan/15 text-daw-cyan" : "border-white/[0.08] bg-white/[0.04] text-daw-muted"
            }`}
          >
            {isLargeEdit ? "Large ON" : "Large OFF"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAuto();
            }}
            className="min-h-8 rounded-lg border border-daw-cyan/25 bg-daw-cyan/10 px-2 text-[10px] font-bold text-daw-cyan"
          >
            Rebuild Clip Pan
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              centerAutomation();
            }}
            className={`min-h-8 rounded-lg border px-2 text-[10px] font-bold ${
              isCenterProtectedRole ? "border-daw-amber/30 bg-daw-amber/10 text-daw-amber" : "border-white/[0.08] bg-white/[0.04] text-daw-muted"
            }`}
          >
            {isCenterProtectedRole ? "Center Guard" : "Center"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onReset();
            }}
            className="min-h-8 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 text-[10px] font-bold text-daw-muted"
          >
            {hasAutoPan ? "Reset Auto" : "Reset"}
          </button>
        </div>
      </div>

      <div
        ref={surfaceRef}
        className={`relative overflow-hidden rounded-xl border border-white/[0.08] bg-daw-bg touch-none transition-[height] duration-150 ${
          isLargeEdit ? "shadow-[0_0_0_1px_rgba(77,217,255,0.18)]" : ""
        }`}
        style={{ height: editorHeight }}
        onPointerDown={handleSurfacePointerDown}
        onPointerMove={handleSurfacePointerMove}
        onPointerUp={handleSurfacePointerUp}
        onPointerCancel={handleSurfacePointerUp}
      >
        <div className="absolute inset-0 opacity-80">
          <WaveformCanvas
            peaks={peaks}
            color={color}
            height={editorHeight}
            sourceStartSec={clip.sourceStartSec}
            durationSec={clip.durationSec}
            detailMode
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-white/55 shadow-[0_0_12px_rgba(255,255,255,0.25)]" />
        {isLargeEdit ? (
          <>
            <div className="pointer-events-none absolute left-2 top-2 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-black text-daw-cyan">L</div>
            <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/45 px-2 py-1 text-[10px] font-bold text-white/75">CENTER</div>
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] font-black text-daw-amber">R</div>
          </>
        ) : (
          <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full border border-daw-cyan/20 bg-black/45 px-2 py-1 text-[9px] font-bold text-daw-cyan">
            tap for large edit
          </div>
        )}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline
            points={svgPoints}
            fill="none"
            stroke={color}
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
            opacity={draft.enabled && !draft.bypassed ? 0.9 : 0.38}
          />
        </svg>
        {points.map((point, index) => {
          const left = `${(point.time / durationSec) * 100}%`;
          const top = `${(point.pan + 1) * 50}%`;
          const isSelected = selectedPointId === point.id;
          return (
            <button
              key={point.id}
              type="button"
              aria-label={`Pan anchor ${index + 1}`}
              title={`${formatTime(point.time)} / ${formatPan(point.pan)}`}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedPointId(point.id);
              }}
              onPointerDown={(event) => handlePointPointerDown(event, point.id)}
              onPointerMove={handleSurfacePointerMove}
              onPointerUp={handleSurfacePointerUp}
              onPointerCancel={handleSurfacePointerUp}
              className={`absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-black shadow-lg ${
                isLargeEdit ? "h-8 w-8 text-[10px]" : "h-5 w-5 text-[8px]"
              } ${
                isSelected
                  ? "border-white bg-daw-cyan text-black shadow-daw-cyan/40"
                  : "border-white/55 bg-black/80 text-white"
              }`}
              style={{ left, top }}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      {isLargeEdit ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(160px,0.45fr)]">
          <div className="grid gap-2">
            <label className="grid gap-1 text-[10px] font-bold text-daw-muted">
              Depth {Math.round(draft.depth * 100)}%
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(draft.depth * 100)}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => updateDraftPatch({ depth: Number(event.currentTarget.value) / 100 })}
                className="accent-daw-cyan"
              />
            </label>
            <label className="grid gap-1 text-[10px] font-bold text-daw-muted">
              Smooth {draft.smoothingMs}ms
              <input
                type="range"
                min={0}
                max={180}
                step={5}
                value={draft.smoothingMs}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => updateDraftPatch({ smoothingMs: Number(event.currentTarget.value) })}
                className="accent-daw-cyan"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                updateDraftPatch({ enabled: !draft.enabled, bypassed: false });
              }}
              className={`min-h-9 rounded-lg border px-2 text-[10px] font-black ${
                draft.enabled ? "border-daw-green/30 bg-daw-green/12 text-daw-green" : "border-white/[0.08] bg-white/[0.04] text-daw-muted"
              }`}
            >
              {draft.enabled ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                updateDraftPatch({ bypassed: !draft.bypassed, enabled: true });
              }}
              className={`min-h-9 rounded-lg border px-2 text-[10px] font-black ${
                draft.bypassed ? "border-daw-amber/35 bg-daw-amber/12 text-daw-amber" : "border-white/[0.08] bg-white/[0.04] text-daw-muted"
              }`}
            >
              {draft.bypassed ? "Bypass" : "Live"}
            </button>
            <button
              type="button"
              disabled={!selectedPoint || points.length <= 2}
              onClick={(event) => {
                event.stopPropagation();
                removeSelectedPoint();
              }}
              className="min-h-9 rounded-lg border border-red-300/25 bg-red-500/10 px-2 text-[10px] font-black text-daw-red disabled:opacity-30"
            >
              Delete Pt
            </button>
            <div className="flex min-h-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 text-center text-[10px] font-bold text-daw-muted">
              {selectedPoint ? `${formatTime(selectedPoint.time)} / ${formatPan(selectedPoint.pan)}` : "No point"}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-daw-muted">
          <span>Tap the mini waveform or an anchor to open the large editor.</span>
          <span className="shrink-0 font-bold">{selectedPoint ? `${formatTime(selectedPoint.time)} / ${formatPan(selectedPoint.pan)}` : "No point"}</span>
        </div>
      )}
    </div>
  );
}

function ClipPluginPill({
  plugin,
  onEdit,
  onToggle,
  onRemove,
}: {
  plugin: PluginInstance;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const descriptor = getPluginDescriptor(plugin.pluginId);
  return (
    <div className="flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-daw-line bg-daw-panel px-1.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
        className="inline-flex min-h-7 items-center gap-1 text-[10px] font-bold text-daw-text"
      >
        <SlidersHorizontal size={12} />
        {descriptor?.shortName ?? plugin.name}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={plugin.enabled ? "text-daw-green" : "text-daw-muted"}
        aria-label="Toggle clip plug-in"
      >
        <Power size={12} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="text-daw-red"
        aria-label="Remove clip plug-in"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function getRecommendedClipPlugins(role: StemRole): Array<{ label: string; pluginId: BuiltinPluginId }> {
  const shared = [{ label: "Filter", pluginId: "sweet-filter" as const }];
  if (role === "vocal" || role === "backingVocal") {
    return [
      { label: "De-Esser", pluginId: "sweet-de-esser" },
      { label: "Pitch", pluginId: "sweet-pitch-assist" },
      { label: "Delay Throw", pluginId: "sweet-delay-lite" },
    ];
  }
  if (role === "drums") {
    return [
      { label: "Transient", pluginId: "sweet-transient-shaper" },
      { label: "Drive", pluginId: "sweet-drive" },
      { label: "Gate", pluginId: "sweet-gate-lite" },
    ];
  }
  if (role === "bass") {
    return [
      { label: "Bass+", pluginId: "sweet-bass-enhancer" },
      { label: "Drive", pluginId: "sweet-drive" },
      { label: "Comp", pluginId: "sweet-multiband-comp" },
    ];
  }
  if (role === "guitar") {
    return [
      { label: "Rig", pluginId: "sweet-guitar-rig" },
      { label: "Amp", pluginId: "sweet-guitar-amp" },
      { label: "Cab", pluginId: "sweet-guitar-cab" },
    ];
  }
  if (role === "synth" || role === "keys" || role === "loop") {
    return [
      { label: "Chopper", pluginId: "sweet-rhythm-chopper" },
      { label: "Chorus", pluginId: "sweet-chorus" },
      { label: "Grain", pluginId: "sweet-granular-texture" },
    ];
  }
  if (role === "fx") {
    return [
      { label: "Reverse Color", pluginId: "sweet-granular-texture" },
      { label: "Wide", pluginId: "sweet-stereo-widener" },
      { label: "Space", pluginId: "sweet-ir-space" },
    ];
  }
  return shared;
}

function getOneTapActions(role: StemRole): Array<{ label: string; pluginIds: BuiltinPluginId[] }> {
  if (role === "vocal" || role === "backingVocal") {
    return [
      { label: "Clean Vocal", pluginIds: ["sweet-de-esser", "sweet-vocal-fx"] },
      { label: "Robot Phrase", pluginIds: ["sweet-pitch-assist", "sweet-vocoder-lite"] },
      { label: "Delay Throw", pluginIds: ["sweet-delay-lite"] },
      { label: "Reverb Tail", pluginIds: ["sweet-reverb-lite"] },
    ];
  }
  if (role === "drums") {
    return [
      { label: "Punch", pluginIds: ["sweet-transient-shaper"] },
      { label: "Crush", pluginIds: ["sweet-drive"] },
      { label: "Gate Tight", pluginIds: ["sweet-gate-lite"] },
    ];
  }
  if (role === "bass") {
    return [
      { label: "Hard Bass", pluginIds: ["sweet-bass-enhancer", "sweet-drive"] },
      { label: "Mono Tight", pluginIds: ["sweet-bass-enhancer"] },
    ];
  }
  if (role === "guitar") {
    return [
      { label: "Crunch Guitar", pluginIds: ["sweet-guitar-rig"] },
      { label: "Wide Clean", pluginIds: ["sweet-guitar-amp", "sweet-chorus"] },
      { label: "Lo-Fi Amp", pluginIds: ["sweet-guitar-cab"] },
    ];
  }
  if (role === "synth" || role === "keys" || role === "loop") {
    return [
      { label: "Glitch", pluginIds: ["sweet-rhythm-chopper"] },
      { label: "Wide Pad", pluginIds: ["sweet-chorus", "sweet-stereo-widener"] },
      { label: "Filter Move", pluginIds: ["sweet-filter"] },
    ];
  }
  if (role === "fx") {
    return [
      { label: "Reverse Color", pluginIds: ["sweet-granular-texture"] },
      { label: "Big Space", pluginIds: ["sweet-reverb-lite"] },
    ];
  }
  return [{ label: "Filter Drop", pluginIds: ["sweet-filter"] }];
}

function getIntentTagSuggestions(role: StemRole) {
  const suggestions: Record<StemRole, string[]> = {
    vocal: ["hook", "verse", "phrase_end", "adlib", "whisper", "robot", "delay_throw", "reverb_tail"],
    backingVocal: ["harmony", "stack", "wide", "response", "pad_like"],
    drums: ["groove", "fill", "drop", "break", "build", "impact"],
    bass: ["sub", "drive", "drop", "groove", "transition"],
    guitar: ["riff", "cutting", "lead", "ambient", "crunch", "fill"],
    synth: ["motif", "pad", "riser", "counter_melody", "texture", "glitch"],
    keys: ["motif", "pad", "counter_melody", "texture", "support"],
    fx: ["riser", "impact", "sweep", "transition", "noise", "reverse"],
    music: ["support", "texture", "hook", "transition"],
    loop: ["groove", "variation", "build", "break"],
    other: ["texture", "support", "transition"],
    reference: ["ref", "guide"],
  };
  return suggestions[role] ?? suggestions.other;
}

function getClipSpatialPanInfo(clip: Clip) {
  const historyItem = (clip.actionHistory ?? []).find((item) => item.type === "aimixSpatialPan");
  if (!historyItem) return null;
  const role = typeof historyItem.details.role === "string" ? historyItem.details.role : clip.role;
  const template = typeof historyItem.details.template === "string" ? historyItem.details.template : "manual";
  const scene = typeof historyItem.details.scene === "string" ? historyItem.details.scene : "manual";
  return { role, template, scene };
}

function TrackOrderButton({
  label,
  disabled,
  children,
  onClick,
}: {
  label: string;
  disabled: boolean;
  children: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-daw-muted disabled:opacity-25"
    >
      {children}
    </button>
  );
}

function createCenterPanAutomation(durationSec: number, enabled: boolean): ClipPanAutomation {
  const safeDuration = Math.max(0.1, durationSec);
  return {
    enabled,
    depth: 1,
    smoothingMs: 45,
    bypassed: false,
    anchorPoints: [
      { id: createId("pan"), time: 0, pan: 0, curve: "smooth" },
      { id: createId("pan"), time: safeDuration, pan: 0, curve: "smooth" },
    ],
  };
}

function normalizePanAutomation(automation: ClipPanAutomation | undefined, durationSec: number): ClipPanAutomation {
  const safeDuration = Math.max(0.1, durationSec);
  if (!automation) {
    return createCenterPanAutomation(safeDuration, false);
  }

  const anchorPoints = automation.anchorPoints
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.pan))
    .map((point) => ({
      ...point,
      time: clampNumber(point.time, 0, safeDuration),
      pan: clampNumber(point.pan, -1, 1),
      curve: point.curve ?? "smooth",
    }))
    .sort((a, b) => a.time - b.time);

  return {
    enabled: Boolean(automation.enabled),
    depth: clampNumber(automation.depth, 0, 1),
    smoothingMs: Math.round(clampNumber(automation.smoothingMs, 0, 250)),
    bypassed: Boolean(automation.bypassed),
    anchorPoints: anchorPoints.length > 0 ? anchorPoints : createCenterPanAutomation(safeDuration, automation.enabled).anchorPoints,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0.00s";
  return `${Math.max(0, seconds).toFixed(2)}s`;
}

function formatPan(pan: number) {
  const value = clampNumber(pan, -1, 1);
  if (Math.abs(value) < 0.025) return "C";
  return value < 0 ? `L ${Math.round(Math.abs(value) * 100)}` : `R ${Math.round(value * 100)}`;
}

function summarizePanAutomation(points: PanAnchorPoint[]) {
  if (points.length === 0) {
    return {
      rangeLabel: "C",
      score: "low",
      scoreClass: "border-white/[0.08] bg-white/[0.04] text-daw-muted",
    };
  }
  const pans = points.map((point) => clampNumber(point.pan, -1, 1));
  const minPan = Math.min(...pans);
  const maxPan = Math.max(...pans);
  const avgAbsPan = pans.reduce((sum, pan) => sum + Math.abs(pan), 0) / Math.max(1, pans.length);
  const score = avgAbsPan < 0.04 ? "low" : avgAbsPan <= 0.14 ? "medium" : "high";
  return {
    rangeLabel: `${formatPan(minPan)}-${formatPan(maxPan)}`,
    score,
    scoreClass: score === "high"
      ? "border-daw-amber/30 bg-daw-amber/10 text-daw-amber"
      : score === "medium"
        ? "border-daw-cyan/25 bg-daw-cyan/10 text-daw-cyan"
        : "border-white/[0.08] bg-white/[0.04] text-daw-muted",
  };
}

/* --- Time Ruler --- */
function TimeRuler({
  durationSec,
  width,
  bpm,
}: {
  durationSec: number;
  width: number;
  bpm: number | null;
}) {
  const interval = getTickInterval(durationSec, width);
  const ticks: { sec: number; label: string; major: boolean }[] = [];

  for (let sec = 0; sec <= durationSec; sec += interval) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    ticks.push({
      sec,
      label: `${m}:${s.toString().padStart(2, "0")}`,
      major: sec % (interval * 4) < 0.001,
    });
  }

  return (
    <>
      {ticks.map((tick) => {
        const left = (tick.sec / durationSec) * 100;
        return (
          <div
            key={tick.sec}
            className="absolute top-0 flex h-full flex-col items-start"
            style={{ left: `${left}%` }}
          >
            <div className={`h-full w-px ${tick.major ? "bg-white/15" : "bg-white/8"}`} />
            {tick.major && (
              <span className="absolute top-1 ml-1 text-[9px] text-daw-muted">{tick.label}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function getTickInterval(durationSec: number, width: number): number {
  const pixelsPerSec = width / durationSec;
  if (pixelsPerSec > 100) return 0.5;
  if (pixelsPerSec > 50) return 1;
  if (pixelsPerSec > 20) return 2;
  if (pixelsPerSec > 10) return 5;
  return 10;
}

/* --- Beat Grid --- */
function BeatGrid({ durationSec, bpm }: { durationSec: number; bpm: number | null }) {
  if (!bpm || bpm <= 0) return null;

  const beatSec = 60 / bpm;
  const lines = Math.min(512, Math.floor(durationSec / beatSec) + 1);

  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: lines }, (_, i) => {
        const percent = ((i * beatSec) / durationSec) * 100;
        const isBar = i % 4 === 0;
        return (
          <div
            key={i}
            className={`absolute inset-y-0 w-px ${isBar ? "bg-white/[0.08]" : "bg-white/[0.03]"}`}
            style={{ left: `${percent}%` }}
          />
        );
      })}
    </div>
  );
}
