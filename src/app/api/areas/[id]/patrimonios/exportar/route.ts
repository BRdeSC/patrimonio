// GET /api/areas/[id]/patrimonios/exportar — exporta a lista de patrimônios
// como PDF, **como exibida**: aceita os MESMOS query params do GET
// ..../patrimonios (q, detentor, localizacao, pendente, col, dir) e reusa o
// mesmo where/orderBy (lib/patrimonio) → paridade total com a tela.
//
// v1 (limites documentados):
// - SEM FOTOS no PDF (coluna "Foto" fora — decisão do dono);
// - layout FINAL ③-D.2 + ajuste ③-D.3: A4 RETRATO, 6 colunas de largura
//   fixa em mm (26/45/33/30/30/22 = 186mm), 8.5pt, zebra suave,
//   "Atualizado em" só com data (dd/mm/aaaa, sem horário);
// - buffer em memória (sem streaming) — suficiente para milhares de itens.
//
// Guards idênticos ao GET da lista (../route.ts): 401 sem sessão →
// 400 id inválido → 404 uniforme (área inexistente OU privada p/ não-membro)
// → canRead. VIEWER pode exportar (mesmos dados da lista — zero exposição nova).
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { getAreaContext, canReadArea } from "@/lib/access";
import { getSessionUser } from "@/lib/session";
import { areaIdParamSchema } from "@/lib/api";
import { listPatrimoniosQuerySchema } from "@/lib/validators/patrimonio";
import {
  SELECT_RESUMO,
  orderByLista,
  whereLista,
  type PatrimonioLinha,
} from "@/lib/patrimonio";
import { slugify } from "@/lib/slug";
import type { AreaDetalhe, SessionUser } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

type Resolved =
  | { error: Response }
  | { user: SessionUser; area: AreaDetalhe };

async function resolve(request: Request, ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser(request);
  if (!user) {
    return { error: Response.json({ erro: "Não autenticado" }, { status: 401 }) } as const;
  }
  const { id } = await ctx.params;
  const idParsed = areaIdParamSchema.safeParse(id);
  if (!idParsed.success) {
    return { error: Response.json({ erro: "id inválido" }, { status: 400 }) } as const;
  }
  const area = await getAreaContext(user, idParsed.data);
  if (!area) {
    return { error: Response.json({ erro: "Área não encontrada" }, { status: 404 }) } as const;
  }
  return { user, area } as const;
}

export async function GET(request: Request, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if ("error" in resolved) return resolved.error;
  const { user, area } = resolved;
  // Não-membro de área privada → 404 idêntico ao inexistente (uniforme).
  if (!canReadArea(area)) {
    return Response.json({ erro: "Área não encontrada" }, { status: 404 });
  }

  // Mesmos params da listagem → o PDF reflete exatamente o que está na tela.
  const query = new URL(request.url).searchParams;
  const parsed = listPatrimoniosQuerySchema.safeParse({
    q: query.get("q") ?? undefined,
    detentor: query.get("detentor") ?? undefined,
    localizacao: query.get("localizacao") ?? undefined,
    pendente: query.get("pendente") ?? undefined,
    col: query.get("col") ?? undefined,
    dir: query.get("dir") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ erro: "Parâmetros inválidos" }, { status: 400 });
  }

  const itens = await prisma.patrimonio.findMany({
    where: whereLista(area.id, parsed.data),
    orderBy: orderByLista(parsed.data.col, parsed.data.dir),
    select: SELECT_RESUMO,
  });

  // slugify (lib/slug) → ASCII [a-z0-9-]: sem injeção em filename.
  const slug = slugify(area.nome) || "area";
  const buffer = await gerarPdf({
    areaNome: area.nome,
    autorNome: user.nome,
    itens,
  });
  // Cópia em ArrayBuffer: BodyInit do TS 5.7+ exige Uint8Array<ArrayBuffer>
  // (mesmo padrão de serveFoto, lib/foto).
  const bytes = new Uint8Array(buffer);
  // inline (E.1, pedido do dono 26/11): o botão do painel faz window.open →
  // o browser EXIBE o PDF na nova aba; para baixar, o usuário usa o "Salvar"
  // do viewer (diálogo de nome: aceita o sugerido ou altera). attachment
  // descarregava direto p/ a pasta de downloads, sem diálogo (nomes
  // duplicados viravam "(1)", "(2)", ...). O filename segue presente como
  // nome sugerido no diálogo de salvar (RFC 6266: advisory no inline).
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="patrimonio-${slug}.pdf"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}

