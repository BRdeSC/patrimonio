import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canEditPatrimonio } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema, readJsonBody } from "@/lib/api";
import { updatePatrimonioSchema } from "@/lib/validators/patrimonio";
import { patrimonioResumo, SELECT_RESUMO, isUniqueViolation } from "@/lib/patrimonio";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; pid: string }> };

type Resolved =
  | { error: Response }
  | { user: SessionUser; area: AreaDetalhe; patrimonioId: number };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: Response.json({ erro: "Não autenticado" }, { status: 401 }) } as const;
  }
  const { id, pid } = await ctx.params;
  const idParsed = areaIdParamSchema.safeParse(id);
  const pidParsed = areaIdParamSchema.safeParse(pid);
  if (!idParsed.success || !pidParsed.success) {
    return { error: Response.json({ erro: "id inválido" }, { status: 400 }) } as const;
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  return { user, area, patrimonioId: pidParsed.data } as const;
}

// Detalhe (membro/leitor). 404 genérico se inexistente ou de outra área
// (escopo areaId na query — nunca vaza existência cross-tenant).
export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { area, patrimonioId } = resolved;
  // Não-membro de área privada → 404 idêntico ao inexistente (zero vazamento de existência).
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }

  const patrimonio = await prisma.patrimonio.findFirst({
    where: { id: patrimonioId, areaId: area.id },
    select: { ...SELECT_RESUMO, atualizadoPor: true },
  });
  if (!patrimonio) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }
  // Quem atualizou (D7): resolve o nome (uid/nome) — nunca o id cru.
  // O campo já é gravado na criação e em todo PATCH (user.id).
  let atualizadoPor: { uid: string; nome: string } | null = null;
  if (patrimonio.atualizadoPor !== null) {
    const autor = await prisma.usuario.findUnique({
      where: { id: patrimonio.atualizadoPor },
      select: { uid: true, nome: true },
    });
    if (autor) atualizadoPor = autor;
  }
  return Response.json({
    patrimonio: { ...patrimonioResumo(patrimonio), atualizadoPor },
  });
}

// Atualização parcial (OPERATOR+). Campos ausentes não mudam;
// null limpa o campo. numero revalida unicidade → 409.
export async function PATCH(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { user, area, patrimonioId } = resolved;
  // Regra 1 antes: não-membro de privada → 404 (uniforme); depois RBAC de escrita → 403.
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canEditPatrimonio(area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const existente = await prisma.patrimonio.findFirst({
    where: { id: patrimonioId, areaId: area.id },
  });
  if (!existente) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const parsed = updatePatrimonioSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const data = parsed.data;

  // Data construída explicitamente (só chaves presentes no body).
  const update: Prisma.PatrimonioUpdateInput = { atualizadoPor: user.id };
  if (data.numero !== undefined) update.numero = data.numero;
  if (data.descricao !== undefined) update.descricao = data.descricao;
  if (data.marca !== undefined) update.marca = data.marca;
  if (data.modelo !== undefined) update.modelo = data.modelo;
  if (data.serie !== undefined) update.serie = data.serie;
  if (data.responsavel !== undefined) update.responsavel = data.responsavel;
  if (data.detentor !== undefined) update.detentor = data.detentor;
  if (data.localizacao !== undefined) update.localizacao = data.localizacao;

  try {
    const atualizado = await prisma.patrimonio.update({
      where: { id: patrimonioId },
      data: update,
      select: SELECT_RESUMO,
    });
    // D7-1: a resposta já traz "quem atualizou" (o próprio operador — sem
    // query extra) para o campo "Atualizado por" do detalhe não sumir pós-save.
    return Response.json({
      patrimonio: {
        ...patrimonioResumo(atualizado),
        atualizadoPor: { uid: user.uid, nome: user.nome },
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json(
        { erro: "Já existe um patrimônio com esse número nesta área" },
        { status: 409 },
      );
    }
    throw err;
  }
}

// Hard delete (OPERATOR+). Foto some via cascade do schema.
export async function DELETE(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { area, patrimonioId } = resolved;
  // Regra 1 antes: não-membro de privada → 404 (uniforme); depois RBAC de escrita → 403.
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canEditPatrimonio(area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const existente = await prisma.patrimonio.findFirst({
    where: { id: patrimonioId, areaId: area.id },
  });
  if (!existente) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  await prisma.patrimonio.delete({ where: { id: patrimonioId } });
  return Response.json({ ok: true });
}
