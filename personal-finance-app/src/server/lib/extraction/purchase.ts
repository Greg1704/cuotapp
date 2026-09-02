import { createHash } from "node:crypto";

import { generateStructured, LLMPermanentError } from "@/server/lib/llm";
import type { LLMResponse, LLMTransport } from "@/server/lib/llm";

import { parsePurchaseExtraction } from "./parse";
import { buildInstructions, buildPrompt, type PromptContext } from "./prompt";
import { purchaseResponseSchema } from "./schema";
import type { ExtractionOutcome } from "./types";

/**
 * Techo del texto que se manda. Una frase de gasto son 10-20 palabras; 1000 caracteres ya
 * es holgadísimo.
 *
 * No es una restricción de producto, es un freno de costo y abuso: la frase es **la única
 * parte del prompt que nunca cachea**, así que cada carácter se paga entero en cada
 * llamada. Y el día que la feature esté detrás de un input siempre visible (§5 del
 * rebranding), pegar un PDF entero ahí no puede costar lo que cuesta un PDF entero.
 */
export const MAX_TEXT_LENGTH = 1000;

export type ExtractPurchaseResult = {
  outcome: ExtractionOutcome;
  /** Las métricas de la llamada, para la telemetría del paso 9. */
  response: LLMResponse;
};

/**
 * La cadena completa: frase → prompt → modelo → JSON → valores para el formulario.
 *
 * **Un solo contexto, no dos.** Recibe las tarjetas y categorías una vez y de ahí deriva
 * lo que necesita el validador (la lista de ids). Si el prompt y el validador recibieran
 * cada uno su lista, podrían no coincidir: el modelo vería una tarjeta que el validador
 * después descarta por "no pertenece al usuario", y el síntoma sería un `cardId` que se
 * pierde sin explicación.
 *
 * **El transporte es un parámetro con default.** Los tests le pasan uno de mentira sin
 * tocar variables de entorno ni el sistema de archivos; producción no le pasa nada y usa
 * `generateStructured`, que a su vez elige entre el proveedor real y las fixtures.
 */
export async function extractPurchase(
  text: string,
  context: PromptContext,
  transport: LLMTransport = generateStructured
): Promise<ExtractPurchaseResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new LLMPermanentError("Escribí qué gastaste.");
  }
  // Permanente en el sentido que importa: reintentar el mismo texto falla idéntico, así
  // que la UI no debe ofrecer "reintentar" sino pedir que lo acorte.
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new LLMPermanentError(
      `El texto es muy largo (máximo ${MAX_TEXT_LENGTH} caracteres).`
    );
  }

  const response = await transport({
    instructions: buildInstructions(),
    prompt: buildPrompt(trimmed, context),
    schema: purchaseResponseSchema(),
    requestKey: requestKey(trimmed),
  });

  const outcome = parsePurchaseExtraction(response.data, {
    cardIds: context.cards.map((card) => card.id),
    categoryIds: context.categories.map((category) => category.id),
    today: context.today,
  });

  return { outcome, response };
}

/**
 * Clave estable de un pedido, derivada **del texto del usuario** y no del prompt entero.
 *
 * El proyecto hermano hashea instrucciones+prompt, pero acá eso no funcionaría: el prompt
 * lleva un nonce aleatorio por llamada (ver `prompt.ts`), así que la clave cambiaría
 * siempre y ninguna fixture se encontraría nunca. El texto es lo que identifica al pedido
 * de verdad: la misma frase es el mismo caso.
 */
export function requestKey(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}
