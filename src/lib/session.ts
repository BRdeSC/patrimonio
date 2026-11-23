import { createHmac, randomBytes } from "node:crypto";
import type { SessionUser } from "@/lib/types";
import { BASE_PATH } from "./base-path";
import { prisma } from "./prisma";

// Sessão: token aleatório no cookie, hash (HMAC-SHA256 com SESSION_SECRET)
// persistido em SESSAO — revogável (basta apagar a linha no Postgres).
export const SESSION_COOKIE = "patrimonio_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8h

export function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET ?? "dev-fallback-nao-usar-em-producao";
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function secureCookie(): boolean {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").startsWith("https");
}

// Monta o valor do header Set-Cookie (funciona com Response nativo e em testes).
export function buildSetCookie(token: string | null): string {
  const parts: string[] = [
    token
      ? `${SESSION_COOKIE}=${encodeURIComponent(token)}`
      // Delete: Path=/ (raiz) limpa cookies definidos em subpath (Path=/patrimonio).
      : `${SESSION_COOKIE}=; Max-Age=0; Path=/`,
    // Sessão escopada ao subpath do app (compartilha de host → cookie não vaza
    // para outros paths). Sem subpath = Path=/ (comportamento anterior).
    `Path=${BASE_PATH || "/"}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (token) parts.push(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  if (secureCookie()) parts.push("Secure");
  return parts.join("; ");
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  // Limpeza preguiçosa de sessões expiradas (mantém a tabela enxuta).
  await prisma.sessao.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.sessao.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
  });
  return token;
}

export async function getSessionUserByToken(
  token: string | null | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const sessao = await prisma.sessao.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { usuario: true },
  });
  if (!sessao) return null;
  if (sessao.expiresAt.getTime() < Date.now()) {
    await prisma.sessao.delete({ where: { id: sessao.id } });
    return null;
  }
  if (!sessao.usuario.ativo) return null;
  return {
    id: sessao.usuario.id,
    uid: sessao.usuario.uid,
    nome: sessao.usuario.nome,
    email: sessao.usuario.email,
  };
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  return getSessionUserByToken(token);
}

export async function destroySession(request: Request): Promise<void> {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return;
  await prisma.sessao.deleteMany({ where: { tokenHash: hashToken(token) } });
}
