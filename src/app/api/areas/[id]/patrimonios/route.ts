import { type Patrimonio } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea, canEditPatrimonio } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema, readJsonBody } from "@/lib/api";
import {
  createPatrimonioSchema,
  listPatrimoniosQuerySchema,
} from "@/lib/validators/patrimonio";
import {
  patrimonioResumo,
  SELECT_RESUMO,
  isUniqueViolation,
  orderByLista,
  whereLista,
} from "@/lib/patrimonio";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

type Resolved =
  | { error: Response }
  | { user: SessionUser; area: AreaDetalhe };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: Response.json({ erro: "Não autenticado" }, { status: 401 }) } as const;
  }
  const { id } = await ctx.params;
  const idParsed = areaIdParamSchema.safeParse(id);
  if (!idParsed.success) {
    return { error: Response.json({ erro: "id inválido" }, { status: 400 }) } as const;
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  return { user, area } as const;
}

// Lista (membro/leitor): busca q + filtros detentor/localizacao/pendente.
// NUNCA o BLOB — apenas o flag temFoto.
// where/orderBy em lib/patrimonio (compartilhado c/ /exportar — paridade ③-D).
export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { area } = resolved;
  // Não-membro de área privada → 404 idêntico ao inexistente (zero vazamento de existência).
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }

  const query = new URL(request.url).searchParams;
  const parsed = listPatrimoniosQuerySchema.safeParse({
    q: query.get("q") ?? undefined,
    detentor: query.get("detentor") ?? undefined,
    localizacao: query.get("localizacao") ?? undefined,
    pendente: query.get("pendente") ?? undefined,
    col: query.get("col") ?? undefined,
    dir: query.get("dir") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ erro: "Parâmetros inválidos" }, { status: 400 });
  }

  const itens = await prisma.patrimonio.findMany({
    where: whereLista(area.id, parsed.data),
    orderBy: orderByLista(parsed.data.col, parsed.data.dir),
    select: SELECT_RESUMO,
  });
  return Response.json({ patrimonios: itens.map(patrimonioResumo) });
}

// Cria (OPERATOR+). Colisão de numero na mesma área → 409 (P2002).
export async function POST(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { user, area } = resolved;
  // Regra 1 antes: não-membro de privada → 404 (uniforme); depois RBAC de escrita → 403.
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }
  if (!canEditPatrimonio(area.papel)) {
    return Response.json({ erro: "Acesso negado" }, { status: 403 });
  }

  const body = await readJsonBody(request);
  const parsed = createPatrimonioSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  const { numero, descricao, marca, modelo, serie, responsavel, detentor, localizacao } =
    parsed.data;

  try {
    const criado: Patrimonio = await prisma.patrimonio.create({
      data: {
        areaId: area.id,
        numero,
        descricao,
        marca,
        modelo,
        serie,
        responsavel,
        detentor,
        localizacao,
        criadoPor: user.id,
        atualizadoPor: user.id,
      },
    });
    const resumo = patrimonioResumo({ ...criado, fotos: [] });
    return Response.json({ patrimonio: resumo }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json(
        { erro: "Já existe um patrimônio com esse número nesta área" },
        { status: 409 },
      );
    }
    throw err;
  }
}
