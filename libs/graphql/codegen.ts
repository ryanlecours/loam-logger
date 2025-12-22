import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: process.env.GRAPHQL_SCHEMA_URL || "http://localhost:4000/graphql",
  documents: ["src/**/*.graphql"],
  generates: {
    "src/generated/index.ts": {
      plugins: [
        "typescript",
        "typescript-operations",
        "typescript-react-apollo"
      ],
      config: {
        withHooks: true,
        withComponent: false,
        withHOC: false
      }
    }
  }
};

export default config;
