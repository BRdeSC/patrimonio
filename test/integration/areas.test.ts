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
import { POST as transferPOST } from "@/app/api/areas/[id]/transfer/route";
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

  it("admin cria área em auto-serviço e vira admin_area", async () => {
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
    expect(minha!.papel).toBe("admin_area");
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

  it("área alheia privada -> 403 (anti IDOR)", async () => {
    const res = await call(areaGET, "GET", `/api/areas/${areaId}`, { cookie: tokens.outro }, {
      id: String(areaId),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ erro: "Acesso negado" });
  });

  it("membro pode ler a área", async () => {
    // secretaria ainda não é membro — lê depois do add (próximo teste).
    const antes = await call(areaGET, "GET", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(antes.status).toBe(403);
  });

  it("admin adiciona membro (secretaria) via uid", async () => {
    const res = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "coids.secretaria", papel: "secretaria" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { membro: { uid: string; papel: string } };
    expect(body.membro.uid).toBe("coids.secretaria");
    expect(body.membro.papel).toBe("secretaria");

    const lista = await call(membersGET, "GET", `/api/areas/${areaId}/members`, {
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    const membros = (await lista.json()) as {
      membros: { uid: string; papel: string; ativo: boolean }[];
    };
    expect(membros.membros.find((m) => m.uid === "coids.secretaria")!.papel).toBe("secretaria");
    expect(membros.membros.find((m) => m.uid === "coids.gestor")!.papel).toBe("admin_area");

    // Agora secretaria é membro e consegue ler a área.
    const agora = await call(areaGET, "GET", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(agora.status).toBe(200);
  });

  it("mass-assignment: papel=admin_area via members é SEMPRE rejeitado", async () => {
    const viaAdd = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "outro.area", papel: "admin_area" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(viaAdd.status).toBe(400);

    // (outro.area acabou de ser rejeitado no add — adiciona como usuario p/ testar o PATCH)
    const add = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "outro.area", papel: "usuario" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(add.status).toBe(201);

    const viaPatch = await call(memberPATCH, "PATCH", `/api/areas/${areaId}/members/outro.area`, {
      body: { papel: "admin_area" },
      cookie: tokens.gestor,
    }, { id: String(areaId), uid: "outro.area" });
    expect(viaPatch.status).toBe(400);

    // Prova o efeito (não só o status): o papel continua "usuario" após a rejeição.
    const lista = await call(membersGET, "GET", `/api/areas/${areaId}/members`, {
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    const membros = (await lista.json()) as {
      membros: { uid: string; papel: string; ativo: boolean }[];
    };
    expect(membros.membros.find((m) => m.uid === "outro.area")!.papel).toBe("usuario");
  });

  it("secretaria NÃO gerencia membros nem configurações (RBAC)", async () => {
    const add = await call(membersPOST, "POST", `/api/areas/${areaId}/members`, {
      body: { uid: "qualquer.uid", papel: "usuario" },
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

  it("transferência de admin: alvo vira admin_area, origem fica usuario", async () => {
    const res = await call(transferPOST, "POST", `/api/areas/${areaId}/transfer`, {
      body: { uid: "coids.secretaria" },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(res.status).toBe(200);

    const hubGestor = (await (
      await call(areasGET, "GET", "/api/areas", { cookie: tokens.gestor })
    ).json()) as { areas: { id: number; papel: string }[] };
    expect(hubGestor.areas.find((a) => a.id === areaId)!.papel).toBe("usuario");

    const hubSecretaria = (await (
      await call(areasGET, "GET", "/api/areas", { cookie: tokens.secretaria })
    ).json()) as { areas: { id: number; papel: string }[] };
    expect(hubSecretaria.areas.find((a) => a.id === areaId)!.papel).toBe("admin_area");

    // O ex-admin perdeu o poder de configurar.
    const semPermissao = await call(areaPATCH, "PATCH", `/api/areas/${areaId}`, {
      body: { nome: "Hack 2 " + SUFFIX },
      cookie: tokens.gestor,
    }, { id: String(areaId) });
    expect(semPermissao.status).toBe(403);
  });

  it("transferência para não-membro é rejeitada", async () => {
    const res = await call(transferPOST, "POST", `/api/areas/${areaId}/transfer`, {
      body: { uid: "nao.membro.area" },
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(res.status).toBe(400);
  });

  it("único admin: não pode ser rebaixado nem desativado (via members)", async () => {
    const rebaixar = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${areaId}/members/coids.secretaria`,
      { body: { papel: "usuario" }, cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.secretaria" },
    );
    expect(rebaixar.status).toBe(400);

    const desativar = await call(
      memberPATCH,
      "PATCH",
      `/api/areas/${areaId}/members/coids.secretaria`,
      { body: { ativo: false }, cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.secretaria" },
    );
    expect(desativar.status).toBe(400);
  });

  it("único admin: auto-remoção é bloqueada", async () => {
    const res = await call(
      memberDELETE,
      "DELETE",
      `/api/areas/${areaId}/members/coids.secretaria`,
      { cookie: tokens.secretaria },
      { id: String(areaId), uid: "coids.secretaria" },
    );
    expect(res.status).toBe(400);
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
    expect(semAcesso.status).toBe(403);
  });

  it("admin desativa a área (soft delete) — some do hub e do acesso", async () => {
    const del = await call(areaDELETE, "DELETE", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(del.status).toBe(200);

    const hub = (await (
      await call(areasGET, "GET", "/api/areas", { cookie: tokens.secretaria })
    ).json()) as { areas: { id: number }[] };
    expect(hub.areas.some((a) => a.id === areaId)).toBe(false);

    const detalhe = await call(areaGET, "GET", `/api/areas/${areaId}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaId) });
    expect(detalhe.status).toBe(404);
  });
});
