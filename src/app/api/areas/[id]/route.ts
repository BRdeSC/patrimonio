import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canManageArea } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema, readJsonBody } from "@/lib/api";
import { slugify } from "@/lib/slug";
import { updateAreaSchema } from "@/lib/validators/area";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Union explícita: sem anotação, o TS injeta `error?: undefined` nos membros
// e o narrowing por `"error" in x` para de excluir o branch de sucesso.
type Resolved = { error: Response } | { user: SessionUser; area: AreaDetalhe };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: Response.json({ erro: "Não autenticado" }, { status: 401 }) } as const;
  }
  const idParsed = areaIdParamSchema.safeParse((await ctx.params).id);
  if (!idParsed.success) {
    return { error: Response.json({ erro: "id inválido" }, { status: 400 }) } as const;
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  return { user, area } as const;
}

export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  // Leitura: membros, ou qualquer autenticado se publica_leitura (somente leitura).
  // Não-membro de área privada → 404 idêntico ao inexistente (zero vazamento de existência).
  if (!canReadArea(resolved.area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  return Response.json({ area: resolved.area });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  // Não-membro de área privada → 404 (mesma regra do GET, classe F-1 completa).
  if (!canReadArea(resolved.area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canManageArea(resolved.area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }
  const body = await readJsonBody(request);
  const parsed = updateAreaSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { nome, descricao, visibilidade } = parsed.data;

  const data: {
    nome?: string;
    slug?: string;
    descricao?: string | null;
    visibilidade?: "privada" | "publica_leitura";
  } = {};
  if (nome !== undefined) {
    data.nome = nome;
    const slug = slugify(nome);
    if (!slug) {
      return Response.json({ erro: "Nome de área inválido" }, { status: 400 });
    }
    const colide = await prisma.area.findUnique({ where: { slug } });
    if (colide && colide.id !== resolved.area.id) {
      return Response.json({ erro: "Já existe uma área com esse nome" }, { status: 409 });
    }
    data.slug = slug;
  }
  if (descricao !== undefined) data.descricao = descricao;
  if (visibilidade !== undefined) data.visibilidade = visibilidade;

  try {
    const area = await prisma.area.update({ where: { id: resolved.area.id }, data });
    return Response.json({ area });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return Response.json({ erro: "Já existe uma área com esse nome" }, { status: 409 });
    }
    throw err;
  }
}

// Hard delete: exclui a área + cascades (membros, patrimônios, fotos) (admin).
// CASCATES já existem no schema: AreaMembro e Patrimonio → Area (onDelete: Cascade);
// PatrimonioFoto/Movimentacao → Patrimonio (Cascade). SEM migração.
export async function DELETE(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  // Não-membro de área privada → 404 (mesma regra do GET, classe F-1 completa).
  if (!canReadArea(resolved.area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canManageArea(resolved.area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }
  await prisma.area.delete({ where: { id: resolved.area.id } });
  return Response.json({ ok: true });
}
