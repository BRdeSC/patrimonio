"use client";

import { useState } from "react";
import { PapelBadge } from "./PapelBadge";
import { NewAreaForm } from "./NewAreaForm";
import { PublicAreasSection } from "./PublicAreasSection";
import type { AreaResumo } from "@/lib/types";
import Link from 'next/link';

// Hub "Minhas Áreas": cards com nome, papel, itens e data de criação,
// seguido da seção de descoberta de áreas públicas (pacote ③-A).
export function Hub({
  areas,
  publicas,
  nome,
}: {
  areas: AreaResumo[];
  publicas: AreaResumo[];
  nome: string;
}) {
  const [mostraNova, setMostraNova] = useState(false);

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto w-full px-4 lg:w-4/5">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Minhas Áreas</h1>
            <p className="text-sm text-zinc-500">Olá, {nome.split(" ")[0]}</p>
          </div>
          <button
            type="button"
            onClick={() => setMostraNova((v) => !v)}
            className="ml-auto rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            {mostraNova ? "Fechar" : "Nova área"}
          </button>
        </div>

        {mostraNova && (
          <div className="mb-6">
            <NewAreaForm onCriada={() => setMostraNova(false)} />
          </div>
        )}

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => (
            <li key={area.id}>
              <Link
                href={`/areas/${area.id}`}
                className="block h-full rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-violet-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-500"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold">{area.nome}</h2>
                  <PapelBadge papel={area.papel} />
                </div>
                <p className="text-sm text-zinc-500">{area.itens} item(ns) cadastrado(s)</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Criada em {new Date(area.criadaEm).toLocaleDateString("pt-BR")}
                </p>
              </Link>
            </li>
          ))}
        </ul>

        <PublicAreasSection publicas={publicas} />
      </div>
    </main>
  );
}
