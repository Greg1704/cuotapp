import { LLMPermanentError } from "./errors";

/**
 * Configuración del proveedor, leída de variables de entorno.
 *
 * **Se lee tarde (en cada llamada), nunca al importar el módulo.** Importar este archivo
 * no debe requerir una API key: si la leyéramos arriba, los tests, `next build` y
 * cualquier import indirecto necesitarían credenciales para no explotar. Es el mismo
 * patrón del cliente perezoso de Qulmara, por la misma razón.
 */
export type LLMConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** Parámetros propios del proveedor, mergeados al body. Ver `parseExtraBody`. */
  extraBody: Record<string, unknown>;
};

const DEFAULT_BASE_URL = "https://api.deepseek.com";
/**
 * Presupuesto de UNA llamada, y como no hay reintentos automáticos, es el presupuesto
 * total. 60 s es holgado a propósito: el proyecto hermano midió 39-48 s con el
 * razonamiento del modelo prendido por default. Una vez medido cuánto tarda de verdad
 * con el razonamiento apagado, este número debería bajar bastante — un timeout largo
 * en un flujo donde el usuario espera es una promesa que no queremos cumplir.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * ¿Está configurada la feature? Lo usa la UI para **ocultarse** si no hay key, en vez de
 * mostrar un botón que al apretarlo avisa que no anda (requisito del REBRANDING §2:
 * "la feature tiene que degradar sola").
 */
export function isConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_MODEL);
}

/**
 * Qué transporte corre. `api` es lo único que se despliega; `fixture` lee respuestas de
 * disco para que los tests y el corpus corran la cadena entera sin red ni API key.
 */
export type LLMProvider = "api" | "fixture";

export function readProvider(): LLMProvider {
  return process.env.LLM_PROVIDER === "fixture" ? "fixture" : "api";
}

export function readFixturesDir(): string {
  const dir = process.env.LLM_FIXTURES_DIR;
  if (!dir) {
    throw new LLMPermanentError("LLM_PROVIDER=fixture necesita LLM_FIXTURES_DIR.");
  }
  return dir;
}

export function readConfig(): LLMConfig {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;

  // Permanente, no transitorio: sin credenciales, reintentar falla idéntico.
  if (!apiKey || !model) {
    throw new LLMPermanentError("La asistencia por IA no está configurada.");
  }

  return {
    apiKey,
    model,
    baseUrl: (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeoutMs: positiveInt(process.env.LLM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
    extraBody: parseExtraBody(process.env.LLM_EXTRA_BODY),
  };
}

/**
 * Parámetros del proveedor que no son parte del estándar de OpenAI, como un JSON.
 *
 * **Por qué existe desde el día uno, y no es especulación.** En Qulmara, apagar el
 * razonamiento del modelo —que resultó ser el 87% del output facturado y ~40 s de
 * latencia por llamada— quedó bloqueado justamente porque su transporte no tenía por
 * dónde pasar estos parámetros; su propio registro de hallazgos lo anota como "pendiente,
 * toca la firma del transporte, va como paso propio".
 *
 * Teniéndolo acá, el experimento de los tres brazos (razonamiento alto / bajo / apagado)
 * es un cambio de configuración y no de código — la única forma de mover una variable por
 * vez sin recompilar nada. Por ejemplo:
 *
 *     LLM_EXTRA_BODY={"thinking":{"type":"disabled"}}
 *
 * Un JSON inválido es un error de configuración, no de la llamada: permanente y ruidoso,
 * porque fallar en silencio significaría correr el experimento creyendo que un parámetro
 * está aplicado cuando no lo está — y esa medición sería peor que no tenerla.
 */
export function parseExtraBody(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LLMPermanentError("LLM_EXTRA_BODY no es un JSON válido.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new LLMPermanentError("LLM_EXTRA_BODY tiene que ser un objeto JSON.");
  }
  return parsed as Record<string, unknown>;
}

function positiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}
