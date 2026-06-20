import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: "server/graphql/schema.graphqls",
  documents: "ui/src/infrastructure/vivi-api/graphql/operations/**/*.graphql",
  generates: {
    "ui/src/infrastructure/vivi-api/graphql/generated/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: { enumsAsTypes: true },
    },
  },
};

export default config;
