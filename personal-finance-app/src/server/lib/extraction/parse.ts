import { parseISO } from "@/server/lib/dates";

import type {
  Currency,
  ExtractionContext,
  ExtractionField,
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
  const repair = (field: ExtractionField, what: Repair["what"]) =>
    repaired.push({ field, what });
  const reject = (field: ExtractionField, reason: RejectionReason) =>
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

  // El monto de una cuota no va al formulario: alimenta la derivación de más abajo.
  let installmentAmount: number | null = null;
  read(raw, "installmentAmount", (value) => {
    const amount = asPositiveNumber(value);
    if (amount === null) return reject("installmentAmount", numberReason(value));
    installmentAmount = amount;
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

  deriveTotals({ values, installmentAmount, accept, repair, reject });

  return { values, filled, repaired, rejected };
}

/**
 * "12 cuotas de 45 mil" → 540.000, y la multiplicación la hacemos nosotros.
 *
 * **Por qué el modelo no multiplica.** Distinguir "la cuota es 45 mil" de "el total es 45
 * mil" es una **clasificación** —en qué campo va el número que leyó— y eso los modelos lo
 * hacen bien. Multiplicar es una **cuenta**, la hacen peor, y sobre todo: un total
 * equivocado es indistinguible de uno correcto mirando la respuesta, así que ni el
 * validador ni el usuario tienen cómo detectarlo. Es exactamente lo que prohíbe
 * `.claude/rules/dinero-y-fechas.md`.
 *
 * Los tres casos, que salen del modelo de datos de la app (ARCHITECTURE.md → cuotas con
 * interés: el comercio informa "N cuotas de X" y el recargo se deriva):
 *
 * | La frase dice | `totalAmount` | `financedTotal` |
 * |---|---|---|
 * | solo la cuota — *"12 cuotas de 45 mil"* | 540.000 (derivado) | — (no se sabe si hay recargo) |
 * | precio y cuota — *"una tele de 500 mil en 12 de 45 mil"* | 500.000 (lo dicho) | 540.000 (derivado) |
 * | precio y cuota que coinciden | lo dicho | — (iguales ⇒ sin recargo) |
 *
 * **Una derivación que daría un total con recargo MENOR al precio no se hace.** Ahí las
 * dos lecturas se contradicen y no hay forma de saber cuál está mal, así que se descarta
 * la derivada y se conserva lo que la frase dijo textual. Se registra el rechazo: si se
 * repite, el prompt está confundiendo precio con cuota.
 *
 * Ojo con la distinción: esto es una **derivación** (produce un valor que no existía), no
 * una regla cruzada de validación. Que "efectivo" no admita 3 cuotas lo sigue decidiendo
 * `purchaseSchema`, que es la autoridad.
 */
function deriveTotals({
  values,
  installmentAmount,
  accept,
  repair,
  reject,
}: {
  values: PurchaseDraft;
  installmentAmount: number | null;
  accept: <K extends PurchaseField>(field: K, value: PurchaseDraft[K]) => void;
  repair: (field: ExtractionField, what: Repair["what"]) => void;
  reject: (field: ExtractionField, reason: RejectionReason) => void;
}): void {
  if (installmentAmount === null) return;

  const installments = values.totalInstallments;
  if (installments === undefined) {
    // Vino el monto de la cuota sin cuántas: no hay con qué multiplicar. No se asume 1,
    // que convertiría "cuotas de 45 mil" en una compra de 45 mil.
    return reject("installmentAmount", "sin-cuotas-para-derivar");
  }

  // Redondeo al centavo: el producto en punto flotante puede dar 539999.9999999999, y ese
  // número entra al formulario y de ahí a la conversión a centavos.
  const derived = Math.round(installmentAmount * installments * 100) / 100;

  if (values.totalAmount === undefined) {
    repair("totalAmount", "derivado");
    return accept("totalAmount", derived);
  }
  // Iguales ⇒ no hay recargo (ARCHITECTURE.md). Dejar `financedTotal` vacío es
  // exactamente lo que la app espera en ese caso.
  if (derived === values.totalAmount) return;
  if (derived < values.totalAmount) {
    return reject("financedTotal", "contradice-el-monto");
  }

  repair("financedTotal", "derivado");
  accept("financedTotal", derived);
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
  field: ExtractionField,
  handle: (value: unknown) => void
): void {
  const value = raw[field];
  if (value === undefined || value === null) return;
  handle(value);
}

type TextHandlers = {
  accept: <K extends PurchaseField>(field: K, value: PurchaseDraft[K]) => void;
  repair: (field: ExtractionField, what: Repair["what"]) => void;
  reject: (field: ExtractionField, reason: RejectionReason) => void;
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
