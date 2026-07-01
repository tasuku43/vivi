import type { KnipConfig } from "knip";

const config: KnipConfig = {
  workspaces: {
    ".": {
      entry: [
        "scripts/**/*.mjs",
        "test/**/*.{test,spec}.{ts,tsx}",
        "test/e2e/support/**/*.ts",
        "ui/.storybook/**/*.{ts,tsx}",
        "ui/*.config.{js,ts}",
        "ui/src/main.tsx",
        "ui/src/**/*.stories.tsx",
      ],
      project: [
        "cli/typescript/**/*.ts",
        "evals/**/*.ts",
        "harness/**/*.ts",
        "scripts/**/*.mjs",
        "server/typescript/**/*.ts",
        "test/**/*.ts",
        "test/**/*.tsx",
        "ui/.storybook/**/*.{ts,tsx}",
        "ui/*.config.{js,ts}",
        "ui/src/**/*.{ts,tsx}",
        "*.config.ts",
      ],
      ignore: [
        "test/fixtures/**",
        "ui/src/**/*.violation.ts",
        "ui/src/infrastructure/vivi-api/graphql/generated/**",
      ],
      ignoreExportsUsedInFile: true,
    },
  },
};

export default config;
