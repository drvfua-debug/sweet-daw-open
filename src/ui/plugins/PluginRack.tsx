"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Gauge, Pencil, Plus, Power, Shield, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import {
  estimatePluginChainCpuScore,
  getFixedPluginsForTarget,
  getPluginCpuCost,
  getPluginCpuLabel,
  getPluginDescriptor,
} from "@/audio/plugins/pluginRegistry";
import { createPluginQualityReport, createPluginQualityReportItem } from "@/audio/plugins/pluginQualityReport";
import type { PluginInstance, PluginTargetKind } from "@/daw/model/Plugin";

type PluginRackProps = {
  targetKind: PluginTargetKind;
  eqEnabled: boolean;
  characterEnabled?: boolean;
  compressorEnabled?: boolean;
  limiterEnabled?: boolean;
  insertChain?: PluginInstance[];
  compact?: boolean;
  mode?: "stack" | "rail";
  onOpenEq: () => void;
  onOpenCharacter?: () => void;
  onToggleCompressor?: () => void;
  onToggleLimiter?: () => void;
  onAddPlugin?: () => void;
  onEditPlugin?: (pluginInstanceId: string) => void;
  onTogglePlugin?: (pluginInstanceId: string) => void;
  onMovePlugin?: (pluginInstanceId: string, direction: "up" | "down") => void;
  onRemovePlugin?: (pluginInstanceId: string) => void;
};

