import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canManageArea } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema, readJsonBody } from "@/lib/api";
import { addMemberSchema } from "@/lib/validators/member";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

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

// Lista membros (visível para membros da área).
export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  // Não-membro de área privada → 404 (classe F-1); leitor público → 403
  // (a lista de membros nunca é pública).
  if (!canReadArea(resolved.area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!resolved.area.isMember) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }
  const membros = await prisma.areaMembro.findMany({
    where: { areaId: resolved.area.id },
    include: { usuario: true },
    orderBy: { papel: "asc" },
  });
  return Response.json({
    membros: membros.map((m) => ({
      uid: m.usuario.uid,
      nome: m.usuario.nome,
      papel: m.papel,
      ativo: m.ativo,
    })),
  });
}

// Adiciona membro (OWNER). papel: OWNER|OPERATOR|VIEWER (allowlist).
// Usuário inexistente -> JIT placeholder.
export async function POST(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  // Não-membro de área privada → 404 (classe F-1).
  if (!canReadArea(resolved.area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canManageArea(resolved.area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }
  const user: SessionUser = resolved.user;

  const body = await readJsonBody(request);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    // Inclui papéis fora do enum — anti mass-assignment.
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { uid, papel } = parsed.data;

  const usuario = await prisma.usuario.upsert({
    where: { uid },
    // Placeholder: sem nome/email/dn até o primeiro login (JIT).
    update: {},
    create: { uid, nome: uid },
  });

  const membro = await prisma.areaMembro.upsert({
    where: { areaId_usuarioId: { areaId: resolved.area.id, usuarioId: usuario.id } },
    // Membro inativo -> reativado com o papel informado.
    update: { papel, ativo: true, adicionadoPor: user.id },
    create: {
      areaId: resolved.area.id,
      usuarioId: usuario.id,
      papel,
      ativo: true,
      adicionadoPor: user.id,
    },
  });

  return Response.json(
    {
      membro: {
        uid: usuario.uid,
        nome: usuario.nome,
        papel: membro.papel,
        ativo: membro.ativo,
      },
    },
    { status: 201 },
  );
}
