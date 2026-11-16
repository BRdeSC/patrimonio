import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slug";

describe("slugify", () => {
  it("remove acentos e converte para minúsculas", () => {
    expect(slugify("Área de COIDS")).toBe("area-de-coids");
  });

  it("substitui símbolos por hífen e colapsa repetições", () => {
    expect(slugify("São Paulo - TI!!")).toBe("sao-paulo-ti");
    expect(slugify("a--b")).toBe("a-b");
  });

  it("remove hífens nas bordas e espaços", () => {
    expect(slugify("  COIDS  ")).toBe("coids");
    expect(slugify("-COIDS-")).toBe("coids");
  });

  it("retorna string vazia para nome sem caracteres utilizáveis", () => {
    expect(slugify("!!!@@@")).toBe("");
  });
});
