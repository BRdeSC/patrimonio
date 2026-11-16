// Ambiente fixo para a suíte de testes (roda ANTES de qualquer import de app).
// - Banco de teste dedicado (patrimonio_test) — criado/sincronizado sob demanda
//   por test/helpers/test-db.ts (ensureTestDatabase).
// - IPA_MODE sempre mock (FreeIPA real não existe no dev).
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://postgres:postgres@localhost:5432/patrimonio_test?schema=public";
process.env.IPA_MODE = "mock";
process.env.SESSION_SECRET = "test-session-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
