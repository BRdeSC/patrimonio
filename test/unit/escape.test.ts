import { describe, expect, it } from "vitest";
import { buildUserDn, escapeRdnValue } from "@/lib/ipa";

describe("escapeRdnValue (RFC 4515 — anti LDAP-injection)", () => {
  it("deixa valores comuns intactos", () => {
    expect(escapeRdnValue("coids.gestor")).toBe("coids.gestor");
  });

  it("escapa caracteres especiais", () => {
    expect(escapeRdnValue("a,b")).toBe("a\\,b");
    expect(escapeRdnValue("a+b")).toBe("a\\+b");
    expect(escapeRdnValue('a"b')).toBe('a\\"b');
    expect(escapeRdnValue("a*b")).toBe("a\\*b");
    expect(escapeRdnValue("a(b)")).toBe("a\\(b\\)");
    expect(escapeRdnValue("a\\b")).toBe("a\\\\b");
  });

  it("escapa '#' e espaço no início, espaço no fim", () => {
    expect(escapeRdnValue("#hash")).toBe("\\#hash");
    expect(escapeRdnValue(" lead")).toBe("\\ lead");
    expect(escapeRdnValue("trail ")).toBe("trail\\ ");
  });
});

describe("buildUserDn", () => {
  it("monta o DN com o uid escapado", () => {
    const base = "dc=exemplo,dc=com,dc=br";
    expect(buildUserDn("coids.gestor", base)).toBe(`uid=coids.gestor,${base}`);
  });

  it("neutraliza tentativa de injeção de RDN", () => {
    const base = "dc=exemplo,dc=com,dc=br";
    // A vírgula do payload deve ser escapada — não pode introduzir um novo RDN.
    expect(buildUserDn("mal,ou=evil", base)).toBe(`uid=mal\\,ou=evil,${base}`);
  });
});
