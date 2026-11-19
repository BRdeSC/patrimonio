import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAreasForUser } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { slugify } from "@/lib/slug";
import { createAreaSchema } from "@/lib/validators/area";
import { readJsonBody } from "@/lib/api";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ erro: "Não autenticado" }, { status: 401 });
  }
  const areas = await getAreasForUser(user.id);
  return Response.json({ areas });
}

export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ erro: "Não autenticado" }, { status: 401 });
  }

  // Rate limit simples na criação de área (hardening completo no ⑤).
  const rl = rateLimit(`area-create:${getClientIp(request)}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) {
    return Response.json(
      { erro: "Muitas tentativas. Tente novamente em instantes." },
      { status: 429 },
    );
  }

  const body = await readJsonBody(request);
  const parsed = createAreaSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { nome, descricao } = parsed.data;
  const slug = slugify(nome);
  if (!slug) {
    return Response.json({ erro: "Nome de área inválido" }, { status: 400 });
  }

  const existente = await prisma.area.findUnique({ where: { slug } });
  if (existente && existente.ativo) {
    return Response.json({ erro: "Já existe uma área com esse nome" }, { status: 409 });
  }

  try {
    const area = await prisma.$transaction(async (tx) => {
      const criada = await tx.area.create({
        data: {
          nome,
          slug,
          descricao: descricao ?? null,
          // Privada por padrão (decisão travada).
          visibilidade: "privada" as const,
          criadoPor: user.id,
        },
      });
      // O autor vira responsável maior (OWNER).
      await tx.areaMembro.create({
        data: {
          areaId: criada.id,
          usuarioId: user.id,
          papel: "OWNER" as const,
          adicionadoPor: user.id,
        },
      });
      return criada;
    });
    return Response.json(
      { area: { id: area.id, nome: area.nome, slug: area.slug } },
      { status: 201 },
    );
  } catch (err) {
    // Backstop da corrida (unique slug) — mesma semântica do check acima.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ erro: "Já existe uma área com esse nome" }, { status: 409 });
    }
    throw err;
  }
}
