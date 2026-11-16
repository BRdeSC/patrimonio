import { prisma } from "@/lib/prisma";
import { getIpaProvider } from "@/lib/ipa";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { buildSetCookie, createSession } from "@/lib/session";
import { getAreasForUser } from "@/lib/access";
import { loginSchema } from "@/lib/validators/auth";
import { readJsonBody } from "@/lib/api";

export async function POST(request: Request) {
  const body = await readJsonBody(request);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { uid, senha } = parsed.data;

  // Rate limit simples: 5 tentativas / 15min por IP+uid (hardening completo no ⑤).
  const rl = rateLimit(`login:${getClientIp(request)}:${uid.toLowerCase()}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return Response.json(
      { erro: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  // FreeIPA autentica (IdP). Falha -> 401 genérico (anti enumeração).
  const identity = await getIpaProvider().authenticate(uid, senha);
  if (!identity) {
    return Response.json({ erro: "Credenciais inválidas" }, { status: 401 });
  }

  // JIT upsert: FreeIPA é a fonte de verdade da identidade.
  const user = await prisma.usuario.upsert({
    where: { uid: identity.uid },
    update: {
      nome: identity.nome,
      email: identity.email,
      dn: identity.dn,
      ultimoLogin: new Date(),
      ativo: true,
    },
    create: {
      uid: identity.uid,
      nome: identity.nome,
      email: identity.email,
      dn: identity.dn,
      ultimoLogin: new Date(),
    },
  });

  const token = await createSession(user.id);
  const areas = await getAreasForUser(user.id);

  const response = Response.json({
    user: {
      uid: user.uid,
      nome: user.nome,
      email: user.email,
      areas: areas.map((a) => ({ id: a.id, nome: a.nome, papel: a.papel })),
    },
  });
  response.headers.set("set-cookie", buildSetCookie(token));
  return response;
}
