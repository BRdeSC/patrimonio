import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canEditPatrimonio } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema } from "@/lib/api";
import { storage } from "@/lib/storage";
import { serveFoto } from "@/lib/foto";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; pid: string; fid: string }> };

type Resolved =
  | { error: Response }
  | { user: SessionUser; area: AreaDetalhe; patrimonioId: number; fotoId: number };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: Response.json({ erro: "Não autenticado" }, { status: 401 }) } as const;
  }
  const { id, pid, fid } = await ctx.params;
  const idParsed = areaIdParamSchema.safeParse(id);
  const pidParsed = areaIdParamSchema.safeParse(pid);
  const fidParsed = areaIdParamSchema.safeParse(fid);
  // fid malformado ⇒ certamente não corresponde a foto → 404 (nunca 400/500,
  // e não vaza existência de área/patrimônio).
  if (!idParsed.success || !pidParsed.success || !fidParsed.success) {
    return { error: Response.json({ erro: "Foto não encontrada" }, { status: 404 }) } as const;
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  return { user, area, patrimonioId: pidParsed.data, fotoId: fidParsed.data } as const;
}

// Valida que o patrimônio existe DENTRO da área (escopo areaId — anti-IDOR).
async function patrimonioDaArea(areaId: number, patrimonioId: number) {
  return prisma.patrimonio.findFirst({
    where: { id: patrimonioId, areaId },
    select: { id: true },
  });
}

// GET /fotos/[fid] — serve o BLOB escopado (fid AND patrimonioId). Membro/leitor.
export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { area, patrimonioId, fotoId } = resolved;
  // Não-membro de área privada → 404 idêntico ao inexistente (zero vazamento).
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }

  const patrimonio = await patrimonioDaArea(area.id, patrimonioId);
  if (!patrimonio) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  // Escopo duplo: a foto deve pertencer a ESTE patrimônio (anti-IDOR por fid).
  const foto = await storage.byId(patrimonioId, fotoId);
  if (!foto) {
    return Response.json({ erro: "Foto não encontrada" }, { status: 404 });
  }

  return serveFoto(foto.data, foto.contentType);
}

// DELETE /fotos/[fid] — remoção escopada (fid AND patrimonioId). OPERATOR+.
export async function DELETE(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { user, area, patrimonioId, fotoId } = resolved;
  // Regra 1 antes: não-membro de privada → 404 (uniforme); depois RBAC de escrita → 403.
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canEditPatrimonio(area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const patrimonio = await patrimonioDaArea(area.id, patrimonioId);
  if (!patrimonio) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  const removida = await storage.removeById(patrimonioId, fotoId);
  if (!removida) {
    return Response.json({ erro: "Foto não encontrada" }, { status: 404 });
  }

  // D8: remover foto é alteração do item → registra o operador.
  await prisma.patrimonio.update({
    where: { id: patrimonioId },
    data: { atualizadoPor: user.id },
  });

  return Response.json({ ok: true });
}
