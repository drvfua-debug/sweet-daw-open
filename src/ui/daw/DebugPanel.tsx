"use client";

import { Bug } from "lucide-react";

type DebugPanelProps = {
  log: string[];
  info: Record<string, string | number | null>;
};

export function DebugPanel({ log, info }: DebugPanelProps) {
  return (
    <section className="glass-panel-sm overflow-hidden">
      <div className="flex min-h-[44px] items-center gap-2 border-b border-daw-line px-4 text-sm font-semibold text-daw-muted">
        <Bug size={16} />
        Debug
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-[240px_1fr]">
        <dl className="space-y-1.5 text-xs">
          {Object.entries(info).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 rounded-lg bg-white/[0.03] px-2.5 py-2">
              <dt className="text-daw-muted">{key}</dt>
              <dd className="text-right text-daw-text">{String(value ?? "--")}</dd>
            </div>
          ))}
        </dl>
        <div className="daw-scrollbar max-h-44 overflow-y-auto rounded-lg bg-white/[0.02] p-3 text-[11px] leading-5 text-daw-muted">
          {log.length === 0 ? (
            <p>No events yet.</p>
          ) : (
            log.map((line, i) => <p key={`${line}-${i}`}>{line}</p>)
          )}
        </div>
      </div>
    </section>
  );
}
