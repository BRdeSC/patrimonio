import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUserByToken, SESSION_COOKIE } from "@/lib/session";
import { getAreasForUser } from "@/lib/access";
import { Hub } from "@/components/Hub";
import { Onboarding } from "@/components/Onboarding";

// Página depende de sessão (cookies) — bloqueia o prerender (sem streaming).
export const instant = false;

export default async function Home() {
  const cookieStore = await cookies();
  const user = await getSessionUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  const areas = await getAreasForUser(user.id);

  if (areas.length === 0) {
    return <Onboarding nome={user.nome} />;
  }

  return <Hub areas={areas} nome={user.nome} />;
}
