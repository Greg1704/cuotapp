import { parseISO } from "@/server/lib/dates";

import type {
  Currency,
  ExtractionContext,
  ExtractionOutcome,
  PaymentMethod,
  PurchaseDraft,
  PurchaseField,
  Rejection,
  RejectionReason,
  Repair,
} from "./types";

/**
 * Interpreta la respuesta cruda del modelo y devuelve valores listos para prellenar el
 * formulario, más el detalle de qué se reparó y qué se descartó.
 *
 * ## La regla
 *
 * **Reparar lo deducible, rechazar lo que habría que inventar.**
 *
 * Es la regla que usa Qulmara, pero acá cae mucho más del lado de rechazar, porque son
 * datos de plata: allá reparar de más cuesta un puntaje levemente equivocado, acá cuesta
 * una fila mal cargada. Normalizar `"pesos"` a `ARS` es deducible (es vocabulario, no
 * dato). Redondear `12.4` cuotas a `12` sería inventar: si el modelo dudó, que lo diga el
 * formulario, que ya sabe pedir lo que falta.
 *
 * ## Por qué se lee campo por campo y no con `schema.parse()`
 *
 * Dos motivos, y el segundo es el que decide:
 *
 * 1. **Un `.parse()` es todo o nada.** Si el modelo manda `totalAmount: "45000"` (string),
 *    Zod tira el objeto entero y se pierden los ocho campos que estaban bien — habiendo
 *    pagado la llamada y esperado la latencia.
 * 2. **`.catch()` por campo repararía en silencio**, y nos interesa *contar* las
 *    desviaciones. Una que se repite en el mismo campo es la señal de que ese campo está
 *    mal explicado en el prompt. Es información de calibración que se pierde si el
 *    validador es mudo.
 *
 * Se itera **la lista de campos conocidos, nunca las claves de la respuesta**: así un
 * campo que no pedimos se ignora por omisión, sin código que lo contemple.
 */
export function parsePurchaseExtraction(
  data: unknown,
  context: ExtractionContext
): ExtractionOutcome {
  const raw = isRecord(data) ? data : {};
  const values: PurchaseDraft = {};
  const filled: PurchaseField[] = [];
  const repaired: Repair[] = [];
  const rejected: Rejection[] = [];

  function accept<K extends PurchaseField>(field: K, value: PurchaseDraft[K]) {
    values[field] = value;
    filled.push(field);
  }
  const repair = (field: PurchaseField, what: Repair["what"]) =>
    repaired.push({ field, what });
  const reject = (field: PurchaseField, reason: RejectionReason) =>
    rejected.push({ field, reason });

  // --- Enums: se normaliza el vocabulario, se rechaza lo desconocido ---------
  read(raw, "paymentMethod", (value) => {
    const text = asText(value);
    if (text === null) return reject("paymentMethod", "tipo-invalido");
    const method = normalizePaymentMethod(text);
    if (!method) return reject("paymentMethod", "valor-desconocido");
    if (method !== text) repair("paymentMethod", "normalizado");
    accept("paymentMethod", method);
  });

  read(raw, "currency", (value) => {
    const text = asText(value);
    if (text === null) return reject("currency", "tipo-invalido");
    const currency = normalizeCurrency(text);
    if (!currency) return reject("currency", "valor-desconocido");
    if (currency !== text) repair("currency", "normalizado");
    accept("currency", currency);
  });

  // --- Plata: nunca se clampea ni se redondea -------------------------------
  read(raw, "totalAmount", (value) => {
    const amount = asPositiveNumber(value);
    if (amount === null) return reject("totalAmount", numberReason(value));
    accept("totalAmount", amount);
  });

  read(raw, "financedTotal", (value) => {
    const amount = asPositiveNumber(value);
    if (amount === null) return reject("financedTotal", numberReason(value));
    accept("financedTotal", amount);
  });

  read(raw, "totalInstallments", (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return reject("totalInstallments", "tipo-invalido");
    }
    // Sin redondear: 12.4 cuotas no existe, y elegir 12 sería decidir por el usuario
    // sobre el plan de pago de una compra.
    if (!Number.isInteger(value)) return reject("totalInstallments", "no-entero");
    // Sin clampear: fuera de 1..60 el modelo entendió otra cosa, no se acercó.
    if (value < MIN_INSTALLMENTS || value > MAX_INSTALLMENTS) {
      return reject("totalInstallments", "fuera-de-rango");
    }
    accept("totalInstallments", value);
  });

  // --- Referencias: pertenencia, jamás parecido -----------------------------
  read(raw, "cardId", (value) => {
    const id = asText(value);
    if (id === null) return reject("cardId", "tipo-invalido");
    // Un id que no está en las tarjetas del usuario es una tarjeta alucinada. No se
    // busca "la más parecida": así es como se carga una compra en la tarjeta equivocada.
    if (!context.cardIds.includes(id)) return reject("cardId", "no-pertenece-al-usuario");
    accept("cardId", id);
  });

  read(raw, "categoryId", (value) => {
    const id = asText(value);
    if (id === null) return reject("categoryId", "tipo-invalido");
    if (!context.categoryIds.includes(id)) {
      return reject("categoryId", "no-pertenece-al-usuario");
    }
    accept("categoryId", id);
  });

  // --- Texto: se recorta, porque es etiqueta y no dato numérico -------------
  readText(raw, "description", MAX_DESCRIPTION, { accept, repair, reject });
  readText(raw, "merchant", MAX_MERCHANT, { accept, repair, reject });

  // --- Fecha ----------------------------------------------------------------
  read(raw, "purchaseDate", (value) => {
    const text = asText(value);
    if (text === null) return reject("purchaseDate", "tipo-invalido");
    const date = parseIsoDate(text);
    if (!date) return reject("purchaseDate", "fecha-invalida");
    // Una compra ya ocurrió: una fecha futura es el modelo confundiéndose de año, o
    // resolviendo mal "el martes". El día de tolerancia cubre el desfase de zona horaria
    // que la app ya asume (ver ARCHITECTURE.md → invariante UTC).
    if (date.getTime() > context.today.getTime() + DAY_MS) {
      return reject("purchaseDate", "fecha-futura");
    }
    accept("purchaseDate", date);
  });

  return { values, filled, repaired, rejected };
}

