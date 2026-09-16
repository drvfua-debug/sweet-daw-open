"use client";

import React, { useMemo } from "react";
import type { SourceId } from "@/types/soundSphere";
import { RAW_SOURCES } from "@/lib/soundSphere/weighting";

interface SoundSpherePanelProps {
  x: number;
  y: number;
  z: number;
  mutedSources: SourceId[];
  sourceWeights: Record<SourceId, number>;
}

// Visual color configuration for each source slice
const SOURCE_COLORS: Record<SourceId, { base: string; glow: string; text: string }> = {
  metal: { base: "from-zinc-500 to-zinc-800", glow: "rgba(161,161,170,0.4)", text: "#a1a1aa" },
  fire: { base: "from-orange-500 to-red-600", glow: "rgba(239,68,68,0.5)", text: "#ef4444" },
  water: { base: "from-sky-500 to-blue-700", glow: "rgba(59,130,246,0.5)", text: "#3b82f6" },
  glass: { base: "from-teal-400 to-cyan-500", glow: "rgba(6,182,212,0.5)", text: "#06b6d4" },
  wood: { base: "from-amber-600 to-yellow-800", glow: "rgba(217,119,6,0.3)", text: "#d97706" },
  stone: { base: "from-neutral-500 to-stone-700", glow: "rgba(120,113,108,0.3)", text: "#78716c" },
  electric: { base: "from-lime-400 to-emerald-600", glow: "rgba(16,185,129,0.5)", text: "#10b981" },
  air: { base: "from-indigo-300 to-violet-600", glow: "rgba(139,92,246,0.4)", text: "#8b5cf6" },
  string: { base: "from-rose-400 to-pink-600", glow: "rgba(244,63,94,0.5)", text: "#f43f5e" },
};

export const SoundSpherePanel: React.FC<SoundSpherePanelProps> = ({
  x,
  y,
  z,
  mutedSources,
  sourceWeights,
}) => {
  const width = 300;
  const height = 300;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 110;

  // Render watermelon-like divided slices
  const slices = useMemo(() => {
    const ids = Object.keys(RAW_SOURCES) as SourceId[];
    const count = ids.length;
    const angleStep = 360 / count;

    return ids.map((id, index) => {
      const source = RAW_SOURCES[id];
      const startAngle = (index * angleStep - 90) * (Math.PI / 180);
      const endAngle = ((index + 1) * angleStep - 90) * (Math.PI / 180);

      const x1 = centerX + radius * Math.cos(startAngle);
      const y1 = centerY + radius * Math.sin(startAngle);
      const x2 = centerX + radius * Math.cos(endAngle);
      const y2 = centerY + radius * Math.sin(endAngle);

      // SVG path for a sector
      const pathData = `
        M ${centerX} ${centerY}
        L ${x1} ${y1}
        A ${radius} ${radius} 0 0 1 ${x2} ${y2}
        Z
      `;

      const isMuted = mutedSources.includes(id);
      const weight = sourceWeights[id] ?? 0;
      const opacity = isMuted ? 0.05 : 0.12 + weight * 0.78;

      // Color scheme
      const colors = SOURCE_COLORS[id];

      // Calculate label coordinates
      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const labelRadius = radius + 22;
      const lx = centerX + labelRadius * Math.cos(midAngle);
      const ly = centerY + labelRadius * Math.sin(midAngle);

      return {
        id,
        pathData,
        colors,
        opacity,
        isMuted,
        lx,
        ly,
        name: source.name,
      };
    });
  }, [centerX, centerY, radius, mutedSources, sourceWeights]);

  // Translate X/Y inside unit circle
  // Positive Y goes upwards
  const dotX = centerX + x * radius;
  const dotY = centerY - y * radius;

  // Sphere dot size and glow based on Z depth [-1, 1]
  // Z = 1 => closer, larger, high glow
  // Z = -1 => deeper, smaller, low glow
  const dotRadius = 9 + (z * 4); // 5px to 13px
  const dotGlow = 14 + (z * 8);

  return (
    <div className="glass-panel relative flex flex-col items-center justify-center rounded-2xl p-4 overflow-hidden shadow-2xl">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-950/10 to-purple-950/15 pointer-events-none" />

      {/* SVG Sphere Container */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="relative z-10 drop-shadow-[0_0_20px_rgba(0,0,0,0.6)]"
      >
        <defs>
          {/* Sphere premium circular glow filter */}
          <radialGradient id="sphereBacking" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0d1527" stopOpacity="0.8" />
            <stop offset="70%" stopColor="#070c16" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#030509" stopOpacity="1.0" />
          </radialGradient>

          {/* Glowing neon dot filter */}
          <filter id="neonDotGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Sphere circular background */}
        <circle
          cx={centerX}
          cy={centerY}
          r={radius}
          fill="url(#sphereBacking)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1.5"
        />

        {/* Watermelon divisions */}
        {slices.map((slice) => (
          <g key={slice.id}>
            <path
              d={slice.pathData}
              fill={slice.isMuted ? "rgba(255,255,255,0.02)" : slice.colors.text}
              opacity={slice.opacity}
              className="transition-all duration-300 ease-out"
              stroke="rgba(0, 0, 0, 0.45)"
              strokeWidth="1"
            />
            {/* Slice separator line */}
            <line
              x1={centerX}
              y1={centerY}
              x2={slice.lx}
              y2={slice.ly}
              stroke="rgba(255,255,255,0.025)"
              strokeWidth="0.5"
            />
          </g>
        ))}

        {/* Outer orbital rings (for 3D visual projection depth) */}
        <circle
          cx={centerX}
          cy={centerY}
          r={radius - 20}
          fill="none"
          stroke="rgba(255,255,255,0.025)"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
        <circle
          cx={centerX}
          cy={centerY}
          r={radius - 50}
          fill="none"
          stroke="rgba(255,255,255,0.02)"
          strokeWidth="1"
          strokeDasharray="2 4"
        />

        {/* Source Labels */}
        {slices.map((slice) => (
          <text
            key={slice.id + "-lbl"}
            x={slice.lx}
            y={slice.ly + 4}
            fill={slice.isMuted ? "#3f3f46" : slice.colors.text}
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
            className="transition-colors duration-300 font-sans tracking-tight"
            style={{
              textShadow: slice.isMuted
                ? "none"
                : `0 0 10px ${slice.colors.glow}`,
            }}
          >
            {slice.name}
          </text>
        ))}

        {/* Dynamic Black/Glowing Dot ● */}
        <circle
          cx={dotX}
          cy={dotY}
          r={dotRadius}
          fill="#000000"
          stroke="#4dd9ff"
          strokeWidth="3.5"
          filter="url(#neonDotGlow)"
          className="transition-all duration-75 ease-out"
          style={{
            boxShadow: `0 0 ${dotGlow}px rgba(77,217,255,0.85)`,
          }}
        />

        {/* Inside target crosshairs for center reference */}
        <line x1={centerX - 5} y1={centerY} x2={centerX + 5} y2={centerY} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        <line x1={centerX} y1={centerY - 5} x2={centerX} y2={centerY + 5} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      </svg>

      {/* Aesthetic bottom coordinate tag */}
      <div className="mt-2 text-center">
        <span className="text-[10px] uppercase font-mono tracking-widest text-zinc-500">
          Position: X: {x.toFixed(2)} | Y: {y.toFixed(2)} | Z: {z.toFixed(2)}
        </span>
      </div>
    </div>
  );
};
