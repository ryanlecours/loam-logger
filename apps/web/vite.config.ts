import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

export default defineConfig({
  root: __dirname,
  build: {
    sourcemap: true,
  },
  plugins: [
    tailwindcss(),
    react(),
    nxViteTsPaths(),
    sentryVitePlugin({
      org: "loam-labs-gq",
      project: "loam-logger-web",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
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
