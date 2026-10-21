import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import { execFileSync } from "node:child_process";
import type { Plugin, ResolvedConfig } from "vite";

// Prerender the landing page into the built index.html as the last step of
// every production build, so `nx build web`, `npm run build` and Vercel's
// `npm run build:web` all produce the same output. The work happens in a
// child process (scripts/prerender-landing.mjs) because it boots its own
// Vite SSR server, which cannot run inside the build that is finishing.
function prerenderLanding(): Plugin {
  let resolved: ResolvedConfig;
  return {
    name: "loam:prerender-landing",
    apply: "build",
    configResolved(config) {
      resolved = config;
    },
    closeBundle() {
      if (process.env.LOAM_SKIP_PRERENDER) return;
      const indexPath = path.resolve(resolved.root, resolved.build.outDir, "index.html");
      execFileSync(process.execPath, [path.resolve(__dirname, "scripts/prerender-landing.mjs"), indexPath], {
        stdio: "inherit",
      });
    },
  };
}

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
    prerenderLanding(),
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
