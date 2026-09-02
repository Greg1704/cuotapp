import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CORPUS, CORPUS_CONTEXT, type CorpusCase } from "./corpus";
import { extractPurchase, requestKey } from "./purchase";
import type { PurchaseDraft, PurchaseField } from "./types";

const FIXTURES_DIR = join(import.meta.dirname, "__fixtures__");

/**
 * El corpus, corrido contra las respuestas guardadas.
 *
 * **Los casos sin fixture se saltean.** Hoy hay una sola respuesta guardada porque todavía
 * no se corrió el corpus contra el proveedor real (hace falta la API key, y el entorno de
 * la nube ni siquiera puede llegar al proveedor — ver `IA-PLAN.md`). A medida que
 * `npm run corpus -- --save-fixtures` vaya dejando respuestas, esta suite crece sola sin
 * tocar una línea de código.
 *
 * Lo que verifica no es el modelo —una respuesta guardada no puede sorprenderse— sino
 * **todo lo que viene después**: el parseo, las reparaciones, la derivación del total y la
 * pertenencia de las tarjetas, sobre respuestas reales en vez de inventadas. Es la red que
 * atrapa una regresión en esa cadena cuando alguien toque `parse.ts`.
 */
describe("corpus contra fixtures", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "fixture");
    vi.stubEnv("LLM_FIXTURES_DIR", FIXTURES_DIR);
  });
  afterEach(() => vi.unstubAllEnvs());

  const withFixture = CORPUS.filter((testCase) =>
    existsSync(join(FIXTURES_DIR, `${requestKey(testCase.text)}.json`))
  );

  it("hay al menos un caso con respuesta guardada", () => {
    expect(withFixture.length).toBeGreaterThan(0);
  });

  for (const testCase of withFixture) {
    it(`${testCase.label}: ${testCase.text}`, async () => {
      const { outcome } = await extractPurchase(testCase.text, {
        ...CORPUS_CONTEXT,
        ...testCase.context,
      });

      for (const [field, expected] of Object.entries(testCase.expected ?? {})) {
        expect(outcome.values[field as PurchaseField], `campo ${field}`).toEqual(expected);
      }
      for (const field of testCase.present ?? []) {
        expect(outcome.values[field], `campo ${field} debería venir`).toBeDefined();
      }
      for (const field of testCase.absent ?? []) {
        expect(outcome.values[field], `campo ${field} NO debería venir`).toBeUndefined();
      }
    });
  }
});

describe("integridad del corpus", () => {
  it("las etiquetas son únicas: son la clave de la tabla de resultados", () => {
    const labels = CORPUS.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("cada caso afirma algo: uno sin expected/present/absent no mide nada", () => {
    for (const testCase of CORPUS) {
      const asserts =
        Object.keys(testCase.expected ?? {}).length +
        (testCase.present?.length ?? 0) +
        (testCase.absent?.length ?? 0);
      expect(asserts, `el caso "${testCase.label}" no afirma nada`).toBeGreaterThan(0);
    }
  });

  it("ningún caso se contradice a sí mismo", () => {
    for (const testCase of CORPUS) {
      const expected = Object.keys(testCase.expected ?? {}) as PurchaseField[];
      for (const field of testCase.absent ?? []) {
        expect(expected, `"${testCase.label}" pide ${field} ausente y presente`).not.toContain(
          field
        );
        expect(testCase.present ?? []).not.toContain(field);
      }
    }
  });

  // El caso "vago" es el que atrapa las alucinaciones: si el corpus solo verificara lo que
  // se llena, no podría detectar que el modelo esté inventando datos.
  it("hay casos que verifican ausencia, no solo presencia", () => {
    const withAbsent = CORPUS.filter((c: CorpusCase) => c.absent?.length);
    expect(withAbsent.length).toBeGreaterThanOrEqual(5);
  });

  it("los montos esperados están en unidades, nunca en centavos", () => {
    for (const testCase of CORPUS) {
      const amount = testCase.expected?.totalAmount;
      if (amount !== undefined) expect(amount).toBeLessThan(100_000_000);
    }
  });

  it("las fechas esperadas no son futuras respecto del hoy congelado", () => {
    for (const testCase of CORPUS) {
      const date = (testCase.expected as PurchaseDraft | undefined)?.purchaseDate;
      if (date) expect(date.getTime()).toBeLessThanOrEqual(CORPUS_CONTEXT.today.getTime());
    }
  });
});
