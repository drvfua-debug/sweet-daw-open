"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Eraser, Headphones, SlidersHorizontal, Sparkles, Wand2, Volume2, VolumeX } from "lucide-react";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { STEM_ROLES, type Project, type StemRole, type Track, type VocalImageMasterState, type VocalImageTrackState } from "@/daw/model/Project";
import { VuMeter } from "@/ui/components/VuMeter";
import { PluginRack } from "@/ui/plugins/PluginRack";
import { WaveformCanvas } from "@/ui/timeline/WaveformCanvas";

type MeterUiReading = { rms: number; peak: number; clipping: boolean };

type MixConsoleProps = {
  project: Project;
  peaksByFileId: Record<string, PeakSummary>;
  positionSec: number;
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
  onSeek: (positionSec: number) => void;
  onTrackChange: (
    trackId: string,
    patch: Partial<Pick<Track, "gainDb" | "pan" | "mute" | "solo" | "name" | "role">>
  ) => void;
  onTrackVocalImageChange: (trackId: string, patch: Partial<VocalImageTrackState>) => void;
  onOpenTrackEq: (trackId: string) => void;
  onOpenTrackCharacter: (trackId: string) => void;
  onToggleTrackCompressor: (trackId: string, enabled: boolean) => void;
  onOpenTrackPluginBrowser: (trackId: string) => void;
  onOpenTrackPluginEditor: (trackId: string, pluginInstanceId: string) => void;
  onToggleTrackPlugin: (trackId: string, pluginInstanceId: string) => void;
  onMoveTrackPlugin: (trackId: string, pluginInstanceId: string, direction: "up" | "down") => void;
  onRemoveTrackPlugin: (trackId: string, pluginInstanceId: string) => void;
  onAnalyzeTrack: (trackId: string) => void;
  onClearTrackAnalysis: (trackId: string) => void;
  onRenderTrack: (
    trackId: string,
    options?: {
      includeMasterFx?: boolean;
      muteOriginal?: boolean;
      normalizePeak?: boolean;
    },
  ) => void;
  renderingTrackId?: string | null;
  onMasterGainChange: (gainDb: number) => void;
  onOpenMasterEq: () => void;
  onToggleMasterCompressor: (enabled: boolean) => void;
  onToggleMasterLimiter: (enabled: boolean) => void;
  onMasterVocalImageChange: (patch: Partial<VocalImageMasterState>) => void;
  onOpenMasterPluginBrowser: () => void;
  onOpenMasterPluginEditor: (pluginInstanceId: string) => void;
  onToggleMasterPlugin: (pluginInstanceId: string) => void;
  onMoveMasterPlugin: (pluginInstanceId: string, direction: "up" | "down") => void;
  onRemoveMasterPlugin: (pluginInstanceId: string) => void;
  meterReadings?: Record<string, MeterUiReading>;
  masterMeter?: MeterUiReading;
  transformActionsAvailable?: boolean;
};

const DEFAULT_METER: MeterUiReading = { rms: -60, peak: -60, clipping: false };

