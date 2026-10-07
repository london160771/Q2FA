import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  server: { fs: { allow: [workspaceRoot] } },
});
