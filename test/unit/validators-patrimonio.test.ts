import { describe, expect, it } from "vitest";
import {
  createPatrimonioSchema,
  listPatrimoniosQuerySchema,
  updatePatrimonioSchema,
} from "@/lib/validators/patrimonio";

describe("createPatrimonioSchema", () => {
  it("aceita numero + descricao mínimos", () => {
    const r = createPatrimonioSchema.safeParse({ numero: "CO-01", descricao: "Notebook" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({
        numero: "CO-01",
        descricao: "Notebook",
        marca: null,
        modelo: null,
        serie: null,
        responsavel: null,
        detentor: null,
        localizacao: null,
      });
    }
  });

  it("trims todos os campos e trata '' em opcionais como null", () => {
    const r = createPatrimonioSchema.safeParse({
      numero: "  CO-01  ",
      descricao: "  Notebook  ",
      marca: " Dell ",
      detentor: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.numero).toBe("CO-01");
      expect(r.data.descricao).toBe("Notebook");
      expect(r.data.marca).toBe("Dell");
      expect(r.data.detentor).toBe(null);
    }
  });

  it("rejeita numero ausente, vazio ou só espaços", () => {
    expect(createPatrimonioSchema.safeParse({ descricao: "x" }).success).toBe(false);
    expect(createPatrimonioSchema.safeParse({ numero: "", descricao: "x" }).success).toBe(false);
    expect(createPatrimonioSchema.safeParse({ numero: "   ", descricao: "x" }).success).toBe(
      false,
    );
  });

  it("rejeita descricao ausente/vazia", () => {
    expect(createPatrimonioSchema.safeParse({ numero: "CO-01" }).success).toBe(false);
    expect(createPatrimonioSchema.safeParse({ numero: "CO-01", descricao: "  " }).success).toBe(
      false,
    );
  });

  it("rejeita tamanhos acima do limite (64/500/200)", () => {
    expect(createPatrimonioSchema.safeParse({ numero: "x".repeat(65), descricao: "d" }).success).toBe(
      false,
    );
    expect(
      createPatrimonioSchema.safeParse({ numero: "CO", descricao: "d".repeat(501) }).success,
    ).toBe(false);
    expect(
      createPatrimonioSchema.safeParse({ numero: "CO", descricao: "d", marca: "m".repeat(201) })
        .success,
    ).toBe(false);
  });

  it("stripa campos fora da allowlist (mass-assignment)", () => {
    const r = createPatrimonioSchema.safeParse({
      numero: "CO-01",
      descricao: "Notebook",
      id: 999,
      areaId: 7,
      criadoPor: 1,
      temFoto: true,
      fotos: [1, 2],
      papel: "OWNER",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("id");
      expect(r.data).not.toHaveProperty("areaId");
      expect(r.data).not.toHaveProperty("criadoPor");
      expect(r.data).not.toHaveProperty("temFoto");
      expect(r.data).not.toHaveProperty("fotos");
      expect(r.data).not.toHaveProperty("papel");
    }
  });
});

describe("updatePatrimonioSchema", () => {
  it("rejeita objeto vazio (nenhum campo para atualizar)", () => {
    expect(updatePatrimonioSchema.safeParse({}).success).toBe(false);
  });

  it("aceita atualização parcial com trim", () => {
    const r = updatePatrimonioSchema.safeParse({ detentor: " Ana " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.detentor).toBe("Ana");
      expect(r.data.numero).toBeUndefined();
    }
  });

  it("aceita null/vazio em opcionais (limpa o campo)", () => {
    const rVazio = updatePatrimonioSchema.safeParse({ marca: "" });
    expect(rVazio.success).toBe(true);
    if (rVazio.success) expect(rVazio.data.marca).toBe(null);
    const rNull = updatePatrimonioSchema.safeParse({ localizacao: null });
    expect(rNull.success).toBe(true);
    if (rNull.success) expect(rNull.data.localizacao).toBe(null);
  });

  it("rejeita numero inválido em atualização", () => {
    expect(updatePatrimonioSchema.safeParse({ numero: "  " }).success).toBe(false);
    expect(updatePatrimonioSchema.safeParse({ numero: "x".repeat(65) }).success).toBe(false);
  });

  it("stripa campos fora da allowlist", () => {
    const r = updatePatrimonioSchema.safeParse({ descricao: "novo", criadoPor: 1, id: 5 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("criadoPor");
      expect(r.data).not.toHaveProperty("id");
    }
  });
});

describe("listPatrimoniosQuerySchema", () => {
  it("aceita query vazia", () => {
    expect(listPatrimoniosQuerySchema.safeParse({}).success).toBe(true);
  });

  it("aceita q/detentor/localizacao dentro do limite e trim", () => {
    const r = listPatrimoniosQuerySchema.safeParse({ q: "  notebook ", detentor: "Ana" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.q).toBe("notebook");
  });

  it("rejeita q acima de 200 caracteres", () => {
    expect(listPatrimoniosQuerySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });

  it("valida o enum pendente", () => {
    for (const ok of ["detentor", "localizacao", "ambos"]) {
      expect(listPatrimoniosQuerySchema.safeParse({ pendente: ok }).success).toBe(true);
    }
    expect(listPatrimoniosQuerySchema.safeParse({ pendente: "tudo" }).success).toBe(false);
    expect(listPatrimoniosQuerySchema.safeParse({ pendente: "DETENTOR" }).success).toBe(false);
  });

  it("aceita col/dir dentro da allowlist (D6)", () => {
    const r = listPatrimoniosQuerySchema.safeParse({ col: "detentor", dir: "desc" });
    expect(r.success).toBe(true);
    expect(listPatrimoniosQuerySchema.safeParse({ col: "atualizadoEm" }).success).toBe(true);
    // dir sem col é aceito (contrato: ignorado — ordem padrão).
    expect(listPatrimoniosQuerySchema.safeParse({ dir: "asc" }).success).toBe(true);
  });

  it("rejeita col fora da allowlist ou dir inválido (D6)", () => {
    expect(listPatrimoniosQuerySchema.safeParse({ col: "id" }).success).toBe(false);
    expect(listPatrimoniosQuerySchema.safeParse({ col: "numero", dir: "lateral" }).success).toBe(false);
    expect(listPatrimoniosQuerySchema.safeParse({ col: "DESCRICAO" }).success).toBe(false);
  });
});
