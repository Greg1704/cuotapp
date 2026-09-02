import type { PAYMENT_METHODS } from "@/lib/validation/purchase";

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type Currency = "ARS" | "USD";

/**
 * Los campos que la IA puede proponer para una compra.
 *
 * Es un SUBCONJUNTO de `purchaseSchema` a propósito. Dos ausencias deliberadas:
 *
 * - **`limitRate`** (la cotización para imputar al límite de crédito). Es un dato de
 *   mercado que el usuario informa, no algo que esté en la frase: si el modelo lo
 *   inventara, la barra de utilización quedaría mal para siempre, porque se guarda como
 *   snapshot inmutable. El modal ya lo pide cuando corresponde.
 * - **`notes`**. La frase cruda no es una nota; duplicarla ahí sería ruido.
 */
export type PurchaseDraft = {
  paymentMethod?: PaymentMethod;
  cardId?: string;
  categoryId?: string;
  description?: string;
  merchant?: string;
  totalAmount?: number;
  currency?: Currency;
  totalInstallments?: number;
  purchaseDate?: Date;
  financedTotal?: number;
};

export type PurchaseField = keyof PurchaseDraft;

/**
 * Lo que el modelo necesita saber del usuario para resolver "la del Galicia".
 *
 * Solo ids: la validación acá es de **pertenencia**, no de parecido. Un `cardId` que no
 * esté en esta lista es una tarjeta alucinada y se descarta — nunca se resuelve "por
 * aproximación", que es como se termina cargando una compra en la tarjeta equivocada.
 */
export type ExtractionContext = {
  cardIds: string[];
  categoryIds: string[];
  /** Hoy, para descartar fechas futuras. Explícito para que los tests no dependan del día. */
  today: Date;
};

/** Por qué se descartó un campo. Sirve de diagnóstico del prompt (ver `parse.ts`). */
export type RejectionReason =
  | "tipo-invalido"
  | "valor-desconocido"
  | "fuera-de-rango"
  | "no-entero"
  | "vacio"
  | "fecha-invalida"
  | "fecha-futura"
  | "no-pertenece-al-usuario";

export type Rejection = { field: PurchaseField; reason: RejectionReason };
export type Repair = { field: PurchaseField; what: "normalizado" | "recortado" };

/**
 * El resultado de interpretar una respuesta del modelo.
 *
 * `filled` existe para que la UI pueda marcar los campos como *"sugerido"*: confirmar no
 * debería ser un acto de fe (REBRANDING §2).
 *
 * `repaired` y `rejected` no son para la UI, son **diagnóstico del prompt**. Es la lectura
 * que Qulmara dejó anotada: una desviación que se repite en el mismo campo no es un
 * accidente, es la señal de que ese campo está mal explicado en las instrucciones.
 * Reparando en silencio sin contarlo, esa información se pierde.
 *
 * Invariantes: `repaired ⊆ filled`, y `rejected` es disjunto de `filled`.
 */
export type ExtractionOutcome = {
  values: PurchaseDraft;
  filled: PurchaseField[];
  repaired: Repair[];
  rejected: Rejection[];
};
