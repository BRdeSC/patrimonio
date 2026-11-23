"use client";

import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { DetentorCombobox } from "@/components/DetentorCombobox";

type Patrimonio = {
  id: number;
  numero: string;
  descricao: string;
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  responsavel: string | null;
  detentor: string | null;
  localizacao: string | null;
  temFoto: boolean;
  atualizadoEm: string;
  // Só no detalhe (D7): quem criou/editou por último (null = legado sem autor).
  atualizadoPor?: { uid: string; nome: string } | null;
};

// Metadado de foto (sem BLOB) — vem de GET /fotos.
type FotoMeta = {
  id: number;
  contentType: string;
  tamanho: number;
};

type FormState = {
  numero: string;
  descricao: string;
  marca: string;
  modelo: string;
  serie: string;
  responsavel: string;
  detentor: string;
  localizacao: string;
};

const FORM_VAZIO: FormState = {
  numero: "",
  descricao: "",
  marca: "",
  modelo: "",
  serie: "",
  responsavel: "",
  detentor: "",
  localizacao: "",
};

const INPUT =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800";
const BOTAO_PRIMARIO =
  "rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60";
const BOTAO =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const BOTAO_PERIGO =
  "rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30";
const CARD =
  "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

// Foto no cadastro (pacote ③-A): validação client-side ANTES de enviar —
// o servidor (rota /foto) revalida o mesmo allowlist/tamanho; nunca confiar só no client.
const FOTOS_PERMITIDAS = ["image/jpeg", "image/png", "image/webp"];
const FOTO_MAX_BYTES = 5 * 1024 * 1024;
const FOTOS_MAX = 10; // máx de fotos por patrimônio (o servidor revalida)

async function lerErro(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { erro?: string } | null;
  return data?.erro ?? `Erro ${res.status}`;
}

function dataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}

function IconeSemFoto() {
  return (
    <span
      title="Sem foto"
      aria-label="Sem foto"
      className="flex h-8 w-8 items-center justify-center rounded border border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden
      >
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="M3 17l5-5 4 4 3-3 6 6" />
      </svg>
    </span>
  );
}

function Campo({
  rotulo,
  valor,
  pendente,
}: {
  rotulo: string;
  valor: string | null;
  pendente?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{rotulo}</dt>
      <dd
        className={`mt-0.5 text-sm ${
          pendente && !valor ? "text-amber-600 dark:text-amber-400" : undefined
        }`}
      >
        {valor || (pendente ? "— (pendente)" : "—")}
      </dd>
    </div>
  );
}

function CampoForm({
  id,
  rotulo,
  obrigatorio,
  valor,
  onChange,
}: {
  id: string;
  rotulo: string;
  obrigatorio?: boolean;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {rotulo}
        {obrigatorio && <span className="text-red-500"> *</span>}
      </label>
      <input
        id={id}
        type="text"
        required={obrigatorio}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
    </div>
  );
}

type View =
  | { nome: "lista" }
  | { nome: "novo" }
  | { nome: "detalhe"; item: Patrimonio }
  | { nome: "editar"; item: Patrimonio };

// Aba Patrimônios (pacote ③): busca com debounce, filtros, contador de pendências,
// tabela, detalhe com foto e form criar/editar. Botões de escrita só para OPERATOR+.
export type ColOrdenacao =
  | "numero"
  | "descricao"
  | "marca"
  | "detentor"
  | "localizacao"
  | "atualizadoEm";

