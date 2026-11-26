import { Prisma } from "@prisma/client";
import type { ListPatrimoniosQuery } from "./validators/patrimonio";

// Contratos de resposta do CRUD de patrimônios (compartilhado pelas rotas).
// O BLOB NUNCA vai em resposta de lista/detalhe — apenas o flag temFoto.

export interface PatrimonioResumo {
  id: number;
  numero: string;
  descricao: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  responsavel: string | null;
  detentor: string | null;
  localizacao: string | null;
  temFoto: boolean;
  atualizadoEm: string;
}

// Shape retornado pelo Prisma com SELECT_RESUMO (data bruta, pré-mapeamento).
export type PatrimonioLinha = {
  id: number;
  numero: string;
  descricao: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  responsavel: string | null;
  detentor: string | null;
  localizacao: string | null;
  atualizadoEm: Date;
  fotos: { id: number }[];
};

// Select explícito (anti vazamento de campos; nunca o BLOB).
export const SELECT_RESUMO = {
  id: true,
  numero: true,
  descricao: true,
  marca: true,
  modelo: true,
  serie: true,
  responsavel: true,
  detentor: true,
  localizacao: true,
  atualizadoEm: true,
  fotos: { select: { id: true } },
} as const;

export function patrimonioResumo(p: PatrimonioLinha): PatrimonioResumo {
  return {
    id: p.id,
    numero: p.numero,
    descricao: p.descricao,
    marca: p.marca,
    modelo: p.modelo,
    serie: p.serie,
    responsavel: p.responsavel,
    detentor: p.detentor,
    localizacao: p.localizacao,
    temFoto: p.fotos.length > 0,
    atualizadoEm: p.atualizadoEm.toISOString(),
  };
}

// true quando o erro é violação de unicidade do Prisma (P2002).
export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

// ---------------------------------------------------------------------------
// Construção da query da listagem — compartilhada por GET /patrimonios e
// GET /patrimonios/exportar (③-D): paridade TOTAL, o PDF reflete exatamente
// a lista que está na tela (busca, filtros, pendências e ordenação).
// ---------------------------------------------------------------------------

// Busca q + filtros detentor/localizacao + pendências. Sempre escopado por
// areaId (anti-IDOR).
export function whereLista(
  areaId: number,
  filtros: Pick<ListPatrimoniosQuery, "q" | "detentor" | "localizacao" | "pendente">,
): Prisma.PatrimonioWhereInput {
  const where: Prisma.PatrimonioWhereInput = { areaId };
  const { q, detentor, localizacao, pendente } = filtros;
  if (q) {
    const like = { contains: q, mode: "insensitive" as const };
    where.OR = [
      { numero: like },
      { descricao: like },
      { marca: like },
      { modelo: like },
      { serie: like },
    ];
  }
  // Busca parcial (pedido 8): contains + insensitive, igual ao "q".
  if (detentor) where.detentor = { contains: detentor, mode: "insensitive" };
  if (localizacao) where.localizacao = { contains: localizacao, mode: "insensitive" };
  const pendencias: Prisma.PatrimonioWhereInput[] = [];
  if (pendente === "detentor" || pendente === "ambos") {
    pendencias.push({ OR: [{ detentor: null }, { detentor: "" }] });
  }
  if (pendente === "localizacao" || pendente === "ambos") {
    pendencias.push({ OR: [{ localizacao: null }, { localizacao: "" }] });
  }
  if (pendencias.length > 0) where.AND = pendencias;
  return where;
}

// Ordenação da listagem (D6): allowlist via zod → zero injeção de coluna.
// Prisma (esta versão): orderBy = ARRAY de objetos de CHAVE ÚNICA, na ordem
// de sorteio. Objeto com 2+ chaves — solto ou dentro do array — é rejeitado
// na validação de runtime (diagnosticado empiricamente; bug live no sort de
// "Marca/Modelo" reportado pelo dono).
// "marca" leva tiebreak por "modelo" (a coluna exibida é "Marca/Modelo").
// A chave final id asc é sempre presente (determinístico; numero já é único
// por área, então o padrão de hoje não muda). Nulls (detentor/localizacao):
// default do Postgres — asc → nulos por último, desc → nulos primeiro.
export function orderByLista(
  col: ListPatrimoniosQuery["col"],
  dir: ListPatrimoniosQuery["dir"],
): Prisma.PatrimonioOrderByWithRelationInput[] {
  if (!col) return [{ numero: "asc" }, { id: "asc" }];
  const d = dir ?? "asc";
  switch (col) {
    case "numero":
      return [{ numero: d }, { id: "asc" }];
    case "descricao":
      return [{ descricao: d }, { id: "asc" }];
    case "marca":
      return [{ marca: d }, { modelo: d }, { id: "asc" }];
    case "detentor":
      return [{ detentor: d }, { id: "asc" }];
    case "localizacao":
      return [{ localizacao: d }, { id: "asc" }];
    case "atualizadoEm":
      return [{ atualizadoEm: d }, { id: "asc" }];
  }
}
