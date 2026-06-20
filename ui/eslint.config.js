import tseslint from "typescript-eslint";

const restrictedInfrastructure = {
  group: ["**/infrastructure/**"],
  message:
    "Features depend on ViviClient/domain abstractions, not infrastructure.",
};

export default tseslint.config(
  {
    files: [
      "src/features/**/*.{ts,tsx}",
      "src/application/**/*.{ts,tsx}",
      "src/domain/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/graphql/generated/**"],
              message: "Generated GraphQL types are private to the infrastructure adapter.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "dist/**",
      "storybook-static/**",
      "public/**",
      "src/infrastructure/vivi-api/graphql/generated/**",
      "src/**/*.violation.ts",
      "src/**/*.violation.tsx",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}", ".storybook/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [restrictedInfrastructure] },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use the injected ViviClient instead." },
        {
          name: "EventSource",
          message: "Workspace event transport belongs in infrastructure.",
        },
      ],
    },
  },
  {
    files: ["src/application/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message: "Application code must stay framework-free.",
            },
            {
              name: "react-dom",
              message: "Application code must stay framework-free.",
            },
          ],
          patterns: [restrictedInfrastructure],
        },
      ],
    },
  },
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "Domain code must stay framework-free." },
          ],
          patterns: [
            {
              group: [
                "**/app/**",
                "**/application/**",
                "**/features/**",
                "**/infrastructure/**",
              ],
              message: "Domain code may only depend on domain/shared modules.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure/**", "**/dto/**"],
              message: "UI components cannot depend on transport or DTO types.",
            },
          ],
        },
      ],
    },
  },
);
