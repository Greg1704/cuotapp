import { readConfig, type LLMConfig } from "./config";
import { LLMPermanentError, LLMTransientError } from "./errors";
import type { GenerateStructuredInput, LLMResponse } from "./types";

/**
 * El transporte: la única función del proyecto que le habla al proveedor de IA.
 *
 * **Por qué `fetch` y no el SDK de OpenAI.** Es un solo endpoint (`chat/completions`),
 * sin streaming ni tool calling, así que el SDK no aporta nada que valga una dependencia
 * nueva. Y hay un beneficio menos obvio: el SDK **reintenta dos veces por defecto**, algo
 * que hay que acordarse de apagar. Con `fetch` no hay nada que apagar.
 *
 * **Por qué no hay reintentos.** El modo de falla más probable no es un error de red: es
 * un `200 OK` con un JSON que no tiene la forma pedida, y eso ningún reintento automático
 * lo ve (nace aguas abajo, cuando Zod lo rechaza). Encima acá el usuario está esperando:
 * tres reintentos con backoff son tres veces la latencia sin avisarle a nadie. El
 * reintento es un botón que aprieta el usuario, que además decide si quiere gastar otra
 * llamada.
 */
export async function generateStructured(
  input: GenerateStructuredInput
): Promise<LLMResponse> {
  return callProvider(readConfig(), input);
}

async function callProvider(
  config: LLMConfig,
  { instructions, prompt, schema }: GenerateStructuredInput
): Promise<LLMResponse> {
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemMessage(instructions, schema) },
          { role: "user", content: prompt },
        ],
        // Esto es una extracción, no una redacción: la misma frase tiene que dar el
        // mismo resultado. Además achica el ruido entre corridas del corpus, que es lo
        // que permite distinguir una mejora real del prompt de una casualidad.
        temperature: 0,
        response_format: { type: "json_object" },
        // Va último para que un parámetro del proveedor pueda pisar cualquiera de los
        // de arriba sin tener que tocar este archivo.
        ...config.extraBody,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    // Timeout, DNS, conexión cortada: nada de eso dice que el pedido esté mal.
    throw transient("El asistente tardó demasiado en responder.", error);
  }

  if (!response.ok) {
    throw httpError(response.status);
  }

  const payload = await readJson(response);
  const content = messageContent(payload);
  if (!content) {
    throw new LLMTransientError("El asistente devolvió una respuesta vacía.");
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    // Transitorio y no permanente: el modelo no es determinista, así que otra tirada
    // suele arreglarlo de verdad. Es además la falla más probable de todas —un 200 con
    // JSON inservible— y la que ningún reintento a nivel HTTP detectaría.
    throw transient("El asistente devolvió una respuesta que no pude leer.", error);
  }

  return {
    data,
    model: stringField(payload, "model") ?? config.model,
    durationMs: Date.now() - startedAt,
    ...usageMetrics(payload),
  };
}

/**
 * El schema viaja **en el prompt**, no en un parámetro de la API.
 *
 * `response_format: json_object` es lo que soportan los proveedores compatibles con
 * OpenAI que nos interesan, y garantiza **JSON válido**, no JSON **con esta forma**.
 * Describir la forma acá es pedirla; hacerla cumplir es siempre trabajo de quien llama
 * (Zod, en el paso siguiente).
 */
function systemMessage(instructions: string, schema: Record<string, unknown>): string {
  return [
    instructions,
    "",
    "Respondé únicamente con un objeto JSON válido que cumpla este JSON Schema. " +
      "Sin texto adicional, sin markdown, sin bloques de código.",
    "",
    `JSON Schema:\n${JSON.stringify(schema)}`,
  ].join("\n");
}

/**
 * Status HTTP → transitorio o permanente.
 *
 * El corte es "¿otra tirada podría salir distinta?". Un 429 o un 503 sí; un 401 o un 400
 * van a fallar idénticos, así que ofrecer "reintentar" sería mentirle al usuario.
 */
function httpError(status: number): LLMTransientError | LLMPermanentError {
  if (status === 408 || status === 409 || status === 429 || status >= 500) {
    return new LLMTransientError("El asistente está ocupado. Probá de nuevo en un momento.");
  }
  if (status === 401 || status === 403) {
    return new LLMPermanentError("La asistencia por IA no está configurada.");
  }
  // 400, 404, 422… el pedido o el modelo están mal: es un problema nuestro, no del
  // proveedor, y se repite igual en cada intento.
  return new LLMPermanentError("El asistente rechazó el pedido.");
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw transient("El asistente devolvió una respuesta que no pude leer.", error);
  }
}

function messageContent(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = isRecord(choices[0]) ? choices[0].message : null;
  if (!isRecord(message)) return null;
  return typeof message.content === "string" && message.content.trim()
    ? message.content
    : null;
}

/**
 * Tokens consumidos, tolerando que cada proveedor reporte el cache a su manera: OpenAI lo
 * anida en `usage.prompt_tokens_details.cached_tokens`, DeepSeek lo expone plano en
 * `usage.prompt_cache_hit_tokens`. Absorber esa diferencia es justamente para lo que
 * existe esta capa.
 */
function usageMetrics(payload: unknown): Pick<
  LLMResponse,
  "promptTokens" | "completionTokens" | "cachedPromptTokens"
> {
  const usage = isRecord(payload) && isRecord(payload.usage) ? payload.usage : null;
  if (!usage) {
    return { promptTokens: null, completionTokens: null, cachedPromptTokens: null };
  }

  const details = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : null;

  return {
    promptTokens: numberField(usage, "prompt_tokens"),
    completionTokens: numberField(usage, "completion_tokens"),
    cachedPromptTokens:
      numberField(usage, "prompt_cache_hit_tokens") ??
      (details ? numberField(details, "cached_tokens") : null),
  };
}

/**
 * Loguea la causa, nunca el contenido.
 *
 * Solo el nombre de la clase del error: el cuerpo de una excepción de red puede arrastrar
 * el request completo, o sea la frase del usuario y los nombres de sus tarjetas. Eso no
 * va a los logs (`.claude/rules/seguridad.md`).
 */
function transient(message: string, error: unknown): LLMTransientError {
  console.warn(
    `[llm] llamada fallida: ${message} (${
      error instanceof Error ? error.name : typeof error
    })`
  );
  return new LLMTransientError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(source: unknown, key: string): string | null {
  if (!isRecord(source)) return null;
  const value = source[key];
  return typeof value === "string" && value ? value : null;
}