export function MixConsole({
  project,
  peaksByFileId,
  positionSec,
  selectedTrackId,
  onSelectTrack,
  onSeek,
  onTrackChange,
  onTrackVocalImageChange,
  onOpenTrackEq,
  onOpenTrackCharacter,
  onToggleTrackCompressor,
  onOpenTrackPluginBrowser,
  onOpenTrackPluginEditor,
  onToggleTrackPlugin,
  onMoveTrackPlugin,
  onRemoveTrackPlugin,
  onAnalyzeTrack,
  onClearTrackAnalysis,
  onRenderTrack,
  renderingTrackId,
  onMasterGainChange,
  onOpenMasterEq,
  onToggleMasterCompressor,
  onToggleMasterLimiter,
  onMasterVocalImageChange,
  onOpenMasterPluginBrowser,
  onOpenMasterPluginEditor,
  onToggleMasterPlugin,
  onMoveMasterPlugin,
  onRemoveMasterPlugin,
  meterReadings = {},
  masterMeter,
  transformActionsAvailable = false,
}: MixConsoleProps) {
  const channelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previewTrack = project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0] ?? null;

  useEffect(() => {
    if (!selectedTrackId) return;
    const node = channelRefs.current[selectedTrackId];
    if (!node) return;
    node.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [project.tracks.length, selectedTrackId]);

  return (
    <section className="view-enter flex h-full min-h-0 max-h-full flex-1 flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-panel">
      <div className="flex min-h-[46px] items-center justify-between border-b border-daw-line px-3 sm:px-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal size={16} className="text-daw-cyan" />
          <span>Mix</span>
        </div>
        <span className="text-[11px] text-daw-muted">{project.tracks.length} tracks</span>
      </div>

      <div className="daw-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2.5 sm:p-3">
        <SelectedTrackWaveform
          track={previewTrack}
          project={project}
          peaksByFileId={peaksByFileId}
          positionSec={positionSec}
          onSeek={onSeek}
        />

        {project.tracks.length === 0 ? (
          <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-daw-line bg-white/[0.02] px-4 text-sm text-daw-muted">
            Import audio stems to build the mix
          </div>
        ) : (
          project.tracks.map((track, index) => (
            <div
              key={track.id}
              ref={(node) => {
                channelRefs.current[track.id] = node;
              }}
            >
              <TrackMixRow
                track={track}
                index={index}
                isSelected={previewTrack?.id === track.id}
                globalVocalImageEnabled={project.master.vocalImageLayer.enabled}
                meter={meterReadings[track.id] ?? DEFAULT_METER}
                onSelect={() => onSelectTrack(track.id)}
                onChange={(patch) => onTrackChange(track.id, patch)}
                onVocalImageChange={(patch) => onTrackVocalImageChange(track.id, patch)}
                onOpenEq={() => onOpenTrackEq(track.id)}
                onOpenCharacter={() => onOpenTrackCharacter(track.id)}
                onToggleCompressor={() => onToggleTrackCompressor(track.id, !track.compressor.enabled)}
                onOpenPluginBrowser={() => onOpenTrackPluginBrowser(track.id)}
                onOpenPluginEditor={(pluginInstanceId) => onOpenTrackPluginEditor(track.id, pluginInstanceId)}
                onTogglePlugin={(pluginInstanceId) => onToggleTrackPlugin(track.id, pluginInstanceId)}
                onMovePlugin={(pluginInstanceId, direction) => onMoveTrackPlugin(track.id, pluginInstanceId, direction)}
                onRemovePlugin={(pluginInstanceId) => onRemoveTrackPlugin(track.id, pluginInstanceId)}
                onAnalyze={() => onAnalyzeTrack(track.id)}
                onClearAnalysis={() => onClearTrackAnalysis(track.id)}
                onRender={(options) => onRenderTrack(track.id, options)}
                isRendering={renderingTrackId === track.id}
                transformActionsAvailable={transformActionsAvailable}
              />
            </div>
          ))
        )}

        <MasterRow
          master={project.master}
          meter={masterMeter ?? DEFAULT_METER}
          onGainChange={onMasterGainChange}
          onOpenEq={onOpenMasterEq}
          onToggleCompressor={() => onToggleMasterCompressor(!project.master.compressor.enabled)}
          onToggleLimiter={() => onToggleMasterLimiter(!project.master.limiterEnabled)}
          onVocalImageChange={onMasterVocalImageChange}
          onOpenPluginBrowser={onOpenMasterPluginBrowser}
          onOpenPluginEditor={onOpenMasterPluginEditor}
          onTogglePlugin={onToggleMasterPlugin}
          onMovePlugin={onMoveMasterPlugin}
          onRemovePlugin={onRemoveMasterPlugin}
        />
      </div>
    </section>
  );
}

