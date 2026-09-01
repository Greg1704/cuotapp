import type { Card } from "@/generated/prisma/client";

/**
 * DTO serializable de una tarjeta para cruzar el borde Server → Client
 * (.claude/rules/rsc-y-payload.md). `Card.creditLimitCents` es `BigInt` —no
 * serializable—, así que se convierte a `string` acá. El resto de los campos son
 * primitivos o `Date` (que el payload RSC sí serializa).
 */
export type CardView = {
  id: string;
  type: "CREDIT" | "DEBIT";
  name: string;
  owner: string | null;
  bank: string;
  brand: string | null;
  last4: string | null;
  expirationDate: Date | null;
  closingDay: number | null;
  dueDay: number | null;
  currencies: string[];
  isActive: boolean;
  /** Límite en centavos (BigInt → string en el borde); `null` si no está cargado. */
  creditLimitCents: string | null;
};

export function toCardView(card: Card): CardView {
  return {
    id: card.id,
    type: card.type,
    name: card.name,
    owner: card.owner,
    bank: card.bank,
    brand: card.brand,
    last4: card.last4,
    expirationDate: card.expirationDate,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    currencies: card.currencies,
    isActive: card.isActive,
    creditLimitCents: card.creditLimitCents == null ? null : card.creditLimitCents.toString(),
  };
}

/**
 * Sufijo identificatorio por los últimos 4 dígitos: `" ···· 1234"`, o `""` si la tarjeta
 * no los tiene cargados (son opcionales, ver `cardSchema`). Centraliza el manejo del
 * `null` para que ninguna etiqueta quede con un "····" colgando sin números detrás.
 */
export function last4Suffix(last4: string | null | undefined): string {
  return last4 ? ` ···· ${last4}` : "";
}
