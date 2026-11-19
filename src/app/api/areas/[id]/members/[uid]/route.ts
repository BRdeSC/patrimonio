import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canManageArea } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema, readJsonBody } from "@/lib/api";
import { updateMemberSchema } from "@/lib/validators/member";
import type { AreaMembro, Usuario } from "@prisma/client";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; uid: string }> };

type Resolved =
  | { error: Response }
  | {
      user: SessionUser;
      area: AreaDetalhe;
      usuario: Usuario;
      membro: AreaMembro;
      adminsAtivos: number;
    };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: Response.json({ erro: "Não autenticado" }, { status: 401 }) } as const;
  }
  const { id, uid } = await ctx.params;
  const idParsed = areaIdParamSchema.safeParse(id);
  if (!idParsed.success) {
    return { error: Response.json({ erro: "id inválido" }, { status: 400 }) } as const;
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  // Não-membro de área privada → 404 (classe F-1), antes do check de escrita.
  if (!canReadArea(area)) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  if (!canManageArea(area.papel)) {
    return { error: Response.json({ erro: "Acesso negado" }, { status: 403 }) } as const;
  }
  const usuario = await prisma.usuario.findUnique({ where: { uid } });
  if (!usuario) {
    return {
      error: Response.json({ erro: "Membro não encontrado" }, { status: 404 }),
    } as const;
  }
  const membro = await prisma.areaMembro.findUnique({
    where: { areaId_usuarioId: { areaId: area.id, usuarioId: usuario.id } },
  });
  if (!membro) {
    return {
      error: Response.json({ erro: "Membro não encontrado" }, { status: 404 }),
    } as const;
  }
  const adminsAtivos = await prisma.areaMembro.count({
    where: { areaId: area.id, papel: "OWNER", ativo: true },
  });
  return { user, area, usuario, membro, adminsAtivos } as const;
}

// Mensagem única do guard do último OWNER (sem vazar internals).
const ERRO_ULTIMO_OWNER = "A área precisa ter ao menos um OWNER";

// true se a mudança deixaria a área sem nenhum OWNER ativo
// ("último OWNER" = count de membros ativos com papel OWNER == 1).
function tirariaUltimoOwner(
  membro: { papel: string; ativo: boolean },
  ownersAtivos: number,
  novoPapel?: string,
  novoAtivo?: boolean,
): boolean {
  if (membro.papel !== "OWNER" || !membro.ativo || ownersAtivos !== 1) return false;
  const perdePapel = novoPapel !== undefined && novoPapel !== "OWNER";
  const ficaInativo = novoAtivo !== undefined && !novoAtivo;
  return perdePapel || ficaInativo;
}

export async function PATCH(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { membro, adminsAtivos } = resolved;

  const body = await readJsonBody(request);
  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) {
    // Rejeita papéis fora do enum e campos fora do contrato.
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { papel, ativo } = parsed.data;

  // Guard do último OWNER: demover/desativar o ÚNICO OWNER ativo → 409.
  if (tirariaUltimoOwner(membro, adminsAtivos, papel, ativo)) {
    return Response.json({ erro: ERRO_ULTIMO_OWNER }, { status: 409 });
  }

  const atualizado = await prisma.areaMembro.update({
    where: { id: membro.id },
    data: { ...(papel !== undefined ? { papel } : {}), ...(ativo !== undefined ? { ativo } : {}) },
  });
  return Response.json({
    membro: {
      uid: resolved.usuario.uid,
      nome: resolved.usuario.nome,
      papel: atualizado.papel,
      ativo: atualizado.ativo,
    },
  });
}

// Remove membro (OWNER). A remoção do ÚNICO OWNER ativo é bloqueada (guard 409).
export async function DELETE(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { membro, adminsAtivos } = resolved;

  // Guard do último OWNER: a remoção do ÚNICO OWNER ativo → 409.
  if (membro.papel === "OWNER" && membro.ativo && adminsAtivos === 1) {
    return Response.json({ erro: ERRO_ULTIMO_OWNER }, { status: 409 });
  }

  await prisma.areaMembro.delete({ where: { id: membro.id } });
  return Response.json({ ok: true });
}
