import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const playgroundDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(playgroundDir, "../..");

export default defineConfig({
  base: "/a2ui/",
  plugins: [react()],
  resolve: {
    alias: {
      "a2ui-core": resolve(repoRoot, "packages/a2ui-core/src"),
      "a2ui-react": resolve(repoRoot, "packages/a2ui-react/src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    exclude: ["a2ui-core", "a2ui-react"],
  },
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/a2ui-api": {
        target: process.env.A2UI_SERVER_URL ?? "http://127.0.0.1:3000",
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        rewrite: (path) => path.replace(/^\/a2ui-api/, ""),
        configure(proxy) {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            if (String(proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              res.setHeader("Cache-Control", "no-cache, no-transform");
              res.setHeader("X-Accel-Buffering", "no");
            }
          });
        },
      },
    },
  },
});
