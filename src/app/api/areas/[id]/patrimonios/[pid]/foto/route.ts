import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema } from "@/lib/api";
import { storage } from "@/lib/storage";
import { serveFoto } from "@/lib/foto";
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

// Valida que o patrimônio existe DENTRO da área (escopo areaId — anti-IDOR).
async function patrimonioDaArea(areaId: number, patrimonioId: number) {
  return prisma.patrimonio.findFirst({
    where: { id: patrimonioId, areaId },
    select: { id: true },
  });
}

// GET /foto — URL inalterada (lista/detalhe seguem funcionando).
// Agora serve a CAPA (1ª foto enviada, menor id). Membro/leitor.
// O id vem só do param da rota — nunca de input.
export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { area, patrimonioId } = resolved;
  // Não-membro de área privada → 404 idêntico ao inexistente (zero vazamento de existência).
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }

  const patrimonio = await patrimonioDaArea(area.id, patrimonioId);
  if (!patrimonio) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  const capa = await storage.cover(patrimonioId);
  if (!capa) {
    return Response.json({ erro: "Foto não encontrada" }, { status: 404 });
  }

  // D9: no-cache (sem ETag → revalida = re-baixa) — a capa muda com a galeria;
  // com max-age=300 outros usuários viam a capa antiga por até 5 min após troca.
  return serveFoto(capa.data, capa.contentType, "no-cache");
}
