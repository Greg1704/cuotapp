# IA — Plan de implementación

Plan de trabajo de la entrada por lenguaje natural (§2 del `REBRANDING.md`). Este archivo
es el **registro de avance**: qué paso va, qué se decidió en cada uno y por qué. Está
pensado para retomar el trabajo en otra sesión sin tener que reconstruir el contexto.

- **El diseño y su justificación** están en [`IA-EXTRACCION.md`](./IA-EXTRACCION.md)
  (derivado de la pipeline ya medida del proyecto hermano Qulmara).
- **El alcance del producto** está en [`REBRANDING.md`](./REBRANDING.md) §2, §5 y §7.

---

## Estado

| # | Paso | Estado |
|---|---|---|
| — | Plan y diseño | ✅ |
| 1 | Transporte — `src/server/lib/llm/` | ✅ |
| 2 | Schema de extracción y reparaciones | ⏳ |
| 3 | El prompt | ⏳ |
| 4 | `extractPurchase()` + transporte `fixture` | ⏳ |
| 5 | Corpus y su runner (`--dry-run`) | ⏳ |
| 6 | Suscripciones y ruteo | ⏳ |
| 7 | `aiEnabled()` + degradación | ⏳ |
| 8 | Server Action, prefill y campos "sugerido" | ⏳ |
| 9 | `ExtractionLog` + rate limit | ⏳ |
| 10 | Input global (§5 del rebranding) | ⏳ |

**Bloque A = pasos 1-6** (backend y laboratorio). **Bloque B = 7-10** (pantalla).

---

## Por qué la API key NO hace falta todavía

Verificado el 2026-09-02, y vale la pena dejarlo escrito porque es contraintuitivo:

1. **En una sesión de Claude Code on the web la llamada no sale.** La política de egress
   del entorno rechaza el CONNECT a los proveedores:
   `api.deepseek.com:443 — connect_rejected (organization policy)`. Lo mismo
   `api.openai.com`. Con o sin key, desde la nube no se puede llamar.
2. **La key nunca va por el chat.** Queda en el transcript de la sesión.
3. **El contenedor es efímero**, así que un `export` ahí se recicla con la sesión.

**Dónde va cuando llegue el momento:** `.env` local (gitignored) para correr el corpus en
tu máquina, y las *Environment Variables* de Vercel en producción. Si en algún momento se
quiere que una sesión en la nube llame al proveedor, hay que habilitar el host en la
política de egress del entorno **y** cargar la variable en su configuración — las dos cosas,
desde la config del entorno.

**Los pasos 1 a 6 no necesitan key ni red.** La key destraba únicamente:

- El **experimento del razonamiento** (ver abajo).
- Correr el corpus de verdad y medir la **barra de ruido**.
- La calibración del prompt.

---

## Corrección al orden que proponía `IA-EXTRACCION.md` §13

Ahí el "medir el razonamiento" figuraba como paso 0, antes de todo. **Está mal en un
detalle que importa:** para medirlo *por el camino de producción* —que es la lección de
Qulmara, *"una herramienta que armara su propio prompt validaría un prompt que nadie
despacha"*— el transporte y el corpus tienen que existir primero.

**Orden bueno:** pasos 1-6 sin key → después, con la key puesta y en una sola sentada, el
experimento de razonamiento y las 3 corridas del corpus para la barra de ruido.

---

## Contrato de cada paso

- Cierra con **`npm run typecheck && npm test` en verde** (convención del repo).
- Trae **sus tests**, junto al código, `*.test.ts` (`.claude/rules/testing.md`).
- Trae **una sola decisión de diseño** a revisar, anotada abajo.
- Commit propio con Conventional Commits.

---

## Paso 1 — El transporte (`src/server/lib/llm/`)

El único módulo del proyecto que habla con el proveedor. Todo lo demás lo llama y nunca
se entera de quién contestó.

**Por qué aislarlo.** No es purismo: la §7 del `REBRANDING.md` (foto del ticket, PDF del
resumen) y el futuro "agregá mi tarjeta del Galicia" son **más dominios sobre el mismo
transporte**. Si el prompt de compras viviera acá adentro, el día que se sume el de
suscripciones habría dos features entrelazadas en la capa de infraestructura. Es
exactamente el corte que Qulmara hace entre `services/llm.py` y `bug_quality/evaluation.py`.

### Decisiones