function SelectedTrackWaveform({
  track,
  project,
  peaksByFileId,
  positionSec,
  onSeek,
}: {
  track: Track | null;
  project: Project;
  peaksByFileId: Record<string, PeakSummary>;
  positionSec: number;
  onSeek: (positionSec: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const clip = track ? project.clips.find((candidate) => candidate.trackId === track.id) : null;
  const file = clip ? project.files.find((candidate) => candidate.id === clip.fileId) : null;
  const peaks = clip ? peaksByFileId[clip.fileId] : undefined;
  const minZoom = 1;
  const maxZoom = 8;
  const clipStartSec = clip?.timelineStartSec ?? 0;
  const clipEndSec = clip ? clip.timelineStartSec + clip.durationSec : Math.max(1, project.clips[0]?.durationSec ?? 1);
  const seekValue = Math.max(clipStartSec, Math.min(clipEndSec, positionSec));
  const playheadPercent = clip
    ? Math.max(0, Math.min(100, ((positionSec - clip.timelineStartSec) / Math.max(0.001, clip.durationSec)) * 100))
    : 0;
  const playheadVisible =
    Boolean(clip) &&
    positionSec >= (clip?.timelineStartSec ?? 0) &&
    positionSec <= (clip ? clip.timelineStartSec + clip.durationSec : 0);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !playheadVisible) return;

    const playheadX = (playheadPercent / 100) * scroll.scrollWidth;
    const leftEdge = scroll.scrollLeft;
    const rightEdge = leftEdge + scroll.clientWidth;
    if (playheadX < leftEdge + 24 || playheadX > rightEdge - 24) {
      scroll.scrollLeft = Math.max(0, playheadX - scroll.clientWidth * 0.5);
    }
  }, [playheadPercent, playheadVisible, zoom]);

  const setClampedZoom = useCallback((nextZoom: number) => {
    setZoom(Math.max(minZoom, Math.min(maxZoom, nextZoom)));
  }, []);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 2) return;
      pinchRef.current = {
        distance: getTouchDistance(event.touches[0], event.touches[1]),
        zoom,
      };
    },
    [zoom],
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length !== 2 || !pinchRef.current) return;
      event.preventDefault();
      const distance = getTouchDistance(event.touches[0], event.touches[1]);
      setClampedZoom(pinchRef.current.zoom * (distance / Math.max(1, pinchRef.current.distance)));
    },
    [setClampedZoom],
  );

  const handleTouchEnd = useCallback(() => {
    pinchRef.current = null;
  }, []);

  return (
    <article className="sticky top-0 z-30 rounded-xl border border-daw-line bg-[#101821]/98 p-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-md">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: track?.color ?? "#55d6ff" }} />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold">{track?.name ?? "No Track"}</h3>
            <div className="truncate text-[10px] text-daw-muted">
              {file ? `${file.durationSec.toFixed(1)}s - ${file.channelCount}ch` : "Waveform"}
            </div>
          </div>
        </div>
        <span className="timecode shrink-0 text-[10px] text-daw-muted">{positionSec.toFixed(2)}s</span>
      </div>

      <div
        ref={scrollRef}
        className="daw-scrollbar relative h-[92px] overflow-x-auto overflow-y-hidden rounded-lg border border-white/[0.05] bg-black/20"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {peaks && track ? (
          <div className="relative h-full min-w-full" style={{ width: `${zoom * 100}%` }}>
            <WaveformCanvas
              peaks={peaks}
              color={track.color}
              height={92}
              sourceStartSec={clip?.sourceStartSec}
              durationSec={clip?.durationSec}
            />
            {playheadVisible && (
              <div
                className="pointer-events-none absolute inset-y-0 w-[2px] rounded-full bg-daw-cyan shadow-glow-cyan"
                style={{ left: `${playheadPercent}%` }}
              />
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-daw-muted">No waveform</div>
        )}
      </div>

      <div className="mt-2 grid gap-2">
        <label className="flex min-w-0 items-center gap-2">
          <span className="w-10 shrink-0 text-[10px] font-bold text-daw-muted">Zoom</span>
          <input
            type="range"
            className="daw-range min-w-0 flex-1"
            min={minZoom}
            max={maxZoom}
            step={0.05}
            value={zoom}
            onChange={(event) => setClampedZoom(Number(event.target.value))}
            aria-label="Mix waveform zoom"
          />
          <span className="timecode w-[44px] shrink-0 text-right text-[10px] text-daw-text">{zoom.toFixed(1)}x</span>
        </label>

        <label className="flex min-w-0 items-center gap-2">
          <span className="w-10 shrink-0 text-[10px] font-bold text-daw-muted">Pos</span>
          <input
            type="range"
            className="daw-range min-w-0 flex-1"
            min={clipStartSec}
            max={Math.max(clipStartSec + 0.001, clipEndSec)}
            step={0.01}
            value={seekValue}
            onChange={(event) => onSeek(Number(event.target.value))}
            disabled={!clip}
            aria-label="Mix waveform playback position"
          />
          <span className="timecode w-[52px] shrink-0 text-right text-[10px] text-daw-text">{seekValue.toFixed(2)}s</span>
        </label>
      </div>
    </article>
  );
}

