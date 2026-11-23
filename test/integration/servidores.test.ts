import { beforeAll, describe, expect, it } from "vitest";
import { GET as servidoresGET } from "@/app/api/servidores/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
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

describe("GET /api/servidores (MockIpaProvider)", () => {
  beforeAll(async () => {
    await ensureTestDatabase();
  });

  it("nao autenticado: 401", async () => {
    const res = await call(servidoresGET, "GET", "/api/servidores", { ip: IP });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { erro: string };
    expect(body.erro).toBeTruthy();
  });

  it("autenticado: retorna a lista de servidores (Mock = MOCK_USERS)", async () => {
    const { token } = await login("coids.gestor", "mock123");
    expect(token).toBeTruthy();
    const res = await call(servidoresGET, "GET", "/api/servidores", {
      cookie: token!,
      ip: IP,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      servidores: { uid: string; nome: string; email: string | null }[];
    };
    expect(Array.isArray(body.servidores)).toBe(true);
    expect(body.servidores.length).toBeGreaterThan(0);
    // Cada item tem shape correto
    for (const s of body.servidores) {
      expect(typeof s.uid).toBe("string");
      expect(typeof s.nome).toBe("string");
      expect(s.email === null || typeof s.email === "string").toBe(true);
    }
  });

  it("contem coids.gestor (user mock) como servidor", async () => {
    const { token } = await login("coids.gestor", "mock123");
    const res = await call(servidoresGET, "GET", "/api/servidores", {
      cookie: token!,
      ip: IP,
    });
    const body = (await res.json()) as {
      servidores: { uid: string }[];
    };
    expect(body.servidores.some((s) => s.uid === "coids.gestor")).toBe(true);
  });
});
