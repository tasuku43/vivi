import { defineConfig } from "vitest/config";

const exclude =
  process.env.VIVI_E2E === "1"
    ? [
        "node_modules/**",
        "dist/**",
        "ui/dist/**",
        "ui/storybook-static/**",
        ".tmp-go-build-cache/**",
        ".tmp-go-mod-cache/**",
      ]
    : [
        "node_modules/**",
        "dist/**",
        "ui/dist/**",
        "ui/storybook-static/**",
        ".tmp-go-build-cache/**",
        ".tmp-go-mod-cache/**",
        "test/e2e/**",
      ];

export default defineConfig({ test: { exclude } });
