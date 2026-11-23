"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";

// Combobox do campo Detentor (selecao de servidor do FreeIPA, title=Servidor).
// - Lista os servidores via GET /api/servidores (carregado uma vez).
// - Busca por nome (insensitive a acentos) + selecao por clique.
// - Opcao "Outros": se o texto digitado nao casa com nenhum servidor, permite
//   incluir livremente (ex.: nome ausente na lista do IPA).
// O valor salvo e o Nome Completo (opcao b) — ou o texto livre em "Outros".
export type Servidor = { uid: string; nome: string; email: string | null };

const INPUT =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800";

export function DetentorCombobox({
  id,
  rotulo,
  valor,
  onChange,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  const [servidores, setServidores] = useState<Servidor[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [aberto, setAberto] = useState(false);
  // Texto canonicamente exibido no input (inicia em `valor`; ao digitar/selecionar
  // vira o novo valor; se `valor` externo mudar de forma independente — abrir
  // edicao, reset do form — o effect abaixo resincroniza).
  const [texto, setTexto] = useState(valor);
  const raiz = useRef<HTMLDivElement>(null);

  // Resincroniza quando o valor externo muda de forma independente (nao por
  // acao propria do usuario, que ja chama onChange + setTexto juntos).
  const ultimoEmitido = useRef(valor);
  useEffect(() => {
    if (valor !== ultimoEmitido.current) {
      setTexto(valor);
    }
  }, [valor]);

  function emitir(novo: string) {
    ultimoEmitido.current = novo;
    onChange(novo);
  }

  // Carrega a lista de servidores uma vez.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`${BASE_PATH}/api/servidores`, {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { servidores: Servidor[] };
        if (vivo) setServidores(data.servidores);
      } catch {
        // Falha no LDAP -> lista vazia; o campo segue funcionando como texto.
      } finally {
        if (vivo) setCarregado(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    function fora(e: MouseEvent) {
      if (raiz.current && !raiz.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  // Filtra por nome (ignora maiusculas e acentos).
  const filtrados = useMemo(() => {
    const t = texto.trim().toLowerCase();
    if (!t) return servidores;
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    return servidores.filter((s) => norm(s.nome).includes(norm(t)));
  }, [servidores, texto]);

  // Texto casado exatamente com um servidor? (decide se "Outros" aparece).
  const casaComServidor = useMemo(
    () =>
      servidores.some(
        (s) => s.nome.toLowerCase() === texto.trim().toLowerCase(),
      ),
    [servidores, texto],
  );

  function selecionar(s: Servidor) {
    setTexto(s.nome);
    emitir(s.nome);
    setAberto(false);
  }

  function escolherOutros() {
    emitir(texto);
    setAberto(false);
  }

  return (
    <div ref={raiz} className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {rotulo}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={aberto}
          aria-autocomplete="list"
          aria-controls={`${id}-lista`}
          autoComplete="off"
          value={texto}
          placeholder={carregado ? "Nome do servidor…" : "Carregando servidores…"}
          className={`${INPUT} pr-8`}
          onChange={(e) => {
            setTexto(e.target.value);
            emitir(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label="Abrir lista de servidores"
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          onClick={() => setAberto((a) => !a)}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {aberto && (
        <ul
          id={`${id}-lista`}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {!carregado ? (
            <li role="option" aria-selected={false} className="px-3 py-2 text-zinc-500">
              Carregando…
            </li>
          ) : filtrados.length === 0 && texto.trim() === "" ? (
            <li role="option" aria-selected={false} className="px-3 py-2 text-zinc-500">
              Nenhum servidor encontrado.
            </li>
          ) : (
            <>
              {filtrados.slice(0, 100).map((s) => (
                <li key={s.uid} role="option" aria-selected={s.nome === valor}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-violet-50 dark:hover:bg-violet-900/30"
                    onClick={() => selecionar(s)}
                  >
                    <span className="text-sm">{s.nome}</span>
                    {s.email && (
                      <span className="text-xs text-zinc-500">{s.email}</span>
                    )}
                  </button>
                </li>
              ))}
              {/* "Outros": inclui o nome digitado livremente (fora da lista). */}
              {texto.trim() !== "" && !casaComServidor && (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-violet-700 hover:bg-violet-50 dark:border-zinc-800 dark:text-violet-300 dark:hover:bg-violet-900/30"
                    onClick={escolherOutros}
                  >
                    <span className="text-xs font-medium uppercase tracking-wide">Outros</span>
                    <span className="text-sm">{texto}</span>
                  </button>
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
