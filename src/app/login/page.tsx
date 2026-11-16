import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUserByToken, SESSION_COOKIE } from "@/lib/session";
import { LoginForm } from "@/components/LoginForm";

// Página depende de sessão (cookies) — bloqueia o prerender (sem streaming).
export const instant = false;

export default async function LoginPage() {
  const cookieStore = await cookies();
  const user = await getSessionUserByToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (user) redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-1 text-2xl font-semibold">Patrimônio</h1>
        <p className="mb-6 text-sm text-zinc-500">Entre com sua conta institucional (FreeIPA).</p>
        <LoginForm />
      </div>
    </main>
  );
}
