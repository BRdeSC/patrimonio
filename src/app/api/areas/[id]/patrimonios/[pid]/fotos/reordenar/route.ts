import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canEditPatrimonio } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema, readJsonBody } from "@/lib/api";
import { storage } from "@/lib/storage";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; pid: string }> };

type Resolved =
  | { error: Response }
  | { user: SessionUser; area: AreaDetalhe; patrimonioId: number };

const reorderBodySchema = z.object({ ordem: z.array(z.number().int()) });

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

// Valida que o patrimônio existe DENTRO da área (escopo areaId — anti-IDOR).
async function patrimonioDaArea(areaId: number, patrimonioId: number) {
  return prisma.patrimonio.findFirst({
    where: { id: patrimonioId, areaId },
    select: { id: true },
  });
}

// POST /fotos/reordenar — drag & drop da galeria (OPERATOR+). Body:
// { ordem: number[] } com os fids NA NOVA ORDEM (ordem[0] = capa).
// Guarda ANTES do body (mesmo padrão das rotas vizinhas): um corpo malformado
// de não-membro de área privada continua valendo 404 de área — zero vazamento.
export async function POST(request: Request, ctx: Ctx) {
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

  const patrimonio = await patrimonioDaArea(area.id, patrimonioId);
  if (!patrimonio) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  const body = await readJsonBody(request);
  const parsed = reorderBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }

  // Conjunto exato: a lista deve conter APENAS os fids desta galeria
  // (faltas/sobras/duplicatas → false → 400 genérico, sem dizer o que falta).
  const ok = await storage.reordenar(patrimonioId, parsed.data.ordem);
  if (!ok) {
    return Response.json({ erro: "Lista de fotos inválida" }, { status: 400 });
  }

  // D8: reordenar (capa = ordem[0]) é alteração do item → registra o operador.
  await prisma.patrimonio.update({
    where: { id: patrimonioId },
    data: { atualizadoPor: user.id },
  });

  return Response.json({ ok: true });
}
