import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";

import { LLMPermanentError, LLMTransientError } from "@/server/lib/llm";
import type { GenerateStructuredInput, LLMResponse, LLMTransport } from "@/server/lib/llm";

import { extractPurchase, MAX_TEXT_LENGTH, requestKey } from "./purchase";
import type { PromptContext } from "./prompt";

const CONTEXT: PromptContext = {
  cards: [
    { id: "card_galicia", label: "Visa Galicia ••1234" },
    { id: "card_santander", label: "Mastercard Santander" },
  ],
  categories: [{ id: "cat_hogar", name: "Hogar" }],
  today: new Date("2026-09-02T00:00:00"),
};

/** Transporte de mentira: devuelve lo que se le diga y recuerda qué le pidieron. */
function fakeTransport(data: unknown) {
  const calls: GenerateStructuredInput[] = [];
  const transport: LLMTransport = (input) => {
    calls.push(input);
    return Promise.resolve({
      data,
      model: "modelo-de-prueba",
      promptTokens: 500,
      completionTokens: 80,
      cachedPromptTokens: 384,
      durationMs: 1200,
    } satisfies LLMResponse);
  };
  return { transport, calls };
}

describe("extractPurchase", () => {
  describe("la cadena completa", () => {
    it("traduce una frase en valores listos para el formulario", async () => {
      const { transport } = fakeTransport({
        paymentMethod: "credito",
        cardId: "card_galicia",
        description: "heladera",
        installmentAmount: 45000,
        totalInstallments: 12,
        currency: "pesos",
      });

      const { outcome } = await extractPurchase(
        "compré una heladera en 12 cuotas de 45 mil con la del Galicia",
        CONTEXT,
        transport
      );

      expect(outcome.values).toEqual({
        paymentMethod: "CREDIT",
        cardId: "card_galicia",
        description: "heladera",
        totalInstallments: 12,
        // Derivado por nuestro código: el modelo devolvió la cuota, no el total.
        totalAmount: 540000,
        currency: "ARS",
      });
    });

    it("devuelve las métricas de la llamada para la telemetría", async () => {
      const { transport } = fakeTransport({ description: "algo" });
      const { response } = await extractPurchase("compré algo", CONTEXT, transport);
      expect(response.promptTokens).toBe(500);
      expect(response.cachedPromptTokens).toBe(384);
      expect(response.model).toBe("modelo-de-prueba");
    });

    it("una respuesta vacía no rompe: devuelve todo sin llenar", async () => {
      const { transport } = fakeTransport({});
      const { outcome } = await extractPurchase("compré una tele", CONTEXT, transport);
      expect(outcome.values).toEqual({});
      expect(outcome.filled).toEqual([]);
    });
  });

  describe("lo que se le manda al transporte", () => {
    it("manda las instrucciones, el prompt y el schema derivado", async () => {
      const { transport, calls } = fakeTransport({});
      await extractPurchase("compré una heladera", CONTEXT, transport);

      expect(calls).toHaveLength(1);
      expect(calls[0].instructions).toMatch(/no inventes/i);
      expect(calls[0].prompt).toContain("compré una heladera");
      expect(calls[0].schema).toHaveProperty("properties.installmentAmount");
    });

    it("recorta espacios antes de mandar", async () => {
      const { transport, calls } = fakeTransport({});
      await extractPurchase("  compré una tele  ", CONTEXT, transport);
      expect(calls[0].requestKey).toBe(requestKey("compré una tele"));
    });
  });

  /**
   * Si el prompt y el validador recibieran cada uno su lista de tarjetas, podrían no
   * coincidir: el modelo vería una tarjeta que el validador después descarta, y el síntoma
   * sería un cardId que se pierde sin explicación posible.
   */
  describe("un solo contexto para el prompt y para el validador", () => {
    it("una tarjeta listada en el prompt es aceptada por el validador", async () => {
      const { transport, calls } = fakeTransport({ cardId: "card_santander" });
      const { outcome } = await extractPurchase("con la del Santander", CONTEXT, transport);

      expect(calls[0].prompt).toContain("card_santander");
      expect(outcome.values.cardId).toBe("card_santander");
      expect(outcome.rejected).toEqual([]);
    });

    it("una tarjeta que el modelo inventó se descarta", async () => {
      const { transport } = fakeTransport({ cardId: "card_nubank" });
      const { outcome } = await extractPurchase("con la del Nubank", CONTEXT, transport);
      expect(outcome.values.cardId).toBeUndefined();
      expect(outcome.rejected).toEqual([
        { field: "cardId", reason: "no-pertenece-al-usuario" },
      ]);
    });
  });

  describe("validación del texto de entrada", () => {
    it("un texto vacío no llega a gastar una llamada", async () => {
      const { transport, calls } = fakeTransport({});
      await expect(extractPurchase("   ", CONTEXT, transport)).rejects.toBeInstanceOf(
        LLMPermanentError
      );
      expect(calls).toHaveLength(0);
    });

    // La frase es la única parte del prompt que nunca cachea: cada carácter se paga entero
    // en cada llamada.
    it("un texto larguísimo se rechaza antes de mandarlo", async () => {
      const { transport, calls } = fakeTransport({});
      await expect(
        extractPurchase("x".repeat(MAX_TEXT_LENGTH + 1), CONTEXT, transport)
      ).rejects.toThrow(/muy largo/);
      expect(calls).toHaveLength(0);
    });

    it("un texto justo en el límite pasa", async () => {
      const { transport, calls } = fakeTransport({});
      await extractPurchase("x".repeat(MAX_TEXT_LENGTH), CONTEXT, transport);
      expect(calls).toHaveLength(1);
    });
  });

  describe("errores del transporte", () => {
    it("un error transitorio sube tal cual, para que la UI ofrezca reintentar", async () => {
      const transport: LLMTransport = () =>
        Promise.reject(new LLMTransientError("El asistente está ocupado."));
      await expect(extractPurchase("compré algo", CONTEXT, transport)).rejects.toBeInstanceOf(
        LLMTransientError
      );
    });
  });

  describe("requestKey", () => {
    it("la misma frase da la misma clave", () => {
      expect(requestKey("compré una tele")).toBe(requestKey("compré una tele"));
    });

    it("frases distintas dan claves distintas", () => {
      expect(requestKey("compré una tele")).not.toBe(requestKey("compré una heladera"));
    });

    // Si la clave saliera del prompt entero —como hace el proyecto hermano— el nonce
    // aleatorio la cambiaría en cada llamada y ninguna fixture se encontraría jamás.
    it("no depende del prompt, así que el nonce no la mueve", () => {
      expect(requestKey("compré una tele")).toBe(requestKey("  compré una tele  "));
    });
  });
});

