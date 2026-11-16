// Tipos de domínio compartilhados (UI + API + testes).
import type { Papel } from "@prisma/client";

export interface SessionUser {
  id: number;
  uid: string;
  nome: string;
  email: string | null;
}

export interface AreaResumo {
  id: number;
  nome: string;
  slug: string;
  papel: Papel;
  itens: number;
  criadaEm: string;
}

export interface AreaDetalhe {
  id: number;
  nome: string;
  slug: string;
  descricao: string | null;
  visibilidade: string;
  ativo: boolean;
  papel: Papel | null;
  isMember: boolean;
}
