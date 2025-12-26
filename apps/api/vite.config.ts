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
    ssr: "src/server.ts",         // your entry file
    outDir: "../../dist/apps/api",
    target: "node18",
    rollupOptions: {
      external: [
        // keep native/binary deps and prisma external
        "@prisma/client",
        "prisma",
      ],
      output: {
        // CommonJS is simplest for Node start
        format: "cjs",
        entryFileNames: "server.cjs",
      },
    },
  },
});
