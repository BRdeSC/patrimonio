"use client";

import { useState } from "react";
import { MembersPanel } from "./MembersPanel";
import { SettingsPanel } from "./SettingsPanel";

type Tab = "patrimonios" | "membros" | "config";

// Abas por papel: Patrimônios (todos); Membros e Configurações (admin_area).
export function AreaTabs({
  areaId,
  papel,
  inicial,
}: {
  areaId: number;
  papel: string | null;
  inicial: { nome: string; descricao: string | null; visibilidade: string };
}) {
  const isAdmin = papel === "admin_area";
  const [tab, setTab] = useState<Tab>("patrimonios");

  const abas: { id: Tab; rotulo: string }[] = [
    { id: "patrimonios", rotulo: "Patrimônios" },
    ...(isAdmin
      ? ([
          { id: "membros", rotulo: "Membros" },
          { id: "config", rotulo: "Configurações" },
        ] as { id: Tab; rotulo: string }[])
      : []),
  ];

  return (
    <section>
      <div className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {abas.map((aba) => (
          <button
            key={aba.id}
            type="button"
            onClick={() => setTab(aba.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === aba.id
                ? "border-violet-600 text-violet-700 dark:text-violet-400"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {aba.rotulo}
          </button>
        ))}
      </div>

      {tab === "patrimonios" && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
          CRUD de patrimônios chega no pacote ③ (cadastro, busca e foto).
        </div>
      )}
      {tab === "membros" && isAdmin && <MembersPanel areaId={areaId} />}
      {tab === "config" && isAdmin && (
        <SettingsPanel
          areaId={areaId}
          nomeInicial={inicial.nome}
          descricaoInicial={inicial.descricao}
          visibilidadeInicial={inicial.visibilidade}
        />
      )}
    </section>
  );
}
