"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function NewAreaForm({ onCriada }: { onCriada?: (areaId: number) => void }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch("/api/areas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, descricao: descricao || undefined }),
      });
      const data = (await res.json().catch(() => null)) as
        | { area?: { id: number }; erro?: string }
        | null;
      if (!res.ok || !data?.area) {
        setErro(data?.erro ?? "Falha ao criar a área");
        return;
      }
      // Sempre refresh: re-busca o server component (Hub/Onboarding) para a
      // área nova aparecer IMEDIATAMENTE em "Minhas Áreas" sem recarregar.
      router.refresh();
      if (onCriada) {
        onCriada(data.area.id);
        return;
      }
      router.push(`/areas/${data.area.id}`);
    } catch {
      setErro("Falha de rede. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="text-lg font-semibold">Criar área</h2>
      <div>
        <label htmlFor="area-nome" className="mb-1 block text-sm font-medium">
          Nome
        </label>
        <input
          id="area-nome"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-800"
          placeholder="ex.: COIDS"
        />
      </div>
      <div>
        <label htmlFor="area-descricao" className="mb-1 block text-sm font-medium">
          Descrição <span className="text-zinc-400">(opcional)</span>
        </label>
        <textarea
          id="area-descricao"
          rows={3}
          maxLength={500}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-800"
          placeholder="O que essa área vai gerenciar?"
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
        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {carregando ? "Criando..." : "Criar área"}
      </button>
      <p className="text-xs text-zinc-500">Quem cria a área vira o responsável (admin) dela.</p>
    </form>
  );
}
