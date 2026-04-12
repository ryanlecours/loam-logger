import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Ensure @loam/shared resolves to the source for bundling
      "@loam/shared": path.resolve(__dirname, "../../libs/shared/src/index.ts"),
    },
  },
  build: {
    ssr: "src/server.ts",
    outDir: "../../dist/apps/api",
    target: "node18",
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
