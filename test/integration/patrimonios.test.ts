// @vitest-environment node
// Ambiente node: File/FormData/Request do undici precisam ser do mesmo "mundo"
// (o ambiente jsdom global faz o Request rejeitar o FormData do jsdom no upload).
import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as areasGET, POST as areasPOST } from "@/app/api/areas/route";
import { PATCH as areaPATCH } from "@/app/api/areas/[id]/route";
import { POST as membersPOST } from "@/app/api/areas/[id]/members/route";
import {
  DELETE as memberDELETE,
  PATCH as memberPATCH,
} from "@/app/api/areas/[id]/members/[uid]/route";
import { GET as patListGET, POST as patPOST } from "@/app/api/areas/[id]/patrimonios/route";
import {
  DELETE as patDELETE,
  GET as patDetailGET,
  PATCH as patPATCH,
} from "@/app/api/areas/[id]/patrimonios/[pid]/route";
import { GET as fotoGET } from "@/app/api/areas/[id]/patrimonios/[pid]/foto/route";
import { GET as fotosListGET, POST as fotosPOST } from "@/app/api/areas/[id]/patrimonios/[pid]/fotos/route";
import {
  DELETE as fotoFidDELETE,
  GET as fotoFidGET,
} from "@/app/api/areas/[id]/patrimonios/[pid]/fotos/[fid]/route";
import { POST as fotosReorderPOST } from "@/app/api/areas/[id]/patrimonios/[pid]/fotos/reordenar/route";
import { ensureTestDatabase } from "../helpers/test-db";
import { call, cookieToken } from "../helpers/http";

const SUFFIX = Date.now().toString(36);

type Tokens = { gestor: string; secretaria: string; outro: string };
const tokens: Tokens = { gestor: "", secretaria: "", outro: "" };
let areaA = 0; // secretaria (OWNER) + outro (VIEWER); gestor FORA da área
let areaB = 0; // só gestor (admin)
let pidMonitor = 0; // PAT-002 em A (usado em RBAC/foto)
let pidServidor = 0; // PAT-100 em A (mass-assignment)
let pidB = 0; // PAT-B-001 em B (IDOR)

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

