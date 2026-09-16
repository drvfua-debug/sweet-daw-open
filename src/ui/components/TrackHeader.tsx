"use client";

type TrackHeaderProps = {
  name: string;
  color: string;
  info?: string;
  compact?: boolean;
  selected?: boolean;
  onTap?: () => void;
};

export function TrackHeader({ name, color, info, compact = false, selected = false, onTap }: TrackHeaderProps) {
  return (
    <button
      type="button"
      onClick={onTap}
      className={`flex items-center gap-2 rounded-xl border px-3 text-left transition-all duration-150 ${
        compact ? "min-h-[44px]" : "min-h-[52px]"
      } ${
        selected
          ? "border-daw-cyan/40 bg-daw-cyan/8 shadow-glow-cyan"
          : "border-daw-line bg-daw-panel2 active:bg-white/[0.06]"
      }`}
    >
      <span
        className={`shrink-0 rounded-full ${compact ? "h-2.5 w-2.5" : "h-3 w-3"}`}
        style={{ background: color }}
      />
      <div className="min-w-0 flex-1">
        <div className={`truncate font-semibold ${compact ? "text-xs" : "text-sm"}`}>{name}</div>
        {info && !compact && (
          <div className="truncate text-[11px] text-daw-muted">{info}</div>
        )}
      </div>
    </button>
  );
}
