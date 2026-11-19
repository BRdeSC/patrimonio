import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as areasGET, POST as areasPOST } from "@/app/api/areas/route";
import {
  DELETE as areaDELETE,
  GET as areaGET,
  PATCH as areaPATCH,
} from "@/app/api/areas/[id]/route";
import {
  GET as membersGET,
  POST as membersPOST,
} from "@/app/api/areas/[id]/members/route";
import {
  DELETE as memberDELETE,
  PATCH as memberPATCH,
} from "@/app/api/areas/[id]/members/[uid]/route";
import { POST as patPOST } from "@/app/api/areas/[id]/patrimonios/route";
import { prisma } from "@/lib/prisma";
import { ensureTestDatabase } from "../helpers/test-db";
import { call, cookieToken } from "../helpers/http";

const SUFFIX = Date.now().toString(36);
const NOME_AREA = `Teste ${SUFFIX}`;

type Tokens = { gestor: string; secretaria: string; outro: string };
const tokens: Tokens = { gestor: "", secretaria: "", outro: "" };
let areaId = 0;

async function login(uid: string, ip: string): Promise<string> {
  const res = await call(loginPOST, "POST", "/api/auth/login", {
    body: { uid, senha: "mock123" },
    ip,
  });
  expect(res.status).toBe(200);
  const token = cookieToken(res);
  expect(token).toBeTruthy();
  return token!;
}

