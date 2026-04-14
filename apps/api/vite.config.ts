import { defineConfig } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Ensure @loam/shared resolves to the source for bundling
      "@loam/shared": path.resolve(__dirname, "../../libs/shared/src/index.ts"),
    },
  },
  plugins: [
    sentryVitePlugin({
      org: "loam-labs-llc",
      project: "node",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // No-op locally without the token, same as the web config.
      disable: !process.env.SENTRY_AUTH_TOKEN,
      release: process.env.SENTRY_RELEASE
        ? { name: process.env.SENTRY_RELEASE }
        : undefined,
      // Bound scope to the server bundle + its sourcemap.
      sourcemaps: {
        assets: ["../../dist/apps/api/**/*.cjs", "../../dist/apps/api/**/*.map"],
      },
    }),
  ],
  build: {
    ssr: "src/server.ts",
    outDir: "../../dist/apps/api",
    target: "node18",
    // Emit source maps so Sentry can symbolicate production stack traces.
    // 'hidden' means no //# sourceMappingURL comment in the built server.cjs —
    // maps still land in dist/ and get uploaded to Sentry but aren't served
    // publicly.
    sourcemap: "hidden",
    rollupOptions: {
      external: [
        // keep native/binary deps and prisma external
        "@prisma/client",
        "prisma",
        // Sentry and Express must be external so Sentry's OpenTelemetry
        // monkey-patching can instrument Express at require() time
        "@sentry/node",
        "express",
      ],
      output: {
        // CommonJS is simplest for Node start
        format: "cjs",
        entryFileNames: "server.cjs",
        // Bundle everything into single file - no code splitting for SSR
        // Prevents "Cannot find module ./assets/index-*.js" errors in production
        codeSplitting: false,
      },
    },
  },
});
