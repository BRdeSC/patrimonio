import { PapelBadge } from "./PapelBadge";
import type { AreaResumo } from "@/lib/types";

// Seção "Áreas públicas" (pacote ③-A): descoberta das áreas publica_leitura
// em que o usuário não é membro. Cards no mesmo estilo do hub; PapelBadge
// com papel=null renderiza "Leitura". Seção oculta se a lista for vazia.
export function PublicAreasSection({ publicas }: { publicas: AreaResumo[] }) {
  if (publicas.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Áreas públicas</h2>
      <p className="mb-3 mt-0.5 text-sm text-zinc-500">
        Áreas abertas para leitura por qualquer usuário autenticado.
      </p>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {publicas.map((area) => (
          <li key={area.id}>
            <a
              href={`/areas/${area.id}`}
              className="block h-full rounded-xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-violet-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-violet-500"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="text-lg font-semibold">{area.nome}</h3>
                <PapelBadge papel={area.papel} />
              </div>
              <p className="text-sm text-zinc-500">{area.itens} item(ns) cadastrado(s)</p>
              <p className="mt-1 text-xs text-zinc-400">
                Criada em {new Date(area.criadaEm).toLocaleDateString("pt-BR")}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
