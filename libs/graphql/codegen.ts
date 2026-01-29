import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * GraphQL Code Generator Configuration
 *
 * This generates TypeScript types from the GraphQL schema.
 *
 * IMPORTANT: Generated files are committed to the repository.
 * Run `npm run codegen` locally after making schema changes.
 *
 * For CI/CD: Uses committed generated files instead of introspection
 * (production APIs have introspection disabled for security).
 */
const config: CodegenConfig = {
  schema: process.env.GRAPHQL_SCHEMA_URL || "../../apps/api/src/graphql/schema.ts",
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
