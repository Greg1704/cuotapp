import { describe, expect, it } from "vitest";

import { parsePurchaseExtraction } from "./parse";
import type { ExtractionContext } from "./types";

const CONTEXT: ExtractionContext = {
  cardIds: ["card_galicia", "card_santander"],
  categoryIds: ["cat_hogar"],
  today: new Date("2026-09-02T00:00:00"),
};

const parse = (data: unknown, context: Partial<ExtractionContext> = {}) =>
  parsePurchaseExtraction(data, { ...CONTEXT, ...context });

describe("parsePurchaseExtraction", () => {
  describe("lo que el modelo no dijo", () => {
    it("un objeto vacío no llena, no repara y no rechaza nada", () => {
      expect(parse({})).toEqual({ values: {}, filled: [], repaired: [], rejected: [] });
    });

    // "No lo dijo" es un resultado válido y esperado —la frase era ambigua—, no una
    // falla del modelo. Contarlo como rechazo ensuciaría el diagnóstico del prompt.
    it("null y undefined son 'no lo dijo', no un rechazo", () => {
      const result = parse({ cardId: null, description: undefined, currency: null });
      expect(result.rejected).toEqual([]);
      expect(result.filled).toEqual([]);
    });

    it("una respuesta que no es objeto no rompe", () => {
      for (const data of [null, "texto", 42, [1, 2]]) {
        expect(parse(data).values).toEqual({});
      }
    });

    // Se itera la lista de campos conocidos, nunca las claves de la respuesta: un campo
    // que no pedimos se ignora por omisión, sin código que lo contemple.
    it("ignora campos que no pedimos, sin rechazarlos", () => {
      const result = parse({ description: "heladera", limitRate: 1450, notes: "hola" });
      expect(result.values).toEqual({ description: "heladera" });
      expect(result.rejected).toEqual([]);
    });
  });

  describe("vocabulario: se normaliza (es deducible, no es inventar)", () => {
    it.each([
      ["CREDIT", "CREDIT"],
      ["credito", "CREDIT"],
      ["crédito", "CREDIT"],
      ["Crédito", "CREDIT"],
      ["tarjeta de crédito", "CREDIT"],
      ["debito", "DEBIT"],
      ["transferencia", "TRANSFER"],
      ["efectivo", "CASH"],
      ["cash", "CASH"],
    ])("paymentMethod %s → %s", (input, expected) => {
      expect(parse({ paymentMethod: input }).values.paymentMethod).toBe(expected);
    });

    it.each([
      ["ARS", "ARS"],
      ["pesos", "ARS"],
      ["$", "ARS"],
      ["USD", "USD"],
      ["dólares", "USD"],
      ["u$s", "USD"],
    ])("currency %s → %s", (input, expected) => {
      expect(parse({ currency: input }).values.currency).toBe(expected);
    });

    it("cuenta la normalización como reparación, para diagnosticar el prompt", () => {
      const result = parse({ currency: "pesos", paymentMethod: "efectivo" });
      expect(result.repaired).toEqual([
        { field: "paymentMethod", what: "normalizado" },
        { field: "currency", what: "normalizado" },
      ]);
    });

    it("un valor ya canónico no cuenta como reparación", () => {
      expect(parse({ currency: "ARS", paymentMethod: "CREDIT" }).repaired).toEqual([]);
    });

    it("una moneda desconocida se descarta, no se adivina", () => {
      const result = parse({ currency: "euros" });
      expect(result.values.currency).toBeUndefined();
      expect(result.rejected).toEqual([{ field: "currency", reason: "valor-desconocido" }]);
    });

    it("un medio de pago desconocido se descarta", () => {
      expect(parse({ paymentMethod: "cripto" }).rejected).toEqual([
        { field: "paymentMethod", reason: "valor-desconocido" },
      ]);
    });
  });

  describe("cuotas: ni se redondean ni se clampean", () => {
    it("acepta un entero dentro de rango", () => {
      expect(parse({ totalInstallments: 12 }).values.totalInstallments).toBe(12);
    });

    it.each([1, 60])("acepta los bordes del rango (%i)", (n) => {
      expect(parse({ totalInstallments: n }).values.totalInstallments).toBe(n);
    });

    // 12.4 cuotas no existe. Elegir 12 sería decidir por el usuario sobre su plan de
    // pago; el formulario ya sabe pedir el dato que falta.
    it("12.4 NO se redondea a 12: se descarta", () => {
      const result = parse({ totalInstallments: 12.4 });
      expect(result.values.totalInstallments).toBeUndefined();
      expect(result.rejected).toEqual([{ field: "totalInstallments", reason: "no-entero" }]);
    });

    it.each([0, -3, 61, 999])("%i está fuera de rango y NO se clampea", (n) => {
      const result = parse({ totalInstallments: n });
      expect(result.values.totalInstallments).toBeUndefined();
      expect(result.rejected).toEqual([
        { field: "totalInstallments", reason: "fuera-de-rango" },
      ]);
    });

    it("un string no se castea aunque parezca un número", () => {
      expect(parse({ totalInstallments: "12" }).rejected).toEqual([
        { field: "totalInstallments", reason: "tipo-invalido" },
      ]);
    });
  });

  describe("montos", () => {
    it("acepta un monto positivo, en unidades", () => {
      expect(parse({ totalAmount: 540000 }).values.totalAmount).toBe(540000);
    });

    it("acepta decimales (centavos expresados en unidades)", () => {
      expect(parse({ totalAmount: 45000.5 }).values.totalAmount).toBe(45000.5);
    });

    it.each([0, -100])("descarta montos no positivos (%i)", (amount) => {
      expect(parse({ totalAmount: amount }).values.totalAmount).toBeUndefined();
    });

    it("descarta un monto que llega como string", () => {
      expect(parse({ totalAmount: "45000" }).rejected).toEqual([
        { field: "totalAmount", reason: "tipo-invalido" },
      ]);
    });

    it("financedTotal sigue las mismas reglas que totalAmount", () => {
      expect(parse({ financedTotal: 578000 }).values.financedTotal).toBe(578000);
      expect(parse({ financedTotal: -1 }).rejected).toEqual([
        { field: "financedTotal", reason: "fuera-de-rango" },
      ]);
    });

    // Las reglas cruzadas son de purchaseSchema, que es la autoridad, y el formulario ya
    // sabe mostrar ese error. Acá no se adivina cuál de los dos campos está mal.
    it("NO valida financedTotal contra totalAmount: eso es de purchaseSchema", () => {
      const result = parse({ totalAmount: 100000, financedTotal: 50000 });
      expect(result.values.financedTotal).toBe(50000);
      expect(result.rejected).toEqual([]);
    });

    it("NO valida que efectivo sea de un solo pago: también es de purchaseSchema", () => {
      const result = parse({ paymentMethod: "efectivo", totalInstallments: 3 });
      expect(result.values.totalInstallments).toBe(3);
      expect(result.rejected).toEqual([]);
    });
  });

  describe("referencias: pertenencia, nunca parecido", () => {
    it("acepta un id que está entre las tarjetas del usuario", () => {
      expect(parse({ cardId: "card_galicia" }).values.cardId).toBe("card_galicia");
    });

    // Así es como se termina cargando una compra en la tarjeta equivocada.
    it("una tarjeta alucinada se descarta y NO se busca la más parecida", () => {
      const result = parse({ cardId: "card_galiciaa" });
      expect(result.values.cardId).toBeUndefined();
      expect(result.rejected).toEqual([
        { field: "cardId", reason: "no-pertenece-al-usuario" },
      ]);
    });

    it("un usuario sin tarjetas rechaza cualquier cardId", () => {
      expect(parse({ cardId: "card_galicia" }, { cardIds: [] }).rejected).toEqual([
        { field: "cardId", reason: "no-pertenece-al-usuario" },
      ]);
    });

    it("categoryId sigue la misma regla", () => {
      expect(parse({ categoryId: "cat_hogar" }).values.categoryId).toBe("cat_hogar");
      expect(parse({ categoryId: "cat_inventada" }).rejected).toEqual([
        { field: "categoryId", reason: "no-pertenece-al-usuario" },
      ]);
    });
  });

  describe("texto: se recorta, porque es etiqueta y no monto", () => {
    it("acepta y limpia espacios", () => {
      expect(parse({ description: "  heladera  " }).values.description).toBe("heladera");
    });

    it("un texto vacío se descarta", () => {
      expect(parse({ description: "   " }).rejected).toEqual([
        { field: "description", reason: "vacio" },
      ]);
    });

    it("recorta una descripción de más de 200 y lo cuenta como reparación", () => {
      const result = parse({ description: "x".repeat(250) });
      expect(result.values.description).toHaveLength(200);
      expect(result.repaired).toEqual([{ field: "description", what: "recortado" }]);
      expect(result.filled).toContain("description");
    });

    it("recorta merchant a 100", () => {
      expect(parse({ merchant: "y".repeat(150) }).values.merchant).toHaveLength(100);
    });
  });

  describe("fecha", () => {
    it("acepta YYYY-MM-DD", () => {
      const date = parse({ purchaseDate: "2026-08-30" }).values.purchaseDate;
      expect(date).toEqual(new Date("2026-08-30T00:00:00"));
    });

    it("acepta la fecha de hoy", () => {
      expect(parse({ purchaseDate: "2026-09-02" }).values.purchaseDate).toBeDefined();
    });

    it.each(["30/08/2026", "ayer", "2026-8-3", "2026-08-30T10:00:00Z"])(
      "descarta un formato que no es YYYY-MM-DD (%s)",
      (value) => {
        expect(parse({ purchaseDate: value }).rejected).toEqual([
          { field: "purchaseDate", reason: "fecha-invalida" },
        ]);
      }
    );

    // Una compra ya ocurrió: una fecha futura es el modelo equivocándose de año o
    // resolviendo mal "el martes".
    it("descarta una fecha futura", () => {
      expect(parse({ purchaseDate: "2027-01-15" }).rejected).toEqual([
        { field: "purchaseDate", reason: "fecha-futura" },
      ]);
    });

    it("tolera un día de desfase (zona horaria)", () => {
      expect(parse({ purchaseDate: "2026-09-03" }).values.purchaseDate).toBeDefined();
    });
  });

  describe("invariantes del resultado", () => {
    it("todo lo reparado también está en filled", () => {
      const result = parse({ currency: "pesos", description: "z".repeat(300) });
      for (const { field } of result.repaired) expect(result.filled).toContain(field);
    });

    it("nada rechazado aparece en filled ni en values", () => {
      const result = parse({ currency: "euros", totalInstallments: 99, cardId: "nope" });
      for (const { field } of result.rejected) {
        expect(result.filled).not.toContain(field);
        expect(result.values[field]).toBeUndefined();
      }
    });

    it("una frase completa llena todo lo que corresponde", () => {
      const result = parse({
        paymentMethod: "credito",
        cardId: "card_galicia",
        categoryId: "cat_hogar",
        description: "heladera",
        merchant: "Frávega",
        totalAmount: 540000,
        currency: "pesos",
        totalInstallments: 12,
        purchaseDate: "2026-09-01",
      });

      expect(result.rejected).toEqual([]);
      expect(result.values).toEqual({
        paymentMethod: "CREDIT",
        cardId: "card_galicia",
        categoryId: "cat_hogar",
        description: "heladera",
        merchant: "Frávega",
        totalAmount: 540000,
        currency: "ARS",
        totalInstallments: 12,
        purchaseDate: new Date("2026-09-01T00:00:00"),
      });
    });
  });
});
