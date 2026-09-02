import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateStructured } from "./client";
import { isConfigured, parseExtraBody } from "./config";
import { LLMPermanentError, LLMTransientError } from "./errors";

/** Respuesta mínima con la forma que devuelve un proveedor compatible con OpenAI. */
function providerResponse(
  body: Record<string, unknown>,
  init: { status?: number } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function completion(content: string, extra: Record<string, unknown> = {}) {
  return { choices: [{ message: { content } }], ...extra };
}

const INPUT = {
  instructions: "Sos un extractor.",
  prompt: "compré una heladera",
  schema: { type: "object" as const },
};

function mockFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

type FetchMock = ReturnType<typeof mockFetch>;

/** La URL a la que se llamó. Falla el test si no se llamó. */
function calledUrl(fetchMock: FetchMock): string {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  return String(call![0]);
}

/**
 * La forma del body que se le manda a un proveedor compatible con OpenAI. Los campos
 * conocidos van tipados; el índice abierto (`unknown`, nunca `any`) cubre los parámetros
 * propios del proveedor que llegan por LLM_EXTRA_BODY.
 */
type ChatRequestBody = {
  model: string;
  temperature: number;
  response_format: { type: string };
  messages: { role: string; content: string }[];
  [key: string]: unknown;
};

/** El body de la llamada, ya parseado. Falla el test si no se llamó. */
function calledBody(fetchMock: FetchMock): ChatRequestBody {
  const call = fetchMock.mock.calls[0];
  expect(call).toBeDefined();
  return JSON.parse(String(call![1]?.body)) as ChatRequestBody;
}

describe("llm/client", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_MODEL", "test-model");
    vi.stubEnv("LLM_BASE_URL", "https://proveedor.test");
    vi.stubEnv("LLM_EXTRA_BODY", "");
    vi.stubEnv("LLM_TIMEOUT_MS", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("configuración", () => {
    it("sin API key la feature no está configurada", () => {
      vi.stubEnv("LLM_API_KEY", "");
      expect(isConfigured()).toBe(false);
    });

    it("sin modelo tampoco: el modelo nunca va incrustado en el código", () => {
      vi.stubEnv("LLM_MODEL", "");
      expect(isConfigured()).toBe(false);
    });

    it("con key y modelo, está configurada", () => {
      expect(isConfigured()).toBe(true);
    });

    // Permanente y no transitorio: sin credenciales, reintentar falla idéntico. Es lo
    // que hace que la UI no ofrezca un botón "reintentar" que no puede funcionar.
    it("llamar sin API key es un error permanente, no transitorio", async () => {
      vi.stubEnv("LLM_API_KEY", "");
      mockFetch(providerResponse(completion("{}")));
      await expect(generateStructured(INPUT)).rejects.toBeInstanceOf(LLMPermanentError);
    });

    it("no le pega al proveedor si no hay API key", async () => {
      vi.stubEnv("LLM_API_KEY", "");
      const fetchMock = mockFetch(providerResponse(completion("{}")));
      await expect(generateStructured(INPUT)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("armado del request", () => {
    it("manda las instrucciones en system y el texto del usuario en user", async () => {
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured(INPUT);

      const body = calledBody(fetchMock);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain("Sos un extractor.");
      expect(body.messages[1]).toEqual({ role: "user", content: "compré una heladera" });
    });

    // La propiedad que más importa del corte en dos mensajes: el texto que escribe el
    // usuario nunca comparte mensaje con las instrucciones que podría intentar pisar.
    it("el texto del usuario NO viaja en el mensaje de instrucciones", async () => {
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured(INPUT);

      const body = calledBody(fetchMock);
      expect(body.messages[0].content).not.toContain("compré una heladera");
    });

    it("inyecta el JSON Schema en el system y pide respuesta JSON", async () => {
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured({ ...INPUT, schema: { type: "object", title: "Compra" } });

      const body = calledBody(fetchMock);
      expect(body.messages[0].content).toContain('"title":"Compra"');
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("temperature 0: la misma frase tiene que dar el mismo resultado", async () => {
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured(INPUT);

      const body = calledBody(fetchMock);
      expect(body.temperature).toBe(0);
    });

    it("usa el modelo y el endpoint de las variables de entorno", async () => {
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured(INPUT);

      expect(calledUrl(fetchMock)).toBe("https://proveedor.test/chat/completions");
      expect(calledBody(fetchMock).model).toBe("test-model");
    });

    it("tolera una base URL con barra final", async () => {
      vi.stubEnv("LLM_BASE_URL", "https://proveedor.test/");
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured(INPUT);

      expect(calledUrl(fetchMock)).toBe("https://proveedor.test/chat/completions");
    });
  });

  // El motivo de que este hueco exista está en config.ts: sin él, apagar el razonamiento
  // del modelo —que en el proyecto hermano resultó ser el 87% del output facturado— sería
  // un cambio de código y no de configuración.
  describe("parámetros propios del proveedor (LLM_EXTRA_BODY)", () => {
    it("mergea el JSON al body de la llamada", async () => {
      vi.stubEnv("LLM_EXTRA_BODY", '{"thinking":{"type":"disabled"}}');
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured(INPUT);

      const body = calledBody(fetchMock);
      expect(body.thinking).toEqual({ type: "disabled" });
    });

    it("puede pisar un parámetro nuestro sin tocar código", async () => {
      vi.stubEnv("LLM_EXTRA_BODY", '{"temperature":0.7}');
      const fetchMock = mockFetch(providerResponse(completion('{"ok":true}')));
      await generateStructured(INPUT);

      expect(calledBody(fetchMock).temperature).toBe(0.7);
    });

    it("vacío o ausente ⇒ no agrega nada", () => {
      expect(parseExtraBody(undefined)).toEqual({});
      expect(parseExtraBody("   ")).toEqual({});
    });

    // Ruidoso a propósito: fallar en silencio significaría correr un experimento creyendo
    // que el parámetro se aplicó cuando no, y esa medición es peor que no tenerla.
    it("un JSON inválido es un error de configuración, no una falla silenciosa", () => {
      expect(() => parseExtraBody("{no es json")).toThrow(LLMPermanentError);
    });

    it("un JSON que no es objeto también se rechaza", () => {
      expect(() => parseExtraBody("[1,2,3]")).toThrow(LLMPermanentError);
      expect(() => parseExtraBody('"texto"')).toThrow(LLMPermanentError);
    });
  });

  describe("clasificación de errores", () => {
    it.each([
      [429, "rate limit"],
      [500, "error del proveedor"],
      [503, "proveedor caído"],
      [408, "timeout del proveedor"],
    ])("%i (%s) ⇒ transitorio: reintentar puede salir distinto", async (status) => {
      mockFetch(providerResponse({}, { status }));
      await expect(generateStructured(INPUT)).rejects.toBeInstanceOf(LLMTransientError);
    });

    it.each([
      [401, "credenciales"],
      [403, "sin permiso"],
      [400, "pedido mal armado"],
      [404, "modelo inexistente"],
    ])("%i (%s) ⇒ permanente: reintentar falla idéntico", async (status) => {
      mockFetch(providerResponse({}, { status }));
      await expect(generateStructured(INPUT)).rejects.toBeInstanceOf(LLMPermanentError);
    });

    it("un fallo de red es transitorio", async () => {
      mockFetch(new TypeError("fetch failed"));
      await expect(generateStructured(INPUT)).rejects.toBeInstanceOf(LLMTransientError);
    });

    // El modo de falla más probable de todos, y el que ningún reintento a nivel HTTP
    // detectaría: la llamada salió 200, el problema está en el cuerpo.
    it("un 200 con JSON malformado es transitorio, no un éxito", async () => {
      mockFetch(providerResponse(completion("{ esto no es json")));
      await expect(generateStructured(INPUT)).rejects.toBeInstanceOf(LLMTransientError);
    });

    it("una respuesta sin contenido es transitoria", async () => {
      mockFetch(providerResponse(completion("   ")));
      await expect(generateStructured(INPUT)).rejects.toBeInstanceOf(LLMTransientError);
    });

    it("una respuesta sin choices es transitoria", async () => {
      mockFetch(providerResponse({ choices: [] }));
      await expect(generateStructured(INPUT)).rejects.toBeInstanceOf(LLMTransientError);
    });

    it("ningún mensaje de error nombra al proveedor ni al modelo", async () => {
      mockFetch(providerResponse({}, { status: 429 }));
      await expect(generateStructured(INPUT)).rejects.toThrow(
        /^(?!.*(proveedor\.test|test-model|test-key)).*$/
      );
    });
  });

  describe("respuesta y métricas", () => {
    it("devuelve el JSON parseado sin validarlo", async () => {
      mockFetch(providerResponse(completion('{"totalInstallments":12}')));
      const result = await generateStructured(INPUT);
      expect(result.data).toEqual({ totalInstallments: 12 });
    });

    it("lee los tokens cacheados en la convención de DeepSeek", async () => {
      mockFetch(
        providerResponse(
          completion('{"ok":true}', {
            usage: {
              prompt_tokens: 900,
              completion_tokens: 120,
              prompt_cache_hit_tokens: 768,
            },
          })
        )
      );
      const result = await generateStructured(INPUT);
      expect(result.promptTokens).toBe(900);
      expect(result.completionTokens).toBe(120);
      expect(result.cachedPromptTokens).toBe(768);
    });

    it("lee los tokens cacheados en la convención de OpenAI", async () => {
      mockFetch(
        providerResponse(
          completion('{"ok":true}', {
            usage: {
              prompt_tokens: 900,
              completion_tokens: 120,
              prompt_tokens_details: { cached_tokens: 512 },
            },
          })
        )
      );
      expect((await generateStructured(INPUT)).cachedPromptTokens).toBe(512);
    });

    // "Nadie contó" y "contó cero" son afirmaciones distintas: confundirlas arruinaría
    // cualquier medición de costo que se haga después sobre estos números.
    it("un proveedor que no reporta uso deja las métricas en null, no en 0", async () => {
      mockFetch(providerResponse(completion('{"ok":true}')));
      const result = await generateStructured(INPUT);
      expect(result.promptTokens).toBeNull();
      expect(result.completionTokens).toBeNull();
      expect(result.cachedPromptTokens).toBeNull();
    });

    it("guarda el modelo que respondió, que puede no ser el pedido", async () => {
      mockFetch(providerResponse(completion('{"ok":true}', { model: "otro-modelo-v2" })));
      expect((await generateStructured(INPUT)).model).toBe("otro-modelo-v2");
    });

    it("si el proveedor no dice qué modelo usó, cae al configurado", async () => {
      mockFetch(providerResponse(completion('{"ok":true}')));
      expect((await generateStructured(INPUT)).model).toBe("test-model");
    });

    it("mide la duración de la llamada", async () => {
      mockFetch(providerResponse(completion('{"ok":true}')));
      expect((await generateStructured(INPUT)).durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
