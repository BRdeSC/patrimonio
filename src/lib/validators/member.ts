import { z } from "zod";
import { uidSchema } from "./auth";

// Allowlist de papéis gerenciáveis via /members. Desde o turno D2 "OWNER"
// é concedível normalmente (o modelo de "admin único" morre — pedido do dono):
// múltiplos OWNERs são permitidos, e o guard do ÚLTIMO OWNER ativo
// (409 "A área precisa ter ao menos um OWNER") vive nas rotas PATCH/DELETE.
export const MEMBER_PAPEIS = ["OWNER", "OPERATOR", "VIEWER"] as const;

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
