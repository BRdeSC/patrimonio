import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUserByToken, SESSION_COOKIE } from "@/lib/session";
import { getAreasForUser, getPublicAreasForUser } from "@/lib/access";
import { Hub } from "@/components/Hub";
import { Onboarding } from "@/components/Onboarding";
import { LogoutButton } from "@/components/LogoutButton";
import { ThemeToggle } from "@/components/ThemeToggle";

// Página depende de sessão (cookies) — bloqueia o prerender (sem streaming).
export const instant = false;

export default async function Home() {
  const cookieStore = await cookies();
  const user = await getSessionUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");

  const [areas, publicas] = await Promise.all([
    getAreasForUser(user.id),
    getPublicAreasForUser(user.id),
  ]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex w-full flex-wrap items-center gap-3 px-4 py-3 lg:w-4/5">
          <h1 className="text-lg font-semibold">Patrimônio</h1>
          <ThemeToggle />
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-zinc-500">{user.nome}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      {areas.length === 0 ? (
        <Onboarding nome={user.nome} publicas={publicas} />
      ) : (
        <Hub areas={areas} publicas={publicas} nome={user.nome} />
      )}
    </div>
  );
}
