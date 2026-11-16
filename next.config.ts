import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 1 imagem / 1 container stateless (decisão travada de deploy).
  output: "standalone",
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
