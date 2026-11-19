import { describe, expect, it } from "vitest";
import { loginSchema } from "@/lib/validators/auth";
import { createAreaSchema, updateAreaSchema } from "@/lib/validators/area";
import { addMemberSchema, updateMemberSchema } from "@/lib/validators/member";

describe("loginSchema", () => {
  it("aceita credenciais válidas", () => {
    expect(loginSchema.safeParse({ uid: "coids.gestor", senha: "mock123" }).success).toBe(true);
  });

  it("rejeita senha vazia", () => {
    expect(loginSchema.safeParse({ uid: "coids.gestor", senha: "" }).success).toBe(false);
  });

  it("rejeita uid com caracteres perigosos", () => {
    expect(loginSchema.safeParse({ uid: "mal/icious", senha: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ uid: "a b", senha: "x" }).success).toBe(false);
  });
});

describe("createAreaSchema", () => {
  it("aceita nome e descrição opcional", () => {
    expect(createAreaSchema.safeParse({ nome: "COIDS" }).success).toBe(true);
    expect(createAreaSchema.safeParse({ nome: "COIDS", descricao: "Área de TI" }).success).toBe(
      true,
    );
  });

  it("rejeita nome curto demais", () => {
    expect(createAreaSchema.safeParse({ nome: "C" }).success).toBe(false);
  });

  it("rejeita descrição longa demais", () => {
    expect(createAreaSchema.safeParse({ nome: "COIDS", descricao: "x".repeat(501) }).success).toBe(
      false,
    );
  });
});

describe("updateAreaSchema (allowlist anti mass-assignment)", () => {
  it("rejeita objeto vazio", () => {
    expect(updateAreaSchema.safeParse({}).success).toBe(false);
  });

  it("rejeita visibilidade fora do enum", () => {
    expect(updateAreaSchema.safeParse({ visibilidade: "aberta" }).success).toBe(false);
  });

  it("rejeita campos fora da allowlist", () => {
    expect(updateAreaSchema.safeParse({ slug: "hack", criadoPor: 1 }).success).toBe(false);
  });

  it("aceita apenas campos permitidos", () => {
    expect(updateAreaSchema.safeParse({ nome: "Nova", visibilidade: "publica_leitura" }).success).toBe(
      true,
    );
  });
});

describe("schemas de membros", () => {
  it("addMemberSchema aceita os 3 papéis (OWNER concedível desde o turno D2)", () => {
    expect(addMemberSchema.safeParse({ uid: "x.y", papel: "OWNER" }).success).toBe(true);
    expect(addMemberSchema.safeParse({ uid: "x.y", papel: "OPERATOR" }).success).toBe(true);
    expect(addMemberSchema.safeParse({ uid: "x.y", papel: "VIEWER" }).success).toBe(true);
  });

  it("addMemberSchema rejeita papel fora do enum", () => {
    expect(addMemberSchema.safeParse({ uid: "x.y", papel: "ADMIN" }).success).toBe(false);
  });

  it("updateMemberSchema aceita papel=OWNER (guard do último OWNER vive na rota)", () => {
    expect(updateMemberSchema.safeParse({ papel: "OWNER" }).success).toBe(true);
  });

  it("updateMemberSchema aceita alterações parciais válidas", () => {
    expect(updateMemberSchema.safeParse({ ativo: false }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ papel: "VIEWER" }).success).toBe(true);
  });

  it("updateMemberSchema rejeita papel fora do enum", () => {
    expect(updateMemberSchema.safeParse({ papel: "ADMIN" }).success).toBe(false);
  });

  it("updateMemberSchema rejeita objeto vazio", () => {
    expect(updateMemberSchema.safeParse({}).success).toBe(false);
  });
});
