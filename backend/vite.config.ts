import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/server.ts",         // your entry file
    outDir: "dist",
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
