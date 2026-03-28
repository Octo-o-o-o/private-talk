import { defineConfig } from "vite";
import type { UserConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (
            id.includes("react-syntax-highlighter") ||
            id.includes("/languages/prism/") ||
            id.includes("/styles/prism/")
          ) {
            return "code-vendor";
          }

          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("mdast-util") ||
            id.includes("micromark")
          ) {
            return "markdown-vendor";
          }

          if (id.includes("@radix-ui")) {
            return "radix-vendor";
          }

          if (id.includes("@tauri-apps")) {
            return "tauri-vendor";
          }

          if (id.includes("react-router")) {
            return "router-vendor";
          }
        },
      },
    },
  },

  // Vitest configuration
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
} as UserConfig));
