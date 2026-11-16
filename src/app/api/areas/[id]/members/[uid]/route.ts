import { prisma } from "@/lib/prisma";
import { getAreaContext, canManageArea } from "@/lib/access";
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
    where: { areaId: area.id, papel: "admin_area", ativo: true },
  });
  return { user, area, usuario, membro, adminsAtivos } as const;
}

// true se a mudança tiraria da área o único admin ativo.
function tirariaUltimoAdmin(
  membro: { papel: string; ativo: boolean },
  adminsAtivos: number,
  novoPapel?: string,
  novoAtivo?: boolean,
): boolean {
  if (membro.papel !== "admin_area" || !membro.ativo || adminsAtivos !== 1) return false;
  const perdeAdmin = novoPapel !== undefined && novoPapel !== "admin_area";
  const ficaInativo = novoAtivo !== undefined && !novoAtivo;
  return perdeAdmin || ficaInativo;
}

export async function PATCH(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { membro, adminsAtivos } = resolved;

  const body = await readJsonBody(request);
  const parsed = updateMemberSchema.safeParse(body);
  if (!parsed.success) {
    // Rejeita papel=admin_area (allowlist) e campos fora do contrato.
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { papel, ativo } = parsed.data;

  if (tirariaUltimoAdmin(membro, adminsAtivos, papel, ativo)) {
    return Response.json(
      { erro: "Não é possível remover o único admin ativo. Transfira a administração primeiro." },
      { status: 400 },
    );
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

// Remove membro (admin). Auto-remoção do único admin é bloqueada.
export async function DELETE(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { membro, adminsAtivos } = resolved;

  if (membro.papel === "admin_area" && membro.ativo && adminsAtivos === 1) {
    return Response.json(
      { erro: "Não é possível remover o único admin ativo. Transfira a administração primeiro." },
      { status: 400 },
    );
  }

  await prisma.areaMembro.delete({ where: { id: membro.id } });
  return Response.json({ ok: true });
}
