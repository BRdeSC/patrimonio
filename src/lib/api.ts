import { z } from "zod";

// Parsers compartilhados pelas rotas (Zod em toda entrada).

export const areaIdParamSchema = z.coerce.number().int().positive();

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