**a) `fetch` nativo, no el SDK `openai`.** Es un solo endpoint (`chat/completions`), sin
streaming ni tool calling. Tres ventajas:

- **Cero dependencias nuevas** en una app que hoy no tiene ninguna de IA.
- **El problema de los reintentos desaparece en vez de resolverse.** El SDK reintenta dos
  veces por defecto y Qulmara tiene que apagarlo explícitamente (`max_retries=0`) con
  cuatro párrafos de justificación. Con `fetch` no hay nada que apagar.
- El mapeo de status HTTP a las dos clases de error son ~15 líneas, y es código que
  igual queremos leer.

Si en algún momento se quiere el SDK, **se cambia solo este archivo**: es justamente la
propiedad que el corte compra.

**b) Sin reintentos automáticos, y es más fuerte que en Qulmara.** Allá la política de
reintentos vive en Celery. Acá no hay cola: la extracción es síncrona y **el usuario está
mirando un spinner**. Tres reintentos con backoff son tres veces la latencia sin decirle
nada a nadie. El reintento es un **botón que el usuario aprieta**, que además le da el
control de gastar la llamada o no.

**c) `providerOptions` desde el arranque — la lección de H-04.** El transporte acepta
parámetros propios del proveedor y los mergea al body, manejados por variable de entorno
(`LLM_EXTRA_BODY`).

Esto no es especulación: en Qulmara, apagar el razonamiento —que es el 87% del output
facturado y ~40 s de latencia— quedó **bloqueado** porque `services/llm.py` no tenía por
dónde pasar `extra_body`, y su propio `HALLAZGOS.md` lo anota como *"pendiente de
implementación [...] el cambio es chico pero toca la firma del transporte, así que va como
paso propio"*. Poniéndolo ahora, el experimento de los tres brazos (`high` / `low` /
`disabled`) es **un cambio de configuración, no de código** — que es la única forma de
mover una variable por vez sin recompilar nada.

**d) `temperature: 0`.** Esto es una extracción, no una redacción: queremos que la misma
frase dé el mismo resultado. También debería achicar la barra de ruido del paso 5 respecto
de la de Qulmara (que mide un juicio, no una traducción) — pero eso **hay que medirlo, no
suponerlo**.

**e) El log nunca lleva el cuerpo del error.** Qulmara loguea solo el nombre de la clase
porque *"el SDK mete el body del request —que contiene todo el prompt— dentro del mensaje
de algunas de sus excepciones"*. Acá ese body incluiría el gasto del usuario y los nombres
de sus tarjetas, y `.claude/rules/seguridad.md` ya prohíbe loguear eso.

**f) Los mensajes de error son de UI y van en español**, y no nombran al proveedor:
*"No pude interpretarlo"*, nunca *"DeepSeek devolvió 429"*. Hay un test que lo custodia
(ningún mensaje puede contener el host, el modelo ni la key).

### Resultado

`src/server/lib/llm/` → `errors.ts`, `types.ts`, `config.ts`, `client.ts`, `index.ts`,
más 36 tests. Las variables quedaron documentadas en `.env.example`, todas opcionales.

Dos cosas que aparecieron al bajarlo a código y no estaban en el plan:

- **`isConfigured()` exige key Y modelo**, no solo la key. El modelo no tiene default
  incrustado a propósito (misma razón que la variable de entorno), así que sin él la
  feature tampoco puede funcionar y tiene que ocultarse igual.
- **Los tests necesitaron tipar el mock de `fetch`.** `vi.fn()` sin tipo deja
  `mock.calls` como tupla vacía y `tsc` lo rechaza; se resolvió con `vi.fn<typeof fetch>`
  y dos helpers (`calledUrl`, `calledBody`) con la forma del request tipada — índice
  abierto en `unknown`, nunca `any` (convención del repo).

---

## Paso 2 — Schema de extracción y reparaciones

El schema Zod **hermano** de `purchaseSchema`, no el mismo.

**Por qué hermano y no el mismo.** `purchaseSchema` tiene `z.date()` (que JSON Schema no
representa) y un `.superRefine()` con reglas cruzadas (tampoco). El de extracción es
JSON-friendly y **todo opcional**:

- Fechas como `string` ISO (`"2026-09-02"`), no `Date`.
- Montos en **unidades** (`45000`), nunca centavos. `.claude/rules/dinero-y-fechas.md`:
  la aritmética de plata no se delega a un modelo probabilístico.
