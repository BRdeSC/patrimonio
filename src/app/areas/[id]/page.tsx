import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUserByToken, SESSION_COOKIE } from "@/lib/session";
import { getAreaContext, canReadArea, getAreasForUser } from "@/lib/access";
import { AreaHeader } from "@/components/AreaHeader";
import { AreaTabs } from "@/components/AreaTabs";

// Página depende de sessão e params dinâmicos — bloqueia o prerender (sem streaming).
export const instant = false;

export default async function AreaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const areaId = Number(id);
  if (!Number.isInteger(areaId) || areaId <= 0) notFound();

  const cookieStore = await cookies();
  const user = await getSessionUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  const area = await getAreaContext(user, areaId);
  if (!area) notFound();
  if (!canReadArea(area)) {
    // Não-membro em área privada: não revela detalhes (anti IDOR).
    notFound();
  }

  const areas = await getAreasForUser(user.id);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-5xl">
        <AreaHeader
          nomeArea={area.nome}
          papel={area.papel}
          areas={areas}
          areaAtualId={area.id}
          nomeUsuario={user.nome}
        />
        <AreaTabs
          areaId={area.id}
          papel={area.papel}
          inicial={{
            nome: area.nome,
            descricao: area.descricao,
            visibilidade: area.visibilidade,
          }}
        />
      </div>
    </main>
  );
}
