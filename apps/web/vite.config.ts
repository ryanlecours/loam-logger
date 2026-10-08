import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

// One release for runtime events and uploaded source maps: the commit SHA.
// Vercel, which builds the deployed site, provides VERCEL_GIT_COMMIT_SHA, and
// it is checked first because Vercel does not expand `$VAR` references in
// project env values: VITE_SENTRY_RELEASE arrived as the literal
// "$VERCEL_GIT_COMMIT_SHA", and the project's SENTRY_RELEASE was set up the
// same way. CI, which is not Vercel, sets SENTRY_RELEASE to the same SHA.
const sentryRelease =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE || "";

export default defineConfig({
  root: __dirname,
  define: {
    "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(sentryRelease),
  },
  build: {
    sourcemap: 'hidden',
  },
  plugins: [
    tailwindcss(),
    react(),
    nxViteTsPaths(),
    sentryVitePlugin({
      org: "loam-labs-llc",
      project: "javascript-react",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      // Same release tag the runtime uses so uploaded source maps bind to the
      // right build in Sentry.
      release: sentryRelease ? { name: sentryRelease } : undefined,
    }),
  ],
  cacheDir: path.resolve(__dirname, '../../.cache/vite/web'),
  resolve: {
    dedupe: ["react", "react-dom", "tailwindcss", "lightningcss"],
    alias: {
      "@": path.resolve(__dirname, "src")
    }
  },
  server: {
    proxy: {
      "/graphql": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
      },
      "/me": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
      },
      "/auth/garmin": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
