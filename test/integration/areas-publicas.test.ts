import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as areasPOST } from "@/app/api/areas/route";
import { GET as publicasGET } from "@/app/api/areas/publicas/route";
import {
  GET as areaGET,
  PATCH as areaPATCH,
} from "@/app/api/areas/[id]/route";
import {
  GET as patListGET,
  POST as patPOST,
} from "@/app/api/areas/[id]/patrimonios/route";
import {
  GET as patDetailGET,
  PATCH as patPATCH,
} from "@/app/api/areas/[id]/patrimonios/[pid]/route";
import { ensureTestDatabase } from "../helpers/test-db";
import { call, cookieToken } from "../helpers/http";
import { prisma } from "@/lib/prisma";

const SUFFIX = Date.now().toString(36);

type Tokens = { gestor: string; outro: string };
const tokens: Tokens = { gestor: "", outro: "" };
let areaPub = 0; // publica_leitura; gestor é membro (admin), outro NÃO é
let areaInativa = 0; // pública mas desativada (ativo=false)
let pidPub = 0; // PAT-PUB-001 em areaPub

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

async function idsPublicas(cookie: string): Promise<number[]> {
  const res = await call(publicasGET, "GET", "/api/areas/publicas", { cookie });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { areas: { id: number; papel: string | null }[] };
  return body.areas.map((a) => a.id);
}

