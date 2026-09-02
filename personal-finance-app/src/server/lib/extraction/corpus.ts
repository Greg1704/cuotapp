import type { PromptContext } from "./prompt";
import type {
  PurchaseDraft,
  PurchaseField,
  SubscriptionDraft,
  SubscriptionField,
} from "./types";

/**
 * El banco de pruebas de la extracción.
 *
 * ## Por qué acá SÍ se puede declarar el resultado esperado
 *
 * El proyecto hermano se prohíbe declararlo, y con razón: *"cuánto debería sacar un
 * reporte es la pregunta que el paso 5 responde, y congelarla en el formato del corpus
 * antes de ver un solo resultado sería hornear la suposición que se quiere testear"*.
 *
 * Acá esa restricción no existe, porque **esto es una extracción y no un juicio**:
 * *"compré una heladera en 12 cuotas de 45 mil"* tiene una respuesta objetivamente
 * correcta. Entonces el corpus deja de ser una tabla para mirar y pasa a ser una suite de
 * tests por campo.
 *
 * ## Tres formas de declarar lo esperado, y las tres hacen falta
 *
 * - `expected` — el campo tiene que valer exactamente esto.
 * - `absent` — el campo NO tiene que estar. Es la mitad que se olvida y la que atrapa las
 *   alucinaciones: un corpus que solo verifica lo que se llena no puede detectar que el
 *   modelo esté inventando.
 * - `present` — el campo tiene que estar, sin importar el valor. Para los casos
 *   **genuinamente ambiguos**: "el martes pasado" puede ser ayer o el martes de la semana
 *   anterior, y elegir una de las dos sería congelar una suposición nuestra como si fuera
 *   la verdad. Lo que sí es falsable es que resuelva *alguna* fecha.
 *
 * ## Sobre el sesgo de estas frases
 *
 * Las escribimos nosotros, o sea que salen **bien formadas**. Lo que una persona tipea
 * apurada en el celular es *"heladera 12x45"*. Al proyecto hermano este sesgo le costó un
 * diagnóstico entero equivocado. Hay que cosechar frases reales antes de dar la
 * calibración por buena; estas son el piso, no el techo.
 */
type BaseCase = {
  label: string;
  text: string;
  /** Casos que necesitan otras tarjetas (ej. dos del mismo banco). */
  context?: Partial<PromptContext>;
  /** Por qué el caso existe, cuando no es obvio. */
  note?: string;
};

/**
 * Unión discriminada por `kind`, no un objeto con todo opcional: así declarar
 * `totalInstallments` en un caso de suscripción no compila. El corpus se protege del mismo
 * error del que el schema protege al modelo.
 */
export type CorpusCase = BaseCase &
  (
    | {
        kind: "purchase";
        expected?: Partial<PurchaseDraft>;
        present?: PurchaseField[];
        absent?: PurchaseField[];
      }
    | {
        kind: "subscription";
        expected?: Partial<SubscriptionDraft>;
        present?: SubscriptionField[];
        absent?: SubscriptionField[];
      }
  );

/** Hoy, congelado: si dependiera del día real, los casos de fecha fallarían solos. */
export const CORPUS_TODAY = new Date("2026-09-02T00:00:00");

export const CORPUS_CONTEXT: PromptContext = {
  cards: [
    { id: "card_galicia", label: "Visa Galicia ••1234 (crédito)" },
    { id: "card_santander", label: "Mastercard Santander ••5678 (crédito)" },
    { id: "card_nacion_debito", label: "Visa Débito Nación ••9012 (débito)" },
  ],
  categories: [
    { id: "cat_hogar", name: "Hogar" },
    { id: "cat_transporte", name: "Transporte" },
    { id: "cat_entretenimiento", name: "Entretenimiento" },
  ],
  today: CORPUS_TODAY,
};