- **Todos los campos opcionales**, porque el resultado esperado de una frase ambigua es un
  campo faltante, no uno adivinado.
- Sin reglas cruzadas: las valida `purchaseSchema` después, que sigue siendo la autoridad.

Cadena completa: `extractionSchema` → normalización → `purchaseSchema.safeParse()` →
prefill. **La IA nunca se saltea la puerta que ya existe.**

### La regla del validador

De Qulmara, y es la línea que ordena todo el paso:

> **Reparar lo deducible, rechazar lo que habría que inventar.**

La regla es la misma; **la tabla es más restrictiva acá**, porque son datos de plata y
porque el `REBRANDING.md` ya fijó el criterio (*"campo vacío y marcado, no adivinado"*).
La tabla completa está en `IA-EXTRACCION.md` §7 — **cada fila es un test**.

---

## Paso 3 — El prompt

Dos mitades, y el corte es deliberado:

- **`buildInstructions()`** — estático, byte-idéntico llamada a llamada. Va al mensaje
  `system`. Con su test de custodia: un refactor que reordene reglas destruiría el cache
  *sin romper ningún comportamiento*, y ningún otro test se enteraría.
- **`buildPrompt()`** — variable. Va al mensaje `user`: la frase, las tarjetas y categorías
  del usuario (DTO mínimo: id + nombre), **la fecha de hoy explícita** y el nonce.

**El caching no es el motivo principal acá.** En Qulmara el prefijo son ~2.500 tokens de
guías y cachea al 98%; en CuotApp son unos cientos y el ahorro absoluto es ruido (ver
`IA-EXTRACCION.md` §4). El ordenamiento se hace igual porque es gratis, pero **lo que
importa de verdad es la otra propiedad**: el texto no confiable del usuario queda fuera del
mensaje que lleva las instrucciones.

**La fecha de hoy va explícita.** El modelo no sabe qué día es: sin eso, "ayer" y "el
martes pasado" salen cualquier cosa.

**El nonce va desde el día uno.** Qulmara usa delimitadores constantes y documenta que son
adivinables, dejando el nonce pendiente hasta que *"el texto venga de un tercero anónimo"*
(para ellos, el webhook de GitHub). **CuotApp tiene ese disparador en el roadmap: la §7 del
rebranding** — un ticket del super o el PDF del resumen del banco es texto que el usuario
no escribió. Cuesta una línea; ponerlo ahora evita tener que acordarse justo cuando importa.

**El JSON Schema se deriva**, no se escribe a mano: `z.toJSONSchema()` sobre el schema de
extracción (verificado: Zod 4.4.3 lo trae). Un schema escrito en paralelo se desincroniza
en el primer cambio y nadie se entera hasta que un campo llega y se descarta en silencio.

---

## Paso 4 — `extractPurchase()` y el transporte `fixture`

La función que compone: arma, llama, parsea, repara. Más un segundo transporte que **lee
respuestas de disco** en vez de llamar al proveedor.

**Para qué el `fixture`.** Que los tests corran la cadena entera —prompt, parseo,
reparaciones, Zod, prefill— **sin API key y sin red**. Es la forma de cumplir lo que el
`REBRANDING.md` pide (*"la llamada al modelo se mockea"*) sin mockear tan arriba que el
test no pruebe nada. Las fixtures salen gratis: son las respuestas reales de la corrida del
corpus.

Es la mecánica del transporte `exchange` de Qulmara con otro propósito. El propósito de
allá —correr el mismo prompt contra otro modelo para separar *"la guía está mal escrita"*
de *"el modelo no da la talla"*— **no aplica acá**: si la extracción falla contra un
resultado esperado, falla y punto.

---

## Paso 5 — El corpus y su runner

El banco de pruebas, construido **antes** de calibrar el prompt.

**Las cuatro decisiones que se copian de `evaluate_corpus`:**

1. **Corre el camino de producción, no una copia.** Llama al mismo `extractPurchase()` que
   llama la Server Action.
2. **`--dry-run` no toca ni proveedor ni base.** Imprime las dos mitades con su `sha256`.
   Es lo único que se puede correr sin key, y mide de paso lo que ninguna respuesta muestra:
   si el prefijo es idéntico llamada a llamada.