// ---------------------------------------------------------------------------
// Geração do PDF (pdfkit, puro JS — fonte Helvetica embutida, WinAnsi:
// acentos pt-BR ok). A4 RETRATO, margens laterais 12mm, topo/base 40pt,
// buffer em memória (spec final do dono, ③-D.2).
// ---------------------------------------------------------------------------

const MM = 72 / 25.4; // 1mm em pt (≈2.835) — larguras espelham a spec em mm
const MARGEM_LATERAL = 12 * MM; // margens laterais: 12mm ≈ 34.02pt
const MARGEM_TB = 40; // topo/base (invariado do ③-D)
const PAD = 2 * MM; // padding horizontal da célula: 2mm ≈ 5.67pt
const PADV = 2 * MM; // padding vertical da célula: 2mm ≈ 5.67pt
const FONTE_TABELA = 8.5; // corpo + cabeçalho da tabela (spec ③-D.2)
const ALTA_LINHA = 11; // altura de linha do cabeçalho em 8.5pt (≈10.2pt + folga)

// dd/mm/aaaa — coluna "Atualizado em" (SÓ a data, sem horário — ③-D.3:
// evita quebra de linha desnecessária na coluna de 22mm; a lista da UI
// continua exibindo data+hora).
const fmtData = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

// dd/mm/aaaa HH:MM (linha "Gerado em" do cabeçalho).
const fmtGeradoEm = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// 6 colunas com largura FIXA em mm (spec final do dono, ③-D.2 + ajuste
// ③-D.3: Descrição 41→45mm, Atualizado em 26→22mm) — soma
// 186mm = 100% da largura útil (210mm − 2×12mm = 527.24pt). "Foto" continua
// fora; "Marca/Modelo" com o MESMO texto da célula da lista.
type Coluna = { rotulo: string; largura: number; texto: (i: PatrimonioLinha) => string };

const COLUNAS: Coluna[] = [
  { rotulo: "Patrimônio", largura: 26 * MM, texto: (i) => i.numero },
  { rotulo: "Descrição", largura: 45 * MM, texto: (i) => i.descricao },
  {
    // Idêntico à célula da lista: marca+modelo juntos quando ambos existem.
    rotulo: "Marca/Modelo",
    largura: 33 * MM,
    texto: (i) => (i.marca && i.modelo ? `${i.marca} ${i.modelo}` : i.marca ?? i.modelo ?? "—"),
  },
  { rotulo: "Detentor", largura: 30 * MM, texto: (i) => i.detentor ?? "—" },
  { rotulo: "Localização", largura: 30 * MM, texto: (i) => i.localizacao ?? "—" },
  { rotulo: "Atualizado em", largura: 22 * MM, texto: (i) => fmtData.format(i.atualizadoEm) },
];

// Options COMPARTILHADAS por heightOfString (altura da linha) e text() (render):
// com as mesmas options, as duas passam pelo MESMO motor de wrap do pdfkit →
// a altura medida é sempre igual às linhas renderizadas (grid alinhado, sem
// estouro horizontal).
// `hyphenate`: não existe como option no pdfkit 0.21 (nem nos types, nem na
// lib — verificado empiricamente: altura idêntica com/sem a chave; a chave é
// ignorada em runtime). Mantida no objeto para versões futuras da lib. A
// quebra de palavra longa (maior que a coluna) já é garantida pela própria
// lib (eachWord: split por caractere — verificado empiricamente em ③-D.1:
// token de 90 chars ≈ 405pt em coluna de 334pt → 3 linhas, zero estouro).
const optsCelula = (largura: number) =>
  ({ width: largura - 2 * PAD, lineBreak: true, hyphenate: true } as { width: number; lineBreak: boolean });

