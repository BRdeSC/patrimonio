import { execSync } from "node:child_process";
import pg from "pg";

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/patrimonio_test?schema=public";

let ready: Promise<void> | null = null;

// Garante que o banco de teste existe e o schema está aplicado (idempotente).
// Chamado via beforeAll apenas pelos testes de integração.
export function ensureTestDatabase(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const dbMatch = /\/([^/?]+)(\?|$)/.exec(TEST_DATABASE_URL);
      const dbName = dbMatch?.[1] ?? "patrimonio_test";
      const adminUrl = TEST_DATABASE_URL.replace(`/${dbName}`, "/postgres");
      const client = new pg.Client({ connectionString: adminUrl });
      try {
        await client.connect();
        const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
          dbName,
        ]);
        if (rows.length === 0) {
          await client.query(`CREATE DATABASE "${dbName}"`);
        }
      } finally {
        await client.end();
      }
      execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        stdio: "pipe",
      });
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
