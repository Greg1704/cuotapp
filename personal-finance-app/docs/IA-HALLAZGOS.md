# IA — Hallazgos de las corridas reales

Observaciones **fechadas y provisorias** de correr la extracción contra el proveedor de
verdad: un campo que puntúa raro, una alucinación, un costo o una latencia que no coincide
con lo estimado, un campo que el proveedor cambió.

> **Por qué vive aparte.** `IA-PLAN.md` e `IA-EXTRACCION.md` guardan **decisiones**; esto
> guarda **observaciones**, que son provisorias y tienen fecha. Mezclarlas hace que los
> documentos de decisiones envejezcan mal. Cuando un hallazgo se convierte en decisión, la
> decisión se muda allá y acá queda el hallazgo con el link.
>
> Es la convención del proyecto hermano (Qulmara, `docs/HALLAZGOS.md`), donde funcionó: 15
> hallazgos documentados fueron los que permitieron corregir supuestos de costo, latencia y
> calibración en vez de arrastrarlos.

## Cómo se anota

Un hallazgo por sección, numerado `H-NN`, con estado `abierto` / `en curso` / `resuelto`.
Cuatro partes, siempre:

- **Observado** — qué pasó, en una línea.
- **Evidencia** — números, tablas, la salida del comando. Sin esto no es un hallazgo, es
  una impresión.
- **Consecuencia** — qué cambia (o no) por esto.
- **Acción propuesta** — qué habría que hacer, o explícitamente "ninguna todavía".

Y cuando corresponda: **Predicción registrada antes de correr**. Anotar qué se espera
*antes* de ver el resultado es lo que distingue una hipótesis de una racionalización
posterior.

---

## Supuestos a verificar en la primera corrida

Ninguno está verificado todavía: **no hubo ninguna llamada real**. El bloque A se
construyó entero contra respuestas de mentira y una fixture escrita a mano.

| # | Supuesto | De dónde sale | Estado |
|---|---|---|---|
| S-1 | El identificador del modelo existe y es el correcto | `.env.example` lo deja vacío a propósito | ⬜ |
| S-2 | El proveedor soporta `response_format: {type:"json_object"}` | Asumido en `llm/client.ts` | ⬜ |
| S-3 | Reporta tokens cacheados en alguna de las dos convenciones que leemos | `usageMetrics()` | ⬜ |
| S-4 | El razonamiento se apaga con `LLM_EXTRA_BODY` y eso baja costo y latencia | Medido en el proyecto hermano, **no acá** | ⬜ |
| S-5 | Apagar el razonamiento NO degrada la adherencia al JSON | Nadie lo documentó | ⬜ |
| S-6 | Con `temperature: 0` la extracción es más estable que un juicio | Plausible, sin medir | ⬜ |
| S-7 | El prefijo cachea de verdad contra el proveedor | El `--dry-run` solo prueba que es idéntico de nuestro lado | ⬜ |

---

## Índice

*(vacío — todavía no se corrió nada contra el proveedor real)*
