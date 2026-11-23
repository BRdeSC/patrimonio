import { getIpaProvider, type Servidor } from "@/lib/ipa";
import { getSessionUser } from "@/lib/session";

// GET /api/servidores — lista os servidores do FreeIPA (title=Servidor).
// Alimenta o combobox do campo Detentor (form Novo/Editar Patrimônio).
// Dinamico por natureza: le o cookie da sessao (getSessionUser) e consulta o
// LDAP a cada chamada — Next 16 (cacheComponents) nao permite `export dynamic`.
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ erro: "Nao autenticado" }, { status: 401 });
  }
  // Falha no LDAP -> [] (o form desabilita a sugestao; nao quebra o cadastro).
  const servidores: Servidor[] = await getIpaProvider().listServidores();
  return Response.json({ servidores });
}
