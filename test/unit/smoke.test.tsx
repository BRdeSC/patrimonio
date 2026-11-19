// Smoke test: valida a pipeline Vitest + Testing Library + jsdom + Tailwind-free render.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PapelBadge } from "@/components/PapelBadge";

describe("smoke", () => {
  it("renderiza PapelBadge com cada papel", () => {
    render(
      <div>
        <PapelBadge papel="OWNER" />
        <PapelBadge papel="OPERATOR" />
        <PapelBadge papel="VIEWER" />
      </div>,
    );
    expect(screen.getByText("OWNER")).toBeInTheDocument();
    expect(screen.getByText("OPERATOR")).toBeInTheDocument();
    expect(screen.getByText("VIEWER")).toBeInTheDocument();
  });

  it("renderiza 'Leitura' quando não há papel (leitura pública)", () => {
    render(<PapelBadge papel={null} />);
    expect(screen.getByText("Leitura")).toBeInTheDocument();
  });
});
