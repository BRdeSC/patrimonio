import { z } from "zod";

// uid: apenas caracteres seguros (também reforça anti-injection no DN).
export const uidSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9._@-]+$/, "uid inválido");

export const loginSchema = z.object({
  uid: uidSchema,
  senha: z.string().min(1).max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;
