import { z } from "zod";
import { uidSchema } from "./auth";

// Allowlist: "admin_area" NUNCA é assignável via members — admin só é
// concedido na criação da área ou via transferência (POST /transfer).
export const MEMBER_PAPEIS = ["secretaria", "usuario"] as const;

export const addMemberSchema = z.object({
  uid: uidSchema,
  papel: z.enum(MEMBER_PAPEIS),
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberSchema = z
  .object({
    papel: z.enum(MEMBER_PAPEIS).optional(),
    ativo: z.boolean().optional(),
  })
  .refine((v) => v.papel !== undefined || v.ativo !== undefined, {
    message: "nenhum campo para atualizar",
  });

export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const transferAdminSchema = z.object({
  uid: uidSchema,
});

export type TransferAdminInput = z.infer<typeof transferAdminSchema>;
