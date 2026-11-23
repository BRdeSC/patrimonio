// Subpath sob o qual o app é servido (ex.: "/patrimonio").
// Fonte única para o next.config.ts (basePath) e para o client (prefixo das
// chamadas fetch/URL que o Next não prefixa sozinho). NEXT_PUBLIC_* → o valor
// é inlinado no bundle no build (em dev, lido do .env; no Docker, via ARG).
// Aceita "", "patrimonio", "/patrimonio" ou "/patrimonio/" → "/patrimonio".
const raw = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();

export const BASE_PATH = raw ? `/${raw.replace(/^\/+|\/+$/g, "")}` : "";
