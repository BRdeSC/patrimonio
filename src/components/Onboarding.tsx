"use client";

import { NewAreaForm } from "./NewAreaForm";

// Onboarding: usuário logado sem áreas.
export function Onboarding({ nome }: { nome: string }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold">Bem-vindo, {nome.split(" ")[0]} 👋</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Você ainda não faz parte de nenhuma área. Crie a sua — o cadastro é em auto-serviço.
          </p>
        </div>
        <NewAreaForm />
      </div>
    </main>
  );
}
