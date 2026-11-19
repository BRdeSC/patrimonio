import { getPublicAreasForUser } from "@/lib/access";
import { getSessionUser } from "@/lib/session";

// Descoberta de áreas públicas (pacote ③-A): qualquer usuário autenticado
// lista as áreas publica_leitura em que NÃO é membro. Rota estática — tem
// precedência sobre [id] (sem RBAC extra: leitura já é aberta por definição).
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ erro: "Não autenticado" }, { status: 401 });
  }
  const areas = await getPublicAreasForUser(user.id);
  return Response.json({ areas });
}
