/**
 * Corre el corpus de frases por la pipeline de extracción y compara campo por campo.
 *
 * El banco de pruebas del paso 5. Iterar el prompt necesita poder correr muchas frases de
 * una y leer los resultados en paralelo, cosa que el formulario no da: medir a través de
 * la UI significa tipear frases a mano en un navegador y mirar campos.
 *
 * **Corre el camino de producción, no una copia.** Llama al mismo `extractPurchase()` que
 * va a llamar la Server Action. Una herramienta que armara su propio prompt validaría un
 * prompt que nadie despacha.
 *
 * Uso:
 *   npx tsx scripts/extract-corpus.ts --dry-run           # sin red ni API key
 *   npx tsx scripts/extract-corpus.ts                     # corrida real
 *   npx tsx scripts/extract-corpus.ts --repeat 3          # barra de ruido
 *   npx tsx scripts/extract-corpus.ts --filter cuota      # un subconjunto
 *   npx tsx scripts/extract-corpus.ts --save-fixtures     # guarda las respuestas
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  CORPUS,
  CORPUS_CONTEXT,
  type CorpusCase,
} from "../src/server/lib/extraction/corpus";
import { buildInstructions, buildPrompt } from "../src/server/lib/extraction/prompt";
import { extractExpense, requestKey } from "../src/server/lib/extraction/expense";
import type { LLMResponse } from "../src/server/lib/llm";

const FIXTURES_DIR = join(
  import.meta.dirname,
  "..",
  "src/server/lib/extraction/__fixtures__"
);

type CellResult = "ok" | "fail" | "skip";
/**
 * Los campos se miran como texto porque la tabla mezcla los dos tipos de gasto. El tipado
 * fuerte vive donde importa —al DECLARAR un caso, donde la unión discriminada impide
 * escribir `totalInstallments` en una suscripción— y no acá, que solo imprime.
 */
type Field = string;
/** Una corrida de un caso. `error` distingue "falló la llamada" de "falló el campo". */
type CaseRun = { cells: Map<Field, CellResult>; error?: string; response?: LLMResponse };

function parseArgs(argv: string[]) {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    dryRun: has("--dry-run"),
    saveFixtures: has("--save-fixtures"),
    repeat: Math.max(1, Number(value("--repeat") ?? 1) || 1),
    filter: value("--filter"),
  };
}

function contextFor(testCase: CorpusCase) {
  return { ...CORPUS_CONTEXT, ...testCase.context };
}

/**
 * Qué campos afirma este caso. Los que no afirma se imprimen como `·` y no cuentan: "no
 * medido" y "medido y correcto" son afirmaciones distintas, y mezclarlas inventaría
 * aciertos que nadie verificó.
 */
function assertedFields(testCase: CorpusCase): Field[] {
  return [
    // El tipo de gasto es la primera afirmación de todas: prellenar el formulario
    // equivocado es peor que no prellenar nada.
    "kind",
    ...Object.keys(testCase.expected ?? {}),
    ...(testCase.present ?? []),
    ...(testCase.absent ?? []),
  ];
}

function checkField(
  testCase: CorpusCase,
  field: Field,
  kind: string,
  values: Record<string, unknown>
): CellResult {
  if (field === "kind") return kind === testCase.kind ? "ok" : "fail";
  const absent: string[] = testCase.absent ?? [];
  const present: string[] = testCase.present ?? [];
  if (absent.includes(field)) return values[field] === undefined ? "ok" : "fail";
  if (present.includes(field)) return values[field] !== undefined ? "ok" : "fail";
  const expected = (testCase.expected as Record<string, unknown> | undefined)?.[field];
  if (expected === undefined) return "skip";
  const actual = values[field];
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime() ? "ok" : "fail";
  }
  return actual === expected ? "ok" : "fail";
}

async function runCase(testCase: CorpusCase, saveFixtures: boolean): Promise<CaseRun> {
  const cells = new Map<Field, CellResult>();
  try {
    const { kind, outcome, response } = await extractExpense(
      testCase.text,
      contextFor(testCase)
    );
    const values = outcome.values as Record<string, unknown>;
    for (const field of assertedFields(testCase)) {
      cells.set(field, checkField(testCase, field, kind, values));
    }
    if (saveFixtures) {
      mkdirSync(FIXTURES_DIR, { recursive: true });
      writeFileSync(
        join(FIXTURES_DIR, `${requestKey(testCase.text)}.json`),
        JSON.stringify({ model: response.model, data: response.data }, null, 2)
      );
    }
    return { cells, response };
  } catch (error) {
    // Una corrida fallida se EXCLUYE, nunca se cuenta como error de campo. Contarla como
    // fallo fabricaría datos a partir de una llamada que no devolvió ninguna opinión,
    // justo en la herramienta cuyo trabajo es distinguir señal de ruido.
    return { cells, error: error instanceof Error ? error.message : String(error) };
  }
}

const SYMBOL: Record<CellResult, string> = { ok: "✓", fail: "✗", skip: "·" };