export const CORPUS: CorpusCase[] = [
  // --- La distinción que más caro sale si falla ------------------------------
  {
    kind: "purchase",
    label: "cuota-explicita",
    text: "compré una heladera en 12 cuotas de 45 mil con la del Galicia",
    note: "El monto es de CADA cuota: el total son 540.000, no 45.000.",
    expected: {
      paymentMethod: "CREDIT",
      cardId: "card_galicia",
      totalInstallments: 12,
      totalAmount: 540000,
      currency: "ARS",
    },
    present: ["description"],
  },
  {
    kind: "purchase",
    label: "total-explicito",
    text: "compré una heladera de 45 mil en 12 cuotas",
    note: "La misma cifra que el caso anterior, pero acá es el TOTAL. Factor de 12.",
    expected: { totalInstallments: 12, totalAmount: 45000 },
    absent: ["financedTotal"],
  },
  {
    kind: "purchase",
    label: "precio-y-cuota",
    text: "una tele de 500 mil en 12 cuotas de 45 mil",
    note: "Da los dos: el precio es el monto y el producto de las cuotas es el recargo.",
    expected: { totalAmount: 500000, financedTotal: 540000, totalInstallments: 12 },
  },
  {
    kind: "purchase",
    label: "sin-interes",
    text: "una notebook de 900 mil en 6 cuotas sin interés",
    note: "'sin interés' no es un monto: financedTotal tiene que quedar vacío.",
    expected: { totalAmount: 900000, totalInstallments: 6 },
    absent: ["financedTotal"],
  },

  // --- Las formas de decir "cuotas" -----------------------------------------
  {
    kind: "purchase",
    label: "pagos-de",
    text: "3 pagos de 20 mil en el super",
    expected: { totalInstallments: 3, totalAmount: 60000 },
  },
  {
    kind: "purchase",
    label: "en-n-a-secas",
    text: "compré unas zapatillas de 180 mil en 6",
    expected: { totalInstallments: 6, totalAmount: 180000 },
  },
  {
    kind: "purchase",
    label: "una-cuota",
    text: "pagué 15 mil en el kiosco en efectivo",
    expected: { paymentMethod: "CASH", totalAmount: 15000 },
    absent: ["cardId", "financedTotal"],
  },

  // --- Montos como los escribe un argentino ---------------------------------
  {
    kind: "purchase",
    label: "punto-de-miles",
    text: "cargué nafta por $45.000 con la del Santander",
    expected: { totalAmount: 45000, cardId: "card_santander" },
  },
  {
    kind: "purchase",
    label: "coma-decimal",
    text: "pagué 45.000,50 de expensas por transferencia",
    expected: { totalAmount: 45000.5, paymentMethod: "TRANSFER" },
  },
  {
    kind: "purchase",
    label: "lucas",
    text: "gasté 45 lucas en el super",
    expected: { totalAmount: 45000 },
  },
  {
    kind: "purchase",
    label: "k",
    text: "una campera de 120k en 3 cuotas",
    expected: { totalAmount: 120000, totalInstallments: 3 },
  },
  {
    kind: "purchase",
    label: "palo",
    text: "compré una moto de un palo y medio en 12 cuotas",
    expected: { totalAmount: 1500000, totalInstallments: 12 },
  },
  {
    kind: "purchase",
    label: "dolares",
    text: "pagué 40 dólares de hosting con la del Galicia",
    expected: { currency: "USD", totalAmount: 40, cardId: "card_galicia" },
  },

  // --- Fechas ----------------------------------------------------------------
  {
    kind: "purchase",
    label: "ayer",
    text: "ayer compré verduras por 12 mil en efectivo",
    expected: { purchaseDate: new Date("2026-09-01T00:00:00") },
  },
  {
    kind: "purchase",
    label: "fecha-explicita",
    text: "el 28 de agosto pagué 30 mil de gas por transferencia",
    expected: { purchaseDate: new Date("2026-08-28T00:00:00") },
  },
  {
    kind: "purchase",
    label: "sin-fecha",
    text: "compré un teclado de 80 mil",
    note: "No dice cuándo: la fecha tiene que quedar vacía, no asumirse hoy.",
    absent: ["purchaseDate"],
  },
  {
    kind: "purchase",
    label: "dia-de-semana-ambiguo",
    text: "el martes pasado pagué 25 mil de la prepaga",
    note: "Ambiguo de verdad (¿ayer o el martes de la semana anterior?). Solo se exige que resuelva alguna fecha.",
    present: ["purchaseDate"],
  },

  // --- Tarjetas: pertenencia, nunca parecido --------------------------------
  {
    kind: "purchase",
    label: "tarjeta-por-banco",
    text: "lo pagué con la del Galicia",
    expected: { cardId: "card_galicia" },
  },
  {
    kind: "purchase",
    label: "tarjeta-inexistente",
    text: "compré un monitor de 300 mil con la del Nubank",
    note: "El usuario no tiene esa tarjeta: mejor vacío que la más parecida.",
    absent: ["cardId"],
  },
  {
    kind: "purchase",
    label: "tarjeta-ambigua",
    text: "lo pagué 50 mil con la del Galicia",
    note: "Dos tarjetas del mismo banco: no hay forma de elegir.",
    context: {
      cards: [
        { id: "card_galicia_visa", label: "Visa Galicia ••1234 (crédito)" },
        { id: "card_galicia_master", label: "Mastercard Galicia ••8888 (crédito)" },
      ],
    },
    absent: ["cardId"],
  },
  {
    kind: "purchase",
    label: "debito",
    text: "pagué 22 mil del super con la de débito del Nación",
    expected: { paymentMethod: "DEBIT", cardId: "card_nacion_debito" },
  },

  // --- Ambigüedad: lo correcto es NO llenar ---------------------------------
  {
    kind: "purchase",
    label: "vago",
    text: "compré una tele",
    note: "El caso que atrapa las alucinaciones: casi todo tiene que quedar vacío.",
    absent: ["totalAmount", "totalInstallments", "cardId", "purchaseDate", "financedTotal"],
    present: ["description"],
  },
  {
    kind: "purchase",
    label: "telegrafico",
    text: "heladera 12x45",
    note: "Cómo se escribe de verdad en el celular. Sin frase de laboratorio.",
    expected: { totalInstallments: 12 },
  },

  // --- Ruteo: la misma pipeline con la otra salida ---------------------------
  {
    kind: "subscription",
    label: "suscripcion-clasica",
    text: "me suscribí a Spotify, 4200 por mes con la del Galicia",
    expected: {
      name: "Spotify",
      amount: 4200,
      paymentMethod: "CREDIT",
      cardId: "card_galicia",
    },
  },
  {
    kind: "subscription",
    label: "suscripcion-debito",
    text: "el gimnasio me cobra 35 mil todos los meses por débito",
    expected: { amount: 35000, paymentMethod: "DEBIT" },
    present: ["name"],
  },
  {
    kind: "subscription",
    label: "suscripcion-dolares",
    text: "pago 12 dólares mensuales de iCloud",
    expected: { amount: 12, currency: "USD" },
  },
  {
    kind: "subscription",
    label: "suscripcion-desde-cuando",
    text: "arranqué el abono del diario el 1 de agosto, 8 mil por mes",
    expected: { amount: 8000, firstChargeDate: new Date("2026-08-01T00:00:00") },
  },
  {
    kind: "purchase",
    label: "cuotas-no-es-suscripcion",
    text: "compré un lavarropas en 18 cuotas de 60 mil",
    note: "La trampa del ruteo: pagar en cuotas todos los meses NO es una suscripción.",
    expected: { totalInstallments: 18, totalAmount: 1080000 },
  },
  {
    kind: "purchase",
    label: "mensual-pero-compra",
    text: "cargué la SUBE con 20 mil",
    note: "Algo que se hace seguido pero no es un cargo recurrente automático.",
    expected: { totalAmount: 20000 },
  },
];
