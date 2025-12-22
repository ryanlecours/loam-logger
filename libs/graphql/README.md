# GraphQL Library

Shared GraphQL schema definitions and generated TypeScript types.

## Overview

This library contains:
- GraphQL schema definitions (`schema.graphql`)
- Generated TypeScript types (`src/generated/index.ts`)
- GraphQL codegen configuration (`codegen.ts`)

## Usage

### In the API (Server)

```typescript
import { User, Ride } from '@loam/graphql';

// Use types in resolvers
const resolvers = {
  Query: {
    user: (): User => { ... }
  }
};
```

### In Web/Mobile (Clients)

```typescript
import { useGetUserQuery } from '@loam/graphql';

// Use generated hooks in components
function UserProfile() {
  const { data, loading } = useGetUserQuery();
  // ...
}
```

## Development Workflow

### When Schema Changes

1. **Update the schema** in `schema.graphql`

2. **Start the API** (required for introspection):
   ```bash
   npm run dev:api
   ```

3. **Run codegen** to generate new types:
   ```bash
   npm run codegen
   ```

4. **Commit the generated files**:
   ```bash
   git add libs/graphql/src/generated/
   git commit -m "Update GraphQL types"
   ```

### Why Commit Generated Files?

Generated TypeScript files are committed to the repository for several reasons:

1. **CI/CD Compatibility**: Production APIs have GraphQL introspection disabled for security, so CI can't regenerate types
2. **Faster Builds**: No need to run codegen on every CI build
3. **Deterministic Builds**: Same generated code across all environments
4. **Offline Development**: Can work without running the API server

## CI/CD

The CI workflow (`/.github/workflows/ci.yml`) verifies that generated files exist but does **not** regenerate them. This is because:

- Production APIs have `introspection: false` for security
- Attempting to introspect will fail with: *"GraphQL introspection is not allowed by Apollo Server"*

### If CI Fails

If you see this error in CI:
```
❌ Error: GraphQL generated files are missing!
Run 'npm run codegen' locally and commit the generated files.
```

**Solution:**
1. Run `npm run dev:api` locally
2. Run `npm run codegen`
3. Commit the generated files
4. Push to trigger CI again

## Configuration

### Codegen Config (`codegen.ts`)

```typescript
{
  schema: process.env.GRAPHQL_SCHEMA_URL || "http://localhost:4000/graphql",
  documents: ["src/**/*.graphql"],
  generates: {
    "src/generated/index.ts": {
      plugins: ["typescript", "typescript-operations", "typescript-react-apollo"]
    }
  }
}
```

### Environment Variables

- **`GRAPHQL_SCHEMA_URL`**: GraphQL endpoint for introspection (default: `http://localhost:4000/graphql`)
  - Local: `http://localhost:4000/graphql`
  - Not used in CI (uses committed files instead)

## Project Configuration

Nx project configuration in `project.json`:

```json
{
  "targets": {
    "codegen": {
      "executor": "nx:run-commands",
      "options": {
        "command": "graphql-codegen --config codegen.ts",
        "cwd": "libs/graphql"
      }
    }
  }
}
```

## Troubleshooting

### "Introspection is not allowed"

This is expected in production. Generated files should be committed.

**Solution**: Run codegen locally against a development API with introspection enabled.

### "Cannot find module '@loam/graphql'"

The generated files might be missing.

**Solution**: Run `npm run codegen` to generate types.

### Types are out of sync with schema

You may have forgotten to run codegen after schema changes.

**Solution**:
1. Run `npm run dev:api`
2. Run `npm run codegen`
3. Commit the updated generated files

## Best Practices

1. **Run codegen after schema changes** - Always regenerate types when updating `schema.graphql`
2. **Commit generated files** - Include `src/generated/` in your commits
3. **Review generated files** - Check diffs to ensure expected changes
4. **Use local API for codegen** - Don't run codegen against production
5. **Keep schema in sync** - Ensure API and schema.graphql match

## Files in this Library

```
libs/graphql/
├── README.md                  # This file
├── codegen.ts                 # GraphQL codegen configuration
├── project.json               # Nx project configuration
├── schema.graphql             # GraphQL schema definitions
├── src/
│   ├── generated/
│   │   └── index.ts           # Generated TypeScript types (committed)
│   └── index.ts               # Library exports
└── tsconfig.json              # TypeScript configuration
```

## Related Documentation

- [GraphQL Code Generator](https://the-guild.dev/graphql/codegen)
- [Apollo Client](https://www.apollographql.com/docs/react/)
- [Apollo Server](https://www.apollographql.com/docs/apollo-server/)
