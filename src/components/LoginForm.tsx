"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";

export function LoginForm() {
  const router = useRouter();
  const [uid, setUid] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, senha }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { erro?: string } | null;
        setErro(data?.erro ?? "Falha no login");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setErro("Falha de rede. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="uid" className="mb-1 block text-sm font-medium">
          Usuário (uid)
        </label>
        <input
          id="uid"
          type="text"
          autoComplete="username"
          required
          value={uid}
          onChange={(e) => setUid(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-800"
          placeholder="ex.: coids.gestor"
        />
      </div>
      <div>
        <label htmlFor="senha" className="mb-1 block text-sm font-medium">
          Senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-800"
          placeholder="Sua senha institucional"
        />
      </div>
      {erro && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {erro}
        </p>
      )}
      <button
        type="submit"
        disabled={carregando}
        className="w-full rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {carregando ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
