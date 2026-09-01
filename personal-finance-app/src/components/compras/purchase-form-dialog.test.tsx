import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PurchaseFormDialog, type PurchaseFormCard } from "./purchase-form-dialog";

// Las Server Actions importan Prisma: las mockeamos para testear solo la UI.
vi.mock("@/server/actions/purchases", () => ({
  createPurchase: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const creditCard: PurchaseFormCard = {
  id: "card-credito",
  type: "CREDIT",
  name: "Tarjeta principal",
  bank: "Galicia",
  last4: "1234",
  currencies: ["ARS"],
  closingDay: 5,
  dueDay: 15,
  hasCreditLimit: false,
};

const debitCard: PurchaseFormCard = {
  ...creditCard,
  id: "card-debito",
  type: "DEBIT",
  name: "Débito",
  closingDay: null,
  dueDay: null,
};

/**
 * El `Select` de Radix renderiza el trigger visible (role combobox) y, además, un
 * `<select>` nativo oculto con TODAS las opciones. Buscar por texto encontraría las dos,
 * así que se consulta el trigger por su rol y se lee el valor mostrado.
 */
function selectedPaymentMethod() {
  return screen.getByRole("combobox", { name: "Medio de pago" });
}

function openDialog(cards: PurchaseFormCard[]) {
  render(
    <PurchaseFormDialog
      cards={cards}
      categories={[]}
      defaultCurrency="ARS"
      trigger={<button>Nuevo movimiento</button>}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Nuevo movimiento" }));
}

describe("PurchaseFormDialog — medio de pago inicial", () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * El onboarding permite registrar el primer gasto sin tener ninguna tarjeta (ver
   * `pendingStep` en server/lib/onboarding). Si el form abriera en "Crédito", ese
   * usuario caería directo en el cartel de "No tenés tarjetas de crédito": un callejón
   * sin salida en el primer movimiento que intenta cargar.
   */
  it("sin tarjetas abre en Efectivo, no en Crédito", async () => {
    openDialog([]);

    expect(await screen.findByText("Nuevo movimiento", { selector: "h2" })).toBeInTheDocument();
    expect(selectedPaymentMethod()).toHaveTextContent("Efectivo");
    expect(screen.queryByText(/No tenés tarjetas/)).not.toBeInTheDocument();
    // Efectivo es pago único: no se ofrece elegir cuotas.
    expect(screen.queryByText("Cuotas")).not.toBeInTheDocument();
  });

  it("sin tarjetas describe el movimiento como gasto de pago único", async () => {
    openDialog([]);

    expect(
      await screen.findByText(/Gasto de pago único: se descuenta de tus ahorros/)
    ).toBeInTheDocument();
  });

  it("con una tarjeta de crédito abre en Crédito y ofrece cuotas", async () => {
    openDialog([creditCard]);

    expect(await screen.findByText("Nuevo movimiento", { selector: "h2" })).toBeInTheDocument();
    expect(selectedPaymentMethod()).toHaveTextContent("Crédito (en cuotas)");
    expect(screen.getByText("Cuotas")).toBeInTheDocument();
    expect(screen.queryByText(/No tenés tarjetas/)).not.toBeInTheDocument();
  });

  it("con tarjetas solo de débito abre en Débito", async () => {
    openDialog([debitCard]);

    expect(await screen.findByText("Nuevo movimiento", { selector: "h2" })).toBeInTheDocument();
    expect(selectedPaymentMethod()).toHaveTextContent("Débito");
    expect(screen.queryByText(/No tenés tarjetas/)).not.toBeInTheDocument();
  });
});
