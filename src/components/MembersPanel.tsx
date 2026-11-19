"use client";

import { useEffect, useState, type FormEvent } from "react";

type Membro = {
  uid: string;
  nome: string;
  papel: "OWNER" | "OPERATOR" | "VIEWER";
  ativo: boolean;
};

async function lerErro(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { erro?: string } | null;
  return data?.erro ?? `Erro ${res.status}`;
}

// Gestão de membros (OWNER): adicionar, alterar papel/ativo, remover.
// OWNER é concedível por qualquer OWNER (guard 409 protege o último OWNER ativo).
export function MembersPanel({ areaId }: { areaId: number }) {
  const [membros, setMembros] = useState<Membro[] | null>(null);
  const [novoUid, setNovoUid] = useState("");
  const [novoPapel, setNovoPapel] = useState<Membro["papel"]>("VIEWER");
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const base = `/api/areas/${areaId}/members`;

  // Recarrega a lista após mutações (chamado a partir de handlers de evento).
  async function recarregar() {
    const res = await fetch(base);
    if (!res.ok) return;
    const data = (await res.json()) as { membros: Membro[] };
    setMembros(data.membros);
  }

  useEffect(() => {
    let ativo = true;
    fetch(base)
      .then(async (res) => {
        if (!ativo) return;
        if (!res.ok) {
          setErro(await lerErro(res));
          return;
        }
        const data = (await res.json()) as { membros: Membro[] };
        setMembros(data.membros);
      })
      .catch(() => {
        if (ativo) setErro("Falha ao carregar membros.");
      });
    return () => {
      ativo = false;
    };
  }, [base]);

  async function aoMutar(fn: () => Promise<Response>, sucesso: string) {
    setErro(null);
    setMsg(null);
    setOcupado(true);
    try {
      const res = await fn();
      if (!res.ok) {
        setErro(await lerErro(res));
        return;
      }
      setMsg(sucesso);
      await recarregar();
    } finally {
      setOcupado(false);
    }
  }

  function onAdicionar(e: FormEvent) {
    e.preventDefault();
    void aoMutar(
      () =>
        fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid: novoUid, papel: novoPapel }),
        }),
      "Membro adicionado.",
    ).then(() => setNovoUid(""));
  }

  function onAlterar(m: Membro, patch: { papel?: Membro["papel"]; ativo?: boolean }) {
    void aoMutar(
      () =>
        fetch(`${base}/${encodeURIComponent(m.uid)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }),
      "Membro atualizado.",
    );
  }

  function onRemover(m: Membro) {
    if (!window.confirm(`Remover ${m.uid} da área?`)) return;
    void aoMutar(
      () => fetch(`${base}/${encodeURIComponent(m.uid)}`, { method: "DELETE" }),
      "Membro removido.",
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={onAdicionar}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div>
          <label htmlFor="novo-uid" className="mb-1 block text-sm font-medium">
            Adicionar por uid
          </label>
          <input
            id="novo-uid"
            type="text"
            required
            value={novoUid}
            onChange={(e) => setNovoUid(e.target.value)}
            placeholder="ex.: coids.secretaria"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>
        <div>
          <label htmlFor="novo-papel" className="mb-1 block text-sm font-medium">
            Papel
          </label>
          <select
            id="novo-papel"
            value={novoPapel}
            onChange={(e) => setNovoPapel(e.target.value as Membro["papel"])}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            <option value="OWNER">OWNER</option>
            <option value="OPERATOR">OPERATOR</option>
            <option value="VIEWER">VIEWER</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={ocupado}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
        >
          Adicionar
        </button>
        <p className="w-full text-xs text-zinc-500">
          A área precisa manter ao menos um OWNER ativo — o último OWNER não pode ser rebaixado,
          desativado ou removido.
        </p>
      </form>

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

      {membros && (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {membros.map((m) => (
            <li key={m.uid} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-40">
                <p className="text-sm font-medium">{m.nome}</p>
                <p className="text-xs text-zinc-500">{m.uid}</p>
              </div>
              <select
                value={m.papel}
                disabled={ocupado}
                onChange={(e) => onAlterar(m, { papel: e.target.value as Membro["papel"] })}
                className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="OWNER">OWNER</option>
                <option value="OPERATOR">OPERATOR</option>
                <option value="VIEWER">VIEWER</option>
              </select>
              <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={m.ativo}
                  disabled={ocupado}
                  onChange={(e) => onAlterar(m, { ativo: e.target.checked })}
                />
                Ativo
              </label>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => onRemover(m)}
                  disabled={ocupado}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30"
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
