"use client";

import { FolderOpen, Layers, ScanSearch, SlidersHorizontal } from "lucide-react";
import type { ActiveView } from "@/daw/store/dawStore";

type BottomNavProps = {
  activeView: ActiveView;
  onViewChange: (view: ActiveView) => void;
  trackCount: number;
};

const tabs: { view: ActiveView; label: string; icon: typeof Layers }[] = [
  { view: "arrange", label: "Arrange", icon: Layers },
  { view: "mix", label: "Mix", icon: SlidersHorizontal },
  { view: "files", label: "Files", icon: FolderOpen },
];

export function BottomNav({ activeView, onViewChange, trackCount }: BottomNavProps) {
  return (
    <nav className="border-b border-white/[0.05] bg-daw-bg/96 px-2 py-1.5 backdrop-blur-md">
      <div className="mx-auto grid w-full max-w-3xl grid-cols-4 gap-1 rounded-xl border border-daw-line bg-daw-panel2 p-1">
        {tabs.map(({ view, label, icon: Icon }) => {
          const active = activeView === view;
          return (
            <button
              key={view}
              type="button"
              onClick={() => onViewChange(view)}
              className={`relative flex min-h-[38px] min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold transition-colors duration-150 ${
                active ? "bg-daw-cyan/12 text-daw-cyan shadow-glow-cyan" : "text-daw-muted"
              }`}
              aria-label={label}
              aria-current={active ? "page" : undefined}
            >
              <div className="relative">
                <Icon size={17} strokeWidth={active ? 2.2 : 1.6} />
                {view === "mix" && trackCount > 0 && (
                  <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-daw-cyan px-1 text-[10px] font-bold text-daw-bg">
                    {trackCount}
                  </span>
                )}
              </div>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}


