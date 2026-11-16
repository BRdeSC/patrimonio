// Badge de papel por área (componente puro — usado também no smoke test).
const ROTULOS: Record<string, string> = {
  admin_area: "Admin",
  secretaria: "Secretaria",
  usuario: "Usuário",
};

const ESTILOS: Record<string, string> = {
  admin_area: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  secretaria: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  usuario: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

export function PapelBadge({ papel }: { papel: string | null }) {
  if (!papel) {
    return (
      <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
        Leitura
      </span>
    );
  }
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        ESTILOS[papel] ?? ESTILOS.usuario
      }`}
    >
      {ROTULOS[papel] ?? papel}
    </span>
  );
}
