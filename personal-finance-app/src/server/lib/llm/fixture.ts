import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readFixturesDir } from "./config";
import { LLMPermanentError } from "./errors";
import type { GenerateStructuredInput, LLMResponse } from "./types";

/**
 * Transporte que lee la respuesta de disco en vez de pedírsela a un proveedor.
 *
 * **Para qué.** Que los tests y el corpus corran la cadena **entera** —prompt, llamada,
 * parseo, reparaciones, derivación— sin API key y sin red. Es la forma de cumplir lo que
 * pide el REBRANDING ("la llamada al modelo se mockea") sin mockear tan arriba que el test
 * termine probando el mock. Las fixtures no hay que inventarlas: son las respuestas
 * reales de la primera corrida del corpus.
 *
 * **Por qué vive acá y no en un script aparte.** Si un script armara su propio prompt,
 * estaría validando un prompt que nadie despacha. Acá lo único que cambia es quién
 * contesta; todo lo demás es el código de producción.
 *
 * **Una fixture faltante es un error permanente.** Ningún reintento hace aparecer un
 * archivo, así que ofrecer "reintentar" sería mentir. El mensaje dice qué archivo falta.
 *
 * **Las métricas vuelven en null, nunca inventadas.** No hay conteo de tokens ni latencia
 * honesta para una respuesta escrita a mano, y un `0` diría "contó cero" cuando la verdad
 * es "nadie contó" — justo la confusión que arruinaría cualquier medición de costo hecha
 * sobre estos números.
 */
export function generateViaFixture({
  requestKey,
}: GenerateStructuredInput): Promise<LLMResponse> {
  if (!requestKey) {
    throw new LLMPermanentError("El transporte de fixtures necesita un requestKey.");
  }

  const path = join(readFixturesDir(), `${requestKey}.json`);

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    throw new LLMPermanentError(`No hay respuesta guardada en ${path}.`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new LLMPermanentError(`La respuesta guardada en ${path} no es JSON válido.`);
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new LLMPermanentError(`La respuesta guardada en ${path} no es un objeto.`);
  }

  // Se aceptan dos formas: el objeto de datos pelado, o envuelto en
  // `{ model, data }`. El envoltorio existe para poder registrar QUÉ modelo produjo esa
  // respuesta — si no, las evaluaciones con fixture serían indistinguibles de las reales
  // en cualquier análisis posterior.
  const wrapper = payload as Record<string, unknown>;
  const data = "data" in wrapper ? wrapper.data : wrapper;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new LLMPermanentError(`La respuesta guardada en ${path} no tiene datos usables.`);
  }

  return Promise.resolve({
    data,
    model: typeof wrapper.model === "string" ? wrapper.model : "fixture",
    promptTokens: null,
    completionTokens: null,
    cachedPromptTokens: null,
    durationMs: 0,
  });
}
