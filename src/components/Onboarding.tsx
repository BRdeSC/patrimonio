"use client";

import { NewAreaForm } from "./NewAreaForm";
import { PublicAreasSection } from "./PublicAreasSection";
import type { AreaResumo } from "@/lib/types";

// Onboarding: usuário logado sem áreas.
export function Onboarding({
  nome,
  publicas,
}: {
  nome: string;
  publicas: AreaResumo[];
}) {
  return (
    <main className="flex-1 p-6">
      <div className="mx-auto w-full px-4 lg:w-4/5">
        <div className="mx-auto max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold">Bem-vindo, {nome.split(" ")[0]} 👋</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Você ainda não faz parte de nenhuma área. Crie a sua — o cadastro é em auto-serviço.
            </p>
          </div>
          <NewAreaForm />
        </div>
        {/* Usuário sem área também deve descobrir áreas públicas (pacote ③-A). */}
        <PublicAreasSection publicas={publicas} />
      </div>
    </main>
  );
}
