import { z } from "zod";

// Validação de TODOS os inputs no servidor, com allowlist explícita
// (anti mass-assignment): campos fora do objeto são stripados pelo Zod.

// Opcionais 1..200 (trim). ""/null/ausente → null (limpa o campo no PATCH).
const textoOpcional = (max: number) =>
  z.string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null));

export const createPatrimonioSchema = z.object({
  numero: z.string().trim().min(1).max(64),
  descricao: z.string().trim().min(1).max(500),
  marca: textoOpcional(200),
  modelo: textoOpcional(200),
  serie: textoOpcional(200),
  responsavel: textoOpcional(200),
  detentor: textoOpcional(200),
  localizacao: textoOpcional(200),
});

export type CreatePatrimonioInput = z.infer<typeof createPatrimonioSchema>;

export const updatePatrimonioSchema = z
  .object({
    numero: z.string().trim().min(1).max(64).optional(),
    descricao: z.string().trim().min(1).max(500).optional(),
    marca: textoOpcional(200).optional(),
    modelo: textoOpcional(200).optional(),
    serie: textoOpcional(200).optional(),
    responsavel: textoOpcional(200).optional(),
    detentor: textoOpcional(200).optional(),
    localizacao: textoOpcional(200).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "nenhum campo para atualizar",
  });

export type UpdatePatrimonioInput = z.infer<typeof updatePatrimonioSchema>;

// Query string da lista (todos opcionais, tamanhos limitados).
export const listPatrimoniosQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  detentor: z.string().trim().max(200).optional(),
  localizacao: z.string().trim().max(200).optional(),
  pendente: z.enum(["detentor", "localizacao", "ambos"]).optional(),
  // Ordenação (D6): col = coluna ordenável (allowlist — zero injeção de coluna).
  // dir = direção; dir SEM col é ignorado (ordem padrão = numero asc).
  col: z
    .enum(["numero", "descricao", "marca", "detentor", "localizacao", "atualizadoEm"])
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

export type ListPatrimoniosQuery = z.infer<typeof listPatrimoniosQuerySchema>;
