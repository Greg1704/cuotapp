import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CORPUS, CORPUS_CONTEXT, type CorpusCase } from "./corpus";
import { extractExpense, requestKey } from "./expense";

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
      const { kind, outcome } = await extractExpense(testCase.text, {
        ...CORPUS_CONTEXT,
        ...testCase.context,
      });

      // El ruteo primero: prellenar el formulario equivocado es peor que no prellenar.
      expect(kind, "tipo de gasto").toBe(testCase.kind);

      // Los valores ya están validados por tipo dentro de su rama; acá se los mira como
      // un diccionario porque la afirmación es la misma para los dos tipos.
      const values = outcome.values as Record<string, unknown>;
      for (const [field, expected] of Object.entries(testCase.expected ?? {})) {
        expect(values[field], `campo ${field}`).toEqual(expected);
      }
      for (const field of testCase.present ?? []) {
        expect(values[field], `campo ${field} debería venir`).toBeDefined();
      }
      for (const field of testCase.absent ?? []) {
        expect(values[field], `campo ${field} NO debería venir`).toBeUndefined();
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
      const expected: string[] = Object.keys(testCase.expected ?? {});
      const present: string[] = testCase.present ?? [];
      for (const field of testCase.absent ?? []) {
        expect(expected, `"${testCase.label}" pide ${field} ausente y presente`).not.toContain(
          field
        );
        expect(present).not.toContain(field);
      }
    }
  });

  // La promesa del rebranding es "una sola feature con tres salidas". Un corpus con un
  // solo tipo de gasto no podría detectar que el ruteo esté roto.
  it("cubre los dos tipos de gasto", () => {
    expect(CORPUS.some((c) => c.kind === "purchase")).toBe(true);
    expect(CORPUS.filter((c) => c.kind === "subscription").length).toBeGreaterThanOrEqual(4);
  });

  // El caso "vago" es el que atrapa las alucinaciones: si el corpus solo verificara lo que
  // se llena, no podría detectar que el modelo esté inventando datos.
  it("hay casos que verifican ausencia, no solo presencia", () => {
    const withAbsent = CORPUS.filter((c: CorpusCase) => c.absent?.length);
    expect(withAbsent.length).toBeGreaterThanOrEqual(5);
  });

  it("los montos esperados están en unidades, nunca en centavos", () => {
    for (const testCase of CORPUS) {
      const expected = (testCase.expected ?? {}) as Record<string, unknown>;
      for (const key of ["totalAmount", "financedTotal", "amount"]) {
        const amount = expected[key];
        if (typeof amount === "number") expect(amount).toBeLessThan(100_000_000);
      }
    }
  });

  // Una COMPRA ya ocurrió, así que su fecha no puede ser futura. Un primer cobro de
  // suscripción sí puede serlo (se da de alta algo que empieza el mes que viene), por eso
  // esta afirmación es solo sobre las compras.
  it("las fechas de compra esperadas no son futuras respecto del hoy congelado", () => {
    for (const testCase of CORPUS) {
      if (testCase.kind !== "purchase") continue;
      const date = testCase.expected?.purchaseDate;
      if (date) expect(date.getTime()).toBeLessThanOrEqual(CORPUS_CONTEXT.today.getTime());
    }
  });
});
