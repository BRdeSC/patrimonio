import { beforeAll, describe, expect, it } from "vitest";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { ensureTestDatabase } from "../helpers/test-db";
import { call, cookieToken } from "../helpers/http";

const IP = "10.1.0.1";

async function login(uid: string, senha: string) {
  const res = await call(loginPOST, "POST", "/api/auth/login", {
    body: { uid, senha },
    ip: IP,
  });
  return { res, token: cookieToken(res) };
}

describe("auth (MockIpaProvider)", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("login ok: cria sessão, retorna user e cookie HttpOnly/Strict", async () => {
    const { res, token } = await login("coids.gestor", "mock123");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      user: { uid: string; nome: string; email: string | null; areas: unknown[] };
    };
    expect(body.user.uid).toBe("coids.gestor");
    expect(body.user.nome).toBe("Gestor COIDS");
    expect(body.user.email).toBe("coids.gestor@exemplo.com.br");
    expect(Array.isArray(body.user.areas)).toBe(true);

    // Cookie da sessão
    expect(token).toBeTruthy();
    expect(token!.length).toBe(64); // 32 bytes hex
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Secure"); // dev http
  });

  it("login com senha errada: 401 genérico (anti enumeração)", async () => {
    const { res } = await login("coids.gestor", "senha-errada");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { erro: string };
    expect(body.erro).toBe("Credenciais inválidas");
  });

  it("login com uid inexistente: 401 com a MESMA mensagem", async () => {
    const { res } = await login("usuario.que.nao.existe", "mock123");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { erro: string };
    expect(body.erro).toBe("Credenciais inválidas");
  });

  it("login com payload inválido: 400", async () => {
    const res = await call(loginPOST, "POST", "/api/auth/login", {
      body: { uid: "", senha: "" },
      ip: IP,
    });
    expect(res.status).toBe(400);
  });

  it("me sem sessão: 401", async () => {
    const res = await call(meGET, "GET", "/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("me com sessão: retorna o usuário", async () => {
    const { res, token } = await login("outro.area", "mock123");
    expect(res.status).toBe(200);
    expect(token).toBeTruthy();

    const meRes = await call(meGET, "GET", "/api/auth/me", { cookie: token });
    expect(meRes.status).toBe(200);
    const body = (await meRes.json()) as { user: { uid: string } };
    expect(body.user.uid).toBe("outro.area");
  });

  it("logout revoga a sessão (token vira inválido)", async () => {
    const { res, token } = await login("coids.secretaria", "mock123");
    expect(res.status).toBe(200);
    expect(token).toBeTruthy();

    const out = await call(logoutPOST, "POST", "/api/auth/logout", { cookie: token, ip: IP });
    expect(out.status).toBe(200);

    const meRes = await call(meGET, "GET", "/api/auth/me", { cookie: token });
    expect(meRes.status).toBe(401);
  });

  it("token aleatório/forjado: 401", async () => {
    const res = await call(meGET, "GET", "/api/auth/me", { cookie: "f" + "0".repeat(63) });
    expect(res.status).toBe(401);
  });
});
