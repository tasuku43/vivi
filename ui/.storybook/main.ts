import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  viteFinal(config) {
    config.build = {
      ...config.build,
      // Storybook's manager, docs, and a11y runtime are tooling-only bundles.
      // The production UI keeps its stricter 650 kB threshold in vite.config.ts.
      chunkSizeWarningLimit: 1_200,
    };
    return config;
  },
};

export default config;
