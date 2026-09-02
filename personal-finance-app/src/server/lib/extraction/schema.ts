import { z } from "zod";

/**
 * El schema de EXTRACCIÓN: lo que se le pide al modelo. Hermano de `purchaseSchema`, no
 * el mismo, y la diferencia es deliberada en cuatro puntos:
 *
 * 1. **Fechas como string ISO**, no `Date`. JSON no tiene fechas, y `z.date()` no es
 *    representable en JSON Schema.
 * 2. **Montos en unidades** (`45000`), nunca centavos. La conversión a `BigInt` la sigue
 *    haciendo nuestro código: no se le delega aritmética de plata a un modelo
 *    probabilístico (`.claude/rules/dinero-y-fechas.md`).
 * 3. **Todo opcional.** El resultado correcto de una frase ambigua es un campo faltante,
 *    no uno adivinado (REBRANDING §2: "vacío y marcado, no adivinado").
 * 4. **Sin reglas cruzadas** (`superRefine`). Que "efectivo" no admita 3 cuotas lo valida
 *    `purchaseSchema`, que sigue siendo la autoridad, y el formulario ya sabe mostrar ese
 *    error. Acá no se adivina cuál de los dos campos contradictorios está mal.
 *
 * **Para qué se declara si el parseo es defensivo** (ver `parse.ts`, que lee campo por
 * campo y no llama a `.parse()`): de acá sale el JSON Schema que viaja en el prompt, vía
 * `z.toJSONSchema()`. Derivarlo en vez de escribirlo a mano evita que se desincronice —
 * un schema paralelo se despega en el primer cambio y nadie se entera hasta que un campo
 * llega y se descarta en silencio.
 *
 * Los enums van como `string` libre a propósito: si acá dijeran `enum(["ARS","USD"])`, un
 * `"pesos"` haría fallar el objeto entero en vez de repararse, que es justo lo que
 * `parse.ts` está para hacer. La lista de valores válidos se le dice al modelo en las
 * instrucciones (paso 3), donde además se puede explicar.
 */
export const purchaseExtractionSchema = z.object({
  paymentMethod: z
    .string()
    .describe("Medio de pago: CREDIT, DEBIT, TRANSFER o CASH.")
    .optional(),
  cardId: z
    .string()
    .describe("El id EXACTO de una de las tarjetas listadas. Omitir si no se identifica.")
    .optional(),
  categoryId: z
    .string()
    .describe("El id EXACTO de una de las categorías listadas. Omitir si ninguna aplica.")
    .optional(),
  description: z.string().describe("Qué se compró, en pocas palabras.").optional(),
  merchant: z.string().describe("Comercio, si la frase lo nombra.").optional(),
  totalAmount: z
    .number()
    .describe("Monto TOTAL en unidades de la moneda (no centavos), sin recargo.")
    .optional(),
  currency: z.string().describe("Moneda: ARS o USD.").optional(),
  totalInstallments: z
    .number()
    .describe("Cantidad de cuotas, entero de 1 a 60. 1 si es un pago único.")
    .optional(),
  installmentAmount: z
    .number()
    .describe(
      "Monto de UNA cuota, en unidades, cuando la frase lo diga así " +
        '("12 cuotas de 45 mil" → 45000). No multiplicar: de eso se encarga la app.'
    )
    .optional(),
  purchaseDate: z.string().describe("Fecha de la compra, formato YYYY-MM-DD.").optional(),
  financedTotal: z
    .number()
    .describe("Total CON recargo, en unidades. Omitir si no hay interés.")
    .optional(),
});

export type PurchaseExtraction = z.infer<typeof purchaseExtractionSchema>;

/**
 * El JSON Schema que viaja en el prompt. Derivado, nunca escrito a mano.
 *
 * Se le saca `$schema`: es metadata para validadores, el modelo no la usa, y todo lo que
 * viaja en el prompt se paga en tokens.
 */
export function purchaseResponseSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(purchaseExtractionSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
