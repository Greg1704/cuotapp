import { z } from "zod";

import { parseExpiration, isCardExpired } from "@/server/lib/dates";

const MMYY = /^(0[1-9]|1[0-2])\/\d{2}$/;

/**
 * Alta/edición de tarjeta. El ciclo de facturación (cierre/vencimiento) solo aplica a
 * tarjetas de CRÉDITO: el débito gasta contra el saldo al instante. Por eso esos campos
 * son opcionales en el tipo y se exigen condicionalmente con `superRefine` según `type`.
 *
 * Lo ÚNICO obligatorio es lo que el motor de cuotas necesita (tipo, nombre, banco y —en
 * crédito— cierre y vencimiento del ciclo). Los datos de identificación —últimos 4,
 * vencimiento MM/AA, marca, dueño— son opcionales: obligarlos en el alta forzaba a tener
 * el plástico en la mano antes de poder registrar la primera compra.
 */
export const cardSchema = z
  .object({
    type: z.enum(["CREDIT", "DEBIT"]),
    name: z.string().min(1, "El nombre es requerido").max(100),
    owner: z
      .string()
      .max(100)
      .regex(/^[\p{L}\s]*$/u, "Solo letras")
      .optional(),
    bank: z.string().min(1, "Elegí un banco").max(50),
    brand: z.string().max(50).optional(),
    // Opcional: vacío o exactamente 4 dígitos. La Server Action normaliza "" a null.
    last4: z
      .string()
      .regex(/^(\d{4})?$/, "Deben ser 4 dígitos")
      .optional(),
    // Opcional, solo crédito (MM/AA). La conversión a Date se hace en la Server Action.
    expiration: z.string().optional(),
    closingDay: z.number().int().min(1, "Día inválido").max(31, "Día inválido").optional(),
    dueDay: z.number().int().min(1, "Día inválido").max(31, "Día inválido").optional(),
    // Una tarjeta opera al menos una moneda; puede tener ARS y USD (mismo ciclo).
    // Deduplicamos por si el form manda repetidos.
    currencies: z
      .array(z.enum(["ARS", "USD"]))
      .min(1, "Elegí al menos una moneda")
      .transform((v) => Array.from(new Set(v))),
    // Límite de crédito en unidades de la moneda principal del usuario (enteros). Es
    // OPCIONAL incluso en crédito: solo aparece con el seguimiento de límites activo y el
    // usuario puede dejarlo vacío por tarjeta. El vacío llega como `null`. La Server Action
    // lo convierte a centavos. Si se carga, debe ser positivo.
    creditLimit: z.number().int("Ingresá un número entero").positive("Debe ser mayor a 0").nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.type !== "CREDIT") return; // el débito no tiene ciclo ni vencimiento
    // El vencimiento MM/AA NO lo usa el motor de cuotas (solo la sección de tarjetas
    // vencidas y el flujo de renovación), así que puede quedar vacío. Si se carga, tiene
    // que ser válido y futuro: una fecha ya pasada es un error de tipeo, no un dato útil.
    if (data.expiration) {
      if (!MMYY.test(data.expiration)) {
        ctx.addIssue({
          path: ["expiration"],
          code: "custom",
          message: "Formato MM/AA (ej. 08/27)",
        });
      } else if (isCardExpired(parseExpiration(data.expiration))) {
        ctx.addIssue({
          path: ["expiration"],
          code: "custom",
          message: "La tarjeta ya está vencida",
        });
      }
    }
    if (data.closingDay == null) {
      ctx.addIssue({ path: ["closingDay"], code: "custom", message: "Día inválido" });
    }
    if (data.dueDay == null) {
      ctx.addIssue({ path: ["dueDay"], code: "custom", message: "Día inválido" });
    }
  });

export type CardFormValues = z.infer<typeof cardSchema>;

/**
 * Renovación de una tarjeta vencida: SOLO un nuevo vencimiento MM/AA futuro. No
 * toca el resto de los datos (es la misma cuenta), así las cuotas siguen atadas.
 */
export const renewCardSchema = z.object({
  expiration: z
    .string()
    .regex(MMYY, "Formato MM/AA (ej. 08/29)")
    .refine((v) => !MMYY.test(v) || !isCardExpired(parseExpiration(v)), {
      message: "El nuevo vencimiento debe ser una fecha futura",
    }),
});

export type RenewCardValues = z.infer<typeof renewCardSchema>;