async function criarPatrimonio(
  areaId: number,
  cookie: string,
  corpo: Record<string, unknown>,
): Promise<number> {
  const res = await call(
    patPOST,
    "POST",
    `/api/areas/${areaId}/patrimonios`,
    { body: corpo, cookie },
    { id: String(areaId) },
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { patrimonio: { id: number } };
  return body.patrimonio.id;
}

// Bytes "jpeg" de teste (conteúdo irrelevante — sem validação de magic bytes).
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("CRUD de patrimônios + foto (multi-tenant, RBAC, BLOB)", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
    tokens.gestor = await login("coids.gestor", "10.4.0.1");
    tokens.secretaria = await login("coids.secretaria", "10.4.0.2");
    tokens.outro = await login("outro.area", "10.4.0.3");

    // Área A: gestor cria; secretaria (OPERATOR) e outro (VIEWER) entram.
    const resA = await call(areasPOST, "POST", "/api/areas", {
      body: { nome: `Patr A ${SUFFIX}` },
      cookie: tokens.gestor,
      ip: "10.4.0.1",
    });
    expect(resA.status).toBe(201);
    areaA = ((await resA.json()) as { area: { id: number } }).area.id;

    expect(
      (
        await call(membersPOST, "POST", `/api/areas/${areaA}/members`, {
          body: { uid: "coids.secretaria", papel: "OPERATOR" },
          cookie: tokens.gestor,
        }, { id: String(areaA) })
      ).status,
    ).toBe(201);
    expect(
      (
        await call(membersPOST, "POST", `/api/areas/${areaA}/members`, {
          body: { uid: "outro.area", papel: "VIEWER" },
          cookie: tokens.gestor,
        }, { id: String(areaA) })
      ).status,
    ).toBe(201);

    // Gestor promove a secretaria a OWNER (via members) e depois sai da área A
    // removendo a si mesmo — permitido, pois há 2 OWNERs e o guard só protege
    // o ÚLTIMO OWNER ativo. Sem membership em A → IDOR "inverso" limpo.
    expect(
      (
        await call(memberPATCH, "PATCH", `/api/areas/${areaA}/members/coids.secretaria`, {
          body: { papel: "OWNER" },
          cookie: tokens.gestor,
        }, { id: String(areaA), uid: "coids.secretaria" })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(memberDELETE, "DELETE", `/api/areas/${areaA}/members/coids.gestor`, {
          cookie: tokens.gestor,
        }, { id: String(areaA), uid: "coids.gestor" })
      ).status,
    ).toBe(200);

    const hubGestor = (await (
      await call(areasGET, "GET", "/api/areas", { cookie: tokens.gestor })
    ).json()) as { areas: { id: number }[] };
    expect(hubGestor.areas.some((a) => a.id === areaA)).toBe(false);

    // Área B: só o gestor (admin).
    const resB = await call(areasPOST, "POST", "/api/areas", {
      body: { nome: `Patr B ${SUFFIX}` },
      cookie: tokens.gestor,
      ip: "10.4.0.1",
    });
    expect(resB.status).toBe(201);
    areaB = ((await resB.json()) as { area: { id: number } }).area.id;
  });

  // ---------------------------------------------------------------- (a) CRUD
  it("(a) ciclo CRUD: create 201 → list → detail → patch → delete → 404", async () => {
    const pid = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-001",
      descricao: "Notebook de teste",
      marca: "Dell",
      detentor: "Ana",
      localizacao: "Sala 1",
    });
    expect(pid).toBeGreaterThan(0);

    const lista = await call(patListGET, "GET", `/api/areas/${areaA}/patrimonios`, {
      cookie: tokens.secretaria,
    }, { id: String(areaA) });
    expect(lista.status).toBe(200);
    const itens = (await lista.json()) as {
      patrimonios: { id: number; numero: string; temFoto: boolean }[];
    };
    const item = itens.patrimonios.find((p) => p.id === pid);
    expect(item).toBeTruthy();
    expect(item!.temFoto).toBe(false);

    const detalhe = await call(patDetailGET, "GET", `/api/areas/${areaA}/patrimonios/${pid}`, {
      cookie: tokens.secretaria,
    }, { id: String(areaA), pid: String(pid) });
    expect(detalhe.status).toBe(200);
    let corpo = (await detalhe.json()) as { patrimonio: Record<string, unknown> };
    expect(corpo.patrimonio.numero).toBe("PAT-001");
    expect(corpo.patrimonio.detentor).toBe("Ana");

    const patch = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaA}/patrimonios/${pid}`,
      { body: { descricao: "Notebook atualizado", detentor: "Bruno" }, cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pid) },
    );
    expect(patch.status).toBe(200);

    // Efeito (re-leitura): mudanças persistiram; campo não tocado manteve.
    const depois = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaA}/patrimonios/${pid}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pid) },
    );
    corpo = (await depois.json()) as { patrimonio: Record<string, unknown> };
    expect(corpo.patrimonio.descricao).toBe("Notebook atualizado");
    expect(corpo.patrimonio.detentor).toBe("Bruno");
    expect(corpo.patrimonio.marca).toBe("Dell");

    const del = await call(
      patDELETE,
      "DELETE",
      `/api/areas/${areaA}/patrimonios/${pid}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pid) },
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    const sumario = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaA}/patrimonios/${pid}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pid) },
    );
    expect(sumario.status).toBe(404);
  });

  // --------------------------------------------------------------- (b) RBAC
  it("(b) RBAC: VIEWER (leitura) → 403 em todas as escritas", async () => {
    pidMonitor = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-002",
      descricao: "Monitor de teste",
      detentor: "Ana",
      localizacao: "Sala 9",
    });

    const create = await call(patPOST, "POST", `/api/areas/${areaA}/patrimonios`, {
      body: { numero: "PAT-002-BIS", descricao: "hackeria" },
      cookie: tokens.outro,
    }, { id: String(areaA) });
    expect(create.status).toBe(403);

    const patch = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaA}/patrimonios/${pidMonitor}`,
      { body: { descricao: "hack" }, cookie: tokens.outro },
      { id: String(areaA), pid: String(pidMonitor) },
    );
    expect(patch.status).toBe(403);

    const del = await call(
      patDELETE,
      "DELETE",
      `/api/areas/${areaA}/patrimonios/${pidMonitor}`,
      { cookie: tokens.outro },
      { id: String(areaA), pid: String(pidMonitor) },
    );
    expect(del.status).toBe(403);

    const fotoUp = await call(
      fotosPOST,
      "POST",
      `/api/areas/${areaA}/patrimonios/${pidMonitor}/fotos`,
      { cookie: tokens.outro, formData: new FormData() },
      { id: String(areaA), pid: String(pidMonitor) },
    );
    expect(fotoUp.status).toBe(403);
    expect(await fotoUp.json()).toEqual({ erro: "Acesso negado" });

    const fotoDel = await call(
      fotoFidDELETE,
      "DELETE",
      `/api/areas/${areaA}/patrimonios/${pidMonitor}/fotos/1`,
      { cookie: tokens.outro },
      { id: String(areaA), pid: String(pidMonitor), fid: "1" },
    );
    expect(fotoDel.status).toBe(403);
    expect(await fotoDel.json()).toEqual({ erro: "Acesso negado" });

    // Leitura total para VIEWER (efeito: o item esperado está presente no corpo).
    const lista = await call(patListGET, "GET", `/api/areas/${areaA}/patrimonios`, {
      cookie: tokens.outro,
    }, { id: String(areaA) });
    expect(lista.status).toBe(200);
    const itensLeitura = (await lista.json()) as { patrimonios: { id: number }[] };
    expect(itensLeitura.patrimonios.some((p) => p.id === pidMonitor)).toBe(true);

    // Efeito: após as rejeições, o patrimônio segue intacto.
    const detalhe = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaA}/patrimonios/${pidMonitor}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidMonitor) },
    );
    expect(detalhe.status).toBe(200);
    const corpo = (await detalhe.json()) as { patrimonio: { descricao: string } };
    expect(corpo.patrimonio.descricao).toBe("Monitor de teste");
  });

  // ---------------------------------------------------------------- (c) IDOR
  it("(c) IDOR cross-área: pid que existe em B acessado por membro de A (e inverso) → 404", async () => {
    pidB = await criarPatrimonio(areaB, tokens.gestor, {
      numero: "PAT-B-001",
      descricao: "Patrimônio da área B",
    });

    // secretaria (membro de A) acessa um pid que EXISTE em B, na URL da própria área:
    // lookup escopado por areaId → 404 genérico (nunca vaza existência cross-tenant).
    const detailAB = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaA}/patrimonios/${pidB}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidB) },
    );
    expect(detailAB.status).toBe(404);
    expect(await detailAB.json()).toEqual({ erro: "Patrimônio não encontrado" });

    const patchAB = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaA}/patrimonios/${pidB}`,
      { body: { descricao: "hack B" }, cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidB) },
    );
    expect(patchAB.status).toBe(404);
    expect(await patchAB.json()).toEqual({ erro: "Patrimônio não encontrado" });

    const delAB = await call(
      patDELETE,
      "DELETE",
      `/api/areas/${areaA}/patrimonios/${pidB}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidB) },
    );
    expect(delAB.status).toBe(404);
    expect(await delAB.json()).toEqual({ erro: "Patrimônio não encontrado" });

    const fotoAB = await call(
      fotoGET,
      "GET",
      `/api/areas/${areaA}/patrimonios/${pidB}/foto`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidB) },
    );
    expect(fotoAB.status).toBe(404);
    expect(await fotoAB.json()).toEqual({ erro: "Patrimônio não encontrado" });

    // O inverso: gestor (membro de B) acessa o pid de A na URL da própria área.
    const detailBA = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaB}/patrimonios/${pidMonitor}`,
      { cookie: tokens.gestor },
      { id: String(areaB), pid: String(pidMonitor) },
    );
    expect(detailBA.status).toBe(404);
    expect(await detailBA.json()).toEqual({ erro: "Patrimônio não encontrado" });

    const patchBA = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaB}/patrimonios/${pidMonitor}`,
      { body: { descricao: "hack A" }, cookie: tokens.gestor },
      { id: String(areaB), pid: String(pidMonitor) },
    );
    expect(patchBA.status).toBe(404);
    expect(await patchBA.json()).toEqual({ erro: "Patrimônio não encontrado" });

    const delBA = await call(
      patDELETE,
      "DELETE",
      `/api/areas/${areaB}/patrimonios/${pidMonitor}`,
      { cookie: tokens.gestor },
      { id: String(areaB), pid: String(pidMonitor) },
    );
    expect(delBA.status).toBe(404);
    expect(await delBA.json()).toEqual({ erro: "Patrimônio não encontrado" });

    const fotoBA = await call(
      fotoGET,
      "GET",
      `/api/areas/${areaB}/patrimonios/${pidMonitor}/foto`,
      { cookie: tokens.gestor },
      { id: String(areaB), pid: String(pidMonitor) },
    );
    expect(fotoBA.status).toBe(404);
    expect(await fotoBA.json()).toEqual({ erro: "Patrimônio não encontrado" });

    // pid inexistente dentro da própria área: 404 genérico (corpo idêntico).
    const inexistente = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaA}/patrimonios/999999999`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: "999999999" },
    );
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual({ erro: "Patrimônio não encontrado" });

    // Efeito: nada mudou cross-tenant.
    const listaB = (await (
      await call(patListGET, "GET", `/api/areas/${areaB}/patrimonios`, {
        cookie: tokens.gestor,
      }, { id: String(areaB) })
    ).json()) as { patrimonios: { id: number }[] };
    expect(listaB.patrimonios.some((p) => p.id === pidB)).toBe(true);
  });

  // -------------------------------------------------- (d) mass-assignment
  it("(d) mass-assignment: chaves extra são ignoradas (efeito por re-leitura)", async () => {
    const res = await call(patPOST, "POST", `/api/areas/${areaA}/patrimonios`, {
      body: {
        numero: "PAT-100",
        descricao: "Servidor de teste",
        id: 999999,
        areaId: areaB,
        criadoPor: 1,
        atualizadoPor: 1,
        atualizadoEm: "2020-01-01T00:00:00.000Z",
        temFoto: true,
        fotos: [1, 2],
      },
      cookie: tokens.secretaria,
    }, { id: String(areaA) });
    expect(res.status).toBe(201);
    const criado = (await res.json()) as { patrimonio: { id: number; temFoto: boolean } };
    pidServidor = criado.patrimonio.id;
    expect(criado.patrimonio.temFoto).toBe(false);

    // Efeito: re-leitura do detalhe — temFoto false (não vem do body);
    // o item pertence a A (na lista de A, ausente na de B).
    const detalhe = (await (
      await call(patDetailGET, "GET", `/api/areas/${areaA}/patrimonios/${pidServidor}`, {
        cookie: tokens.secretaria,
      }, { id: String(areaA), pid: String(pidServidor) })
    ).json()) as { patrimonio: Record<string, unknown> };
    expect(detalhe.patrimonio.numero).toBe("PAT-100");
    expect(detalhe.patrimonio.temFoto).toBe(false);

    const listaA = (await (
      await call(patListGET, "GET", `/api/areas/${areaA}/patrimonios?q=PAT-100`, {
        cookie: tokens.secretaria,
      }, { id: String(areaA) })
    ).json()) as { patrimonios: { id: number }[] };
    expect(listaA.patrimonios.map((p) => p.id)).toContain(pidServidor);

    const listaB = (await (
      await call(patListGET, "GET", `/api/areas/${areaB}/patrimonios?q=PAT-100`, {
        cookie: tokens.gestor,
      }, { id: String(areaB) })
    ).json()) as { patrimonios: { id: number }[] };
    expect(listaB.patrimonios.map((p) => p.id)).not.toContain(pidServidor);
  });

  // --------------------------------------------------------- (e) unicidade
  it("(e) unicidade: mesmo numero na mesma área → 409; em outra área → OK", async () => {
    const colide = await call(patPOST, "POST", `/api/areas/${areaA}/patrimonios`, {
      body: { numero: "PAT-100", descricao: "Colisão" },
      cookie: tokens.secretaria,
    }, { id: String(areaA) });
    expect(colide.status).toBe(409);
    expect(await colide.json()).toEqual({
      erro: "Já existe um patrimônio com esse número nesta área",
    });

    const outroLado = await call(patPOST, "POST", `/api/areas/${areaB}/patrimonios`, {
      body: { numero: "PAT-100", descricao: "Mesmo número, outra área" },
      cookie: tokens.gestor,
    }, { id: String(areaB) });
    expect(outroLado.status).toBe(201);

    // PATCH também revalida unicidade de numero.
    const pidWs = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-200",
      descricao: "Workstation",
    });
    const patchNumero = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaA}/patrimonios/${pidWs}`,
      { body: { numero: "PAT-100" }, cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidWs) },
    );
    expect(patchNumero.status).toBe(409);
  });

  // ---------------------------------------------------------------- (f) fotos
  it("(f) fotos: multi-upload → capa determinística → BLOB escopado → validações → remoção", async () => {
    const base = `/api/areas/${areaA}/patrimonios/${pidMonitor}/fotos`;
    const capa = `/api/areas/${areaA}/patrimonios/${pidMonitor}/foto`;
    const params = { id: String(areaA), pid: String(pidMonitor) };
    const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Sem cookie → 401.
    const semCookie = await call(fotosListGET, "GET", base, {}, params);
    expect(semCookie.status).toBe(401);

    // Multi-upload: 2 arquivos no mesmo POST → 200 com metadados em id asc.
    const fd = new FormData();
    fd.append("foto", new File([JPEG_BYTES], "foto.jpg", { type: "image/jpeg" }));
    fd.append("foto", new File([PNG_BYTES], "foto.png", { type: "image/png" }));
    const up = await call(fotosPOST, "POST", base, { cookie: tokens.secretaria, formData: fd }, params);
    expect(up.status).toBe(200);
    const corpoUp = (await up.json()) as { fotos: { id: number; tamanho: number; contentType: string }[] };
    expect(corpoUp.fotos).toHaveLength(2);
    expect(corpoUp.fotos[0].tamanho).toBe(JPEG_BYTES.length);
    expect(corpoUp.fotos[0].contentType).toBe("image/jpeg");
    expect(corpoUp.fotos[1].tamanho).toBe(PNG_BYTES.length);
    expect(corpoUp.fotos[1].contentType).toBe("image/png");
    // ids presentes e crescentes (ordem de envio ⇒ id asc).
    expect(typeof corpoUp.fotos[0].id).toBe("number");
    expect(corpoUp.fotos[1].id).toBeGreaterThan(corpoUp.fotos[0].id);
    const fid1 = corpoUp.fotos[0].id;
    const fid2 = corpoUp.fotos[1].id;

    // GET /foto (capa) = 1ª enviada: bytes idênticos + headers (leitura VIEWER).
    // D9: capa muda com a galeria → no-cache (lista reflete a troca p/ todos).
    const capaGet = await call(fotoGET, "GET", capa, { cookie: tokens.outro }, params);
    expect(capaGet.status).toBe(200);
    expect(capaGet.headers.get("content-type")).toBe("image/jpeg");
    expect(capaGet.headers.get("content-length")).toBe(String(JPEG_BYTES.length));
    expect(capaGet.headers.get("cache-control")).toBe("no-cache");
    expect(capaGet.headers.get("x-content-type-options")).toBe("nosniff");
    const bytesCapa = new Uint8Array(await capaGet.arrayBuffer());
    expect(Array.from(bytesCapa)).toEqual(Array.from(JPEG_BYTES));

    // GET /fotos → metadados SEM BLOB, em id asc.
    const lista = (await (
      await call(fotosListGET, "GET", base, { cookie: tokens.outro }, params)
    ).json()) as { fotos: { id: number; tamanho: number; contentType: string }[] };
    expect(lista.fotos).toEqual([
      { id: fid1, tamanho: JPEG_BYTES.length, contentType: "image/jpeg" },
      { id: fid2, tamanho: PNG_BYTES.length, contentType: "image/png" },
    ]);

    // GET /fotos/[fid] → BLOB escopado por id (a 2ª foto, PNG).
    const blob2 = await call(
      fotoFidGET,
      "GET",
      `${base}/${fid2}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidMonitor), fid: String(fid2) },
    );
    expect(blob2.status).toBe(200);
    expect(blob2.headers.get("content-type")).toBe("image/png");
    // Foto individual tem bytes imutáveis → segue cacheável (D9 só toca na capa).
    expect(blob2.headers.get("cache-control")).toBe("private, max-age=300");
    expect(Array.from(new Uint8Array(await blob2.arrayBuffer()))).toEqual(Array.from(PNG_BYTES));

    // Listagem reflete temFoto (efeito do upload).
    const listagem = (await (
      await call(patListGET, "GET", `/api/areas/${areaA}/patrimonios?q=PAT-002`, {
        cookie: tokens.secretaria,
      }, { id: String(areaA) })
    ).json()) as { patrimonios: { id: number; temFoto: boolean }[] };
    expect(listagem.patrimonios.find((p) => p.id === pidMonitor)!.temFoto).toBe(true);

    // Validações (paridade de mensagens com o ③): tipo fora do allowlist.
    const fdGif = new FormData();
    fdGif.append("foto", new File([new Uint8Array([0x47, 0x49, 0x46])], "a.gif", { type: "image/gif" }));
    const gif = await call(fotosPOST, "POST", base, { cookie: tokens.secretaria, formData: fdGif }, params);
    expect(gif.status).toBe(400);
    expect(await gif.json()).toEqual({ erro: "Formato não permitido (use JPEG, PNG ou WebP)" });

    // Acima de 5MB → 400.
    const fdGiga = new FormData();
    fdGiga.append(
      "foto",
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }),
    );
    const giga = await call(fotosPOST, "POST", base, { cookie: tokens.secretaria, formData: fdGiga }, params);
    expect(giga.status).toBe(400);
    expect(await giga.json()).toEqual({ erro: "Foto maior que 5MB" });

    // Campo ausente → 400.
    const vazio = await call(fotosPOST, "POST", base, { cookie: tokens.secretaria, formData: new FormData() }, params);
    expect(vazio.status).toBe(400);
    expect(await vazio.json()).toEqual({ erro: "Campo 'foto' ausente" });

    // Patrimônio inexistente na área → 404 (e nunca 500).
    const pidFalso = await call(
      fotosPOST,
      "POST",
      `/api/areas/${areaA}/patrimonios/999999999/fotos`,
      { cookie: tokens.secretaria, formData: fd },
      { id: String(areaA), pid: "999999999" },
    );
    expect(pidFalso.status).toBe(404);
    expect(await pidFalso.json()).toEqual({ erro: "Patrimônio não encontrado" });

    // Não-membro (gestor fora de A) → 404 idêntico ao inexistente (zero vazamento).
    const naoMembro = await call(fotosListGET, "GET", base, { cookie: tokens.gestor }, params);
    expect(naoMembro.status).toBe(404);
    expect(await naoMembro.json()).toEqual({ erro: "Área não encontrada" });
    const naoMembroFid = await call(
      fotoFidGET,
      "GET",
      `${base}/${fid1}`,
      { cookie: tokens.gestor },
      { id: String(areaA), pid: String(pidMonitor), fid: String(fid1) },
    );
    expect(naoMembroFid.status).toBe(404);
    expect(await naoMembroFid.json()).toEqual({ erro: "Área não encontrada" });

    // Capa determinística: remover a ÚLTIMA (fid2) não muda a capa.
    const delUltima = await call(
      fotoFidDELETE,
      "DELETE",
      `${base}/${fid2}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidMonitor), fid: String(fid2) },
    );
    expect(delUltima.status).toBe(200);
    expect(await delUltima.json()).toEqual({ ok: true });
    const capaMesma = await call(fotoGET, "GET", capa, { cookie: tokens.secretaria }, params);
    expect(capaMesma.status).toBe(200);
    expect(Array.from(new Uint8Array(await capaMesma.arrayBuffer()))).toEqual(Array.from(JPEG_BYTES));

    // Remover a capa (fid1) → GET /foto vira 404 + temFoto volta a false.
    const delCapa = await call(
      fotoFidDELETE,
      "DELETE",
      `${base}/${fid1}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidMonitor), fid: String(fid1) },
    );
    expect(delCapa.status).toBe(200);
    expect(await delCapa.json()).toEqual({ ok: true });
    const sumaria = await call(fotoGET, "GET", capa, { cookie: tokens.secretaria }, params);
    expect(sumaria.status).toBe(404);
    expect(await sumaria.json()).toEqual({ erro: "Foto não encontrada" });
    const listaDepois = (await (
      await call(patListGET, "GET", `/api/areas/${areaA}/patrimonios?q=PAT-002`, {
        cookie: tokens.secretaria,
      }, { id: String(areaA) })
    ).json()) as { patrimonios: { id: number; temFoto: boolean }[] };
    expect(listaDepois.patrimonios.find((p) => p.id === pidMonitor)!.temFoto).toBe(false);
  });

  it("(f2) fotos: escopo por fid (anti-IDOR), limite 10 e RBAC de escrita", async () => {
    const pidX = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-401",
      descricao: "Foto escopo",
      detentor: null,
      localizacao: null,
    });
    const baseX = `/api/areas/${areaA}/patrimonios/${pidX}/fotos`;
    const paramsX = { id: String(areaA), pid: String(pidX) };

    // Seed: 1 foto em X.
    const fd1 = new FormData();
    fd1.append("foto", new File([JPEG_BYTES], "s.jpg", { type: "image/jpeg" }));
    const up1 = await call(fotosPOST, "POST", baseX, { cookie: tokens.secretaria, formData: fd1 }, paramsX);
    expect(up1.status).toBe(200);
    const fidX = ((await up1.json()) as { fotos: { id: number }[] }).fotos[0].id;

    // IDOR: fid de X na URL de OUTRO patrimônio da área → 404 "Foto não encontrada" (GET e DELETE).
    const baseMonitor = `/api/areas/${areaA}/patrimonios/${pidMonitor}/fotos`;
    const idorGet = await call(
      fotoFidGET,
      "GET",
      `${baseMonitor}/${fidX}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidMonitor), fid: String(fidX) },
    );
    expect(idorGet.status).toBe(404);
    expect(await idorGet.json()).toEqual({ erro: "Foto não encontrada" });
    const idorDel = await call(
      fotoFidDELETE,
      "DELETE",
      `${baseMonitor}/${fidX}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidMonitor), fid: String(fidX) },
    );
    expect(idorDel.status).toBe(404);
    expect(await idorDel.json()).toEqual({ erro: "Foto não encontrada" });

    // Efeito: o patrimônio X permanece intacto após o IDOR rejeitado.
    const intacto = await call(
      fotoFidGET,
      "GET",
      `${baseX}/${fidX}`,
      { cookie: tokens.secretaria },
      { id: String(areaA), pid: String(pidX), fid: String(fidX) },
    );
    expect(intacto.status).toBe(200);

    // Limite: completa até 10 → ok; a 11ª → 400 com corpo exato.
    const fd9 = new FormData();
    for (let i = 0; i < 9; i++) {
      fd9.append("foto", new File([JPEG_BYTES], `m${i}.jpg`, { type: "image/jpeg" }));
    }
    const up9 = await call(fotosPOST, "POST", baseX, { cookie: tokens.secretaria, formData: fd9 }, paramsX);
    expect(up9.status).toBe(200);
    const galeria = (await (
      await call(fotosListGET, "GET", baseX, { cookie: tokens.secretaria }, paramsX)
    ).json()) as { fotos: unknown[] };
    expect(galeria.fotos).toHaveLength(10);

    const fdMais = new FormData();
    fdMais.append("foto", new File([JPEG_BYTES], "mais.jpg", { type: "image/jpeg" }));
    const decimoPrimeira = await call(fotosPOST, "POST", baseX, { cookie: tokens.secretaria, formData: fdMais }, paramsX);
    expect(decimoPrimeira.status).toBe(400);
    expect(await decimoPrimeira.json()).toEqual({ erro: "Limite de 10 fotos por patrimônio" });

    // RBAC nas rotas novas: VIEWER lê (200) mas não escreve (403).
    const leituraViewer = await call(fotosListGET, "GET", baseX, { cookie: tokens.outro }, paramsX);
    expect(leituraViewer.status).toBe(200);
    const escritaViewer = await call(fotosPOST, "POST", baseX, { cookie: tokens.outro, formData: fdMais }, paramsX);
    expect(escritaViewer.status).toBe(403);
    expect(await escritaViewer.json()).toEqual({ erro: "Acesso negado" });
    const delViewer = await call(
      fotoFidDELETE,
      "DELETE",
      `${baseX}/${fidX}`,
      { cookie: tokens.outro },
      { id: String(areaA), pid: String(pidX), fid: String(fidX) },
    );
    expect(delViewer.status).toBe(403);
    expect(await delViewer.json()).toEqual({ erro: "Acesso negado" });
  });

  // ------------------------------------------------- (j) reordenar galeria (DnD)
  it("(j) fotos: reordenar — capa, ordem, validação de conjunto, RBAC, escopo, compat", async () => {
    const pidR = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-501",
      descricao: "Reordenar",
      detentor: null,
      localizacao: null,
    });
    const baseR = `/api/areas/${areaA}/patrimonios/${pidR}/fotos`;
    const capaR = `/api/areas/${areaA}/patrimonios/${pidR}/foto`;
    const paramsR = { id: String(areaA), pid: String(pidR) };
    const PNG_R = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const WEBP_R = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x57, 0x45, 0x42, 0x50]);

    // Seed: 3 fotos (A=JPEG, B=PNG, C=WebP). Todas ordem=0 → capa = menor id (A).
    const fd = new FormData();
    fd.append("foto", new File([JPEG_BYTES], "a.jpg", { type: "image/jpeg" }));
    fd.append("foto", new File([PNG_R], "b.png", { type: "image/png" }));
    fd.append("foto", new File([WEBP_R], "c.webp", { type: "image/webp" }));
    const up = await call(fotosPOST, "POST", baseR, { cookie: tokens.secretaria, formData: fd }, paramsR);
    expect(up.status).toBe(200);
    const corpo = (await up.json()) as { fotos: { id: number }[] };
    const [a, b, c] = corpo.fotos.map((f) => f.id);

    // Compat: antes de qualquer reorder, capa = menor id (bytes A).
    const capaAntes = await call(fotoGET, "GET", capaR, { cookie: tokens.secretaria }, paramsR);
    expect(Array.from(new Uint8Array(await capaAntes.arrayBuffer()))).toEqual(Array.from(JPEG_BYTES));

    // Reordenar [c, b, a]: C vira capa; A desliza para a 3ª (semântica de lista).
    const reorder = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: [c, b, a] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(reorder.status).toBe(200);
    expect(await reorder.json()).toEqual({ ok: true });

    // Capa agora = C (WebP) e a listagem reflete a nova ordem.
    const capaDepois = await call(fotoGET, "GET", capaR, { cookie: tokens.secretaria }, paramsR);
    expect(capaDepois.status).toBe(200);
    expect(capaDepois.headers.get("content-type")).toBe("image/webp");
    expect(Array.from(new Uint8Array(await capaDepois.arrayBuffer()))).toEqual(Array.from(WEBP_R));
    const lista = (await (
      await call(fotosListGET, "GET", baseR, { cookie: tokens.secretaria }, paramsR)
    ).json()) as { fotos: { id: number }[] };
    expect(lista.fotos.map((f) => f.id)).toEqual([c, b, a]);

    // Persistência: reordenar de volta [a, b, c] restaura a capa A.
    const volta = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: [a, b, c] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(volta.status).toBe(200);
    const capaRestaurada = await call(fotoGET, "GET", capaR, { cookie: tokens.secretaria }, paramsR);
    expect(Array.from(new Uint8Array(await capaRestaurada.arrayBuffer()))).toEqual(Array.from(JPEG_BYTES));

    // Validação de conjunto — galeria permanece intacta após cada rejeição.
    const intacta = async () => {
      const l = (await (
        await call(fotosListGET, "GET", baseR, { cookie: tokens.secretaria }, paramsR)
      ).json()) as { fotos: { id: number }[] };
      expect(l.fotos.map((f) => f.id)).toEqual([a, b, c]);
    };

    // Faltou fid → 400 genérico (não vaza qual falta).
    const faltou = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: [a, b] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(faltou.status).toBe(400);
    expect(await faltou.json()).toEqual({ erro: "Lista de fotos inválida" });
    await intacta();

    // Fid de OUTRO patrimônio na lista → 400 e o outro patrimônio intacto.
    const pidY = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-502",
      descricao: "Outra galeria",
      detentor: null,
      localizacao: null,
    });
    const baseY = `/api/areas/${areaA}/patrimonios/${pidY}/fotos`;
    const paramsY = { id: String(areaA), pid: String(pidY) };
    const fdY = new FormData();
    fdY.append("foto", new File([PNG_R], "y.png", { type: "image/png" }));
    const upY = await call(fotosPOST, "POST", baseY, { cookie: tokens.secretaria, formData: fdY }, paramsY);
    expect(upY.status).toBe(200);
    const fidY = ((await upY.json()) as { fotos: { id: number }[] }).fotos[0].id;
    const alheia = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: [a, b, fidY] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(alheia.status).toBe(400);
    expect(await alheia.json()).toEqual({ erro: "Lista de fotos inválida" });
    await intacta();
    // O patrimônio Y segue intacto (sua capa continua sendo a própria foto).
    const capaY = await call(
      fotoGET,
      "GET",
      `/api/areas/${areaA}/patrimonios/${pidY}/foto`,
      { cookie: tokens.secretaria },
      paramsY,
    );
    expect(capaY.status).toBe(200);
    expect(Array.from(new Uint8Array(await capaY.arrayBuffer()))).toEqual(Array.from(PNG_R));

    // Fid duplicada → 400.
    const duplicada = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: [a, a, b] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(duplicada.status).toBe(400);
    expect(await duplicada.json()).toEqual({ erro: "Lista de fotos inválida" });

    // Body malformado (não-array / não-inteiro) → 400 "Dados inválidos".
    const naoArray = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: "abc" } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(naoArray.status).toBe(400);
    expect(await naoArray.json()).toEqual({ erro: "Dados inválidos" });
    const naoInteiro = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: [a, b, 1.5] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(naoInteiro.status).toBe(400);
    expect(await naoInteiro.json()).toEqual({ erro: "Dados inválidos" });

    // RBAC: VIEWER → 403; não-membro de privada → 404 uniforme; sem cookie → 401.
    const viewer = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.outro, body: { ordem: [a, b, c] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toEqual({ erro: "Acesso negado" });
    const naoMembro = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { cookie: tokens.gestor, body: { ordem: [a, b, c] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(naoMembro.status).toBe(404);
    expect(await naoMembro.json()).toEqual({ erro: "Área não encontrada" });
    const semCookie = await call(
      fotosReorderPOST,
      "POST",
      `${baseR}/reordenar`,
      { body: { ordem: [a, b, c] } },
      { id: String(areaA), pid: String(pidR) },
    );
    expect(semCookie.status).toBe(401);

    // Escopo: patrimônio de OUTRA área no path → 404 (anti-IDOR).
    const areaAlheia = await call(
      fotosReorderPOST,
      "POST",
      `/api/areas/${areaA}/patrimonios/${pidB}/fotos/reordenar`,
      { cookie: tokens.secretaria, body: { ordem: [1, 2] } },
      { id: String(areaA), pid: String(pidB) },
    );
    expect(areaAlheia.status).toBe(404);
    expect(await areaAlheia.json()).toEqual({ erro: "Patrimônio não encontrado" });

    await intacta();
  });

  // ------------------------------------------------- (g) busca e filtros
  it("(g) busca q (numero+descricao i-sensível) e pendente=detentor", async () => {
    const p1 = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-301",
      descricao: "Notebook de pesquisa",
      detentor: "Zoe",
      localizacao: "ALFA-Sala A",
    });
    const p2 = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-302",
      descricao: "Impressora de pesquisa",
      detentor: null,
      localizacao: "ALFA-Sala B",
    });
    const p3 = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "PAT-303",
      descricao: "Scanner de pesquisa",
      detentor: null,
      localizacao: null,
    });

    const idsDaLista = async (query: string): Promise<number[]> => {
      const res = await call(patListGET, "GET", `/api/areas/${areaA}/patrimonios${query}`, {
        cookie: tokens.secretaria,
      }, { id: String(areaA) });
      expect(res.status).toBe(200);
      const b = (await res.json()) as { patrimonios: { id: number }[] };
      return b.patrimonios.map((p) => p.id);
    };

    // q casa em descricao (case-insensitive).
    expect(await idsDaLista("?q=notebook")).toEqual([p1]);

    // q casa em numero (case-insensitive).
    expect(await idsDaLista("?q=pat-302")).toEqual([p2]);

    // Filtro detentor: busca PARCIAL (contains) e i-sensível (pedido 8 do dono).
    expect(await idsDaLista("?detentor=zoe")).toEqual([p1]);
    expect(await idsDaLista("?detentor=zo")).toEqual([p1]);
    expect(await idsDaLista("?detentor=ZO")).toEqual([p1]);

    // Filtro localizacao: busca PARCIAL (contains) e i-sensível (pedido 8 do dono).
    // Token "ALFA" é único nesse bloco (a área tem dados de blocos anteriores).
    expect(await idsDaLista("?localizacao=ALFA-SALA%20B")).toEqual([p2]);
    expect(await idsDaLista("?localizacao=alfa")).toEqual([p1, p2]);

    // pendente=detentor: inclui os sem detentor, exclui o preenchido.
    const semDetIds = await idsDaLista("?pendente=detentor");
    expect(semDetIds).toContain(p2);
    expect(semDetIds).toContain(p3);
    expect(semDetIds).not.toContain(p1);

    // pendente=localizacao: só o sem localização.
    const semLocIds = await idsDaLista("?pendente=localizacao");
    expect(semLocIds).toContain(p3);
    expect(semLocIds).not.toContain(p2);
    expect(semLocIds).not.toContain(p1);

    // pendente=ambos: interseção.
    const ambosIds = await idsDaLista("?pendente=ambos");
    expect(ambosIds).toContain(p3);
    expect(ambosIds).not.toContain(p1);
    expect(ambosIds).not.toContain(p2);

    // Query inválida (pendente fora do enum) → 400.
    const invalida = await call(
      patListGET,
      "GET",
      `/api/areas/${areaA}/patrimonios?pendente=tudo`,
      { cookie: tokens.secretaria },
      { id: String(areaA) },
    );
    expect(invalida.status).toBe(400);
  });

  // ---------------------------------------- (h) F-1: não-membro de área PRIVADA
  it("(h) não-membro de área PRIVADA → 404 uniforme em todos os sub-recursos", async () => {
    // secretaria não é membro de B (privada): mesmo corpo do caso inexistente.
    const lista = await call(patListGET, "GET", `/api/areas/${areaB}/patrimonios`, {
      cookie: tokens.secretaria,
    }, { id: String(areaB) });
    expect(lista.status).toBe(404);
    expect(await lista.json()).toEqual({ erro: "Área não encontrada" });

    const detalhe = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaB}/patrimonios/${pidB}`,
      { cookie: tokens.secretaria },
      { id: String(areaB), pid: String(pidB) },
    );
    expect(detalhe.status).toBe(404);
    expect(await detalhe.json()).toEqual({ erro: "Área não encontrada" });

    const patch = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaB}/patrimonios/${pidB}`,
      { body: { descricao: "hack" }, cookie: tokens.secretaria },
      { id: String(areaB), pid: String(pidB) },
    );
    expect(patch.status).toBe(404);
    expect(await patch.json()).toEqual({ erro: "Área não encontrada" });

    const del = await call(
      patDELETE,
      "DELETE",
      `/api/areas/${areaB}/patrimonios/${pidB}`,
      { cookie: tokens.secretaria },
      { id: String(areaB), pid: String(pidB) },
    );
    expect(del.status).toBe(404);
    expect(await del.json()).toEqual({ erro: "Área não encontrada" });

    const foto = await call(
      fotoGET,
      "GET",
      `/api/areas/${areaB}/patrimonios/${pidB}/foto`,
      { cookie: tokens.secretaria },
      { id: String(areaB), pid: String(pidB) },
    );
    expect(foto.status).toBe(404);
    expect(await foto.json()).toEqual({ erro: "Área não encontrada" });
  });

  // ------------------------------- (i) F-1: não-membro de área PÚBLICA (leitura)
  it("(i) não-membro de área PÚBLICA: leitura 200 (corpo) e escrita 403", async () => {
    // Admin (gestor) ativa a leitura pública da área B via PATCH.
    const abrir = await call(
      areaPATCH,
      "PATCH",
      `/api/areas/${areaB}`,
      { body: { visibilidade: "publica_leitura" }, cookie: tokens.gestor },
      { id: String(areaB) },
    );
    expect(abrir.status).toBe(200);

    // secretaria (não-membro, autenticado) lê o detalhe: 200 + corpo esperado.
    const detalhe = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaB}/patrimonios/${pidB}`,
      { cookie: tokens.secretaria },
      { id: String(areaB), pid: String(pidB) },
    );
    expect(detalhe.status).toBe(200);
    const corpo = (await detalhe.json()) as { patrimonio: { id: number; numero: string } };
    expect(corpo.patrimonio.id).toBe(pidB);
    expect(corpo.patrimonio.numero).toBe("PAT-B-001");

    // Escrita continua bloqueada (área visível → 403 informativo).
    const patch = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaB}/patrimonios/${pidB}`,
      { body: { descricao: "hack público" }, cookie: tokens.secretaria },
      { id: String(areaB), pid: String(pidB) },
    );
    expect(patch.status).toBe(403);
    expect(await patch.json()).toEqual({ erro: "Acesso negado" });

    // Efeito: nada mudou (re-leitura pela admin).
    const intacto = await call(
      patDetailGET,
      "GET",
      `/api/areas/${areaB}/patrimonios/${pidB}`,
      { cookie: tokens.gestor },
      { id: String(areaB), pid: String(pidB) },
    );
    const corpoIntacto = (await intacto.json()) as { patrimonio: { descricao: string } };
    expect(corpoIntacto.patrimonio.descricao).toBe("Patrimônio da área B");

    // Higiene: restaura a privacidade para não afetar outros contextos.
    const fechar = await call(
      areaPATCH,
      "PATCH",
      `/api/areas/${areaB}`,
      { body: { visibilidade: "privada" }, cookie: tokens.gestor },
      { id: String(areaB) },
    );
    expect(fechar.status).toBe(200);
  });

  // ------------------------------------------------- (k) ordenação da listagem (D6)
  it("(k) listagem: ordenação col/dir — asc/desc, marca+modelo, nulls, localizacao, atualizadoEm, inválido, padrão", async () => {
    // Token ORD- único: areaA acumula dados dos blocos anteriores (lição do ALFA).
    // Todas as descrições em minúsculas c/ prefixo comum → ordem alfabética
    // independente de colação do banco (C ou en_US).
    const seed: Record<string, Record<string, unknown>> = {
      "ORD-1": { descricao: "ordem beta", detentor: "Zoe", localizacao: "Zeta-sala" },
      "ORD-2": { descricao: "ordem alpha", detentor: "Ana", localizacao: "Alpha-sala" },
      "ORD-3": { descricao: "ordem gamma" }, // sem detentor/localizacao (null)
      "ORD-4": { descricao: "ordem delta", detentor: "Ana", marca: "Samsung", modelo: "Z10", localizacao: "Alpha-sala" },
      "ORD-5": { descricao: "ordem eps", detentor: "Ana", marca: "Samsung", modelo: "A20" },
      "ORD-6": { descricao: "ordem zeta", detentor: "Ana", marca: "Dell", localizacao: "Mid-sala" },
    };
    for (const [numero, campos] of Object.entries(seed)) {
      // 50ms entre criações → atualizadoEm distinguível (ms) p/ o caso 10.
      // (gap dobrado por recomendação do GATE 1 D6 — robustez do desc)
      await new Promise((r) => setTimeout(r, 50));
      await criarPatrimonio(areaA, tokens.secretaria, { numero, ...campos });
    }

    // Sempre q=ORD- para isolar os 6 itens do seed.
    const numeros = async (qs: string): Promise<string[]> => {
      const res = await call(
        patListGET,
        "GET",
        `/api/areas/${areaA}/patrimonios?${qs}`,
        { cookie: tokens.secretaria },
        { id: String(areaA) },
      );
      expect(res.status).toBe(200);
      const d = (await res.json()) as { patrimonios: { numero: string }[] };
      return d.patrimonios.map((p) => p.numero);
    };

    // 1) Padrão (sem params): numero asc — regressão do comportamento de hoje.
    expect(await numeros("q=ORD-")).toEqual(["ORD-1", "ORD-2", "ORD-3", "ORD-4", "ORD-5", "ORD-6"]);

    // 2/3) descricao asc/desc.
    expect(await numeros("q=ORD-&col=descricao&dir=asc")).toEqual(["ORD-2", "ORD-1", "ORD-4", "ORD-5", "ORD-3", "ORD-6"]);
    expect(await numeros("q=ORD-&col=descricao&dir=desc")).toEqual(["ORD-6", "ORD-3", "ORD-5", "ORD-4", "ORD-1", "ORD-2"]);

    // 4/5) detentor: asc → nulos por último; desc → nulos primeiro (default Postgres).
    expect(await numeros("q=ORD-&col=detentor&dir=asc")).toEqual(["ORD-2", "ORD-4", "ORD-5", "ORD-6", "ORD-1", "ORD-3"]);
    expect(await numeros("q=ORD-&col=detentor&dir=desc")).toEqual(["ORD-3", "ORD-1", "ORD-2", "ORD-4", "ORD-5", "ORD-6"]);

    // 6/7) localizacao: mesma regra de nulls.
    expect(await numeros("q=ORD-&col=localizacao&dir=asc")).toEqual(["ORD-2", "ORD-4", "ORD-6", "ORD-1", "ORD-3", "ORD-5"]);
    expect(await numeros("q=ORD-&col=localizacao&dir=desc")).toEqual(["ORD-3", "ORD-5", "ORD-1", "ORD-6", "ORD-2", "ORD-4"]);

    // 8/9) marca: asc → Dell < Samsung (modelo A20 < Z10) < nulos; desc inverte
    // (nulos primeiro, Samsung c/ modelo desc).
    expect(await numeros("q=ORD-&col=marca&dir=asc")).toEqual(["ORD-6", "ORD-5", "ORD-4", "ORD-1", "ORD-2", "ORD-3"]);
    expect(await numeros("q=ORD-&col=marca&dir=desc")).toEqual(["ORD-1", "ORD-2", "ORD-3", "ORD-4", "ORD-5", "ORD-6"]);

    // 10) atualizadoEm: criados em sequência → asc = ordem de criação, desc = invertida.
    expect(await numeros("q=ORD-&col=atualizadoEm&dir=asc")).toEqual(["ORD-1", "ORD-2", "ORD-3", "ORD-4", "ORD-5", "ORD-6"]);
    expect(await numeros("q=ORD-&col=atualizadoEm&dir=desc")).toEqual(["ORD-6", "ORD-5", "ORD-4", "ORD-3", "ORD-2", "ORD-1"]);

    // 11) Param inválido → 400 (allowlist do zod).
    for (const qs of ["q=ORD-&col=id", "q=ORD-&col=numero&dir=lateral"]) {
      const res = await call(
        patListGET,
        "GET",
        `/api/areas/${areaA}/patrimonios?${qs}`,
        { cookie: tokens.secretaria },
        { id: String(areaA) },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ erro: "Parâmetros inválidos" });
    }

    // 12) dir SEM col → contrato documentado: ignorado, ordem padrão.
    expect(await numeros("q=ORD-&dir=desc")).toEqual(["ORD-1", "ORD-2", "ORD-3", "ORD-4", "ORD-5", "ORD-6"]);

    // 13) Ordenação compõe com filtro: detentor=Ana + descricao asc.
    expect(await numeros("q=ORD-&detentor=Ana&col=descricao&dir=asc")).toEqual(["ORD-2", "ORD-4", "ORD-5", "ORD-6"]);
  });

  // ------------------------------------------------- (l) "atualizado por" no detalhe (D7)
  it("(l) detalhe: 'atualizado por' (D7) — criação → criador; PATCH → operador; lista não expõe", async () => {
    const pid = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "POR-1",
      descricao: "detalhe por",
    });
    const detalhePor = async (cookie: string) => {
      const res = await call(
        patDetailGET,
        "GET",
        `/api/areas/${areaA}/patrimonios/${pid}`,
        { cookie },
        { id: String(areaA), pid: String(pid) },
      );
      expect(res.status).toBe(200);
      const d = (await res.json()) as {
        patrimonio: { atualizadoPor: { uid: string; nome: string } | null };
      };
      return d.patrimonio.atualizadoPor;
    };

    // Criação já registra o criador.
    let por = await detalhePor(tokens.secretaria);
    expect(por?.uid).toBe("coids.secretaria");

    // Gestor entra como OPERATOR (secretaria é OWNER) e edita → autor muda.
    const add = await call(
      membersPOST,
      "POST",
      `/api/areas/${areaA}/members`,
      { body: { uid: "coids.gestor", papel: "OPERATOR" }, cookie: tokens.secretaria },
      { id: String(areaA) },
    );
    expect(add.status).toBe(201);
    const patch = await call(
      patPATCH,
      "PATCH",
      `/api/areas/${areaA}/patrimonios/${pid}`,
      { body: { descricao: "detalhe por (editado)" }, cookie: tokens.gestor },
      { id: String(areaA), pid: String(pid) },
    );
    expect(patch.status).toBe(200);
    // D7-1: a resposta do PATCH já traz o novo autor (campo não some pós-save).
    const patchBody = (await patch.json()) as {
      patrimonio: { atualizadoPor: { uid: string; nome: string } | null };
    };
    expect(patchBody.patrimonio.atualizadoPor?.uid).toBe("coids.gestor");
    por = await detalhePor(tokens.secretaria);
    expect(por?.uid).toBe("coids.gestor");

    // Escopo D7 = detalhe: a listagem continua SEM o campo.
    const res = await call(
      patListGET,
      "GET",
      `/api/areas/${areaA}/patrimonios?q=POR-1`,
      { cookie: tokens.secretaria },
      { id: String(areaA) },
    );
    expect(res.status).toBe(200);
    const d = (await res.json()) as { patrimonios: Record<string, unknown>[] };
    expect(d.patrimonios.length).toBe(1);
    expect("atualizadoPor" in d.patrimonios[0]).toBe(false);
  });

  // --------------------------------------------- (m) foto como alteração (D8)
  it("(m) fotos: adicionar/reordenar/remover registram 'atualizado por' do operador (D8); VIEWER segue bloqueado", async () => {
    const pid = await criarPatrimonio(areaA, tokens.secretaria, {
      numero: "FOT-1",
      descricao: "foto como alteracao",
    });
    const params = { id: String(areaA), pid: String(pid) };
    const base = `/api/areas/${areaA}/patrimonios/${pid}/fotos`;

    const detalhe = async (cookie: string) => {
      const res = await call(
        patDetailGET,
        "GET",
        `/api/areas/${areaA}/patrimonios/${pid}`,
        { cookie },
        { id: String(areaA), pid: String(pid) },
      );
      expect(res.status).toBe(200);
      const d = (await res.json()) as {
        patrimonio: {
          atualizadoEm: string;
          atualizadoPor: { uid: string; nome: string } | null;
        };
      };
      return d.patrimonio;
    };

    // Baseline: criação registra o criador (secretaria, OWNER da área).
    const p0 = await detalhe(tokens.secretaria);
    expect(p0.atualizadoPor?.uid).toBe("coids.secretaria");
    const t0 = p0.atualizadoEm;
    // 50ms → atualizadoEm (ms na serialização) distinguível no próximo passo.
    await new Promise((r) => setTimeout(r, 50));

    // Adicionar (2 fotos) como gestor (OPERATOR) → autor = gestor, tempo avança.
    const fd = new FormData();
    fd.append("foto", new File([JPEG_BYTES], "a.jpg", { type: "image/jpeg" }));
    fd.append(
      "foto",
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "b.png", {
        type: "image/png",
      }),
    );
    const up = await call(fotosPOST, "POST", base, { cookie: tokens.gestor, formData: fd }, params);
    expect(up.status).toBe(200);
    const upload = (await up.json()) as { fotos: { id: number }[] };
    expect(upload.fotos).toHaveLength(2);
    const p1 = await detalhe(tokens.secretaria);
    expect(p1.atualizadoPor?.uid).toBe("coids.gestor");
    expect(p1.atualizadoEm > t0).toBe(true);

    // Reordenar (capa = 2ª foto) como secretaria → autor muda de novo.
    const reorder = await call(
      fotosReorderPOST,
      "POST",
      `${base}/reordenar`,
      { body: { ordem: [upload.fotos[1].id, upload.fotos[0].id] }, cookie: tokens.secretaria },
      params,
    );
    expect(reorder.status).toBe(200);
    const p2 = await detalhe(tokens.gestor);
    expect(p2.atualizadoPor?.uid).toBe("coids.secretaria");

    // Remover (como gestor) → "atualizado por" volta a ser o gestor.
    const del = await call(
      fotoFidDELETE,
      "DELETE",
      `${base}/${upload.fotos[0].id}`,
      { cookie: tokens.gestor },
      { id: String(areaA), pid: String(pid), fid: String(upload.fotos[0].id) },
    );
    expect(del.status).toBe(200);
    const p3 = await detalhe(tokens.secretaria);
    expect(p3.atualizadoPor?.uid).toBe("coids.gestor");

    // VIEWER (outro.area) continua sem escrita na galeria (RBAC da superfície D8).
    const fdV = new FormData();
    fdV.append("foto", new File([JPEG_BYTES], "c.jpg", { type: "image/jpeg" }));
    const upV = await call(fotosPOST, "POST", base, { cookie: tokens.outro, formData: fdV }, params);
    expect(upV.status).toBe(403);
    expect(await upV.json()).toEqual({ erro: "Acesso negado" });
  });
});
