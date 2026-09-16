import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.codex_backups/**", "**/tmp_audio_checks/**", "**/.next/**", "**/out/**"],
  },
});
