import { Prisma, type Patrimonio } from "@prisma/client";
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

// Ordenação da listagem (D6): allowlist via zod → zero injeção de coluna.
// Prisma (esta versão): orderBy = ARRAY de objetos de CHAVE ÚNICA, na ordem
// de sorteio. Objeto com 2+ chaves — solto ou dentro do array — é rejeitado
// na validação de runtime (diagnosticado empiricamente; bug live no sort de
// "Marca/Modelo" reportado pelo dono).
// "marca" leva tiebreak por "modelo" (a coluna exibida é "Marca/Modelo").
// A chave final id asc é sempre presente (determinístico; numero já é único
// por área, então o padrão de hoje não muda). Nulls (detentor/localizacao):
// default do Postgres — asc → nulos por último, desc → nulos primeiro.
type ColOrdenacao =
  | "numero"
  | "descricao"
  | "marca"
  | "detentor"
  | "localizacao"
  | "atualizadoEm";

function ordemLista(
  col: ColOrdenacao | undefined,
  dir: "asc" | "desc" | undefined,
): Prisma.PatrimonioOrderByWithRelationInput[] {
  if (!col) return [{ numero: "asc" }, { id: "asc" }];
  const d = dir ?? "asc";
  switch (col) {
    case "numero":
      return [{ numero: d }, { id: "asc" }];
    case "descricao":
      return [{ descricao: d }, { id: "asc" }];
    case "marca":
      return [{ marca: d }, { modelo: d }, { id: "asc" }];
    case "detentor":
      return [{ detentor: d }, { id: "asc" }];
    case "localizacao":
      return [{ localizacao: d }, { id: "asc" }];
    case "atualizadoEm":
      return [{ atualizadoEm: d }, { id: "asc" }];
  }
}

// Lista (membro/leitor): busca q + filtros detentor/localizacao/pendente.
// NUNCA o BLOB — apenas o flag temFoto.
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
  const { q, detentor, localizacao, pendente, col, dir } = parsed.data;

  const where: Prisma.PatrimonioWhereInput = { areaId: area.id };
  if (q) {
    const like = { contains: q, mode: "insensitive" as const };
    where.OR = [
      { numero: like },
      { descricao: like },
      { marca: like },
      { modelo: like },
      { serie: like },
    ];
  }
  // Busca parcial (pedido 8): contains + insensitive, igual ao "q".
  if (detentor) where.detentor = { contains: detentor, mode: "insensitive" };
  if (localizacao) where.localizacao = { contains: localizacao, mode: "insensitive" };
  const pendencias: Prisma.PatrimonioWhereInput[] = [];
  if (pendente === "detentor" || pendente === "ambos") {
    pendencias.push({ OR: [{ detentor: null }, { detentor: "" }] });
  }
  if (pendente === "localizacao" || pendente === "ambos") {
    pendencias.push({ OR: [{ localizacao: null }, { localizacao: "" }] });
  }
  if (pendencias.length > 0) where.AND = pendencias;

  const itens = await prisma.patrimonio.findMany({
    where,
    orderBy: ordemLista(col, dir),
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
