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
  return papel === "OWNER";
}

// OPERATOR+ : criar/editar patrimônios e foto.
export function canEditPatrimonio(papel: string | null): boolean {
  return papel === "OWNER" || papel === "OPERATOR";
}

// Áreas públicas (publica_leitura) em que o usuário NÃO é membro ativo:
// descoberta no hub/onboarding (pacote ③-A). papel=null → leitura apenas.
export async function getPublicAreasForUser(userId: number): Promise<AreaResumo[]> {
  const areas = await prisma.area.findMany({
    where: {
      ativo: true,
      visibilidade: "publica_leitura",
      NOT: { membros: { some: { usuarioId: userId, ativo: true } } },
    },
    include: { _count: { select: { patrimonios: true } } },
    orderBy: { criadoEm: "asc" },
  });
  return areas.map((a) => ({
    id: a.id,
    nome: a.nome,
    slug: a.slug,
    papel: null,
    itens: a._count.patrimonios,
    criadaEm: a.criadoEm.toISOString(),
  }));
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
