"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// Configurações da área (OWNER): nome, descrição, visibilidade + excluir (hard).
export function SettingsPanel({
  areaId,
  nomeInicial,
  descricaoInicial,
  visibilidadeInicial,
}: {
  areaId: number;
  nomeInicial: string;
  descricaoInicial: string | null;
  visibilidadeInicial: string;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeInicial);
  const [descricao, setDescricao] = useState(descricaoInicial ?? "");
  const [visibilidade, setVisibilidade] = useState(visibilidadeInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function onSalvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setMsg(null);
    setOcupado(true);
    try {
      const res = await fetch(`/api/areas/${areaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, descricao: descricao || null, visibilidade }),
      });
      const data = (await res.json().catch(() => null)) as { erro?: string } | null;
      if (!res.ok) {
        setErro(data?.erro ?? `Erro ${res.status}`);
        return;
      }
      setMsg("Configurações salvas.");
    } finally {
      setOcupado(false);
    }
  }

  async function onExcluir() {
    // Confirmação FORTE (mesmo padrão do ③ em PatrimoniosPanel): digitar o nome.
    if (!window.confirm(`Excluir permanentemente a área "${nome}"?\n\nTODOS os dados (patrimônios, fotos, membros) serão APAGADOS e não podem ser recuperados.\n\nDigite o nome da área para confirmar.`))
      return;
    const confirmado = window.prompt("Digite o nome da área para confirmar:", "");
    if (confirmado === null) return;
    if (confirmado.trim() !== nome.trim()) {
      setErro("Confirmação cancelada: o nome digitado não corresponde.");
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      const res = await fetch(`/api/areas/${areaId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { erro?: string } | null;
        setErro(data?.erro ?? `Erro ${res.status}`);
        return;
      }
      router.push("/");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <form
        onSubmit={onSalvar}
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold">Configurações da área</h2>
        <div>
          <label htmlFor="cfg-nome" className="mb-1 block text-sm font-medium">
            Nome
          </label>
          <input
            id="cfg-nome"
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div>
          <label htmlFor="cfg-descricao" className="mb-1 block text-sm font-medium">
            Descrição
          </label>
          <textarea
            id="cfg-descricao"
            rows={3}
            maxLength={500}
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div>
          <label htmlFor="cfg-visibilidade" className="mb-1 block text-sm font-medium">
            Visibilidade
          </label>
          <select
            id="cfg-visibilidade"
            value={visibilidade}
            onChange={(e) => setVisibilidade(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="privada">Privada (só membros)</option>
            <option value="publica_leitura">Leitura pública (qualquer usuário autenticado)</option>
          </select>
          <p className="mt-1 text-xs text-zinc-500">
            Leitura pública: qualquer pessoa logada pode ver os dados da área (sem permissão de
            edição).
          </p>
        </div>
        {erro && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
            {erro}
          </p>
        )}
        {msg && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            {msg}
          </p>
        )}
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          Salvar
        </button>
      </form>

      <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 dark:border-red-900 dark:bg-red-900/10">
        <h2 className="text-sm font-semibold text-red-800 dark:text-red-300">Zona de perigo</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          Excluir a área APAGA permanentemente todos os dados (patrimônios, fotos, membros) —
          operação irrecuperável.
        </p>
        <button
          type="button"
          onClick={onExcluir}
          disabled={ocupado}
          className="mt-3 rounded-lg border border-red-400 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-900/30"
        >
          Excluir área
        </button>
      </div>
    </div>
  );
}
