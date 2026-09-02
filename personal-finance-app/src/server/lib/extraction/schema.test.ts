import { describe, expect, it } from "vitest";

import { purchaseSchema } from "@/lib/validation/purchase";

import { expenseResponseSchema, purchaseExtractionSchema } from "./schema";
import { EXTRACTION_ONLY_FIELDS } from "./types";

type PropertyNode = {
  type?: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, PropertyNode>;
};

describe("schema de extracción", () => {
  /**
   * El guardarraíl contra la deriva: el schema de extracción es HERMANO de
   * `purchaseSchema`, no independiente. Si alguien renombra un campo del formulario y
   * este no lo sigue, el modelo va a devolver una clave que después se descarta en
   * silencio — el modo de falla más difícil de notar de toda la feature.
   */
  it("todos sus campos existen en purchaseSchema, salvo las excepciones declaradas", () => {
    const formFields = Object.keys(purchaseSchema.def.shape);
    const allowed: readonly string[] = EXTRACTION_ONLY_FIELDS;
    for (const field of Object.keys(purchaseExtractionSchema.shape)) {
      if (allowed.includes(field)) continue;
      expect(formFields).toContain(field);
    }
  });

  /**
   * Las excepciones se declaran en `EXTRACTION_ONLY_FIELDS`, así que sumar un campo que no
   * existe en el formulario es una decisión explícita y no un descuido. Hoy hay una sola:
   * `installmentAmount`, que existe para que la multiplicación de "12 cuotas de 45 mil" la
   * haga nuestro código y no el modelo.
   */
  it("las excepciones son las declaradas, y ninguna más", () => {
    const formFields = Object.keys(purchaseSchema.def.shape);
    const extras = Object.keys(purchaseExtractionSchema.shape).filter(
      (field) => !formFields.includes(field)
    );
    expect(extras).toEqual([...EXTRACTION_ONLY_FIELDS]);
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
    const purchaseProperties = () => {
      const root = expenseResponseSchema().properties as Record<string, PropertyNode>;
      return root.purchase.properties as Record<string, PropertyNode>;
    };

    it("se deriva del schema Zod, con un tipo por campo", () => {
      const properties = purchaseProperties();
      expect(Object.keys(properties).sort()).toEqual(
        Object.keys(purchaseExtractionSchema.shape).sort()
      );
      expect(properties.totalInstallments.type).toBe("number");
      expect(properties.purchaseDate.type).toBe("string");
    });

    /**
     * La razón de que el schema esté anidado: con todos los campos al mismo nivel, nada
     * impide que una suscripción vuelva con `totalInstallments`. Anidando, el campo
     * directamente no existe del lado equivocado — la estructura impide el error en vez de
     * que una instrucción lo desaconseje.
     */
    it("una suscripción no tiene dónde poner los campos de una compra", () => {
      const root = expenseResponseSchema().properties as Record<string, PropertyNode>;
      const subscription = root.subscription.properties as Record<string, PropertyNode>;
      for (const field of ["totalInstallments", "installmentAmount", "financedTotal"]) {
        expect(subscription).not.toHaveProperty(field);
      }
    });

    it("el tipo de gasto es un enum cerrado, no texto libre", () => {
      const root = expenseResponseSchema().properties as Record<string, PropertyNode>;
      expect(root.kind.enum).toEqual(["purchase", "subscription"]);
    });

    // Todo lo que viaja en el prompt se paga en tokens, y esta clave es metadata para
    // validadores que el modelo no usa.
    it("no lleva $schema", () => {
      expect(expenseResponseSchema()).not.toHaveProperty("$schema");
    });

    it("las descripciones viajan: son la documentación que lee el modelo", () => {
      const properties = purchaseProperties();
      expect(properties.totalAmount.description).toMatch(/no centavos/i);
      expect(properties.purchaseDate.description).toMatch(/YYYY-MM-DD/);
    });
  });
});
