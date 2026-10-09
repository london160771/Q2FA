import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  server: {
    fs: { allow: [workspaceRoot] },
    // Local-only relay: direct Arc reads failed in this workspace review
    // environment. The production bundle excludes this route and was verified
    // to call the Arc Mainnet RPC directly from Chrome.
    proxy: {
      "/arc-rpc": {
        target: "https://rpc.mainnet.arc.io",
        changeOrigin: true,
        rewrite: () => "/",
      },
    },
  },
});
