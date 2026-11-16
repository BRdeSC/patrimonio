import { prisma } from "@/lib/prisma";
import { getAreaContext, canManageArea } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema, readJsonBody } from "@/lib/api";
import { transferAdminSchema } from "@/lib/validators/member";
import type { SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Transfere a administração (admin_area) para outro membro ativo.
// O transferente mantém a membresia como "usuario" (perde privilégios de edição).
export async function POST(request: Request, ctx: Ctx) {
  const user: SessionUser = (await getSessionUser(request)) as SessionUser;
  if (!user) {
    return Response.json({ erro: "Não autenticado" }, { status: 401 });
  }
  const idParsed = areaIdParamSchema.safeParse((await ctx.params).id);
  if (!idParsed.success) {
    return Response.json({ erro: "id inválido" }, { status: 400 });
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canManageArea(area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const body = await readJsonBody(request);
  const parsed = transferAdminSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { uid } = parsed.data;

  const alvo = await prisma.usuario.findUnique({ where: { uid } });
  const membroAlvo = alvo
    ? await prisma.areaMembro.findUnique({
        where: { areaId_usuarioId: { areaId: area.id, usuarioId: alvo.id } },
      })
    : null;
  if (!membroAlvo || !membroAlvo.ativo) {
    return Response.json(
      { erro: "O alvo deve ser membro ativo da área" },
      { status: 400 },
    );
  }
  if (membroAlvo.papel === "admin_area") {
    return Response.json({ erro: "O alvo já é admin da área" }, { status: 400 });
  }

  const membroAtual = await prisma.areaMembro.findUniqueOrThrow({
    where: { areaId_usuarioId: { areaId: area.id, usuarioId: user.id } },
  });

  await prisma.$transaction([
    prisma.areaMembro.update({
      where: { id: membroAlvo.id },
      data: { papel: "admin_area" as const },
    }),
    prisma.areaMembro.update({
      where: { id: membroAtual.id },
      data: { papel: "usuario" as const },
    }),
  ]);

  return Response.json({ transferidoPara: uid });
}
