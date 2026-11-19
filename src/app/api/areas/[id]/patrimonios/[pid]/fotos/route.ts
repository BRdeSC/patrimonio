import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canEditPatrimonio } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema } from "@/lib/api";
import { storage } from "@/lib/storage";
import {
  TIPOS_FOTO,
  TAMANHO_MAX,
  LIMITE_FOTOS,
  ERRO_FORMATO,
  ERRO_TAMANHO,
  ERRO_CAMPO_AUSENTE,
  ERRO_ARQUIVO_INVALIDO,
  ERRO_LIMITE,
} from "@/lib/foto";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; pid: string }> };

type Resolved =
  | { error: Response }
  | { user: SessionUser; area: AreaDetalhe; patrimonioId: number };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: Response.json({ erro: "Não autenticado" }, { status: 401 }) } as const;
  }
  const { id, pid } = await ctx.params;
  const idParsed = areaIdParamSchema.safeParse(id);
  const pidParsed = areaIdParamSchema.safeParse(pid);
  if (!idParsed.success || !pidParsed.success) {
    return { error: Response.json({ erro: "id inválido" }, { status: 400 }) } as const;
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  return { user, area, patrimonioId: pidParsed.data } as const;
}

// Valida que o patrimônio existe DENTRO da área (escopo areaId — anti-IDOR).
async function patrimonioDaArea(areaId: number, patrimonioId: number) {
  return prisma.patrimonio.findFirst({
    where: { id: patrimonioId, areaId },
    select: { id: true },
  });
}

// GET /fotos — metadados (SEM BLOB) em ordem de envio (id asc). Membro/leitor.
export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { area, patrimonioId } = resolved;
  // Não-membro de área privada → 404 idêntico ao inexistente (zero vazamento).
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }

  const patrimonio = await patrimonioDaArea(area.id, patrimonioId);
  if (!patrimonio) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  const fotos = await storage.list(patrimonioId);
  return Response.json({ fotos });
}

// POST /fotos — append de N fotos (OPERATOR+). multipart/form-data, campo "foto"
// REPETÍVEL. Revalida cada arquivo server-side + limita a 10 por patrimônio.
// Rejeições de validação → sempre 400 (nunca 500).
export async function POST(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { user, area, patrimonioId } = resolved;
  // Regra 1 antes: não-membro de privada → 404 (uniforme); depois RBAC de escrita → 403.
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canEditPatrimonio(area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const patrimonio = await patrimonioDaArea(area.id, patrimonioId);
  if (!patrimonio) {
    return Response.json({ erro: "Patrimônio não encontrado" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ erro: ERRO_ARQUIVO_INVALIDO }, { status: 400 });
  }

  // Campo "foto" repetível: pega todas as ocorrências, mantém só as que são arquivo.
  const arquivos = form
    .getAll("foto")
    .filter((v): v is File => v instanceof File);
  if (arquivos.length === 0) {
    return Response.json({ erro: ERRO_CAMPO_AUSENTE }, { status: 400 });
  }

  // Valida cada arquivo (tipo/tamanho) — primeira falha decide o 400.
  for (const arquivo of arquivos) {
    if (!(TIPOS_FOTO as readonly string[]).includes(arquivo.type)) {
      return Response.json({ erro: ERRO_FORMATO }, { status: 400 });
    }
    if (arquivo.size > TAMANHO_MAX) {
      return Response.json({ erro: ERRO_TAMANHO }, { status: 400 });
    }
  }

  // Limite: fotos atuais + novos > 10 → 400 (list é metadados, sem BLOB).
  const atuais = await storage.list(patrimonioId);
  if (atuais.length + arquivos.length > LIMITE_FOTOS) {
    return Response.json({ erro: ERRO_LIMITE }, { status: 400 });
  }

  // Append cada um, na ordem dos arquivos (id asc ⇒ capa = 1ª enviada).
  const novas = [];
  for (const arquivo of arquivos) {
    const bytes = Buffer.from(await arquivo.arrayBuffer());
    const salvo = await storage.append(patrimonioId, bytes, arquivo.type);
    novas.push({ id: salvo.id, tamanho: salvo.tamanho, contentType: salvo.contentType });
  }

  // D8: foto é alteração do item → registra o operador ("atualizado por";
  // atualizadoEm sai via @updatedAt).
  await prisma.patrimonio.update({
    where: { id: patrimonioId },
    data: { atualizadoPor: user.id },
  });

  return Response.json({ fotos: novas });
}
