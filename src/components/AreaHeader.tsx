"use client";

import { PapelBadge } from "./PapelBadge";
import { AreaSwitcher } from "./AreaSwitcher";
import { LogoutButton } from "./LogoutButton";
import type { AreaResumo } from "@/lib/types";

export function AreaHeader({
  nomeArea,
  papel,
  areas,
  areaAtualId,
  nomeUsuario,
}: {
  nomeArea: string;
  papel: string | null;
  areas: AreaResumo[];
  areaAtualId: number;
  nomeUsuario: string;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{nomeArea}</h1>
        <PapelBadge papel={papel} />
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        <AreaSwitcher areas={areas} areaAtualId={areaAtualId} />
        <span className="text-sm text-zinc-500">{nomeUsuario}</span>
        <LogoutButton />
      </div>
    </header>
  );
}
