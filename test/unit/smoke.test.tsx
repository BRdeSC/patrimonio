// Smoke test: valida a pipeline Vitest + Testing Library + jsdom + Tailwind-free render.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PapelBadge } from "@/components/PapelBadge";

describe("smoke", () => {
  it("renderiza PapelBadge com cada papel", () => {
    render(
      <div>
        <PapelBadge papel="admin_area" />
        <PapelBadge papel="secretaria" />
        <PapelBadge papel="usuario" />
      </div>,
    );
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Secretaria")).toBeInTheDocument();
    expect(screen.getByText("Usuário")).toBeInTheDocument();
  });

  it("renderiza 'Leitura' quando não há papel (leitura pública)", () => {
    render(<PapelBadge papel={null} />);
    expect(screen.getByText("Leitura")).toBeInTheDocument();
  });
});
