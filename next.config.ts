import type { NextConfig } from "next";
import { BASE_PATH } from "./src/lib/base-path";

const nextConfig: NextConfig = {
  // 1 imagem / 1 container stateless (decisão travada de deploy).
  output: "standalone",
  // Subpath de deploy (ex.: "/patrimonio") — vazio = raiz. Build-time: o valor
  // é inlinado nos assets client (NEXT_PUBLIC_BASE_PATH do .env em dev; ARG do
  // build no Docker).
  basePath: BASE_PATH,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
