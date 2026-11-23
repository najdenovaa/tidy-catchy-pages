import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

let appVersion = process.env.GITHUB_SHA || "development";
try { appVersion = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(); } catch { /* source archive */ }

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion) },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/__l5e/assets-v1": {
        target: "https://deallsoft.ru",
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react-router-dom"],
  },
}));