describe("áreas públicas: descoberta + leitura (pacote ③-A)", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    tokens.gestor = await login("coids.gestor", "10.6.0.1");
    tokens.outro = await login("outro.area", "10.6.0.2");

    // Área pública: gestor cria (admin) e abre a leitura pública.
    const resPub = await call(areasPOST, "POST", "/api/areas", {
      body: { nome: `Pública ${SUFFIX}` },
      cookie: tokens.gestor,
      ip: "10.6.0.1",
    });
    expect(resPub.status).toBe(201);
    areaPub = ((await resPub.json()) as { area: { id: number } }).area.id;
    expect(
      (
        await call(areaPATCH, "PATCH", `/api/areas/${areaPub}`, {
          body: { visibilidade: "publica_leitura" },
          cookie: tokens.gestor,
        }, { id: String(areaPub) })
      ).status,
    ).toBe(200);

    // Um patrimônio na área pública (para os casos de leitura).
    const resPat = await call(patPOST, "POST", `/api/areas/${areaPub}/patrimonios`, {
      body: { numero: "PAT-PUB-001", descricao: "Monitor público", detentor: "Ana" },
      cookie: tokens.gestor,
    }, { id: String(areaPub) });
    expect(resPat.status).toBe(201);
    pidPub = ((await resPat.json()) as { patrimonio: { id: number } }).patrimonio.id;

    // Área que será pública e depois desativada (ativo=false via prisma —
    // DELETE agora é HARD; para testar a clausula ativo:true usamos update).
    const resInat = await call(areasPOST, "POST", "/api/areas", {
      body: { nome: `Inativa ${SUFFIX}` },
      cookie: tokens.gestor,
      ip: "10.6.0.1",
    });
    expect(resInat.status).toBe(201);
    areaInativa = ((await resInat.json()) as { area: { id: number } }).area.id;
    expect(
      (
        await call(areaPATCH, "PATCH", `/api/areas/${areaInativa}`, {
          body: { visibilidade: "publica_leitura" },
          cookie: tokens.gestor,
        }, { id: String(areaInativa) })
      ).status,
    ).toBe(200);
    await prisma.area.update({
      where: { id: areaInativa },
      data: { ativo: false },
    });
  });

  it("sem sessão → 401", async () => {
    const res = await call(publicasGET, "GET", "/api/areas/publicas", {});
    expect(res.status).toBe(401);
  });

  it("área publica_leitura aparece na descoberta do não-membro (200 + corpo)", async () => {
    const res = await call(publicasGET, "GET", "/api/areas/publicas", { cookie: tokens.outro });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      areas: { id: number; nome: string; papel: string | null; itens: number; criadaEm: string }[];
    };
    expect(body.areas.map((a) => a.id)).toContain(areaPub);
    const pub = body.areas.find((a) => a.id === areaPub)!;
    expect(pub.papel).toBeNull();
    expect(pub.itens).toBe(1);
    expect(pub.criadaEm).toBeTruthy();
  });

  it("área própria (membro ativo) NÃO aparece em publicas (sem duplicar)", async () => {
    // gestor é membro ativo (admin) de areaPub → não recebe a própria área.
    const idsGestor = await idsPublicas(tokens.gestor);
    expect(idsGestor).not.toContain(areaPub);
    // outro (não-membro) recebe — mesma área, visões distintas.
    const idsOutro = await idsPublicas(tokens.outro);
    expect(idsOutro).toContain(areaPub);
  });

  it("área inativa (ativo=false) NÃO aparece nem mesmo sendo pública", async () => {
    // Área desativada via prisma (ativo=false): o único fator de exclusão da
    // descoberta é a clausula ativo:true — a linha continua existindo.
    const linha = await prisma.area.findUnique({ where: { id: areaInativa } });
    expect(linha).not.toBeNull();
    expect(linha!.ativo).toBe(false);
    expect(linha!.visibilidade).toBe("publica_leitura");

    const idsOutro = await idsPublicas(tokens.outro);
    expect(idsOutro).not.toContain(areaInativa);
    const idsGestor = await idsPublicas(tokens.gestor);
    expect(idsGestor).not.toContain(areaInativa);
  });

  it("não-membro de área pública: leitura 200 (corpo) em área/lista/detalhe; escrita 403", async () => {
    // GET da área: 200 com papel null / isMember false.
    const area = await call(areaGET, "GET", `/api/areas/${areaPub}`, { cookie: tokens.outro }, {
      id: String(areaPub),
    });
    expect(area.status).toBe(200);
    const corpoArea = (await area.json()) as {
      area: { id: number; papel: string | null; isMember: boolean };
    };
    expect(corpoArea.area.id).toBe(areaPub);
    expect(corpoArea.area.papel).toBeNull();
    expect(corpoArea.area.isMember).toBe(false);

    // Lista de patrimônios: 200 + corpo com o item esperado.
    const lista = await call(patListGET, "GET", `/api/areas/${areaPub}/patrimonios`, {
      cookie: tokens.outro,
    }, { id: String(areaPub) });
    expect(lista.status).toBe(200);
    const corpoLista = (await lista.json()) as {
      patrimonios: { id: number; numero: string; temFoto: boolean }[];
    };
    expect(corpoLista.patrimonios.some((p) => p.id === pidPub)).toBe(true);
    expect(corpoLista.patrimonios.find((p) => p.id === pidPub)!.temFoto).toBe(false);

    // Detalhe: 200 + corpo.
    const detalhe = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaPub}/patrimonios/${pidPub}`,
      { cookie: tokens.outro },
      { id: String(areaPub), pid: String(pidPub) },
    );
    expect(detalhe.status).toBe(200);
    const corpoDetalhe = (await detalhe.json()) as {
      patrimonio: { id: number; numero: string };
    };
    expect(corpoDetalhe.patrimonio.id).toBe(pidPub);
    expect(corpoDetalhe.patrimonio.numero).toBe("PAT-PUB-001");

    // Escrita: 403 (área existe e é visível → erro informativo, não 404).
    const patch = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaPub}/patrimonios/${pidPub}`,
      { body: { descricao: "hack público" }, cookie: tokens.outro },
      { id: String(areaPub), pid: String(pidPub) },
    );
    expect(patch.status).toBe(403);

    // Efeito: nada mudou.
    const intacto = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaPub}/patrimonios/${pidPub}`,
      { cookie: tokens.gestor },
      { id: String(areaPub), pid: String(pidPub) },
    );
    const corpoIntacto = (await intacto.json()) as { patrimonio: { descricao: string } };
    expect(corpoIntacto.patrimonio.descricao).toBe("Monitor público");
  });
});