function printResults(cases: CorpusCase[], runs: Map<string, CaseRun[]>, repeat: number) {
  const fields = [...new Set(cases.flatMap(assertedFields))];
  const labelWidth = Math.max(...cases.map((c) => c.label.length));
  const columnWidth = 6;

  const head = fields.map((f) => f.slice(0, columnWidth).padEnd(columnWidth)).join(" ");
  console.log(`\n${"caso".padEnd(labelWidth)}  ${head}`);
  console.log("-".repeat(labelWidth + 2 + head.length));

  const totals = new Map<Field, { ok: number; total: number }>();
  let unstable = 0;

  for (const testCase of cases) {
    const caseRuns = runs.get(testCase.label) ?? [];
    const cells = fields.map((field) => {
      const results = caseRuns.map((run) => run.cells.get(field)).filter(Boolean);
      if (!results.length) return "·".padEnd(columnWidth);

      const distinct = new Set(results);
      // El "?" es la lección más cara del proyecto hermano: una celda que cambia entre
      // corridas idénticas es ruido, y atribuirle una mejora a un cambio de prompt sin
      // conocer ese piso es perseguir fantasmas.
      if (distinct.size > 1) {
        unstable += 1;
        return "?".padEnd(columnWidth);
      }

      const result = results[0] as CellResult;
      if (result !== "skip") {
        const total = totals.get(field) ?? { ok: 0, total: 0 };
        total.total += 1;
        if (result === "ok") total.ok += 1;
        totals.set(field, total);
      }
      return SYMBOL[result].padEnd(columnWidth);
    });

    const failed = caseRuns.find((run) => run.error);
    const suffix = failed ? `  ⚠ ${failed.error}` : "";
    console.log(`${testCase.label.padEnd(labelWidth)}  ${cells.join(" ")}${suffix}`);
  }

  // La fila que es el punto de todo esto: un fallo suelto es una frase difícil, una
  // columna en 4/20 es un prompt que no explica ese campo, y dice cuál.
  console.log("-".repeat(labelWidth + 2 + head.length));
  const summary = fields
    .map((field) => {
      const total = totals.get(field);
      const text = total ? `${total.ok}/${total.total}` : "-";
      return text.slice(0, columnWidth).padEnd(columnWidth);
    })
    .join(" ");
  console.log(`${"POR CAMPO".padEnd(labelWidth)}  ${summary}`);

  if (repeat > 1) {
    console.log(
      `\nCeldas inestables entre ${repeat} corridas: ${unstable}. ` +
        "Es la barra de ruido: una mejora que no la supere no es una mejora."
    );
  }
}

function printMetrics(runs: Map<string, CaseRun[]>) {
  const responses = [...runs.values()].flat().flatMap((run) => (run.response ? [run.response] : []));
  if (!responses.length) return;

  const sum = (pick: (r: LLMResponse) => number | null) =>
    responses.reduce((acc, r) => acc + (pick(r) ?? 0), 0);
  // Si NADIE reportó tokens (el caso del transporte de fixtures), se dice "n/a" en vez de
  // un 0: "nadie contó" y "contó cero" no son lo mismo.
  const reported = responses.some((r) => r.promptTokens !== null);

  console.log(
    `\nLlamadas: ${responses.length}` +
      (reported
        ? ` · prompt ${sum((r) => r.promptTokens)} tok` +
          ` (cacheados ${sum((r) => r.cachedPromptTokens)})` +
          ` · salida ${sum((r) => r.completionTokens)} tok` +
          ` · ${Math.round(sum((r) => r.durationMs) / responses.length)} ms de promedio`
        : " · métricas n/a (transporte de fixtures)")
  );
}

/**
 * Imprime las dos mitades del prompt con su huella, sin tocar el proveedor ni la red.
 *
 * Es lo único que se puede correr sin API key, y de paso mide algo que ninguna respuesta
 * muestra: si el prefijo es idéntico llamada a llamada. Si el sha de las instrucciones
 * cambiara entre dos casos, el caching estaría roto y no habría forma de notarlo mirando
 * resultados.
 */
function dryRun(cases: CorpusCase[]) {
  const instructions = buildInstructions();
  const sha = createHash("sha256").update(instructions).digest("hex").slice(0, 16);

  console.log("=== INSTRUCCIONES (mitad cacheable) ===");
  console.log(instructions);
  console.log(`\nsha256: ${sha} · ${instructions.length} caracteres (~${Math.round(instructions.length / 4)} tokens)`);

  const first = cases[0];
  console.log(`\n=== PROMPT (mitad variable) — caso "${first.label}" ===`);
  const prompt = buildPrompt(first.text, contextFor(first));
  console.log(prompt);
  console.log(`\n${prompt.length} caracteres (~${Math.round(prompt.length / 4)} tokens)`);

  const shas = new Set(
    cases.map(() => createHash("sha256").update(buildInstructions()).digest("hex"))
  );
  console.log(
    `\nHuellas distintas de las instrucciones en ${cases.length} casos: ${shas.size} ` +
      (shas.size === 1 ? "✓ (el prefijo cachea)" : "✗ EL PREFIJO NO ES ESTABLE")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = args.filter
    ? CORPUS.filter((c) => c.label.includes(args.filter!) || c.text.includes(args.filter!))
    : CORPUS;

  if (!cases.length) {
    console.error(`Ningún caso coincide con "${args.filter}".`);
    process.exit(1);
  }

  if (args.dryRun) return dryRun(cases);

  const runs = new Map<string, CaseRun[]>();
  for (let round = 1; round <= args.repeat; round += 1) {
    for (const testCase of cases) {
      process.stderr.write(`\r[${round}/${args.repeat}] ${testCase.label}${" ".repeat(20)}`);
      const run = await runCase(testCase, args.saveFixtures);
      runs.set(testCase.label, [...(runs.get(testCase.label) ?? []), run]);
    }
  }
  process.stderr.write("\r" + " ".repeat(60) + "\r");

  printResults(cases, runs, args.repeat);
  printMetrics(runs);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
