import { readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";
import { Client } from "ldapts";

// Port/Adapter de autenticação: FreeIPA é o IdP (só autentica — nunca armazena senha).
export interface IpaIdentity {
  uid: string;
  nome: string;
  email: string | null;
  dn: string;
}

export interface IpaProvider {
  authenticate(uid: string, senha: string): Promise<IpaIdentity | null>;
}

/**
 * Escape de valor de RDN conforme RFC 4515 — anti LDAP-injection.
 * Escapa: , + " * ( ) \ NUL; '#' ou espaço no início; espaço no fim.
 */
export function escapeRdnValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (
      ch === "," ||
      ch === "+" ||
      ch === '"' ||
      ch === "*" ||
      ch === "(" ||
      ch === ")" ||
      ch === "\\" ||
      ch === "\0"
    ) {
      out += "\\" + ch;
    } else if (i === 0 && (ch === "#" || ch === " ")) {
      out += "\\" + ch;
    } else if (i === value.length - 1 && ch === " ") {
      out += "\\" + ch;
    } else {
      out += ch;
    }
  }
  return out;
}

export function buildUserDn(uid: string, baseDn: string): string {
  return `uid=${escapeRdnValue(uid)},${baseDn}`;
}

// ---------------------------------------------------------------------------
// MockIpaProvider — dev/teste. Usuários fixos (documentados no README).
// Senha: mock123
// ---------------------------------------------------------------------------
export const MOCK_USERS = [
  { uid: "coids.gestor", nome: "Gestor COIDS", email: "coids.gestor@exemplo.com.br" },
  { uid: "coids.secretaria", nome: "Secretaria COIDS", email: "coids.secretaria@exemplo.com.br" },
  { uid: "outro.area", nome: "Outro Área", email: "outro.area@exemplo.com.br" },
] as const;

export const MOCK_PASSWORD = "mock123";

export class MockIpaProvider implements IpaProvider {
  async authenticate(uid: string, senha: string): Promise<IpaIdentity | null> {
    const user = MOCK_USERS.find((u) => u.uid === uid);
    if (!user || senha !== MOCK_PASSWORD) return null;
    return {
      uid: user.uid,
      nome: user.nome,
      email: user.email,
      dn: `uid=${user.uid},ou=people,dc=exemplo,dc=com,dc=br`,
    };
  }
}

// ---------------------------------------------------------------------------
// LdapsIpaProvider — produção. Bind LDAPS como o próprio usuário em IPA_BASE_DN.
// Sucesso -> lê cn/mail; qualquer falha -> null (erro genérico, anti enumeração).
// Verificação de certificado via IPA_CA_CERT.
// ---------------------------------------------------------------------------

// No ldapts v9 o valor de um atributo pode vir como string | string[] | Buffer | Buffer[].
function firstAttributeValue(entry: Record<string, unknown>, attr: string): string | null {
  const value = entry[attr];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === "string") return first;
    if (first instanceof Buffer) return first.toString("utf8");
    return null;
  }
  if (value instanceof Buffer) return value.toString("utf8");
  return null;
}

export class LdapsIpaProvider implements IpaProvider {
  private readonly url: string;
  private readonly baseDn: string;
  private readonly caCert?: string;

  constructor() {
    this.url = process.env.IPA_LDAPS_URL ?? "";
    this.baseDn = process.env.IPA_BASE_DN ?? "";
    this.caCert = process.env.IPA_CA_CERT || undefined;
    if (!this.url || !this.baseDn) {
      throw new Error("IPA_MODE=ldaps requer IPA_LDAPS_URL e IPA_BASE_DN");
    }
  }

  async authenticate(uid: string, senha: string): Promise<IpaIdentity | null> {
    const userDn = buildUserDn(uid, this.baseDn);
    let client: Client | null = null;
    try {
      const tlsOptions: ConnectionOptions = {};
      if (this.caCert) {
        tlsOptions.ca = readFileSync(this.caCert);
      }
      client = new Client({ url: this.url, timeout: 10_000, tlsOptions });
      // Bind como o usuário: a FreeIPA valida a senha (IdP).
      await client.bind(userDn, senha);
      const result = await client.search(userDn, {
        scope: "base",
        filter: "(objectClass=*)",
        attributes: ["cn", "mail", "uid"],
        sizeLimit: 1,
      });
      const entry = result.searchEntries[0];
      if (!entry) return null;
      const nome =
        firstAttributeValue(entry, "cn") ?? firstAttributeValue(entry, "uid") ?? uid;
      const email = firstAttributeValue(entry, "mail");
      return { uid, nome, email, dn: userDn };
    } catch {
      return null; // credenciais inválidas, rede, certificado... -> genérico
    } finally {
      if (client) {
        await client.unbind().catch(() => undefined);
      }
    }
  }
}

// Seleção por env: default mock; produção usa ldaps.
let provider: IpaProvider | null = null;

export function getIpaProvider(): IpaProvider {
  if (!provider) {
    const mode = (process.env.IPA_MODE ?? "mock").toLowerCase();
    if (mode === "ldaps") {
      provider = new LdapsIpaProvider();
    } else {
      provider = new MockIpaProvider();
    }
  }
  return provider;
}

// Só para testes (reset entre suítes).
export function _resetIpaProviderForTests(): void {
  provider = null;
}
