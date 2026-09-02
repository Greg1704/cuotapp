import { createHash } from "node:crypto";

import { generateStructured, LLMPermanentError, LLMTransientError } from "@/server/lib/llm";
import type { LLMResponse, LLMTransport } from "@/server/lib/llm";

import { parsePurchaseExtraction, parseSubscriptionExtraction } from "./parse";
import { buildInstructions, buildPrompt, type PromptContext } from "./prompt";
import { expenseResponseSchema } from "./schema";
import type { ExpenseExtraction, ExtractionContext } from "./types";

/**
 * Techo del texto que se manda. Una frase de gasto son 10-20 palabras; 1000 caracteres ya
 * es holgadísimo.
 *
 * No es una restricción de producto, es un freno de costo y abuso: la frase es **la única
 * parte del prompt que nunca cachea**, así que cada carácter se paga entero en cada
 * llamada. Y con la feature detrás de un input siempre visible (§5 del rebranding), pegar
 * un PDF entero ahí no puede costar lo que cuesta un PDF entero.
 */
export const MAX_TEXT_LENGTH = 1000;

export type ExtractExpenseResult = ExpenseExtraction & { response: LLMResponse };

/**
 * El punto común de entrada: *"contame qué gastaste"*.
 *
 * Una frase entra, y sale **o** una compra **o** una suscripción, prellenada. Es la
 * promesa del REBRANDING §2 —"una sola feature con tres salidas, no tres features"— y este
 * archivo es donde se sostiene: un solo prompt, una sola llamada, un solo lugar donde
 * agregar el próximo tipo de gasto.
 *
 * **Una llamada, no dos.** Clasificar primero y extraer después duplicaría costo y
 * latencia sin comprar nada: el modelo tiene que leer la frase entera para cualquiera de
 * las dos cosas, así que las hace juntas.
 *
 * **La clasificación la decide el modelo, pero el ruteo lo decide el código.** El `kind`
 * es un enum cerrado y cualquier otra cosa es un error transitorio: sin saber de qué tipo
 * de gasto se trata no hay formulario que prellenar, y no hay nada razonable que asumir.
 */
export async function extractExpense(
  text: string,
  context: PromptContext,
  transport: LLMTransport = generateStructured
): Promise<ExtractExpenseResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new LLMPermanentError("Escribí qué gastaste.");
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new LLMPermanentError(
      `El texto es muy largo (máximo ${MAX_TEXT_LENGTH} caracteres).`
    );
  }

  const response = await transport({
    instructions: buildInstructions(),
    prompt: buildPrompt(trimmed, context),
    schema: expenseResponseSchema(),
    requestKey: requestKey(trimmed),
  });

  const data = isRecord(response.data) ? response.data : {};
  const validation: ExtractionContext = {
    cardIds: context.cards.map((card) => card.id),
    categoryIds: context.categories.map((category) => category.id),
    today: context.today,
  };

  if (data.kind === "subscription") {
    return {
      kind: "subscription",
      outcome: parseSubscriptionExtraction(data.subscription, validation),
      response,
    };
  }
  if (data.kind === "purchase") {
    return {
      kind: "purchase",
      outcome: parsePurchaseExtraction(data.purchase, validation),
      response,
    };
  }

  // Ni siquiera hay un default razonable: prellenar el formulario equivocado es peor que
  // no prellenar nada, porque el usuario tiene que darse cuenta y volver atrás.
  throw new LLMTransientError("No pude entender qué tipo de gasto es. Probá de nuevo.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Clave estable de un pedido, derivada **del texto del usuario** y no del prompt entero.
 *
 * El proyecto hermano hashea instrucciones+prompt, pero acá eso no funcionaría: el prompt
 * lleva un nonce aleatorio por llamada (ver `prompt.ts`), así que la clave cambiaría
 * siempre y ninguna respuesta guardada se encontraría nunca. El texto es lo que identifica
 * al pedido de verdad: la misma frase es el mismo caso.
 */
export function requestKey(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}