function gerarPdf(opts: {
  areaNome: string;
  autorNome: string;
  itens: PatrimonioLinha[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    // margin: MARGEM_TB (40pt, topo/base invariados) — usado pelo pdfkit em
    // page.maxY() nas quebras automáticas; as margens laterais (12mm) são
    // aplicadas explicitamente no layout abaixo (MARGEM_LATERAL).
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margin: MARGEM_TB });
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const larguraUtil = doc.page.width - MARGEM_LATERAL * 2; // 186mm = 527.24pt
    // Rodapé: a linha de 8pt (≈9.6pt) precisa ter a BASE dentro da
    // maxY (height − margem inferior), senão o pdfkit 0.21 cria uma página
    // em branco (comportamento verificado empiricamente). 12pt de folga.
    const rodapeY = doc.page.height - MARGEM_TB - 12;

    // Colunas na mesma ordem da tabela — posição X FIXA e acumulada; o
    // texto nunca alarga a coluna (spec ③-D.2, item 4).
    const colX: number[] = [];
    {
      let x = MARGEM_LATERAL;
      for (const c of COLUNAS) {
        colX.push(x);
        x += c.largura;
      }
    }

    function linhaCabecalho() {
      doc.font("Helvetica-Bold").fontSize(FONTE_TABELA);
      const y = doc.y;
      COLUNAS.forEach((c, i) => {
        doc.text(c.rotulo, colX[i] + PAD, y + PADV, { width: c.largura - 2 * PAD, lineBreak: false });
      });
      doc.y = y + ALTA_LINHA + 2 * PADV;
      doc.moveTo(MARGEM_LATERAL, doc.y)
        .lineTo(MARGEM_LATERAL + larguraUtil, doc.y)
        .lineWidth(0.5)
        .strokeColor("#999999")
        .stroke();
      doc.y += 1;
    }

    // ---- Cabeçalho do documento ----
    doc.font("Helvetica-Bold").fontSize(16);
    doc.text(`Patrimônio — ${opts.areaNome}`, MARGEM_LATERAL, MARGEM_TB, { width: larguraUtil });
    doc.font("Helvetica").fontSize(9).fillColor("#555555");
    doc.text(
      `Gerado em ${fmtGeradoEm.format(new Date())} por ${opts.autorNome}`,
      MARGEM_LATERAL,
      doc.y + 2,
      { width: larguraUtil, lineBreak: false },
    );
    doc.text(
      `Total: ${opts.itens.length} ${opts.itens.length === 1 ? "item" : "itens"}`,
      MARGEM_LATERAL,
      doc.y + 2,
      { width: larguraUtil, lineBreak: false },
    );
    doc.fillColor("#000000");
    doc.y += 12;

    // ---- Tabela ----
    if (opts.itens.length === 0) {
      // 0 itens não é erro: PDF com cabeçalho + "Nenhum item".
      doc.font("Helvetica").fontSize(10);
      doc.text("Nenhum item", MARGEM_LATERAL, doc.y + 6, { width: larguraUtil, lineBreak: false });
    } else {
      linhaCabecalho();
      doc.font("Helvetica").fontSize(FONTE_TABELA);
      opts.itens.forEach((item, idx) => {
        const textoCelula = COLUNAS.map((c) => c.texto(item));
        // Altura da linha = célula mais alta + padding vertical (2mm).
        // MESMAS options (optsCelula) no heightOfString e no text() abaixo →
        // mesmo motor de wrap → a altura medida é sempre igual às linhas
        // renderizadas (sem estouro, grid ok).
        const altura =
          Math.max(
            ...COLUNAS.map((c, i) => doc.heightOfString(textoCelula[i], optsCelula(c.largura))),
          ) + 2 * PADV;

        // Paginação: a linha não cabe → nova página + cabeçalho repetido.
        if (doc.y + altura > rodapeY) {
          doc.addPage();
          linhaCabecalho();
          doc.font("Helvetica").fontSize(FONTE_TABELA);
        }

        const y0 = doc.y;

        // Zebra suave (spec ③-D.2): linhas de índice ÍMPAR (2ª, 4ª, …) em
        // #f5f5f5, largura total da tabela, desenhadas ANTES do texto e do
        // grid. save/restore: não contamina a cor de preenchimento do texto.
        if (idx % 2 === 1) {
          doc.save();
          doc.rect(MARGEM_LATERAL, y0, larguraUtil, altura).fill("#f5f5f5");
          doc.restore();
        }

        doc.fillColor("#000000");
        textoCelula.forEach((texto, i) => {
          doc.text(texto, colX[i] + PAD, y0 + PADV, optsCelula(COLUNAS[i].largura));
        });
        doc.y = y0 + altura;

        // Grid simples: linha inferior da linha + verticais da altura dela.
        doc.lineWidth(0.5).strokeColor("#dddddd");
        doc.moveTo(MARGEM_LATERAL, doc.y).lineTo(MARGEM_LATERAL + larguraUtil, doc.y).stroke();
        for (let i = 0; i <= COLUNAS.length; i++) {
          const x =
            i === 0 ? MARGEM_LATERAL : i === COLUNAS.length ? MARGEM_LATERAL + larguraUtil : colX[i];
          doc.moveTo(x, y0).lineTo(x, doc.y).stroke();
        }
        doc.y += 1;
      });
    }

    // ---- Rodapé em todas as páginas (bufferPages): "Página X de Y" ----
    const totalPaginas = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPaginas; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8).fillColor("#888888");
      doc.text(`Página ${i + 1} de ${totalPaginas}`, MARGEM_LATERAL, rodapeY, {
        width: larguraUtil,
        align: "center",
        lineBreak: false,
      });
    }

    doc.end();
  });
}
