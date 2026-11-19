"use client";

import { useTheme } from "next-themes";

// Toggle de tema (pedido do dono — TURNO D4 ③-B).
// O ícone é alternado POR CSS (dark:hidden / dark:block): o script do
// next-themes aplica a classe .dark antes do paint, então o markup é
// idêntico no SSR e no client (sem mismatch de hidratação). O clique usa
// resolvedTheme, que está sempre em dia após o mount.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Alternar tema claro/escuro"
      title="Alternar tema"
      className="rounded-lg border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {/* Lua visível em modo claro (clique → escuro) */}
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 dark:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
      {/* Sol visível em modo escuro (clique → claro) */}
      <svg
        viewBox="0 0 24 24"
        className="hidden h-4 w-4 dark:block"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    </button>
  );
}
