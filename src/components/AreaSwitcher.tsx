"use client";

import { useRouter } from "next/navigation";
import type { AreaResumo } from "@/lib/types";

// Seletor de área (troca rápida entre as áreas do usuário).
export function AreaSwitcher({
  areas,
  areaAtualId,
}: {
  areas: AreaResumo[];
  areaAtualId: number;
}) {
  const router = useRouter();

  if (areas.length <= 1) return null;

  return (
    <label className="flex items-center gap-2 text-sm text-zinc-500">
      Área:
      <select
        value={areaAtualId}
        onChange={(e) => {
          const id = Number(e.target.value);
          if (id && id !== areaAtualId) router.push(`/areas/${id}`);
        }}
        className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
      >
        {areas.map((area) => (
          <option key={area.id} value={area.id}>
            {area.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
