import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        daw: {
          bg: "#080a0f",
          panel: "#11151d",
          panel2: "#171d28",
          line: "#283142",
          text: "#f4f7fb",
          muted: "#9aa6b8",
          cyan: "#4dd9ff",
          green: "#65f0a4",
          amber: "#f4c95d",
          pink: "#ff6fa8",
          red: "#ff5f6d",
        },
      },
      boxShadow: {
        meter: "0 0 24px rgba(77, 217, 255, 0.16)",
        "glow-cyan": "0 0 28px rgba(77, 217, 255, 0.22)",
        "glow-green": "0 0 28px rgba(101, 240, 164, 0.18)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 0 rgba(77, 217, 255, 0)" },
          "50%": { boxShadow: "0 0 26px rgba(77, 217, 255, 0.28)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 1.8s ease-in-out infinite",
        "fade-in": "fade-in 180ms ease-out both",
        "slide-up": "slide-up 200ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
