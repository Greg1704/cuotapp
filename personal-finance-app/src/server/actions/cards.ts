"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { cardSchema, renewCardSchema } from "@/lib/validation/card";
import { parseExpiration, startOfToday } from "@/server/lib/dates";
import { currencyToCents } from "@/server/lib/money";
import { utilizationPercent, convertCents } from "@/server/lib/card-utilization";
import { getSubscriptionUtilizationByCard } from "@/server/queries/subscriptions";
import { toCardView, type CardView } from "@/lib/card-view";

/**
 * Tarjetas vigentes: activas y sin vencer. Tres casos cuentan como vigentes:
 * - DÉBITO: no tiene vencimiento.
 * - Crédito SIN `expirationDate`: el MM/AA es opcional, y una tarjeta sin fecha cargada
 *   no puede saberse vencida. Sin esta rama desaparecería de la lista (no matchearía
 *   ninguna de las otras dos) y tampoco aparecería en las vencidas: se esfumaría.
 * - Crédito con fecha que todavía no pasó.
 */
export async function listActiveCards() {
  const user = await requireUser();
  return prisma.card.findMany({
    where: {
      userId: user.id,
      isActive: true,
      OR: [
        { type: "DEBIT" },
        { expirationDate: null },
        { expirationDate: { gte: startOfToday() } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Tarjetas vencidas: solo crédito (el débito no vence), activas y con fecha pasada. */
export async function listExpiredCards() {
  const user = await requireUser();
  return prisma.card.findMany({
    where: {
      userId: user.id,
      isActive: true,
      type: "CREDIT",
      expirationDate: { lt: startOfToday() },
    },
    orderBy: { expirationDate: "desc" },
  });
}

/** Tarjetas desactivadas a mano (soft delete). */
export async function listDeactivatedCards() {
  const user = await requireUser();
  return prisma.card.findMany({
    where: { userId: user.id, isActive: false },
    orderBy: { createdAt: "desc" },
  });
}

export type CreateCardResult =
  | { status: "created" }
  | { status: "duplicate"; existing: CardView };

/**
 * Mapea los datos validados del form al `data` de Prisma. El DÉBITO no tiene ciclo de
 * facturación, vencimiento ni límite: esos campos se persisten como `null`. El crédito
 * convierte el MM/AA a Date (fin de mes), el límite a centavos, y guarda cierre/vencimiento.
 */
function toCardData(parsed: ReturnType<typeof cardSchema.parse>) {
  const { expiration, closingDay, dueDay, creditLimit, last4, ...rest } = parsed;
  const isCredit = parsed.type === "CREDIT";
  return {
    ...rest,
    // El form manda "" cuando el campo queda vacío; en la DB eso es `null`, no un string
    // vacío (que ensuciaría el chequeo de duplicados y las comparaciones).
    last4: last4 || null,
    closingDay: isCredit ? closingDay : null,
    dueDay: isCredit ? dueDay : null,
    expirationDate: isCredit && expiration ? parseExpiration(expiration) : null,
    creditLimitCents: isCredit && creditLimit != null ? currencyToCents(creditLimit) : null,
  };
}

export async function createCard(input: unknown, force = false): Promise<CreateCardResult> {
  const user = await requireUser();
  const parsed = cardSchema.parse(input);

  // Duplicado = mismo banco + últimos 4 (entre activas, vencidas y desactivadas). Solo
  // se chequea si se cargaron los últimos 4: son el único dato que identifica el plástico.
  // Sin ellos no hay señal de duplicado —dos tarjetas del mismo banco son perfectamente
  // normales— y además Prisma IGNORA un filtro cuyo valor es `undefined`, así que la query
  // pasaría a ser "cualquier tarjeta de este banco" y marcaría falsos positivos.
  if (!force && parsed.last4) {
    const existing = await prisma.card.findFirst({
      where: { userId: user.id, bank: parsed.bank, last4: parsed.last4 },
    });
    if (existing) {
      return { status: "duplicate", existing: toCardView(existing) };
    }
  }

  await prisma.card.create({
    // El userId SIEMPRE viene de la sesión, nunca del input del cliente.
    data: { ...toCardData(parsed), userId: user.id },
  });

  revalidatePath("/tarjetas");
  return { status: "created" };
}

export type CardUtilizationView = {
  cardId: string;
  name: string;
  /** Moneda del límite/uso: la principal del usuario (`User.defaultCurrency`). */
  currency: string;
  usedCents: string; // BigInt → string (borde serializable)
  limitCents: string;
  percent: number;
};

/**
 * Utilización de las tarjetas de crédito con límite cargado: cuánto del límite está
 * comprometido en cuotas todavía no pagadas, por tarjeta. El límite y el uso van en la
 * moneda principal del USUARIO (`defaultCurrency`): las cuotas en otra moneda se convierten
 * con la cotización snapshot de su compra (`Purchase.limitRate`). Devuelve un DTO plano
 * reutilizable por la sección de tarjetas y la alerta del dashboard. Scopeado por `userId`.
 *
 * Devuelve `[]` si el seguimiento de límites está apagado (`trackCreditLimits`), lo que
 * apaga la barra y la alerta en toda la UI sin ramas extra en los componentes.
 */
export async function getCardsUtilization(): Promise<CardUtilizationView[]> {
  const user = await requireUser();
  const profile = await prisma.user.findUnique({
    where: { id: user.id },
    select: { defaultCurrency: true, trackCreditLimits: true },
  });
  if (!profile?.trackCreditLimits) return [];
  const mainCurrency = profile.defaultCurrency;

  const cards = await prisma.card.findMany({
    where: {
      userId: user.id,
      isActive: true,
      type: "CREDIT",
      creditLimitCents: { not: null },
    },
    select: { id: true, name: true, creditLimitCents: true },
  });
  if (cards.length === 0) return [];

  // Uso = suma de cuotas NO pagadas (PENDING/OVERDUE), convertidas a la moneda principal.
  // La cuota lleva la moneda de su compra; si difiere de la principal, se convierte con la
  // `limitRate` snapshot de la compra. Una compra en otra moneda SIN tasa (previa a la
  // feature) no se puede imputar → se excluye del uso. La cuota no guarda `cardId` (va por
  // `purchase`), así que agregamos en JS. Scopeado por userId.
  const rows = await prisma.installment.findMany({
    where: {
      status: { not: "PAID" },
      purchase: { userId: user.id, cardId: { in: cards.map((c) => c.id) } },
    },
    select: {
      amountCents: true,
      currency: true,
      purchase: { select: { cardId: true, limitRate: true } },
    },
  });

  const usedByCard = new Map<string, bigint>();
  for (const r of rows) {
    const cardId = r.purchase.cardId!;
    let cents: bigint;
    if (r.currency === mainCurrency) {
      cents = r.amountCents;
    } else if (r.purchase.limitRate != null) {
      cents = convertCents(r.amountCents, r.purchase.limitRate.toString());
    } else {
      continue; // moneda extranjera sin cotización: no imputable al límite
    }
    usedByCard.set(cardId, (usedByCard.get(cardId) ?? 0n) + cents);
  }

  // Suscripciones de crédito: suman el cobro del mes corriente (no pagado) al uso de su
  // tarjeta, convertido a la moneda principal con su `limitRate`. A diferencia de una compra
  // en N cuotas, no comprometen su límite a futuro (cada mes postea su propio cargo).
  const subUsedByCard = await getSubscriptionUtilizationByCard(
    user.id,
    mainCurrency,
    cards.map((c) => c.id)
  );
  for (const [cardId, cents] of subUsedByCard) {
    usedByCard.set(cardId, (usedByCard.get(cardId) ?? 0n) + cents);
  }

  return cards.map((c) => {
    const usedCents = usedByCard.get(c.id) ?? 0n;
    const limitCents = c.creditLimitCents!;
    return {
      cardId: c.id,
      name: c.name,
      currency: mainCurrency,
      usedCents: usedCents.toString(),
      limitCents: limitCents.toString(),
      percent: utilizationPercent(usedCents, limitCents),
    };
  });
}

export async function getCardById(id: string) {
  const user = await requireUser();

  const card = await prisma.card.findFirst({
    where: { id, userId: user.id },
  });

  if (!card) {
    throw new Error("Tarjeta no encontrada");
  }
  return card;
}

export async function updateCard(id: string, input: unknown) {
  const user = await requireUser();
  const parsed = cardSchema.parse(input);

  // La tarjeta debe existir y ser del usuario (findFirst scopeado por userId).
  const existing = await prisma.card.findFirst({ where: { id, userId: user.id } });
  if (!existing) {
    throw new Error("Tarjeta no encontrada");
  }

  // No se puede quitar una moneda que todavía tiene cuotas PENDIENTES en esa moneda:
  // seguiría comprometiendo flujo a futuro (mismo criterio que deactivateCard). Las
  // cuotas guardan su propia `currency`, así que el conteo va por moneda removida.
  const kept = new Set<string>(parsed.currencies);
  const removed = existing.currencies.filter((c) => !kept.has(c));
  if (removed.length > 0) {
    const pending = await prisma.installment.groupBy({
      by: ["currency"],
      where: {
        status: { not: "PAID" },
        currency: { in: removed },
        purchase: { cardId: id, userId: user.id },
      },
      _count: { _all: true },
    });
    if (pending.length > 0) {
      const detail = pending.map((p) => `${p._count._all} cuota(s) en ${p.currency}`).join(", ");
      throw new Error(
        `No podés quitar esa moneda: la tarjeta tiene ${detail} pendiente(s) de pago.`
      );
    }
  }

  // updateMany filtra por userId: el usuario A no puede editar la tarjeta de B.
  const { count } = await prisma.card.updateMany({
    where: { id, userId: user.id },
    data: toCardData(parsed),
  });

  if (count === 0) {
    throw new Error("Tarjeta no encontrada");
  }

  revalidatePath("/tarjetas");
}

/**
 * Soft delete: marca la tarjeta como inactiva en vez de borrarla.
 * Preserva el historial de compras/cuotas (el schema tiene onDelete: Cascade,
 * así que un borrado real arrastraría todas las compras de la tarjeta).
 */
export async function deactivateCard(id: string) {
  const user = await requireUser();

  // No se puede desactivar una tarjeta con cuotas sin pagar: seguiría comprometiendo
  // flujo a futuro. El conteo va scopeado por userId (vía la relación purchase).
  const pendingInstallments = await prisma.installment.count({
    where: {
      status: { not: "PAID" },
      purchase: { cardId: id, userId: user.id },
    },
  });
  if (pendingInstallments > 0) {
    throw new Error(
      `No podés desactivar una tarjeta con ${pendingInstallments} cuota(s) pendiente(s) de pago.`
    );
  }

  const { count } = await prisma.card.updateMany({
    where: { id, userId: user.id },
    data: { isActive: false },
  });

  if (count === 0) {
    throw new Error("Tarjeta no encontrada");
  }

  revalidatePath("/tarjetas");
}

/**
 * Renueva una tarjeta vencida empujando SOLO su `expirationDate` (la misma cuenta:
 * las cuotas en curso quedan atadas, sin migración). Al quedar la fecha en el
 * futuro, vuelve a aparecer como vigente en `listActiveCards`.
 */
export async function renewCard(id: string, input: unknown) {
  const user = await requireUser();
  const { expiration } = renewCardSchema.parse(input);

  // updateMany filtra por userId: el usuario A no puede renovar la tarjeta de B.
  const { count } = await prisma.card.updateMany({
    where: { id, userId: user.id },
    data: { expirationDate: parseExpiration(expiration) },
  });

  if (count === 0) {
    throw new Error("Tarjeta no encontrada");
  }

  revalidatePath("/tarjetas");
}

/** Reactiva una tarjeta desactivada a mano. */
export async function reactivateCard(id: string) {
  const user = await requireUser();

  const { count } = await prisma.card.updateMany({
    where: { id, userId: user.id },
    data: { isActive: true },
  });

  if (count === 0) {
    throw new Error("Tarjeta no encontrada");
  }

  revalidatePath("/tarjetas");
}
