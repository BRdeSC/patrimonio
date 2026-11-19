// Constantes e helper compartilhados pelas rotas de foto (pacote ③-B: N fotos).
// Validação server-side — o client NUNCA é confiado; a rota revalida tudo.

// Allowlist explícita de tipos aceitos (anti upload arbitrário).
export const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;

// Limite de tamanho por arquivo.
export const TAMANHO_MAX = 5 * 1024 * 1024; // 5MB

// Limite de fotos por patrimônio (máx).
export const LIMITE_FOTOS = 10;

// Mensagens de erro fixas (paridade com o ③; sem vazamento de internals).
export const ERRO_FORMATO = "Formato não permitido (use JPEG, PNG ou WebP)";
export const ERRO_TAMANHO = "Foto maior que 5MB";
export const ERRO_CAMPO_AUSENTE = "Campo 'foto' ausente";
export const ERRO_ARQUIVO_INVALIDO = "Arquivo inválido";
export const ERRO_LIMITE = `Limite de ${LIMITE_FOTOS} fotos por patrimônio`;

// Headers de serving de BLOB. GET /fotos/[fid] mantém o padrão (bytes imutáveis →
// cacheável). GET /foto (capa) passa "no-cache": a capa muda a cada
// add/remover/reordenar, e a lista de itens deve refletir a troca para TODOS os
// usuários sem esperar o fim do max-age (D9).
export function serveFoto(
  data: Uint8Array,
  contentType: string,
  cacheControl = "private, max-age=300",
): Response {
  // Cópia em ArrayBuffer: BodyInit do TS 5.7+ exige Uint8Array<ArrayBuffer>.
  const bytes = new Uint8Array(data);
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
    },
  });
}
