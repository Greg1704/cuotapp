import type { PromptContext } from "./prompt";
import type { PurchaseDraft, PurchaseField } from "./types";

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
export type CorpusCase = {
  label: string;
  text: string;
  expected?: Partial<PurchaseDraft>;
  present?: PurchaseField[];
  absent?: PurchaseField[];
  /** Casos que necesitan otras tarjetas (ej. dos del mismo banco). */
  context?: Partial<PromptContext>;
  /** Por qué el caso existe, cuando no es obvio. */
  note?: string;
};

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
    label: "total-explicito",
    text: "compré una heladera de 45 mil en 12 cuotas",
    note: "La misma cifra que el caso anterior, pero acá es el TOTAL. Factor de 12.",
    expected: { totalInstallments: 12, totalAmount: 45000 },
    absent: ["financedTotal"],
  },
  {
    label: "precio-y-cuota",
    text: "una tele de 500 mil en 12 cuotas de 45 mil",
    note: "Da los dos: el precio es el monto y el producto de las cuotas es el recargo.",
    expected: { totalAmount: 500000, financedTotal: 540000, totalInstallments: 12 },
  },
  {
    label: "sin-interes",
    text: "una notebook de 900 mil en 6 cuotas sin interés",
    note: "'sin interés' no es un monto: financedTotal tiene que quedar vacío.",
    expected: { totalAmount: 900000, totalInstallments: 6 },
    absent: ["financedTotal"],
  },

  // --- Las formas de decir "cuotas" -----------------------------------------
  {
    label: "pagos-de",
    text: "3 pagos de 20 mil en el super",
    expected: { totalInstallments: 3, totalAmount: 60000 },
  },
  {
    label: "en-n-a-secas",
    text: "compré unas zapatillas de 180 mil en 6",
    expected: { totalInstallments: 6, totalAmount: 180000 },
  },
  {
    label: "una-cuota",
    text: "pagué 15 mil en el kiosco en efectivo",
    expected: { paymentMethod: "CASH", totalAmount: 15000 },
    absent: ["cardId", "financedTotal"],
  },

  // --- Montos como los escribe un argentino ---------------------------------
  {
    label: "punto-de-miles",
    text: "cargué nafta por $45.000 con la del Santander",
    expected: { totalAmount: 45000, cardId: "card_santander" },
  },
  {
    label: "coma-decimal",
    text: "pagué 45.000,50 de expensas por transferencia",
    expected: { totalAmount: 45000.5, paymentMethod: "TRANSFER" },
  },
  {
    label: "lucas",
    text: "gasté 45 lucas en el super",
    expected: { totalAmount: 45000 },
  },
  {
    label: "k",
    text: "una campera de 120k en 3 cuotas",
    expected: { totalAmount: 120000, totalInstallments: 3 },
  },
  {
    label: "palo",
    text: "compré una moto de un palo y medio en 12 cuotas",
    expected: { totalAmount: 1500000, totalInstallments: 12 },
  },
  {
    label: "dolares",
    text: "pagué 40 dólares de hosting con la del Galicia",
    expected: { currency: "USD", totalAmount: 40, cardId: "card_galicia" },
  },

  // --- Fechas ----------------------------------------------------------------
  {
    label: "ayer",
    text: "ayer compré verduras por 12 mil en efectivo",
    expected: { purchaseDate: new Date("2026-09-01T00:00:00") },
  },
  {
    label: "fecha-explicita",
    text: "el 28 de agosto pagué 30 mil de gas por transferencia",
    expected: { purchaseDate: new Date("2026-08-28T00:00:00") },
  },
  {
    label: "sin-fecha",
    text: "compré un teclado de 80 mil",
    note: "No dice cuándo: la fecha tiene que quedar vacía, no asumirse hoy.",
    absent: ["purchaseDate"],
  },
  {
    label: "dia-de-semana-ambiguo",
    text: "el martes pasado pagué 25 mil de la prepaga",
    note: "Ambiguo de verdad (¿ayer o el martes de la semana anterior?). Solo se exige que resuelva alguna fecha.",
    present: ["purchaseDate"],
  },

  // --- Tarjetas: pertenencia, nunca parecido --------------------------------
  {
    label: "tarjeta-por-banco",
    text: "lo pagué con la del Galicia",
    expected: { cardId: "card_galicia" },
  },
  {
    label: "tarjeta-inexistente",
    text: "compré un monitor de 300 mil con la del Nubank",
    note: "El usuario no tiene esa tarjeta: mejor vacío que la más parecida.",
    absent: ["cardId"],
  },
  {
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
    label: "debito",
    text: "pagué 22 mil del super con la de débito del Nación",
    expected: { paymentMethod: "DEBIT", cardId: "card_nacion_debito" },
  },

  // --- Ambigüedad: lo correcto es NO llenar ---------------------------------
  {
    label: "vago",
    text: "compré una tele",
    note: "El caso que atrapa las alucinaciones: casi todo tiene que quedar vacío.",
    absent: ["totalAmount", "totalInstallments", "cardId", "purchaseDate", "financedTotal"],
    present: ["description"],
  },
  {
    label: "telegrafico",
    text: "heladera 12x45",
    note: "Cómo se escribe de verdad en el celular. Sin frase de laboratorio.",
    expected: { totalInstallments: 12 },
  },
];
