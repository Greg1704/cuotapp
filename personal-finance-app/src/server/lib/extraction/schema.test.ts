import { describe, expect, it } from "vitest";

import { purchaseSchema } from "@/lib/validation/purchase";

import { purchaseExtractionSchema, purchaseResponseSchema } from "./schema";

describe("schema de extracción", () => {
  /**
   * El guardarraíl contra la deriva: el schema de extracción es HERMANO de
   * `purchaseSchema`, no independiente. Si alguien renombra un campo del formulario y
   * este no lo sigue, el modelo va a devolver una clave que después se descarta en
   * silencio — el modo de falla más difícil de notar de toda la feature.
   */
  it("todos sus campos existen en purchaseSchema", () => {
    const formFields = Object.keys(purchaseSchema.def.shape);
    for (const field of Object.keys(purchaseExtractionSchema.shape)) {
      expect(formFields).toContain(field);
    }
  });

  // Es una cotización de mercado que el usuario informa, no algo que esté en la frase. Si
  // el modelo la inventara, la utilización del límite quedaría mal para siempre: se guarda
  // como snapshot inmutable.
  it("NO le pide limitRate al modelo", () => {
    expect(purchaseExtractionSchema.shape).not.toHaveProperty("limitRate");
  });

  it("todos los campos son opcionales: lo ambiguo llega vacío, no adivinado", () => {
    for (const [field, schema] of Object.entries(purchaseExtractionSchema.shape)) {
      expect(schema.safeParse(undefined).success, `${field} debería ser opcional`).toBe(true);
    }
  });

  describe("JSON Schema derivado", () => {
    it("se deriva del schema Zod, con un tipo por campo", () => {
      const schema = purchaseResponseSchema();
      expect(schema.type).toBe("object");
      const properties = schema.properties as Record<string, { type: string }>;
      expect(Object.keys(properties).sort()).toEqual(
        Object.keys(purchaseExtractionSchema.shape).sort()
      );
      expect(properties.totalInstallments.type).toBe("number");
      expect(properties.purchaseDate.type).toBe("string");
    });

    // Todo lo que viaja en el prompt se paga en tokens, y esta clave es metadata para
    // validadores que el modelo no usa.
    it("no lleva $schema", () => {
      expect(purchaseResponseSchema()).not.toHaveProperty("$schema");
    });

    it("las descripciones viajan: son la documentación que lee el modelo", () => {
      const properties = purchaseResponseSchema().properties as Record<
        string,
        { description?: string }
      >;
      expect(properties.totalAmount.description).toMatch(/no centavos/i);
      expect(properties.purchaseDate.description).toMatch(/YYYY-MM-DD/);
    });
  });
});
