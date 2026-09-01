import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CardFormDialog } from "./card-form-dialog";

// Las Server Actions importan Prisma: las mockeamos para testear solo la UI.
vi.mock("@/server/actions/cards", () => ({
  createCard: vi.fn().mockResolvedValue({ status: "created" }),
  updateCard: vi.fn().mockResolvedValue(undefined),
  reactivateCard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TOGGLE = "Datos de la tarjeta (opcional)";

function openDialog() {
  render(<CardFormDialog trigger={<button>+ Nueva tarjeta</button>} />);
  fireEvent.click(screen.getByRole("button", { name: "+ Nueva tarjeta" }));
}

/**
 * Nivel 1 y 2 del rebranding (REBRANDING.md § 1): el alta muestra solo lo que el motor de
 * cuotas necesita. Los datos que identifican el plástico —y que obligan a tenerlo en la
 * mano— quedan detrás de un toggle.
 */
describe("CardFormDialog — datos identificatorios plegados", () => {
  beforeEach(() => vi.clearAllMocks());

  it("el alta muestra los campos del ciclo, no los identificatorios", async () => {
    openDialog();

    // Visibles: lo que el motor necesita.
    expect(await screen.findByText("Nombre")).toBeInTheDocument();
    expect(screen.getByText("Banco")).toBeInTheDocument();
    expect(screen.getByText("Día de cierre")).toBeInTheDocument();
    expect(screen.getByText("Día de vencimiento")).toBeInTheDocument();

    // Plegados: identifican el plástico, no hacen falta para calcular cuotas.
    expect(screen.queryByText("Últimos 4 dígitos")).not.toBeInTheDocument();
    expect(screen.queryByText("Vencimiento (MM/AA)")).not.toBeInTheDocument();
    expect(screen.queryByText("Marca")).not.toBeInTheDocument();
    expect(screen.queryByText("Dueño")).not.toBeInTheDocument();
  });

  it("el toggle despliega los cuatro campos opcionales", async () => {
    openDialog();
    fireEvent.click(await screen.findByRole("button", { name: TOGGLE }));

    expect(await screen.findByText("Últimos 4 dígitos")).toBeInTheDocument();
    expect(screen.getByText("Vencimiento (MM/AA)")).toBeInTheDocument();
    expect(screen.getByText("Marca")).toBeInTheDocument();
    expect(screen.getByText("Dueño")).toBeInTheDocument();
  });

  it("en edición arrancan desplegados: esconder datos ya cargados sería peor", async () => {
    render(
      <CardFormDialog
        card={{
          id: "cixf00000000000000000000",
          type: "CREDIT",
          name: "Tarjeta principal",
          owner: null,
          bank: "Galicia",
          brand: "Visa",
          last4: "1234",
          expirationDate: new Date("2030-12-31"),
          closingDay: 20,
          dueDay: 10,
          currencies: ["ARS"],
          isActive: true,
          creditLimitCents: null,
        }}
        trigger={<button>Editar</button>}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));

    expect(await screen.findByText("Últimos 4 dígitos")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1234")).toBeInTheDocument();
  });
});