3. **Salida por campo, con fila de agregado.** Un fallo suelto es una frase difícil; una
   columna con 4/20 es un prompt que no explica ese campo, y dice cuál.
4. **Un caso por entrada**, con su etiqueta.

### La diferencia que juega a favor de CuotApp

Qulmara **se prohíbe** declarar el resultado esperado, a propósito: *"cuánto debería sacar
un reporte es la pregunta que el paso 5 responde"*. Acá esa restricción no existe —
*"compré una heladera en 12 cuotas de 45 mil"* tiene una respuesta objetivamente correcta.

**Entonces el corpus deja de ser una tabla para mirar y pasa a ser una suite de tests por
campo.** Es la mejor noticia de todo el análisis.

**Formato: un `.ts` tipado**, no YAML ni JSON. Así un error de tipeo en un nombre de campo
lo caza `tsc` en vez de aparecer disfrazado de fallo del modelo.

### Casos que el corpus tiene que tener sí o sí

- **"12 cuotas de 45 mil"** vs. **"45 mil en 12 cuotas"** — cuota contra total. El error más
  caro posible, y un factor de 12.
- **"12 cuotas sin interés"** → `financedTotal` ausente, no `0`.
- **"3 pagos de"**, **"3 cuotas"**, **"en 3"** — lo mismo dicho de tres formas.
- **Montos argentinos**: `45.000`, `45 lucas`, `45k`, `$45.000,50`.
- **Fechas relativas**: "ayer", "el martes pasado", "a fin de mes". La fecha de hoy tiene
  que estar **congelada** en el corpus o los tests fallan solos con el tiempo.
- **"la del Galicia"** con una tarjeta Galicia, con dos, y con ninguna (⇒ vacío + marcado).
- **Ambigüedad deliberada**: "compré una tele" ⇒ casi todo vacío.
- **Ruteo**: *"me suscribí a Spotify, 4200 por mes"* tiene que ir a `subscriptionSchema`.

---

## Paso 6 — Suscripciones y ruteo

El segundo schema de salida. El `REBRANDING.md` promete que es *"una sola feature con tres
salidas, no tres features"*; **este paso es donde esa promesa se verifica o se cae**.

---

## Errores de método (aplican a los pasos 5 en adelante)

Los tres que Qulmara aprendió a los golpes. Están acá porque son lo más caro de re-aprender:

1. **Medir la barra de ruido ANTES de creerle a una mejora.** El mismo texto exacto da
   resultados distintos entre corridas. Sin conocer ese piso, cualquier cambio "mejora" o
   "empeora" según el ruido. **Correr el corpus 3 veces sin tocar nada, primero.**
2. **Medir por campo, nunca por un agregado.** En Qulmara un ítem se movió 50 puntos
   mientras el score global se movía 4: el promedio divide el movimiento y deja que dos
   campos que se mueven en sentidos opuestos se cancelen. Corolario: **una corrida fallida
   se excluye, nunca se cuenta como cero.**
3. **El sesgo del corpus escrito por uno mismo.** Las frases que uno escribe pensando en el
   corpus salen bien formadas. Lo que la gente tipea apurada es *"heladera 12x45"*. A
   Qulmara este sesgo le costó un diagnóstico entero equivocado: concluyeron que una guía
   estaba rota cuando el corpus no contenía lo que esa guía preguntaba. **Hay que cosechar
   frases reales antes de dar la calibración por buena.**
4. **Una variable por vez.** El experimento del razonamiento va solo, antes de calibrar. Si
   cambia la calidad, hay que volver a medir la barra de ruido para esa configuración.

---

## Variables de entorno (se completan a medida que los pasos las agregan)

| Variable | Para qué |
|---|---|
| `LLM_API_KEY` | Credencial. **Vacía ⇒ la feature se oculta** (paso 7), nunca rompe |
| `LLM_BASE_URL` | Endpoint del proveedor (compatible con la API de OpenAI) |
| `LLM_MODEL` | En variable, **nunca incrustado**: a Qulmara el proveedor le dio de baja el alias del modelo por default y la primera llamada real habría fallado sin motivo aparente |
| `LLM_TIMEOUT_MS` | Presupuesto de una llamada. Sin reintentos automáticos, es el total |
| `LLM_EXTRA_BODY` | JSON mergeado al body: parámetros propios del proveedor (el razonamiento) |
| `LLM_PROVIDER` | `api` (default) o `fixture` (paso 4) |