const MIN_INSTALLMENTS = 1;
const MAX_INSTALLMENTS = 60;
const MAX_DESCRIPTION = 200;
const MAX_MERCHANT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Vocabulario aceptado por campo.
 *
 * Es una reparación legítima —y no "inventar"— porque no agrega información: `"pesos"` y
 * `"ARS"` son la misma moneda dicha de dos formas. Lo que se compara está sin acentos y
 * en minúsculas, así que "crédito" y "credito" entran por la misma puerta.
 */
const PAYMENT_METHOD_WORDS: Record<string, PaymentMethod> = {
  credit: "CREDIT",
  credito: "CREDIT",
  "tarjeta de credito": "CREDIT",
  debit: "DEBIT",
  debito: "DEBIT",
  "tarjeta de debito": "DEBIT",
  transfer: "TRANSFER",
  transferencia: "TRANSFER",
  cash: "CASH",
  efectivo: "CASH",
};

const CURRENCY_WORDS: Record<string, Currency> = {
  ars: "ARS",
  peso: "ARS",
  pesos: "ARS",
  $: "ARS",
  usd: "USD",
  dolar: "USD",
  dolares: "USD",
  "u$s": "USD",
  us$: "USD",
};

export function normalizePaymentMethod(value: string): PaymentMethod | null {
  return PAYMENT_METHOD_WORDS[foldCase(value)] ?? null;
}

export function normalizeCurrency(value: string): Currency | null {
  return CURRENCY_WORDS[foldCase(value)] ?? null;
}

/** Minúsculas y sin acentos, para que "crédito" y "credito" sean la misma clave. */
function foldCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Lee un campo solo si vino. `null` y `undefined` son "el modelo no lo dijo", que es un
 * resultado válido y esperado —no una falla— así que no se cuentan como rechazo.
 */
function read(
  raw: Record<string, unknown>,
  field: PurchaseField,
  handle: (value: unknown) => void
): void {
  const value = raw[field];
  if (value === undefined || value === null) return;
  handle(value);
}

type TextHandlers = {
  accept: <K extends PurchaseField>(field: K, value: PurchaseDraft[K]) => void;
  repair: (field: PurchaseField, what: Repair["what"]) => void;
  reject: (field: PurchaseField, reason: RejectionReason) => void;
};

function readText(
  raw: Record<string, unknown>,
  field: "description" | "merchant",
  maxLength: number,
  { accept, repair, reject }: TextHandlers
): void {
  read(raw, field, (value) => {
    const text = asText(value);
    if (text === null) return reject(field, "tipo-invalido");
    if (!text) return reject(field, "vacio");
    // Recortar sí es deducible: es una etiqueta, no un monto. Perder una descripción
    // buena por 5 caracteres de más sería estricto sin comprar nada.
    if (text.length > maxLength) {
      repair(field, "recortado");
      return accept(field, text.slice(0, maxLength).trimEnd());
    }
    accept(field, text);
  });
}

/** `"YYYY-MM-DD"` → medianoche local. Cualquier otra forma es inválida. */
function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

function asPositiveNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function numberReason(value: unknown): RejectionReason {
  return typeof value === "number" ? "fuera-de-rango" : "tipo-invalido";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
