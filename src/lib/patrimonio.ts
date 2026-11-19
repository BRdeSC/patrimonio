import { Prisma } from "@prisma/client";

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
