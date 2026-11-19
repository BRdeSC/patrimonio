// Smoke test da aba Patrimônios (pacote ③, turno B): render, RBAC e estado vazio.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PatrimoniosPanel } from "@/components/PatrimoniosPanel";

const ITEM = {
  id: 1,
  numero: "IT-0001",
  descricao: "Notebook Dell",
  marca: "Dell",
  modelo: "Latitude",
  serie: "SN123",
  responsavel: "TI",
  detentor: null,
  localizacao: "Sala 10",
  temFoto: false,
  atualizadoEm: "2026-11-16T12:00:00.000Z",
};

function mockFetchLista(itens: unknown[]) {
  // Mock ciente da URL: GET .../fotos responde { fotos: [] } (contrato real da rota);
  // GET .../patrimonios/:pid (detalhe) responde { patrimonio: ITEM + atualizadoPor }
  // (contrato D7/D7-2 — abrir o detalhe busca o detalhe e o autor pode ser outro
  // usuário, como neste mock: o painel é OPERATOR, o autor é o gestor);
  // o resto responde a lista de patrimônios.
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/fotos")) {
      return { ok: true, status: 200, json: async () => ({ fotos: [] }) };
    }
    if (/\/patrimonios\/\d+$/.test(url)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          patrimonio: { ...ITEM, atualizadoPor: { uid: "coids.gestor", nome: "Gestor COIDS" } },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ patrimonios: itens }) };
  });
}

describe("PatrimoniosPanel (smoke)", () => {
  // Sem globals no vitest → auto-cleanup não se registra; limpa o DOM entre testes.
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lista itens e não expõe botões de escrita para VIEWER", async () => {
    vi.stubGlobal("fetch", mockFetchLista([ITEM]));
    render(<PatrimoniosPanel areaId={1} papel="VIEWER" />);
    expect(await screen.findByText("IT-0001")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo patrimônio" })).not.toBeInTheDocument();
  });

  it("exibe Novo patrimônio e abre o detalhe ao clicar na linha (OPERATOR)", async () => {
    vi.stubGlobal("fetch", mockFetchLista([ITEM]));
    render(<PatrimoniosPanel areaId={1} papel="OPERATOR" />);
    expect(await screen.findByText("IT-0001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo patrimônio" })).toBeInTheDocument();
    // Contador de pendências a partir da resposta (item sem detentor).
    expect(screen.getByText(/1 sem detentor/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("IT-0001"));
    expect(await screen.findByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Voltar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover patrimônio" })).toBeInTheDocument();
    // D7-2: abrir o detalhe busca o detalhe → "Atualizado por" aparece mesmo para
    // quem NÃO foi o autor (listagem não traz o campo; o mock responde o gestor).
    expect(await screen.findByText("Atualizado por")).toBeInTheDocument();
    expect(await screen.findByText("Gestor COIDS")).toBeInTheDocument();
  });

  it("mostra estado vazio com CTA para OPERATOR", async () => {
    vi.stubGlobal("fetch", mockFetchLista([]));
    render(<PatrimoniosPanel areaId={1} papel="OPERATOR" />);
    expect(await screen.findByText("Nenhum patrimônio cadastrado.")).toBeInTheDocument();
    // Botão na toolbar + CTA do estado vazio.
    expect(screen.getAllByRole("button", { name: "Novo patrimônio" }).length).toBeGreaterThanOrEqual(1);
  });
});