/**
 * El transporte de fixtures, corriendo la cadena entera contra un archivo en disco: sin
 * red, sin API key, y con el mismo código que se despliega.
 */
describe("extractPurchase con el transporte de fixtures", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "fixture");
    vi.stubEnv("LLM_FIXTURES_DIR", join(import.meta.dirname, "__fixtures__"));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lee la respuesta guardada y la procesa como si viniera del proveedor", async () => {
    const { outcome, response } = await extractPurchase(
      "compré una heladera en 12 cuotas de 45 mil con la del Galicia",
      CONTEXT
    );

    expect(outcome.values.totalAmount).toBe(540000);
    expect(outcome.values.cardId).toBe("card_galicia");
    expect(response.model).toBe("fixture-manual");
  });

  // "Nadie contó" y "contó cero" son afirmaciones distintas: inventar un 0 acá
  // envenenaría cualquier medición de costo hecha sobre estos números.
  it("las métricas vuelven en null, nunca inventadas", async () => {
    const { response } = await extractPurchase(
      "compré una heladera en 12 cuotas de 45 mil con la del Galicia",
      CONTEXT
    );
    expect(response.promptTokens).toBeNull();
    expect(response.completionTokens).toBeNull();
  });

  // Ningún reintento hace aparecer un archivo.
  it("una fixture faltante es un error permanente, y dice qué archivo falta", async () => {
    await expect(extractPurchase("una frase sin fixture", CONTEXT)).rejects.toBeInstanceOf(
      LLMPermanentError
    );
    await expect(extractPurchase("una frase sin fixture", CONTEXT)).rejects.toThrow(
      new RegExp(requestKey("una frase sin fixture"))
    );
  });
});
