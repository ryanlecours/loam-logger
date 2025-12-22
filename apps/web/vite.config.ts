import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nxViteTsPaths } from "@nx/vite/plugins/nx-tsconfig-paths.plugin";
import path from "path";

export default defineConfig({
  root: __dirname,
  plugins: [tailwindcss(), react(), nxViteTsPaths()],
  cacheDir: path.resolve(__dirname, '../../.cache/vite/web'),
  resolve: {
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
