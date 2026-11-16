import { getSessionUser } from "@/lib/session";
import { getAreasForUser } from "@/lib/access";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ erro: "Não autenticado" }, { status: 401 });
  }
  const areas = await getAreasForUser(user.id);
  return Response.json({
    user: {
      uid: user.uid,
      nome: user.nome,
      email: user.email,
      areas: areas.map((a) => ({ id: a.id, nome: a.nome, papel: a.papel })),
    },
  });
}
