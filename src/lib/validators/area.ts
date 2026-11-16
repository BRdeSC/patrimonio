import { z } from "zod";

export const VISIBILIDADES = ["privada", "publica_leitura"] as const;

export const createAreaSchema = z.object({
  nome: z.string().trim().min(2).max(120),
  descricao: z.string().trim().max(500).optional(),
});

export type CreateAreaInput = z.infer<typeof createAreaSchema>;

// Allowlist explícita (anti mass-assignment): só nome, descricao, visibilidade.
export const updateAreaSchema = z
  .object({
    nome: z.string().trim().min(2).max(120).optional(),
    descricao: z.string().trim().max(500).nullable().optional(),
    visibilidade: z.enum(VISIBILIDADES).optional(),
  })
  .refine((v) => v.nome !== undefined || v.descricao !== undefined || v.visibilidade !== undefined, {
    message: "nenhum campo para atualizar",
  });

export type UpdateAreaInput = z.infer<typeof updateAreaSchema>;