describe("áreas + RBAC + multi-tenant (MockIpaProvider)", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    tokens.gestor = await login("coids.gestor", "10.2.0.1");
    tokens.secretaria = await login("coids.secretaria", "10.2.0.2");
    tokens.outro = await login("outro.area", "10.2.0.3");
  });

  it("admin cria área em auto-serviço e vira OWNER", async () => {
    const res = await call(areasPOST, "POST", "/api/areas", {
      body: { nome: NOME_AREA, descricao: "Área de teste" },
      cookie: tokens.gestor,
      ip: "10.2.0.1",
    });
    expect(res.status).toBe(201);
    const { area } = (await res.json()) as { area: { id: number; slug: string } };
    areaId = area.id;
    expect(area.slug).toBe(`teste-${SUFFIX}`);

    const hub = await call(areasGET, "GET", "/api/areas", { cookie: tokens.gestor });
    expect(hub.status).toBe(200);
    const body = (await hub.json()) as {
      areas: { id: number; papel: string; itens: number; criadaEm: string }[];
    };
    const minha = body.areas.find((a) => a.id === areaId);
    expect(minha).toBeTruthy();
    expect(minha!.papel).toBe("OWNER");
    expect(minha!.itens).toBe(0);
    expect(minha!.criadaEm).toBeTruthy();
  });

  it("colisão de slug (ignora maiúsculas/acentos): 409", async () => {
    const res = await call(areasPOST, "POST", "/api/areas", {
      body: { nome: NOME_AREA.toUpperCase() },
      cookie: tokens.gestor,
      ip: "10.2.0.1",
    });
    expect(res.status).toBe(409);
  });

  it("hub mostra apenas as áreas do próprio usuário", async () => {
    const hub = await call(areasGET, "GET", "/api/areas", { cookie: tokens.outro });
    expect(hub.status).toBe(200);
    const body = (await hub.json()) as { areas: { id: number }[] };
    expect(body.areas.some((a) => a.id === areaId)).toBe(false);
  });

  it("área alheia privada -> 404 (anti IDOR, zero vazamento de existência)", async () => {
    const res = await call(areaGET, "GET", `/api/areas/${areaId}`, { cookie: tokens.outro }, {
      id: String(areaId),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ erro: "Área não encontrada" });
  });

  it("membro pode ler a área", async () => {
    // secretaria ainda não é membro — lê depois do add (próximo teste).
    const antes = await call(areaGET, "GET", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(antes.status).toBe(404);
    expect(await antes.json()).toEqual({ erro: "Área não encontrada" });
  });

  it("admin adiciona membro (secretaria) via uid", async () => {
    const res = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "coids.secretaria", papel: "OPERATOR" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { membro: { uid: string; papel: string } };
    expect(body.membro.uid).toBe("coids.secretaria");
    expect(body.membro.papel).toBe("OPERATOR");

    const lista = await call(membersGET, "GET", `/api/areas/${areaId}/members`, {
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    const membros = (await lista.json()) as {
      membros: { uid: string; papel: string; ativo: boolean }[];
    };
    expect(membros.membros.find((m) => m.uid === "coids.secretaria")!.papel).toBe("OPERATOR");
    expect(membros.membros.find((m) => m.uid === "coids.gestor")!.papel).toBe("OWNER");

    // Agora secretaria é membro e consegue ler a área.
    const agora = await call(areaGET, "GET", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(agora.status).toBe(200);
  });

  it("mass-assignment: papéis fora do enum e campos fora da allowlist são rejeitados", async () => {
    const papelInvalido = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "outro.area", papel: "ADMIN" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(papelInvalido.status).toBe(400);

    // Campos extra são descartados (allowlist): sem campo válido → 400.
    const semPapel = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "outro.area", slug: "hack" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(semPapel.status).toBe(400);

    // (outro.area acabou de ser rejeitado no add — adiciona como VIEWER p/ testar o PATCH)
    const add = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "outro.area", papel: "VIEWER" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(add.status).toBe(201);

    const viaPatch = await call(memberPATCH, "PATCH", `/api/areas/${areaId}/members/outro.area`, {
      body: { papel: "ADMIN" },
      cookie: tokens.gestor,
    }, { id: String(areaId), uid: "outro.area" });
    expect(viaPatch.status).toBe(400);

    const patchExtra = await call(memberPATCH, "PATCH", `/api/areas/${areaId}/members/outro.area`, {
      body: { slug: "hack" },
      cookie: tokens.gestor,
    }, { id: String(areaId), uid: "outro.area" });
    expect(patchExtra.status).toBe(400);

    // Prova o efeito (não só o status): o papel continua "VIEWER" após a rejeição.
    const lista = await call(membersGET, "GET", `/api/areas/${areaId}/members`, {
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    const membros = (await lista.json()) as {
      membros: { uid: string; papel: string; ativo: boolean }[];
    };
    expect(membros.membros.find((m) => m.uid === "outro.area")!.papel).toBe("VIEWER");
  });

  it("secretaria NÃO gerencia membros nem configurações (RBAC)", async () => {
    const add = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "qualquer.uid", papel: "VIEWER" },
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(add.status).toBe(403);

    const patch = await call(areaPATCH, "PATCH", `/api/areas/${areaId}`, {
      body: { nome: "Hack " + SUFFIX },
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(patch.status).toBe(403);
  });

  it("admin edita a área (allowlist) e o slug acompanha o nome", async () => {
    const novoNome = `Renomeada ${SUFFIX}`;
    const res = await call(areaPATCH, "PATCH", `/api/areas/${areaId}`, {
      body: { nome: novoNome },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { area: { nome: string; slug: string } };
    expect(body.area.nome).toBe(novoNome);
    expect(body.area.slug).toBe(`renomeada-${SUFFIX}`);
  });

  it("admin promove membro a OWNER — múltiplos OWNERs passam a ser permitidos", async () => {
    const res = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${areaId}/members/coids.secretaria`,
      { body: { papel: "OWNER" }, cookie: tokens.gestor },
      { id: String(areaId), uid: "coids.secretaria" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { membro: { papel: string } };
    expect(body.membro.papel).toBe("OWNER");

    // Re-leitura: 2 OWNERs ativos (o modelo de "admin único" morre).
    const lista = await call(membersGET, "GET", `/api/areas/${areaId}/members`, {
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    const membros = (await lista.json()) as {
      membros: { uid: string; papel: string; ativo: boolean }[];
    };
    expect(membros.membros.filter((m) => m.papel === "OWNER" && m.ativo)).toHaveLength(2);
  });

  it("com 2 OWNERs: demover 1 é permitido → 200", async () => {
    // Gestor (OWNER) se rebaixa a VIEWER — há outro OWNER ativo.
    const res = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${areaId}/members/coids.gestor`,
      { body: { papel: "VIEWER" }, cookie: tokens.gestor },
      { id: String(areaId), uid: "coids.gestor" },
    );
    expect(res.status).toBe(200);

    // Re-leitura: secretaria é o ÚNICO OWNER ativo; gestor virou VIEWER.
    const lista = await call(membersGET, "GET", `/api/areas/${areaId}/members`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    const membros = (await lista.json()) as {
      membros: { uid: string; papel: string; ativo: boolean }[];
    };
    expect(membros.membros.filter((m) => m.papel === "OWNER" && m.ativo)).toHaveLength(1);
    expect(membros.membros.find((m) => m.uid === "coids.gestor")!.papel).toBe("VIEWER");
  });

  it("ÚNICO OWNER: demover (papel != OWNER) → 409 + corpo exato", async () => {
    const res = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${areaId}/members/coids.secretaria`,
      { body: { papel: "VIEWER" }, cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.secretaria" },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erro: "A área precisa ter ao menos um OWNER" });
  });

  it("ÚNICO OWNER: desativar → 409 + corpo exato", async () => {
    const res = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${areaId}/members/coids.secretaria`,
      { body: { ativo: false }, cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.secretaria" },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erro: "A área precisa ter ao menos um OWNER" });
  });

  it("ÚNICO OWNER: remoção (inclusive auto) → 409 + corpo exato", async () => {
    const res = await call(
      memberDELETE,
      "DELETE",
      `/api/areas/${areaId}/members/coids.secretaria`,
      { cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.secretaria" },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ erro: "A área precisa ter ao menos um OWNER" });
  });

  it("com 2 OWNERs: remover 1 é permitido → 200", async () => {
    // Re-promove o gestor (volta a haver 2 OWNERs) e a secretaria remove um deles.
    const repromove = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${areaId}/members/coids.gestor`,
      { body: { papel: "OWNER" }, cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.gestor" },
    );
    expect(repromove.status).toBe(200);

    const del = await call(
      memberDELETE,
      "DELETE",
      `/api/areas/${areaId}/members/coids.gestor`,
      { cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.gestor" },
    );
    expect(del.status).toBe(200);

    // Efeito: gestor fora da área; secretaria segue sendo a ÚNICA OWNER.
    const lista = await call(membersGET, "GET", `/api/areas/${areaId}/members`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    const membros = (await lista.json()) as {
      membros: { uid: string; papel: string; ativo: boolean }[];
    };
    expect(membros.membros.find((m) => m.uid === "coids.gestor")).toBeUndefined();
    expect(membros.membros.find((m) => m.uid === "coids.secretaria")!.papel).toBe("OWNER");
  });

  it("admin remove membro (outro.area) e o membro perde acesso", async () => {
    const del = await call(
      memberDELETE,
      "DELETE",
      `/api/areas/${areaId}/members/outro.area`,
      { cookie: tokens.secretaria },
      { id: String(areaId), uid: "outro.area" },
    );
    expect(del.status).toBe(200);

    const semAcesso = await call(areaGET, "GET", `/api/areas/${areaId}`, {
      cookie: tokens.outro,
    }, { id: String(areaId) });
    expect(semAcesso.status).toBe(404);
    expect(await semAcesso.json()).toEqual({ erro: "Área não encontrada" });
  });

  it("admin exclui a área (hard delete) — area/patrimônios/membros somem (cascade)", async () => {
    // Seed: 1 patrimônio na área (prova cascade ao hard delete).
    const patRes = await call(patPOST, "POST", `/api/areas/${areaId}/patrimonios`, {
      body: { numero: "PAT-DEL-001", descricao: "Patrimônio de teste cascade" },
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(patRes.status).toBe(201);

    const del = await call(areaDELETE, "DELETE", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    // Cascade: a área some do banco (findUnique → null).
    const area = await prisma.area.findUnique({ where: { id: areaId } });
    expect(area).toBeNull();

    // Cascade: patrimônios e membros da área também somem.
    expect(await prisma.patrimonio.count({ where: { areaId } })).toBe(0);
    expect(await prisma.areaMembro.count({ where: { areaId } })).toBe(0);

    // Some do hub e do acesso.
    const hub = (await (
      await call(areasGET, "GET", "/api/areas", { cookie: tokens.secretaria })
    ).json()) as { areas: { id: number }[] };
    expect(hub.areas.some((a) => a.id === areaId)).toBe(false);

    const detalhe = await call(areaGET, "GET", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(detalhe.status).toBe(404);
  });

  // Classe F-1 completa: não-membro de área PRIVADA recebe 404 idêntico ao
  // inexistente em TODOS os endpoints de escrita/leitura de membros — em
  // nenhum caso 403 (zero vazamento de existência).
  it("não-membro de área PRIVADA → 404 + 'Área não encontrada' em todos os endpoints", async () => {
    // Área privada ATIVA: gestor é o único membro (admin); outro não é membro.
    const resPriv = await call(areasPOST, "POST", "/api/areas", {
      body: { nome: `Priv 2 ${SUFFIX}` },
      cookie: tokens.gestor,
      ip: "10.2.0.1",
    });
    expect(resPriv.status).toBe(201);
    const privId = ((await resPriv.json()) as { area: { id: number } }).area.id;
    const params = { id: String(privId) };

    const membrosGET = await call(membersGET, "GET", `/api/areas/${privId}/members`, {
      cookie: tokens.outro,
    }, params);
    expect(membrosGET.status).toBe(404);
    expect(await membrosGET.json()).toEqual({ erro: "Área não encontrada" });

    const membrosPOST = await call(
      membersPOST,
      "POST",
      `/api/areas/${privId}/members`,
      { body: { uid: "outro.area", papel: "VIEWER" }, cookie: tokens.outro },
      params,
    );
    expect(membrosPOST.status).toBe(404);
    expect(await membrosPOST.json()).toEqual({ erro: "Área não encontrada" });

    const membroPATCH = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${privId}/members/coids.gestor`,
      { body: { papel: "VIEWER" }, cookie: tokens.outro },
      { id: String(privId), uid: "coids.gestor" },
    );
    expect(membroPATCH.status).toBe(404);
    expect(await membroPATCH.json()).toEqual({ erro: "Área não encontrada" });

    const membroDELETE = await call(
      memberDELETE,
      "DELETE",
      `/api/areas/${privId}/members/coids.gestor`,
      { cookie: tokens.outro },
      { id: String(privId), uid: "coids.gestor" },
    );
    expect(membroDELETE.status).toBe(404);
    expect(await membroDELETE.json()).toEqual({ erro: "Área não encontrada" });

    const patchArea = await call(areaPATCH, "PATCH", `/api/areas/${privId}`, {
      body: { nome: "Hack " + SUFFIX },
      cookie: tokens.outro,
    }, params);
    expect(patchArea.status).toBe(404);
    expect(await patchArea.json()).toEqual({ erro: "Área não encontrada" });

    const deleteArea = await call(areaDELETE, "DELETE", `/api/areas/${privId}`, {
      cookie: tokens.outro,
    }, params);
    expect(deleteArea.status).toBe(404);
    expect(await deleteArea.json()).toEqual({ erro: "Área não encontrada" });

    // Efeito: nada mudou — a área segue ativa e o gestor segue admin.
    const intacta = await call(areaGET, "GET", `/api/areas/${privId}`, {
      cookie: tokens.gestor,
    }, params);
    expect(intacta.status).toBe(200);
    const corpo = (await intacta.json()) as { area: { papel: string; ativo: boolean } };
    expect(corpo.area.papel).toBe("OWNER");
    expect(corpo.area.ativo).toBe(true);
  });
});