function getTouchDistance(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function TrackMixRow({
  track,
  index,
  isSelected,
  globalVocalImageEnabled,
  meter,
  onSelect,
  onChange,
  onVocalImageChange,
  onOpenEq,
  onOpenCharacter,
  onToggleCompressor,
  onOpenPluginBrowser,
  onOpenPluginEditor,
  onTogglePlugin,
  onMovePlugin,
  onRemovePlugin,
  onAnalyze,
  onClearAnalysis,
  onRender,
  isRendering,
  transformActionsAvailable,
}: {
  track: Track;
  index: number;
  isSelected: boolean;
  globalVocalImageEnabled: boolean;
  meter: MeterUiReading;
  onSelect: () => void;
  onChange: (patch: Partial<Pick<Track, "gainDb" | "pan" | "mute" | "solo" | "name" | "role">>) => void;
  onVocalImageChange: (patch: Partial<VocalImageTrackState>) => void;
  onOpenEq: () => void;
  onOpenCharacter: () => void;
  onToggleCompressor: () => void;
  onOpenPluginBrowser: () => void;
  onOpenPluginEditor: (pluginInstanceId: string) => void;
  onTogglePlugin: (pluginInstanceId: string) => void;
  onMovePlugin: (pluginInstanceId: string, direction: "up" | "down") => void;
  onRemovePlugin: (pluginInstanceId: string) => void;
  onAnalyze: () => void;
  onClearAnalysis: () => void;
  onRender: (options?: { includeMasterFx?: boolean; muteOriginal?: boolean; normalizePeak?: boolean }) => void;
  isRendering: boolean;
  transformActionsAvailable: boolean;
}) {
  const vocalImageSuggested = track.role === "vocal" || track.role === "backingVocal";

  return (
    <article
      className={`rounded-xl border bg-daw-panel2 p-3 shadow-[0_10px_26px_rgba(0,0,0,0.18)] ${
        isSelected ? "border-daw-cyan/70" : "border-daw-line"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onSelect} className="min-w-0 text-left" aria-label={`Show ${track.name} waveform`}>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: track.color }} />
            <span className="timecode text-[10px] text-daw-muted">T{String(index + 1).padStart(2, "0")}</span>
            <h3 className="truncate text-sm font-bold">{track.name}</h3>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-daw-muted">
            <span className="timecode">{formatDb(track.gainDb)}</span>
            <span>{formatPan(track.pan)}</span>
            <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 font-bold uppercase">{track.role}</span>
            {meter.clipping && <span className="font-bold text-daw-red">CLIP</span>}
          </div>
        </button>

        <div className="grid grid-cols-2 gap-1">
          <MixIconButton
            label={`${track.name} mute`}
            active={track.mute}
            tone="red"
            onClick={() => onChange({ mute: !track.mute })}
            icon={<VolumeX size={14} />}
          />
          <MixIconButton
            label={`${track.name} solo`}
            active={track.solo}
            tone="amber"
            onClick={() => onChange({ solo: !track.solo })}
            icon={<Headphones size={14} />}
          />
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <ControlLane label="Role" value={track.role}>
          <select
            value={track.role}
            onChange={(event) => onChange({ role: event.currentTarget.value as StemRole })}
            className="h-9 min-w-0 flex-1 rounded-lg border border-daw-line bg-daw-panel px-2 text-xs font-bold text-daw-text"
            aria-label={`${track.name} role`}
          >
            {STEM_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </ControlLane>

        <ControlLane label="Vol" value={formatDb(track.gainDb)}>
          <input
            type="range"
            className="daw-range min-w-0 flex-1"
            min={-60}
            max={12}
            step={0.5}
            value={track.gainDb}
            onChange={(event) => onChange({ gainDb: Number(event.target.value) })}
            aria-label={`${track.name} volume`}
          />
        </ControlLane>

        <ControlLane label="Pan" value={formatPan(track.pan)}>
          <input
            type="range"
            className="daw-range min-w-0 flex-1"
            min={-1}
            max={1}
            step={0.01}
            value={track.pan}
            onChange={(event) => onChange({ pan: Number(event.target.value) })}
            aria-label={`${track.name} pan`}
          />
        </ControlLane>

        <VocalImageTrackControl
          state={track.vocalImage}
          globallyEnabled={globalVocalImageEnabled}
          suggested={vocalImageSuggested}
          onChange={onVocalImageChange}
        />

        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-[10px] font-bold text-daw-muted">Meter</span>
          <div className="min-w-0 flex-1">
            <VuMeter rmsDb={meter.rms} peakDb={meter.peak} clipping={meter.clipping} width={8} height={180} orientation="horizontal" />
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-white/[0.05] pt-2">
        <PluginRack
          targetKind="track"
          eqEnabled={track.eq.enabled}
          characterEnabled={track.character.enabled}
          compressorEnabled={track.compressor.enabled}
          insertChain={track.insertChain}
          compact
          mode="rail"
          onOpenEq={onOpenEq}
          onOpenCharacter={onOpenCharacter}
          onToggleCompressor={onToggleCompressor}
          onAddPlugin={onOpenPluginBrowser}
          onEditPlugin={onOpenPluginEditor}
          onTogglePlugin={onTogglePlugin}
          onMovePlugin={onMovePlugin}
          onRemovePlugin={onRemovePlugin}
        />
      </div>

      <div className="mt-3 border-t border-white/[0.05] pt-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-daw-muted">Transform</span>
          <span className="timecode text-[10px] text-daw-muted">{track.analysis.onsetsSec.length} onsets</span>
        </div>
        {transformActionsAvailable ? (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
            <TransformButton label="Analyze" icon={<Activity size={13} />} onClick={onAnalyze} disabled={isRendering} />
            <TransformButton label="Clear" icon={<Eraser size={13} />} onClick={onClearAnalysis} disabled={isRendering || track.analysis.onsetsSec.length === 0} />
            <TransformButton label={isRendering ? "Rendering" : "Render"} icon={<Wand2 size={13} />} onClick={() => onRender()} disabled={isRendering} />
            <TransformButton label="Render+Mute" icon={<Wand2 size={13} />} onClick={() => onRender({ muteOriginal: true })} disabled={isRendering} />
            <TransformButton label="With Master" icon={<Wand2 size={13} />} onClick={() => onRender({ includeMasterFx: true })} disabled={isRendering} />
          </div>
        ) : (
          <div className="rounded-lg border border-daw-line bg-white/[0.03] px-3 py-2 text-[10px] font-semibold leading-4 text-daw-muted">
            Analyze / Render tools are coming soon. Current playback, EQ, Plug-in, AIMIX, and WAV export remain available.
          </div>
        )}
      </div>
    </article>
  );
}

function MasterRow({
  master,
  meter,
  onGainChange,
  onOpenEq,
  onToggleCompressor,
  onToggleLimiter,
  onVocalImageChange,
  onOpenPluginBrowser,
  onOpenPluginEditor,
  onTogglePlugin,
  onMovePlugin,
  onRemovePlugin,
}: {
  master: Project["master"];
  meter: MeterUiReading;
  onGainChange: (gainDb: number) => void;
  onOpenEq: () => void;
  onToggleCompressor: () => void;
  onToggleLimiter: () => void;
  onVocalImageChange: (patch: Partial<VocalImageMasterState>) => void;
  onOpenPluginBrowser: () => void;
  onOpenPluginEditor: (pluginInstanceId: string) => void;
  onTogglePlugin: (pluginInstanceId: string) => void;
  onMovePlugin: (pluginInstanceId: string, direction: "up" | "down") => void;
  onRemovePlugin: (pluginInstanceId: string) => void;
}) {
  return (
    <article className="rounded-xl border border-daw-cyan/35 bg-[#0b1820]/95 p-3 shadow-glow-cyan">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-daw-cyan">
            <Volume2 size={16} />
            <h3 className="truncate text-sm font-bold">Master Bus</h3>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-daw-muted">
            <span className="timecode">{formatDb(master.gainDb)}</span>
            <span>{master.limiterEnabled ? "Limiter on" : "Limiter off"}</span>
            {meter.clipping && <span className="font-bold text-daw-red">CLIP</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <ControlLane label="Out" value={formatDb(master.gainDb)}>
          <input
            type="range"
            className="daw-range min-w-0 flex-1"
            min={-24}
            max={6}
            step={0.5}
            value={master.gainDb}
            onChange={(event) => onGainChange(Number(event.target.value))}
            aria-label="Master output volume"
          />
        </ControlLane>

        <VocalImageMasterControl
          enabled={master.vocalImageLayer.enabled}
          onChange={(enabled) => onVocalImageChange({ enabled })}
        />

        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-[10px] font-bold text-daw-muted">Meter</span>
          <div className="min-w-0 flex-1">
            <VuMeter rmsDb={meter.rms} peakDb={meter.peak} clipping={meter.clipping} width={9} height={190} orientation="horizontal" />
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-daw-cyan/10 pt-2">
        <PluginRack
          targetKind="master"
          eqEnabled={master.eq.enabled}
          compressorEnabled={master.compressor.enabled}
          limiterEnabled={master.limiterEnabled}
          insertChain={master.insertChain}
          compact
          mode="rail"
          onOpenEq={onOpenEq}
          onToggleCompressor={onToggleCompressor}
          onToggleLimiter={onToggleLimiter}
          onAddPlugin={onOpenPluginBrowser}
          onEditPlugin={onOpenPluginEditor}
          onTogglePlugin={onTogglePlugin}
          onMovePlugin={onMovePlugin}
          onRemovePlugin={onRemovePlugin}
        />
      </div>
    </article>
  );
}

function VocalImageTrackControl({
  state,
  globallyEnabled,
  suggested,
  onChange,
}: {
  state: VocalImageTrackState;
  globallyEnabled: boolean;
  suggested: boolean;
  onChange: (patch: Partial<VocalImageTrackState>) => void;
}) {
  const active = globallyEnabled && state.enabled;
  const status = active ? "Active" : state.enabled ? "Master off" : suggested ? "Suggested" : "Off";

  return (
    <div className={`rounded-lg border p-2 ${active ? "border-daw-cyan/45 bg-daw-cyan/10" : "border-white/[0.06] bg-black/15"}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles size={13} className={active ? "text-daw-cyan" : "text-daw-muted"} />
          <div className="min-w-0">
            <div className="truncate text-[10px] font-bold uppercase tracking-wide text-daw-text">Vocal Image</div>
            <div className="truncate text-[9px] text-daw-muted">{status} · hidden support layer</div>
          </div>
        </div>
        <button
          type="button"
          className={`daw-btn !min-h-[32px] !rounded-lg px-2 text-[10px] ${state.enabled ? "daw-btn-primary" : "daw-btn-ghost"}`}
          onClick={() => onChange({ enabled: !state.enabled })}
          aria-label="Toggle Vocal Image Layer for this track"
        >
          {state.enabled ? "ON" : "OFF"}
        </button>
      </div>

      {state.enabled && (
        <div className="mt-2 grid gap-2">
          <ControlLane label="Amt" value={`${Math.round(state.amount)}%`}>
            <input
              type="range"
              className="daw-range min-w-0 flex-1"
              min={0}
              max={100}
              step={1}
              value={state.amount}
              onChange={(event) => onChange({ amount: Number(event.target.value) })}
              aria-label="Vocal Image Layer amount"
            />
          </ControlLane>
          <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_3.25rem] items-center gap-2">
            <span className="text-[10px] font-bold text-daw-muted">Dist</span>
            <select
              value={state.distance}
              onChange={(event) => onChange({ distance: event.currentTarget.value as VocalImageTrackState["distance"] })}
              className="h-8 min-w-0 rounded-lg border border-daw-line bg-daw-panel px-2 text-xs font-bold text-daw-text"
              aria-label="Vocal Image Layer distance"
            >
              <option value="close">Close</option>
              <option value="natural">Natural</option>
              <option value="wide">Wide</option>
            </select>
            <button
              type="button"
              className={`daw-btn !min-h-[32px] !rounded-lg px-1 text-[9px] ${state.monoSafety ? "daw-btn-primary" : "daw-btn-ghost"}`}
              onClick={() => onChange({ monoSafety: !state.monoSafety })}
              aria-label="Toggle Vocal Image Layer mono safety"
            >
              Mono
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VocalImageMasterControl({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className={`rounded-lg border p-2 ${enabled ? "border-daw-cyan/45 bg-daw-cyan/10" : "border-white/[0.06] bg-black/15"}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles size={13} className={enabled ? "text-daw-cyan" : "text-daw-muted"} />
          <div className="min-w-0">
            <div className="truncate text-[10px] font-bold uppercase tracking-wide text-daw-text">Vocal Image Layer</div>
            <div className="truncate text-[9px] text-daw-muted">Global gate · tracks opt in</div>
          </div>
        </div>
        <button
          type="button"
          className={`daw-btn !min-h-[32px] !rounded-lg px-2 text-[10px] ${enabled ? "daw-btn-primary" : "daw-btn-ghost"}`}
          onClick={() => onChange(!enabled)}
          aria-label="Toggle global Vocal Image Layer"
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}

function ControlLane({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="w-9 shrink-0 text-[10px] font-bold text-daw-muted">{label}</span>
      {children}
      <span className="timecode w-[52px] shrink-0 text-right text-[10px] text-daw-text">{value}</span>
    </label>
  );
}

function MixIconButton({
  label,
  icon,
  active,
  tone,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  tone: "red" | "amber";
  onClick: () => void;
}) {
  const activeClass = tone === "red" ? "border-daw-red bg-daw-red text-daw-bg" : "border-daw-amber bg-daw-amber text-daw-bg";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`daw-btn !h-10 !w-10 !min-h-10 !min-w-10 !rounded-lg text-[11px] ${active ? activeClass : "daw-btn-ghost"}`}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function TransformButton({
  label,
  icon,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="daw-btn daw-btn-ghost !min-h-[34px] justify-start !rounded-lg px-2 text-[9px] disabled:opacity-35"
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function formatDb(db: number) {
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

function formatPan(pan: number) {
  if (Math.abs(pan) < 0.005) return "C";
  return pan < 0 ? `L${Math.round(Math.abs(pan) * 100)}` : `R${Math.round(pan * 100)}`;
}
