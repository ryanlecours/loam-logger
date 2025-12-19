import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: process.env.GRAPHQL_SCHEMA_URL || "http://localhost:4000/graphql",
  documents: ["src/**/*.graphql"],
  generates: {
    "src/generated/types.ts": {
      plugins: ["typescript", "typescript-operations"]
    },
    "src/generated/hooks.ts": {
      preset: "import-types",
      plugins: ["typescript-react-apollo"],
      presetConfig: { typesPath: "./types" },
      config: { withHooks: true }
    }
  }
};

export default config;
