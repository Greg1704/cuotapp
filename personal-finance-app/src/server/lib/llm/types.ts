/** Lo que devuelve una llamada al proveedor: el JSON crudo y lo que costó. */
export type LLMResponse = {
  /**
   * El JSON parseado, sin validar contra ningún schema. Validarlo es responsabilidad
   * de quien llama: los proveedores garantizan JSON **válido**, no JSON **con la forma
   * pedida**. Por eso es `unknown` y no un tipo concreto — obliga a pasar por Zod.
   */
  data: unknown;
  /** El modelo que efectivamente respondió (puede no ser el pedido). */
  model: string;
  /**
   * Métricas de la llamada. `null` cuando el proveedor no las reporta: "nadie contó" y
   * "contó cero" son afirmaciones distintas, y confundirlas arruina cualquier medición
   * de costo que se haga después.
   */
  promptTokens: number | null;
  completionTokens: number | null;
  cachedPromptTokens: number | null;
  durationMs: number;
};

/**
 * Los dos textos van separados a propósito, y quien llama tiene que respetar el corte:
 *
 * - `instructions` es la parte que **se repite** entre llamadas (rol, reglas, formato).
 *   Va al mensaje `system`, adelante de todo.
 * - `prompt` es la parte que **cambia** en cada llamada (el texto del usuario y su
 *   contexto). Va al mensaje `user`, al final.
 *
 * El motivo secundario es el caching por prefijo (los proveedores cachean prefijos
 * byte-idénticos). El motivo principal es de seguridad: deja el texto no confiable del
 * usuario **fuera** del mensaje que lleva las instrucciones que podría intentar pisar.
 */
export type GenerateStructuredInput = {
  instructions: string;
  prompt: string;
  /** JSON Schema de la respuesta esperada. Se inyecta en el prompt (ver `client.ts`). */
  schema: Record<string, unknown>;
};

/** Firma común a todos los transportes. Quien llama nunca sabe cuál corrió. */
export type LLMTransport = (input: GenerateStructuredInput) => Promise<LLMResponse>;