export function PatrimoniosPanel({
  areaId,
  papel,
}: {
  areaId: number;
  papel: string | null;
}) {
  const podeEditar = papel === "OWNER" || papel === "OPERATOR";
  const base = `${BASE_PATH}/api/areas/${areaId}/patrimonios`;
  // Capa (1ª foto) — URL inalterada; a tabela usa esta thumb.
  const fotoUrl = (id: number) => `${base}/${id}/foto`;
  // Galeria / foto individual.
  const fotosUrl = (id: number, fid?: number) =>
    fid === undefined ? `${base}/${id}/fotos` : `${base}/${id}/fotos/${fid}`;

  const [view, setView] = useState<View>({ nome: "lista" });
  const [itens, setItens] = useState<Patrimonio[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  // Versão das thumbs da tabela: bump ao mutar fotos → troca a URL (?v=N) e
  // quebra o cache do browser (a rota /foto não muda, mas a capa pode).
  const [fotoVer, setFotoVer] = useState(0);

  // Filtros (texto com debounce ~300ms) + toggles de pendência.
  const [busca, setBusca] = useState("");
  const [detF, setDetF] = useState("");
  const [locF, setLocF] = useState("");
  const [semDet, setSemDet] = useState(false);
  const [semLoc, setSemLoc] = useState(false);
  const [deb, setDeb] = useState({ q: "", det: "", loc: "" });

  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  // Fotos selecionadas no form CRIAR (múltiplas).
  const [fotosForm, setFotosForm] = useState<File[]>([]);
  // Galeria do detalhe (metadados de GET /fotos; null = carregando).
  const [fotos, setFotos] = useState<FotoMeta[] | null>(null);
  // Lightbox (pedido ③-B): foto ampliada no clique; null = fechado.
  const [fotoAmpliada, setFotoAmpliada] = useState<{ src: string; alt: string } | null>(null);
  // Drag & drop da galeria (pedido ③-B): fid arrastada + alvo sob o cursor.
  const [fidArrastada, setFidArrastada] = useState<number | null>(null);
  const [fidSobAlvo, setFidSobAlvo] = useState<number | null>(null);
  // Ordenação da listagem (D6): null = padrão do servidor (numero asc).
  const [ordCol, setOrdCol] = useState<ColOrdenacao | null>(null);
  const [ordDir, setOrdDir] = useState<"asc" | "desc">("asc");

  // ESC fecha o lightbox (listener removido no cleanup).
  useEffect(() => {
    if (!fotoAmpliada) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFotoAmpliada(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fotoAmpliada]);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Debounce dos campos de texto (~300ms); mantém a referência estável quando nada muda.
  useEffect(() => {
    const t = setTimeout(() => {
      setDeb((atual) =>
        atual.q === busca && atual.det === detF && atual.loc === locF
          ? atual
          : { q: busca, det: detF, loc: locF },
      );
    }, 300);
    return () => clearTimeout(t);
  }, [busca, detF, locF]);

  useEffect(() => {
    let ativo = true;
    const p = new URLSearchParams();
    if (deb.q) p.set("q", deb.q);
    if (deb.det) p.set("detentor", deb.det);
    if (deb.loc) p.set("localizacao", deb.loc);
    if (semDet && semLoc) p.set("pendente", "ambos");
    else if (semDet) p.set("pendente", "detentor");
    else if (semLoc) p.set("pendente", "localizacao");
    if (ordCol) {
      p.set("col", ordCol);
      p.set("dir", ordDir);
    }
    const qs = p.toString();
    fetch(`${base}${qs ? `?${qs}` : ""}`)
      .then(async (res) => {
        if (!ativo) return;
        if (!res.ok) {
          setErroLista(await lerErro(res));
          return;
        }
        const data = (await res.json()) as { patrimonios: Patrimonio[] };
        setItens(data.patrimonios);
      })
      .catch(() => {
        if (ativo) setErroLista("Falha ao carregar patrimônios.");
      });
    return () => {
      ativo = false;
    };
  }, [base, deb, semDet, semLoc, versao, ordCol, ordDir]);

  const pend = useMemo(() => {
    if (!itens) return null;
    return {
      detentor: itens.filter((i) => !i.detentor).length,
      localizacao: itens.filter((i) => !i.localizacao).length,
    };
  }, [itens]);

  const temFiltro = Boolean(busca || detF || locF || semDet || semLoc);

  // Cabeçalho ordenável (D6): coluna nova → asc; coluna ativa → alterna direção.
  function aoOrdenar(col: ColOrdenacao) {
    if (ordCol === col) {
      setOrdDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setOrdCol(col);
      setOrdDir("asc");
    }
  }

  // (função de render — não é um componente: evita remontagem a cada render)
  function thOrdem(col: ColOrdenacao, rotulo: string) {
    const ativo = ordCol === col;
    return (
      <th
        aria-sort={ativo ? (ordDir === "asc" ? "ascending" : "descending") : undefined}
        className="px-3 py-2 font-medium"
      >
        <button
          type="button"
          onClick={() => aoOrdenar(col)}
          className="inline-flex items-center gap-1 hover:underline"
        >
          {rotulo}
          {ativo ? (ordDir === "asc" ? "▲" : "▼") : ""}
        </button>
      </th>
    );
  }

  function atualizaItem(novo: Patrimonio) {
    setItens((lista) => (lista ? lista.map((i) => (i.id === novo.id ? novo : i)) : lista));
    setView((v) =>
      v.nome === "detalhe" && v.item.id === novo.id ? { nome: "detalhe", item: novo } : v,
    );
  }

  function abrirNovo() {
    setForm(FORM_VAZIO);
    setFotosForm([]);
    setErro(null);
    setMsg(null);
    setAviso(null);
    setView({ nome: "novo" });
  }

  async function abrirDetalhe(item: Patrimonio) {
    setErro(null);
    setMsg(null);
    setAviso(null);
    setView({ nome: "detalhe", item });
    void carregarFotos(item);
    // D7-2: a listagem NÃO traz "Atualizado por" (escopo = detalhe). Busca o
    // detalhe para o campo aparecer para QUALQUER usuário da área. Falha
    // (ex.: item já removido) → mantém o item da lista, sem estado de erro novo.
    try {
      const res = await fetch(`${base}/${item.id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { patrimonio: Patrimonio };
      setView((v) =>
        v.nome === "detalhe" && v.item.id === item.id
          ? { nome: "detalhe", item: data.patrimonio }
          : v,
      );
    } catch {
      // falha de rede — o detalhe fica com os dados da listagem
    }
  }

  function abrirEditar(item: Patrimonio) {
    setForm({
      numero: item.numero,
      descricao: item.descricao,
      marca: item.marca ?? "",
      modelo: item.modelo ?? "",
      serie: item.serie ?? "",
      responsavel: item.responsavel ?? "",
      detentor: item.detentor ?? "",
      localizacao: item.localizacao ?? "",
    });
    setFotosForm([]);
    setErro(null);
    setMsg(null);
    setAviso(null);
    setView({ nome: "editar", item });
    // D8: a gestão de fotos vive no editar — carrega a galeria (metadados).
    void carregarFotos(item);
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setMsg(null);
    setAviso(null);
    setOcupado(true);
    const payload = {
      numero: form.numero,
      descricao: form.descricao,
      marca: form.marca || null,
      modelo: form.modelo || null,
      serie: form.serie || null,
      responsavel: form.responsavel || null,
      detentor: form.detentor || null,
      localizacao: form.localizacao || null,
    };
    const editando = view.nome === "editar";
    // Validação client-side das fotos ANTES de enviar (o servidor revalida).
    if (!editando) {
      if (fotosForm.length > FOTOS_MAX) {
        setErro(`Limite de ${FOTOS_MAX} fotos por patrimônio.`);
        setOcupado(false);
        return;
      }
      for (const a of fotosForm) {
        if (!FOTOS_PERMITIDAS.includes(a.type)) {
          setErro("Foto inválida: use JPEG, PNG ou WebP.");
          setOcupado(false);
          return;
        }
        if (a.size > FOTO_MAX_BYTES) {
          setErro("Foto inválida: tamanho máximo de 5 MB.");
          setOcupado(false);
          return;
        }
      }
    }
    try {
      const res = await fetch(editando ? `${base}/${view.item.id}` : base, {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setErro(await lerErro(res));
        return;
      }
      const data = (await res.json()) as { patrimonio: Patrimonio };
      const atual = data.patrimonio;
      if (editando) {
        atualizaItem(atual);
        setMsg("Patrimônio atualizado.");
        setView({ nome: "detalhe", item: atual });
        return;
      }
      // Criação com fotos: dois endpoints independentes (sem rollback) —
      // o patrimônio NÃO é deletado se o upload de fotos falhar.
      if (fotosForm.length > 0) {
        let fotosOk = false;
        let fotosErro = "";
        try {
          const fd = new FormData();
          for (const a of fotosForm) fd.append("foto", a);
          const fotosRes = await fetch(`${base}/${atual.id}/fotos`, {
            method: "POST",
            body: fd,
          });
          fotosOk = fotosRes.ok;
          if (!fotosOk) fotosErro = await lerErro(fotosRes);
        } catch {
          fotosErro = "falha de rede";
        }
        if (!fotosOk) {
          setAviso(`Patrimônio criado, mas as fotos não foram enviadas: ${fotosErro}`);
        } else {
          setMsg("Patrimônio criado.");
        }
      } else {
        setMsg("Patrimônio criado.");
      }
      // Item novo não está na lista local — recarrega da API (reflete temFoto).
      setVersao((v) => v + 1);
      setView({ nome: "lista" });
    } catch {
      setErro("Falha ao salvar patrimônio.");
    } finally {
      setOcupado(false);
    }
  }

  // Carrega a galeria (metadados, SEM BLOB) do detalhe. Retorna a lista
  // (null se a chamada falhou — o servidor revalida permissão/escopo).
  async function carregarFotos(item: Patrimonio): Promise<FotoMeta[] | null> {
    setFotos(null);
    try {
      const res = await fetch(fotosUrl(item.id));
      if (!res.ok) return null;
      const data = (await res.json()) as { fotos: FotoMeta[] };
      setFotos(data.fotos);
      return data.fotos;
    } catch {
      return null;
    }
  }

  // Adiciona N fotos ao detalhe (input múltiplo). O limite de 10 respeita o
  // count atual da galeria; o servidor revalida tipo/tamanho/limite.
  async function onAdicionarFotos(item: Patrimonio, arquivos: File[]) {
    setErro(null);
    if (fotos && fotos.length + arquivos.length > FOTOS_MAX) {
      setErro(`Limite de ${FOTOS_MAX} fotos por patrimônio.`);
      return;
    }
    for (const a of arquivos) {
      if (!FOTOS_PERMITIDAS.includes(a.type)) {
        setErro("Foto inválida: use JPEG, PNG ou WebP.");
        return;
      }
      if (a.size > FOTO_MAX_BYTES) {
        setErro("Foto inválida: tamanho máximo de 5 MB.");
        return;
      }
    }
    setOcupado(true);
    try {
      const fd = new FormData();
      for (const a of arquivos) fd.append("foto", a);
      const res = await fetch(fotosUrl(item.id), { method: "POST", body: fd });
      if (!res.ok) {
        setErro(await lerErro(res));
        return;
      }
      const lista = await carregarFotos(item);
      if (lista) atualizaItem({ ...item, temFoto: lista.length > 0 });
      setFotoVer((v) => v + 1);
      setMsg("Fotos adicionadas.");
    } catch {
      setErro("Falha ao enviar as fotos.");
    } finally {
      setOcupado(false);
    }
  }

  // Reordena a galeria (drag & drop): POST a nova ordem dos fids (ordem[0] =
  // capa). O servidor revalida o conjunto exato (400 se faltar/sobra/duplicar).
  async function onReordenarFotos(item: Patrimonio, ordem: number[]) {
    setErro(null);
    setOcupado(true);
    try {
      const res = await fetch(`${fotosUrl(item.id)}/reordenar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordem }),
      });
      if (!res.ok) {
        setErro(await lerErro(res));
        return;
      }
      await carregarFotos(item);
      setFotoVer((v) => v + 1); // thumbs da tabela refletem a nova capa
      setMsg("Galeria reordenada.");
    } catch {
      setErro("Falha ao reordenar a galeria.");
    } finally {
      setOcupado(false);
    }
  }

  // DnD (editores apenas): classe visual por estado (arrastando / alvo).
  function celulaClasse(fid: number) {
    if (fidArrastada === fid) return "space-y-1 opacity-60";
    if (fidSobAlvo === fid && fidArrastada !== null) {
      return "space-y-1 rounded ring-2 ring-indigo-400 dark:ring-indigo-500";
    }
    return "space-y-1";
  }

  function limparDrag() {
    setFidArrastada(null);
    setFidSobAlvo(null);
  }

  function onDragStartFotos(e: DragEvent<HTMLDivElement>, fid: number) {
    if (!podeEditar) return;
    e.dataTransfer.setData("text/plain", String(fid)); // exigido pelo Firefox
    e.dataTransfer.effectAllowed = "move";
    setFidArrastada(fid);
  }

  function onDragOverFotos(e: DragEvent<HTMLDivElement>, fid: number) {
    if (fidArrastada === null || fid === fidArrastada) return;
    e.preventDefault(); // só permite drop em alvo válido
    setFidSobAlvo(fid);
  }

  function onDropFotos(e: DragEvent<HTMLDivElement>, item: Patrimonio, fidAlvo: number) {
    e.preventDefault();
    const fidOrigem = fidArrastada;
    limparDrag();
    if (fidOrigem === null || !fotos || fidOrigem === fidAlvo) return;
    // Semântica de lista: a arrastada vai ao índice do alvo, as demais deslizam.
    const ordem = fotos.map((f) => f.id);
    const iOrigem = ordem.indexOf(fidOrigem);
    const iAlvo = ordem.indexOf(fidAlvo);
    ordem.splice(iOrigem, 1);
    ordem.splice(iAlvo > iOrigem ? iAlvo - 1 : iAlvo, 0, fidOrigem);
    void onReordenarFotos(item, ordem);
  }

  // Remove uma foto específica do detalhe (confirmação no padrão do ③).
  async function onRemoverFotoFid(item: Patrimonio, fid: number) {
    if (!window.confirm("Remover esta foto?")) return;
    setErro(null);
    setOcupado(true);
    try {
      const res = await fetch(fotosUrl(item.id, fid), { method: "DELETE" });
      if (!res.ok) {
        setErro(await lerErro(res));
        return;
      }
      const lista = await carregarFotos(item);
      if (lista) atualizaItem({ ...item, temFoto: lista.length > 0 });
      setFotoVer((v) => v + 1);
      setMsg("Foto removida.");
    } catch {
      setErro("Falha ao remover a foto.");
    } finally {
      setOcupado(false);
    }
  }

  async function onRemover(item: Patrimonio) {
    if (!window.confirm(`Remover o patrimônio ${item.numero}?`)) return;
    setErro(null);
    setOcupado(true);
    try {
      const res = await fetch(`${base}/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        setErro(await lerErro(res));
        return;
      }
      setItens((lista) => (lista ? lista.filter((i) => i.id !== item.id) : lista));
      setMsg("Patrimônio removido.");
      setView({ nome: "lista" });
    } catch {
      setErro("Falha ao remover o patrimônio.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      {erro && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          {erro}
        </p>
      )}
      {msg && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          {msg}
        </p>
      )}
      {aviso && (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        >
          {aviso}
        </p>
      )}

      {view.nome === "lista" && (
        <>
          <div className={CARD}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label htmlFor="busca-patrimonio" className="mb-1 block text-sm font-medium">
                  Buscar
                </label>
                <input
                  id="busca-patrimonio"
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="patrimônio, descrição, marca…"
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="f-detentor" className="mb-1 block text-sm font-medium">
                  Detentor
                </label>
                <input
                  id="f-detentor"
                  type="text"
                  value={detF}
                  onChange={(e) => setDetF(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor="f-local" className="mb-1 block text-sm font-medium">
                  Localização
                </label>
                <input
                  id="f-local"
                  type="text"
                  value={locF}
                  onChange={(e) => setLocF(e.target.value)}
                  className={INPUT}
                />
              </div>
              <label className="flex items-center gap-1.5 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={semDet}
                  onChange={(e) => setSemDet(e.target.checked)}
                />
                Sem detentor
              </label>
              <label className="flex items-center gap-1.5 pb-2 text-sm text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={semLoc}
                  onChange={(e) => setSemLoc(e.target.checked)}
                />
                Sem localização
              </label>
              {podeEditar && (
                <button
                  type="button"
                  onClick={abrirNovo}
                  className={`${BOTAO_PRIMARIO} mb-0.5`}
                >
                  Novo patrimônio
                </button>
              )}
            </div>
            {pend && (
              <p
                className={`mt-3 text-xs ${
                  pend.detentor + pend.localizacao > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-500"
                }`}
              >
                {pend.detentor} sem detentor · {pend.localizacao} sem localização
              </p>
            )}
          </div>

          {erroLista ? (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
            >
              {erroLista}
            </p>
          ) : itens === null ? (
            <p className="text-sm text-zinc-500">Carregando…</p>
          ) : itens.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
              {temFiltro
                ? "Nenhum resultado para os filtros atuais."
                : "Nenhum patrimônio cadastrado."}
              {!temFiltro && podeEditar && (
                <div className="mt-3">
                  <button type="button" onClick={abrirNovo} className={BOTAO_PRIMARIO}>
                    Novo patrimônio
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                    {thOrdem("numero", "Patrimônio")}
                    {thOrdem("descricao", "Descrição")}
                    {thOrdem("marca", "Marca/Modelo")}
                    {thOrdem("detentor", "Detentor")}
                    {thOrdem("localizacao", "Localização")}
                    <th className="px-3 py-2 font-medium">Foto</th>
                    {thOrdem("atualizadoEm", "Atualizado em")}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {itens.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => void abrirDetalhe(p)}
                      className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <td className="px-3 py-2 font-medium">{p.numero}</td>
                      <td className="px-3 py-2">{p.descricao}</td>
                      <td className="px-3 py-2">
                        {p.marca && p.modelo
                          ? `${p.marca} ${p.modelo}`
                          : p.marca ?? p.modelo ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {p.detentor ?? (
                          <span className="text-amber-600 dark:text-amber-400">sem detentor</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {p.localizacao ?? (
                          <span className="text-amber-600 dark:text-amber-400">
                            sem localização
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {p.temFoto ? (
                          // Foto = upload do usuário servido pela API; <img> simples de propósito.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${fotoUrl(p.id)}?v=${fotoVer}`}
                            alt=""
                            className="h-8 w-8 rounded object-cover"
                          />
                        ) : (
                          <IconeSemFoto />
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-500">
                        {dataHora(p.atualizadoEm)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {view.nome === "detalhe" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setView({ nome: "lista" })} className={BOTAO}>
              ← Voltar
            </button>
            <h2 className="text-lg font-semibold">
              {view.item.numero} — {view.item.descricao}
            </h2>
          </div>

          {podeEditar && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => abrirEditar(view.item)}
                disabled={ocupado}
                className={BOTAO}
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => onRemover(view.item)}
                disabled={ocupado}
                className={BOTAO_PERIGO}
              >
                Remover patrimônio
              </button>
            </div>
          )}

          <div className={CARD}>
            {fotos === null ? (
              <p className="mb-4 text-sm text-zinc-500">Carregando fotos…</p>
            ) : fotos.length === 0 ? (
              <p className="mb-4 text-sm text-zinc-500">Sem foto.</p>
            ) : (
              <div className="mb-4 flex flex-wrap gap-3">
                {/* D8: detalhe = EXIBIÇÃO pura — fotos lado a lado, clique amplia.
                    Toda modificação (adicionar/remover/reordenar) vai para o Editar.
                    Capa = 1ª célula, no mesmo formato das demais. */}
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() =>
                      setFotoAmpliada({
                        src: fotosUrl(view.item.id, fotos[0].id),
                        alt: `Foto do patrimônio ${view.item.numero}`,
                      })
                    }
                    className="block cursor-zoom-in"
                    aria-label="Ampliar foto de capa"
                  >
                    {/* Foto = upload do usuário servido pela API; <img> simples de propósito. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fotosUrl(view.item.id, fotos[0].id)}
                      alt={`Foto do patrimônio ${view.item.numero}`}
                      className="h-28 w-28 aspect-square object-cover rounded border border-zinc-200 dark:border-zinc-800"
                    />
                  </button>
                  <span className="text-xs text-zinc-500">
                    Capa · {fotos.length} foto{fotos.length > 1 ? "s" : ""}
                  </span>
                </div>
                {fotos.slice(1).map((f) => (
                  <div key={f.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() =>
                        setFotoAmpliada({
                          src: fotosUrl(view.item.id, f.id),
                          alt: `Foto ${f.id} do patrimônio ${view.item.numero}`,
                        })
                      }
                      className="block cursor-zoom-in"
                      aria-label={`Ampliar foto ${f.id}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fotosUrl(view.item.id, f.id)}
                        alt=""
                        className="h-28 w-28 aspect-square object-cover rounded border border-zinc-200 dark:border-zinc-800"
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Campo rotulo="Patrimônio" valor={view.item.numero} />
              <Campo rotulo="Descrição" valor={view.item.descricao} />
              <Campo rotulo="Marca" valor={view.item.marca} />
              <Campo rotulo="Modelo" valor={view.item.modelo} />
              <Campo rotulo="Série" valor={view.item.serie} />
              <Campo rotulo="Responsável" valor={view.item.responsavel} />
              <Campo rotulo="Detentor" valor={view.item.detentor} pendente />
              <Campo rotulo="Localização" valor={view.item.localizacao} pendente />
              <Campo rotulo="Atualizado em" valor={dataHora(view.item.atualizadoEm)} />
              {view.item.atualizadoPor && (
                <Campo
                  rotulo="Atualizado por"
                  valor={view.item.atualizadoPor.nome || view.item.atualizadoPor.uid}
                />
              )}
            </dl>
          </div>
        </div>
      )}

      {(view.nome === "novo" || view.nome === "editar") && (
        <form onSubmit={submitForm} className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">
              {view.nome === "novo" ? "Novo patrimônio" : `Editar ${view.item.numero}`}
            </h2>
            <button
              type="button"
              onClick={() => {
                // D7-2: cancel do editar volta ao detalhe via abrirDetalhe
                // (busca o detalhe — o "Atualizado por" não fica órfão).
                if (view.nome === "novo") setView({ nome: "lista" });
                else void abrirDetalhe(view.item);
              }}
              className={BOTAO}
            >
              Cancelar
            </button>
          </div>

          <div className={`${CARD} grid grid-cols-1 gap-4 sm:grid-cols-2`}>
            <CampoForm
              id="p-numero"
              rotulo="Patrimônio"
              obrigatorio
              valor={form.numero}
              onChange={(v) => setForm((f) => ({ ...f, numero: v }))}
            />
            <CampoForm
              id="p-descricao"
              rotulo="Descrição"
              obrigatorio
              valor={form.descricao}
              onChange={(v) => setForm((f) => ({ ...f, descricao: v }))}
            />
            <CampoForm
              id="p-marca"
              rotulo="Marca"
              valor={form.marca}
              onChange={(v) => setForm((f) => ({ ...f, marca: v }))}
            />
            <CampoForm
              id="p-modelo"
              rotulo="Modelo"
              valor={form.modelo}
              onChange={(v) => setForm((f) => ({ ...f, modelo: v }))}
            />
            <CampoForm
              id="p-serie"
              rotulo="Série"
              valor={form.serie}
              onChange={(v) => setForm((f) => ({ ...f, serie: v }))}
            />
            <CampoForm
              id="p-responsavel"
              rotulo="Responsável"
              valor={form.responsavel}
              onChange={(v) => setForm((f) => ({ ...f, responsavel: v }))}
            />
            <DetentorCombobox
              id="p-detentor"
              rotulo="Detentor"
              valor={form.detentor}
              onChange={(v) => setForm((f) => ({ ...f, detentor: v }))}
            />
            <CampoForm
              id="p-local"
              rotulo="Localização"
              valor={form.localizacao}
              onChange={(v) => setForm((f) => ({ ...f, localizacao: v }))}
            />
          </div>

          {view.nome === "editar" && (
            <div className={CARD}>
              <p className="mb-2 text-sm font-medium">
                Fotos
                {fotos !== null && fotos.length > 0 && (
                  <span className="font-normal text-zinc-500">
                    {" "}
                    ({fotos.length}/{FOTOS_MAX} — a 1ª é a capa)
                  </span>
                )}
              </p>

              {fotos === null ? (
                <p className="text-sm text-zinc-500">Carregando fotos…</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {fotos.length === 0 && (
                    <p className="mb-1 text-sm text-zinc-500">Sem foto.</p>
                  )}
                  {/* D8: gestão de fotos no editar — arrastar reordena (ordem[0]=capa),
                      Remover tem confirmação; adicionar é imediato (cada op. é uma
                      alteração do item e registra o operador no "Atualizado por"). */}
                  {fotos.length > 0 && (
                    <div
                      className={celulaClasse(fotos[0].id)}
                      draggable
                      onDragStart={(e) => onDragStartFotos(e, fotos[0].id)}
                      onDragOver={(e) => onDragOverFotos(e, fotos[0].id)}
                      onDragLeave={() => {
                        if (fidSobAlvo === fotos[0].id) setFidSobAlvo(null);
                      }}
                      onDrop={(e) => onDropFotos(e, view.item, fotos[0].id)}
                      onDragEnd={limparDrag}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fotosUrl(view.item.id, fotos[0].id)}
                        alt={`Foto de capa do patrimônio ${view.item.numero}`}
                        className="h-28 w-28 aspect-square object-cover rounded border border-zinc-200 dark:border-zinc-800"
                      />
                      <button
                        type="button"
                        onClick={() => void onRemoverFotoFid(view.item, fotos[0].id)}
                        disabled={ocupado}
                        className={`${BOTAO_PERIGO} w-full`}
                      >
                        Remover
                      </button>
                    </div>
                  )}
                  {fotos.slice(1).map((f) => (
                    <div
                      key={f.id}
                      className={celulaClasse(f.id)}
                      draggable
                      onDragStart={(e) => onDragStartFotos(e, f.id)}
                      onDragOver={(e) => onDragOverFotos(e, f.id)}
                      onDragLeave={() => {
                        if (fidSobAlvo === f.id) setFidSobAlvo(null);
                      }}
                      onDrop={(e) => onDropFotos(e, view.item, f.id)}
                      onDragEnd={limparDrag}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={fotosUrl(view.item.id, f.id)}
                        alt=""
                        className="h-28 w-28 aspect-square object-cover rounded border border-zinc-200 dark:border-zinc-800"
                      />
                      <button
                        type="button"
                        onClick={() => void onRemoverFotoFid(view.item, f.id)}
                        disabled={ocupado}
                        className={`${BOTAO_PERIGO} w-full`}
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label className={`${BOTAO} mt-5 cursor-pointer`}>
                Adicionar fotos
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files ? Array.from(e.target.files) : [];
                    e.target.value = "";
                    if (files.length) void onAdicionarFotos(view.item, files);
                  }}
                />
              </label>
              <p className="mt-2 text-xs text-zinc-500">
                Arraste uma foto até outra para reordenar — a 1ª vira a capa.
              </p>
            </div>
          )}
          {view.nome === "novo" && (
            <div className={CARD}>
              <label htmlFor="p-fotos" className="mb-1 block text-sm font-medium">
                Fotos (opcional, até {FOTOS_MAX})
              </label>
              <input
                id="p-fotos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : [];
                  setFotosForm(files);
                  e.target.value = "";
                }}
                className={INPUT}
              />
              {fotosForm.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500">
                  {fotosForm.length} arquivo{fotosForm.length > 1 ? "s" : ""} selecionado
                  {fotosForm.length > 1 ? "s" : ""} — JPEG, PNG ou WebP, até 5 MB cada, máx{" "}
                  {FOTOS_MAX}.
                </p>
              )}
            </div>
          )}
          <button type="submit" disabled={ocupado} className={BOTAO_PRIMARIO}>
            {ocupado ? "Salvando…" : "Salvar"}
          </button>
        </form>
      )}

      {/* Lightbox (pedido ③-B): overlay com a foto ampliada; fecha por X, ESC ou clique no fundo. */}
      {fotoAmpliada && (
        <div
          role="dialog"
          aria-label="Foto ampliada"
          onClick={() => setFotoAmpliada(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        >
          <button
            type="button"
            onClick={() => setFotoAmpliada(null)}
            aria-label="Fechar"
            className="absolute right-4 top-4 text-3xl leading-none text-white hover:text-zinc-300"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fotoAmpliada.src}
            alt={fotoAmpliada.alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        </div>
      )}
    </div>
  );
}
