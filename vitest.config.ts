import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["./test/setup-env.ts", "./vitest.setup.ts"],
    // Suíte de integração compartilha o Postgres de teste: 1 worker, arquivos sequenciais.
    pool: "forks",
    fileParallelism: false,
  },
});