export function PluginRack({
  targetKind,
  eqEnabled,
  characterEnabled = false,
  compressorEnabled = false,
  limiterEnabled = false,
  insertChain = [],
  compact = false,
  mode = "stack",
  onOpenEq,
  onOpenCharacter,
  onToggleCompressor,
  onToggleLimiter,
  onAddPlugin,
  onEditPlugin,
  onTogglePlugin,
  onMovePlugin,
  onRemovePlugin,
}: PluginRackProps) {
  const plugins = getFixedPluginsForTarget(targetKind);
  const cpuScore = estimatePluginChainCpuScore(insertChain);
  const cpuLabel = getPluginCpuLabel(cpuScore);
  const qualityReport = createPluginQualityReport(insertChain.filter((plugin) => plugin.enabled));
  const visibleWarnings = qualityReport.warnings.slice(0, 2);

  return (
    <div className={mode === "rail" ? "flex w-full flex-wrap gap-1.5" : "flex w-full flex-col gap-1"}>
      {plugins.map((plugin) => {
        if (plugin.id === "sweet-parametric-eq") {
          return (
            <PluginButton
              key={plugin.id}
              label={compact ? "EQ" : plugin.shortName}
              active={eqEnabled}
              icon={<SlidersHorizontal size={13} />}
              mode={mode}
              onClick={onOpenEq}
              ariaLabel={`Open ${plugin.name}`}
            />
          );
        }

        if (plugin.id === "sweet-compressor") {
          return (
            <PluginButton
              key={plugin.id}
              label={compact ? "CP" : plugin.shortName}
              active={compressorEnabled}
              icon={<Gauge size={13} />}
              mode={mode}
              onClick={onToggleCompressor}
              ariaLabel={`Toggle ${plugin.name}`}
            />
          );
        }

        if (plugin.id === "sweet-character") {
          return (
            <PluginButton
              key={plugin.id}
              label={compact ? "TN" : plugin.shortName}
              active={characterEnabled}
              icon={<Sparkles size={13} />}
              mode={mode}
              onClick={onOpenCharacter}
              ariaLabel={`Open ${plugin.name}`}
            />
          );
        }

        return (
          <PluginButton
            key={plugin.id}
            label={compact ? "LM" : plugin.shortName}
            active={limiterEnabled}
            icon={<Shield size={13} />}
            mode={mode}
            onClick={onToggleLimiter}
            ariaLabel={`Toggle ${plugin.name}`}
          />
        );
      })}

      {insertChain.map((plugin, index) => (
        <InsertedPluginSlot
          key={plugin.id}
          plugin={plugin}
          index={index}
          count={insertChain.length}
          compact={compact}
          mode={mode}
          onEdit={() => onEditPlugin?.(plugin.id)}
          onToggle={() => onTogglePlugin?.(plugin.id)}
          onMove={(direction) => onMovePlugin?.(plugin.id, direction)}
          onRemove={() => onRemovePlugin?.(plugin.id)}
        />
      ))}

      {insertChain.length > 0 && (
        <div
          className={`rounded-lg border border-daw-line bg-white/[0.025] px-2 py-1.5 ${
            mode === "rail" ? "min-w-[116px] flex-1" : ""
          }`}
          title="Estimated insert plug-in load"
        >
          <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-bold text-daw-muted">
            <span>Load</span>
            <span className={getLoadTextClass(cpuLabel)}>{cpuLabel}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full ${getLoadBarClass(cpuLabel)}`}
              style={{ width: `${Math.min(100, Math.max(8, cpuScore * 12.5))}%` }}
            />
          </div>
          {cpuLabel === "High" && (
            <div className="mt-1 text-[9px] font-semibold text-amber-200">Freeze/Render recommended</div>
          )}
          {qualityReport.masterRiskCount > 0 && (
            <div className="mt-1 text-[9px] font-semibold text-amber-200">Master insert caution {qualityReport.masterRiskCount}</div>
          )}
        </div>
      )}

      {visibleWarnings.length > 0 && (
        <div
          className={`rounded-lg border px-2 py-1.5 text-[9px] font-semibold leading-3 ${
            mode === "rail" ? "min-w-[160px] flex-1" : ""
          } ${
            qualityReport.warnings.length >= 3
              ? "border-daw-red/25 bg-daw-red/10 text-daw-red"
              : "border-daw-amber/25 bg-daw-amber/10 text-daw-amber"
          }`}
          title={qualityReport.warnings.join("\n")}
        >
          <div className="mb-1 flex items-center gap-1 font-black uppercase tracking-wide">
            <AlertTriangle size={11} />
            Quality Guard
          </div>
          {visibleWarnings.map((warning) => (
            <div key={warning} className="truncate">{warning}</div>
          ))}
          {qualityReport.warnings.length > visibleWarnings.length && (
            <div>+{qualityReport.warnings.length - visibleWarnings.length} more</div>
          )}
        </div>
      )}

      {onAddPlugin && (
        <button
          type="button"
          onClick={onAddPlugin}
          className={`daw-btn daw-btn-ghost !min-h-[32px] justify-start !rounded-lg px-2 text-[9px] ${
            mode === "rail" ? "w-auto flex-1 basis-[84px]" : "w-full"
          }`}
          aria-label={`Add ${targetKind} plug-in`}
          title={`Add ${targetKind} plug-in`}
        >
          <Plus size={13} />
          <span>{compact ? "ADD" : "Add Plugin"}</span>
        </button>
      )}
    </div>
  );
}

function InsertedPluginSlot({
  plugin,
  index,
  count,
  compact,
  mode,
  onEdit,
  onToggle,
  onMove,
  onRemove,
}: {
  plugin: PluginInstance;
  index: number;
  count: number;
  compact: boolean;
  mode: "stack" | "rail";
  onEdit: () => void;
  onToggle: () => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const descriptor = getPluginDescriptor(plugin.pluginId);
  const label = descriptor?.shortName ?? plugin.name;
  const load = getPluginCpuCost(plugin.pluginId);
  const quality = createPluginQualityReportItem(plugin);
  const hasWarnings = quality.warnings.length > 0;
  const warningTone = quality.severity === "danger" ? "text-daw-red" : "text-daw-amber";

  return (
    <div
      className={`rounded-lg border px-1.5 py-1 ${
        mode === "rail" ? "min-w-[116px] flex-1" : ""
      } ${
        plugin.enabled
          ? "border-daw-green/35 bg-daw-green/10 text-daw-green"
          : "border-daw-line bg-white/[0.02] text-daw-muted"
      }`}
    >
      <button
        type="button"
        onClick={onEdit}
        className="flex min-h-[28px] w-full min-w-0 items-center justify-start gap-1.5 text-left text-[9px] font-bold"
        aria-label={`Edit ${plugin.name}`}
        title={`Edit ${plugin.name}`}
      >
        <Pencil size={11} />
        <span className="truncate">{compact ? label : plugin.name}</span>
        {hasWarnings && <AlertTriangle size={10} className={`shrink-0 ${warningTone}`} />}
        <span className="ml-auto shrink-0 text-[8px] uppercase text-daw-muted">{load}</span>
      </button>
      {hasWarnings && (
        <div className={`mt-1 truncate text-[8px] font-semibold ${warningTone}`} title={quality.warnings.join("\n")}>
          {quality.warnings[0]}
        </div>
      )}
      <div className="mt-1 grid grid-cols-4 gap-1">
        <SlotIconButton
          label={plugin.enabled ? "Bypass" : "Enable"}
          onClick={onToggle}
          active={plugin.enabled}
          icon={<Power size={11} />}
        />
        <SlotIconButton
          label="Move up"
          onClick={() => onMove("up")}
          disabled={index === 0}
          icon={<ArrowUp size={11} />}
        />
        <SlotIconButton
          label="Move down"
          onClick={() => onMove("down")}
          disabled={index === count - 1}
          icon={<ArrowDown size={11} />}
        />
        <SlotIconButton
          label="Remove"
          onClick={onRemove}
          danger
          icon={<Trash2 size={11} />}
        />
      </div>
    </div>
  );
}

function SlotIconButton({
  label,
  icon,
  active = false,
  danger = false,
  disabled = false,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`grid min-h-[24px] place-items-center rounded-md border text-[9px] ${
        active
          ? "border-daw-green/40 bg-daw-green/15 text-daw-green"
          : danger
            ? "border-daw-red/25 bg-daw-red/10 text-daw-red"
            : "border-daw-line bg-daw-panel text-daw-muted"
      } disabled:opacity-35`}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function getLoadTextClass(label: string) {
  if (label === "High") return "text-daw-red";
  if (label === "Medium") return "text-daw-amber";
  return "text-daw-green";
}

function getLoadBarClass(label: string) {
  if (label === "High") return "bg-daw-red";
  if (label === "Medium") return "bg-daw-amber";
  return "bg-daw-green";
}

function PluginButton({
  label,
  icon,
  active,
  onClick,
  ariaLabel,
  mode,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick?: () => void;
  ariaLabel: string;
  mode: "stack" | "rail";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`daw-btn !min-h-[32px] justify-start !rounded-lg px-2 text-[9px] ${
        mode === "rail" ? "w-auto flex-1 basis-[66px]" : "w-full"
      } ${
        active ? "border-daw-cyan/40 bg-daw-cyan/15 text-daw-cyan" : "daw-btn-ghost"
      } disabled:cursor-not-allowed disabled:opacity-40`}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
