import { prisma } from "./prisma";
import type { AreaDetalhe, AreaResumo, SessionUser } from "./types";

// ---------------------------------------------------------------------------
// Escopo de tenant: TODA query de área passa por aqui (anti-IDOR).
// Área só é lida por membros — ou por qualquer autenticado se publica_leitura
// (somente leitura).
// ---------------------------------------------------------------------------

export async function getAreaContext(
  user: SessionUser,
  areaId: number,
): Promise<AreaDetalhe | null> {
  const area = await prisma.area.findUnique({ where: { id: areaId } });
  if (!area || !area.ativo) return null;
  const membro = await prisma.areaMembro.findUnique({
    where: { areaId_usuarioId: { areaId, usuarioId: user.id } },
  });
  const papel = membro?.ativo ? membro.papel : null;
  return {
    id: area.id,
    nome: area.nome,
    slug: area.slug,
    descricao: area.descricao,
    visibilidade: area.visibilidade,
    ativo: area.ativo,
    papel,
    isMember: papel !== null,
  };
}

export function canReadArea(area: AreaDetalhe): boolean {
  return area.isMember || area.visibilidade === "publica_leitura";
}

export function canManageArea(papel: string | null): boolean {
  return papel === "admin_area";
}

// secretaria+ : criar/editar patrimônios e foto.
export function canEditPatrimonio(papel: string | null): boolean {
  return papel === "admin_area" || papel === "secretaria";
}

export async function getAreasForUser(userId: number): Promise<AreaResumo[]> {
  const membros = await prisma.areaMembro.findMany({
    where: { usuarioId: userId, ativo: true },
    include: {
      area: { include: { _count: { select: { patrimonios: true } } } },
    },
    orderBy: { area: { criadoEm: "asc" } },
  });
  return membros
    .filter((m) => m.area.ativo)
    .map((m) => ({
      id: m.area.id,
      nome: m.area.nome,
      slug: m.area.slug,
      papel: m.papel,
      itens: m.area._count.patrimonios,
      criadaEm: m.area.criadoEm.toISOString(),
    }));
}
