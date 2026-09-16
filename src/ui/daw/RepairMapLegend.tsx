"use client";

import React from "react";

const BEFORE = [
  ["Low", "#06111c"],
  ["Watch", "#d7b84a"],
  ["Hot", "#e87832"],
  ["Critical", "#ef3b46"],
] as const;

const AFTER = [
  ["Clean", "#0b3c4a"],
  ["Improved", "#1f9f8a"],
  ["Still hot", "#d7b84a"],
  ["Risk", "#ef3b46"],
] as const;

const DIFF = [
  ["Improved", "#46e0a5"],
  ["Light fix", "#4aa8ff"],
  ["Unchanged", "#5b6570"],
  ["Worse", "#ef3b46"],
  ["Protect", "#7c5cff"],
  ["Over-cut", "#6d4a7c"],
] as const;

export function RepairMapLegend() {
  return (
    <div className="grid gap-2 rounded-lg border border-white/[0.06] bg-black/25 p-2 text-[9px] text-daw-muted sm:grid-cols-3">
      <LegendGroup title="Before" items={BEFORE} />
      <LegendGroup title="After" items={AFTER} />
      <LegendGroup title="Difference" items={DIFF} />
    </div>
  );
}

function LegendGroup({ title, items }: { title: string; items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div>
      <div className="mb-1 font-black uppercase tracking-wider text-daw-text">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1 rounded-md bg-white/[0.035] px-1.5 py-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
