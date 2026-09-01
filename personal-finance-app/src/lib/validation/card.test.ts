import { describe, it, expect, vi, afterEach } from "vitest";
import { cardSchema } from "./card";

const base = {
  type: "CREDIT" as const,
  name: "Visa Galicia",
  bank: "Galicia",
  last4: "1234",
  closingDay: 20,
  dueDay: 10,
  currencies: ["ARS"] as const,
  creditLimit: 2_000_000,
};

describe("cardSchema — vencimiento", () => {
  afterEach(() => vi.useRealTimers());

  it("rechaza una tarjeta con vencimiento en el pasado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // junio 2026

    const result = cardSchema.safeParse({ ...base, expiration: "01/20" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/vencida/i);
  });

  it("acepta un vencimiento futuro", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15));

    expect(cardSchema.safeParse({ ...base, expiration: "08/30" }).success).toBe(true);
  });

  it("acepta el mes en curso (la tarjeta vale hasta fin de mes)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // 15/06/2026

    expect(cardSchema.safeParse({ ...base, expiration: "06/26" }).success).toBe(true);
  });

  it("reporta formato inválido sin romper", () => {
    const result = cardSchema.safeParse({ ...base, expiration: "13/99" });
    expect(result.success).toBe(false);
  });
});

describe("cardSchema — monedas", () => {
  const credit = { ...base, expiration: "08/30" };

  it("acepta una tarjeta multi-moneda (ARS y USD)", () => {
    const result = cardSchema.safeParse({ ...credit, currencies: ["ARS", "USD"] });
    expect(result.success).toBe(true);
    expect(result.data?.currencies).toEqual(["ARS", "USD"]);
  });

  it("rechaza una tarjeta sin monedas", () => {
    const result = cardSchema.safeParse({ ...credit, currencies: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/al menos una moneda/i);
  });

  it("deduplica monedas repetidas", () => {
    const result = cardSchema.safeParse({ ...credit, currencies: ["ARS", "ARS"] });
    expect(result.success).toBe(true);
    expect(result.data?.currencies).toEqual(["ARS"]);
  });
});

describe("cardSchema — límite de crédito", () => {
  const credit = { ...base, expiration: "08/30" };

  it("acepta una tarjeta de crédito sin límite (es opcional)", () => {
    // El límite es opt-in: solo aparece con el seguimiento activo y puede quedar vacío.
    expect(cardSchema.safeParse({ ...credit, creditLimit: undefined }).success).toBe(true);
    expect(cardSchema.safeParse({ ...credit, creditLimit: null }).success).toBe(true);
  });

  it("rechaza un límite de 0 o negativo", () => {
    expect(cardSchema.safeParse({ ...credit, creditLimit: 0 }).success).toBe(false);
    expect(cardSchema.safeParse({ ...credit, creditLimit: -100 }).success).toBe(false);
  });

  it("acepta un límite positivo", () => {
    const result = cardSchema.safeParse({ ...credit, creditLimit: 3_000_000 });
    expect(result.success).toBe(true);
    expect(result.data?.creditLimit).toBe(3_000_000);
  });

  it("no exige límite en una tarjeta de débito", () => {
    const result = cardSchema.safeParse({
      type: "DEBIT",
      name: "Visa Débito",
      bank: "Galicia",
      last4: "1234",
      currencies: ["ARS"],
    });
    expect(result.success).toBe(true);
  });
});

/**
 * Nivel 1 y 2 del rebranding (ver REBRANDING.md § 1): los campos que solo identifican el
 * plástico dejaron de ser obligatorios. Lo único requerido es lo que el motor de cuotas
 * necesita: tipo, nombre, banco y —en crédito— el ciclo de cierre/vencimiento.
 */
describe("cardSchema — campos identificatorios opcionales", () => {
  const minima = {
    type: "CREDIT" as const,
    name: "Tarjeta principal",
    bank: "Galicia",
    closingDay: 20,
    dueDay: 10,
    currencies: ["ARS"] as const,
  };

  it("acepta una tarjeta de crédito sin últimos 4, sin MM/AA, sin marca y sin dueño", () => {
    expect(cardSchema.safeParse(minima).success).toBe(true);
  });

  it("acepta esos campos como string vacío (lo que manda el form al dejarlos en blanco)", () => {
    const result = cardSchema.safeParse({
      ...minima,
      last4: "",
      expiration: "",
      brand: "",
      owner: "",
    });
    expect(result.success).toBe(true);
  });

  it("sigue exigiendo el ciclo de facturación en crédito", () => {
    expect(cardSchema.safeParse({ ...minima, closingDay: undefined }).success).toBe(false);
    expect(cardSchema.safeParse({ ...minima, dueDay: undefined }).success).toBe(false);
  });

  it("si se cargan, los últimos 4 tienen que ser exactamente 4 dígitos", () => {
    expect(cardSchema.safeParse({ ...minima, last4: "12" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...minima, last4: "12ab" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...minima, last4: "1234" }).success).toBe(true);
  });

  it("si se carga, el MM/AA sigue validándose (formato y no vencido)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15));

    expect(cardSchema.safeParse({ ...minima, expiration: "13/99" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...minima, expiration: "01/20" }).success).toBe(false);
    expect(cardSchema.safeParse({ ...minima, expiration: "08/30" }).success).toBe(true);
  });
});
