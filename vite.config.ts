import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const exclude =
  process.env.VIVI_E2E === "1"
    ? ["node_modules/**", "dist/**"]
    : ["node_modules/**", "dist/**", "test/e2e/**"];

export default defineConfig({
  plugins: [react()],
  test: {
    exclude,
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: false,
    chunkSizeWarningLimit: 650,
    rolldownOptions: {
      output: {
        codeSplitting: true,
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
