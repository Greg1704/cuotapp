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
 * Campos que se le piden al modelo pero que NO son del formulario.
 *
 * Hoy solo `installmentAmount`, el monto de UNA cuota. Existe porque el retail argentino
 * informa el plan como "12 cuotas de 45 mil", y pedirle al modelo que devuelva 540.000
 * sería pedirle que multiplique: la multiplicación la hace nuestro código
 * (`.claude/rules/dinero-y-fechas.md`). Así lo único que el modelo decide es **en qué
 * campo va el número que leyó**, que es una clasificación y no una cuenta.
 */
export const EXTRACTION_ONLY_FIELDS = ["installmentAmount"] as const;
export type ExtractionOnlyField = (typeof EXTRACTION_ONLY_FIELDS)[number];
export type ExtractionField = PurchaseField | ExtractionOnlyField;

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
  | "no-pertenece-al-usuario"
  /** Vino el monto de la cuota pero no cuántas: no hay con qué multiplicar. */
  | "sin-cuotas-para-derivar"
  /** El total de las cuotas da MENOS que el precio: una de las dos lecturas está mal. */
  | "contradice-el-monto";

export type Rejection = { field: ExtractionField; reason: RejectionReason };
export type Repair = {
  field: ExtractionField;
  what: "normalizado" | "recortado" | "derivado";
};

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
