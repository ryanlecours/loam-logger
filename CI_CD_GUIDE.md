# CI/CD Guide - GitHub Actions

## Overview

This repository uses GitHub Actions for continuous integration with Nx monorepo optimizations.

## Workflow Configuration

**File:** `.github/workflows/ci.yml`

**Triggers:**
- Push to `main` or `dev` branches
- Pull requests to `main` or `dev` branches
- Manual trigger via `@claude review` comment on PRs

## CI Pipeline Steps

### 1. Setup
- Checkout code with full git history (for Nx affected commands)
- Set up Node.js 20 with npm cache
- Clean nested `node_modules` to prevent native dependency issues
- Install dependencies with `npm ci --include=optional`

### 2. Nx Affected Setup
- Derive base and head SHAs for Nx affected commands
- Only builds/tests/lints projects affected by changes

### 3. GraphQL Type Verification
- **Verifies** that generated GraphQL types exist
- **Does NOT** regenerate types (production APIs have introspection disabled)
- If missing, fails with instructions to run `npm run codegen` locally

### 4. Lint, Type Check, Build
- Runs in parallel (`--parallel=3`)
- Only on affected projects
- Outputs are cached by Nx

### 5. Prisma Validation
- Validates Prisma schema if API is affected
- Uses dummy DATABASE_URL for validation

### 6. Optional Claude PR Review
- Triggered manually with `@claude review` comment
- Only runs on PRs to `main` branch
- Uses Claude Haiku model for cost efficiency

## Environment Variables

### Required Secrets

**GitHub Repository Secrets** (Settings → Secrets → Actions):

None required for basic CI! The following are optional:

- **`ANTHROPIC_API_KEY`** (Optional) - For Claude PR reviews
  - Only needed if using `@claude review` feature
  - Get from: https://console.anthropic.com

### Environment Variables in Workflow

- **`DATABASE_URL`** - Set to dummy value for Prisma validation
- **`GRAPHQL_SCHEMA_URL`** - Not used (removed to prevent introspection failures)

## GraphQL Code Generation

### Important: Generated Files Are Committed

GraphQL TypeScript types are **generated locally** and **committed to the repository**.

**Why?**
- Production APIs have introspection disabled for security
- CI cannot introspect the schema to regenerate types
- Committed files ensure deterministic builds

### Workflow for Schema Changes

1. **Update schema** in `libs/graphql/schema.graphql`

2. **Start local API** (required for introspection):
   ```bash
   npm run dev:api
   ```

3. **Generate types**:
   ```bash
   npm run codegen
   ```

4. **Commit generated files**:
   ```bash
   git add libs/graphql/src/generated/
   git commit -m "Update GraphQL types"
   ```

### If CI Fails with "GraphQL introspection is not allowed"

This error should no longer occur after the fix. If you see it:

**Old Error (before fix):**
```
GraphQL introspection is not allowed by Apollo Server,
but the query contained __schema or __type.
```

**Solution:** The workflow has been updated to skip introspection and verify committed files instead.

### If CI Fails with "GraphQL generated files are missing"

**Error:**
```
❌ Error: GraphQL generated files are missing!
Run 'npm run codegen' locally and commit the generated files.
```

**Solution:**
1. Start the API: `npm run dev:api`
2. Generate types: `npm run codegen`
3. Commit: `git add libs/graphql/src/generated/ && git commit -m "Add GraphQL types"`
4. Push and CI will pass

## Nx Affected Commands

The CI uses Nx affected commands to only run tasks on changed projects.

**Example:**
```bash
# Only lints projects affected by your changes
npx nx affected -t lint --parallel=3

# Only builds affected projects
npx nx affected -t build --parallel=3
```

**Benefits:**
- Faster CI times (skip unchanged projects)
- Better resource usage
- Incremental builds

## Common CI Failures

### 1. Linting Errors

**Error:** `Linting "project" failed`

**Solution:**
```bash
# Fix locally first
npm run lint

# Or fix specific project
npx nx run mobile:lint
```

### 2. Build Errors

**Error:** `Cannot find module '@loam/graphql'`

**Solution:**
- Ensure workspace dependencies are installed: `npm install`
- Check that imports use workspace aliases correctly

### 3. Type Errors

**Error:** `Type 'X' is not assignable to type 'Y'`

**Solution:**
```bash
# Check types locally
npx nx affected -t type-check

# Fix and test
npm run build
```

### 4. Prisma Schema Validation

**Error:** `Prisma schema validation failed`

**Solution:**
```bash
# Validate locally
cd apps/api
npx prisma validate

# Format schema
npx prisma format
```

### 5. Missing Dependencies

**Error:** `Cannot find package 'xyz'`

**Solution:**
```bash
# Install dependencies
npm install

# Or specific package
npm install xyz --save-dev
```

## Local Testing Before Push

Run these commands locally to catch issues before CI:

```bash
# 1. Install dependencies
npm install

# 2. Generate GraphQL types (if schema changed)
npm run codegen

# 3. Lint all affected
npx nx affected -t lint

# 4. Build all affected
npx nx affected -t build

# 5. Validate Prisma (if API changed)
cd apps/api && npx prisma validate && cd ../..
```

## Manual CI Triggers

### Claude PR Review

To request a Claude PR review:

1. Open a pull request to `main` branch
2. Comment: `@claude review`
3. Claude will analyze and provide feedback

**Note:** Only works on PRs to `main` branch, requires `ANTHROPIC_API_KEY` secret.

## Performance Optimization

### Nx Caching

Nx caches task outputs to speed up subsequent runs:

```bash
# First run - full execution
npx nx build api
# ✔ Completed in 45s

# Second run - from cache
npx nx build api
# ✔ Cached in 0.1s
```

**Cache locations:**
- Local: `node_modules/.cache/nx`
- CI: GitHub Actions cache

### Parallel Execution

Tasks run in parallel when possible:

```bash
# Runs up to 3 projects in parallel
npx nx affected -t lint --parallel=3
```

## Troubleshooting Tips

### View Detailed Logs

Add `--verbose` to any Nx command:

```bash
npx nx affected -t build --verbose
```

### Clear Nx Cache

If builds are inconsistent:

```bash
npx nx reset
```

### Check Which Projects Are Affected

```bash
npx nx show projects --affected
```

### View Task Graph

See task dependencies:

```bash
npx nx graph
```

## Best Practices

1. **Commit Generated Files** - Always commit GraphQL generated types
2. **Test Locally First** - Run lint/build before pushing
3. **Use Affected Commands** - Leverage Nx affected for faster feedback
4. **Keep Dependencies Updated** - Regularly update packages
5. **Monitor CI Times** - Optimize if builds get slow

## Related Files

- `.github/workflows/ci.yml` - CI workflow configuration
- `nx.json` - Nx workspace configuration
- `libs/graphql/codegen.ts` - GraphQL codegen configuration
- `libs/graphql/README.md` - GraphQL library documentation

## Support

### CI Issues
- Check workflow logs in GitHub Actions tab
- Review error messages and stack traces
- Test locally with same Node.js version (20.x)

### Nx Issues
- Check [Nx Documentation](https://nx.dev)
- Run `npx nx --help` for command reference
- Use `npx nx graph` to visualize dependencies

### GraphQL Codegen Issues
- See `libs/graphql/README.md`
- Check [GraphQL Code Generator docs](https://the-guild.dev/graphql/codegen)
