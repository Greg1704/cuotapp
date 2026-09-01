import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/db", () => ({
  prisma: {
    card: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { createCard } from "@/server/actions/cards";

const USER = "user-aaaaaaaaaaaaaaaaaaaaaa";

/** Alta mínima de crédito: solo lo que el motor de cuotas necesita. */
const minimaCredito = {
  type: "CREDIT" as const,
  name: "Tarjeta principal",
  bank: "Galicia",
  closingDay: 20,
  dueDay: 10,
  currencies: ["ARS"] as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ id: USER } as never);
});

/**
 * Los datos identificatorios (últimos 4, MM/AA) son opcionales: exigirlos obligaba a tener
 * el plástico en la mano para poder registrar la primera compra. Ver REBRANDING.md § 1.
 */
describe("createCard — campos identificatorios opcionales", () => {
  it("crea una tarjeta de crédito sin últimos 4 ni vencimiento MM/AA", async () => {
    await createCard(minimaCredito);

    expect(prisma.card.create).toHaveBeenCalledTimes(1);
    const data = vi.mocked(prisma.card.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: USER,
      last4: null,
      expirationDate: null,
      closingDay: 20,
      dueDay: 10,
    });
  });

  it('persiste last4 como null (no como "") cuando el campo llega vacío del form', async () => {
    await createCard({ ...minimaCredito, last4: "", expiration: "" });

    const data = vi.mocked(prisma.card.create).mock.calls[0][0].data;
    expect(data.last4).toBeNull();
  });

  it("rechaza unos últimos 4 incompletos (si se cargan, tienen que ser 4 dígitos)", async () => {
    await expect(createCard({ ...minimaCredito, last4: "12" })).rejects.toThrow();
    expect(prisma.card.create).not.toHaveBeenCalled();
  });
});

/**
 * El chequeo de duplicados es "mismo banco + mismos últimos 4". Sin los últimos 4 no hay
 * señal de duplicado, y la consulta NO debe correr: Prisma ignora los filtros cuyo valor es
 * `undefined`, así que quedaría reducida a "cualquier tarjeta de este banco" y marcaría como
 * duplicada la segunda tarjeta que alguien cargue del mismo banco.
 */
describe("createCard — chequeo de duplicados", () => {
  it("NO busca duplicados cuando la tarjeta no trae últimos 4", async () => {
    await createCard(minimaCredito);

    expect(prisma.card.findFirst).not.toHaveBeenCalled();
    expect(prisma.card.create).toHaveBeenCalledTimes(1);
  });

  it("busca duplicados por banco + últimos 4 cuando sí vienen", async () => {
    vi.mocked(prisma.card.findFirst).mockResolvedValue(null as never);
    await createCard({ ...minimaCredito, last4: "1234" });

    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: { userId: USER, bank: "Galicia", last4: "1234" },
    });
  });

  it("reporta el duplicado sin crear nada cuando ya existe esa tarjeta", async () => {
    vi.mocked(prisma.card.findFirst).mockResolvedValue({
      id: "cixf00000000000000000000",
      userId: USER,
      type: "CREDIT",
      name: "Tarjeta principal",
      owner: null,
      bank: "Galicia",
      brand: null,
      last4: "1234",
      expirationDate: null,
      closingDay: 20,
      dueDay: 10,
      currencies: ["ARS"],
      creditLimitCents: null,
      isActive: true,
      createdAt: new Date(),
    } as never);

    const result = await createCard({ ...minimaCredito, last4: "1234" });

    expect(result.status).toBe("duplicate");
    expect(prisma.card.create).not.toHaveBeenCalled();
  });
});
