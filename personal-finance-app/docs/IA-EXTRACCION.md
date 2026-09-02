# IA — Extracción por lenguaje natural

Diseño de la sección 2 del `REBRANDING.md` (*"contame qué gastaste"*), derivado de lo que
ya está construido y **medido contra un proveedor real** en el proyecto hermano
**Qulmara**.

> **Por qué existe este documento.** Qulmara es un side project del mismo autor que tiene
> una pipeline LLM en producción-ish: prompt armado, validación, telemetría y **un período
> de pruebas documentado** (`docs/HALLAZGOS.md`, 15 hallazgos fechados con evidencia). No
> se trata de copiar código —son stacks distintos, Django/Celery contra Next.js— sino de
> **no volver a pagar los errores que allá ya se pagaron**. Varios de esos hallazgos
> contradicen supuestos que el `REBRANDING.md` da por buenos.

---

## 0. La buena noticia: la forma coincide

Qulmara se describe informalmente como "el backend del chatbot", pero **no es un chatbot**:
no tiene historial de conversación, ni turnos, ni memoria. Es una **extracción estructurada
de un turno** — entra un texto, sale un JSON con forma fija, se valida, se persiste.

Es exactamente la decisión que el `REBRANDING.md` §2 ya tomó para CuotApp:

> *"**Input único, no chat.** Es una extracción de UN turno: un campo de texto y un
> resultado, sin historial de conversación."*

Las dos pipelines son la misma pipeline con distinto contenido:

```
Qulmara:  reporte de bug   → [LLM] → JSON → parse_response() → EvaluationFinding (filas)
CuotApp:  "compré una       → [LLM] → JSON → schema.parse()   → prefill del form → el
           heladera en 12                                        usuario confirma → Server Action
           cuotas..."
```

La diferencia de fondo, que ordena todo lo que sigue: **Qulmara le pide al modelo un
juicio, CuotApp le pide una traducción.** "¿Qué tan bien escrito está este reporte?" no
tiene respuesta correcta; "¿cuántas cuotas dice esta frase?" sí. Esa diferencia hace que
varias piezas de Qulmara **no** hagan falta acá, y que una que allá es imposible —testear
con resultado esperado— acá sea trivial y valiosísima.

---

## 1. Qué se rescata, en una tabla

| Pieza de Qulmara | ¿Transfiere? | A qué se convierte en CuotApp |
|---|---|---|
| **Dos capas: transporte vs. dominio** | ✅ Directo | `src/server/lib/llm/` (agnóstico) + `src/server/lib/extraction/` (prompt + parse por schema) |
| **Corte `instructions` / `prompt`** (caching de prefijo) | ⚠️ Con matiz | Se hace igual porque es gratis, pero **no es la palanca de costo acá** (§4) |
| **Taxonomía `Transient` / `Permanent`** | ✅ Adaptado | Cambia el destinatario: allá decide si Celery reintenta, acá decide qué ve el usuario (§5) |
| **`max_retries=0` en el SDK** | ✅ Directo, y más fuerte | El usuario está mirando un spinner: cero reintentos automáticos (§5) |
| **Texto del usuario fuera del system message + delimitadores** | ✅ Directo | Y el **nonce** pasa de opcional a obligatorio antes de la foto/PDF (§6) |
| **Schema derivado de la configuración, no escrito a mano** | ✅ Directo | Derivarlo del Zod que ya existe, no reescribirlo (§3) |
| **"Reparar lo deducible, rechazar lo que habría que inventar"** | ✅ La regla; ❌ la tabla | Misma regla, tabla distinta: acá casi todo cae del lado "no inventes" (§7) |
| **Telemetría en la fila** (tokens, duración, modelo) | ✅ Y se le suma lo que allá falta | Tokens + **tasa de aceptación del prefill**, que es la única métrica de calidad (§8) |
| **`evaluate_corpus`** (banco de pruebas) | ✅ **La pieza más valiosa** | Corpus de frases argentinas, y acá **sí** con resultado esperado (§9) |
| **Los errores de método documentados** | ✅ Impagable | Ruido, sesgo del corpus propio, una variable por vez (§10) |
| **Thinking mode prendido por default** | 🔴 **Alerta** | Rompe dos supuestos del `REBRANDING.md`: costo y latencia (§2) |
| **Degradación sin API key** (cliente lazy) | ✅ Directo, y más fuerte | Acá la feature tiene que **ocultarse**, no fallar (§11) |
| Transporte `exchange` (corrida de referencia) | ❌ El propósito no aplica | Pero sí una variante `fixture` para los tests (§9) |
| Celery, `202` + polling, snapshot inmutable | ❌ No hace falta nada de eso | La extracción es síncrona y su resultado no se persiste (§12) |

---

## 2. Lo primero: dos supuestos del REBRANDING que Qulmara ya refutó

Esto va arriba de todo porque **cambia decisiones de producto**, no de implementación.

El `REBRANDING.md` §2 dice:

> *"**Costo:** una extracción así ronda ~1-2K tokens de entrada y ~150 de salida, y con el
> modelo chico elegido el costo por carga es despreciable."*
> *"**Latencia:** 1-3 s. No hace falta streaming."*

Qulmara midió las dos cosas contra `deepseek-v4-flash`, que es el modelo que el
`REBRANDING.md` elige, y **las dos quedaron mal**:

### El costo quedó corto ~5× (H-04)

| | Estimado | Medido |
|---|---|---|
| Output | ~900 tokens | **4.847** |
| Costo por evaluación | $0,0003 | **$0,00155** |
| Output como % del costo | ~80% | **88%** |

**La causa: `deepseek-v4-flash` razona por defecto.** Thinking mode arranca en `enabled` +
effort `high`, y esos tokens de razonamiento **se facturan como output** — la mitad cara.
El ~87% del output facturado es texto que nunca se ve.

### La latencia fue de 39-48 s, no de 1-3 s (H-05)

Misma causa: razonar cuesta tiempo. Con un timeout de 60 s, tres llamadas dieron 48.369 ms,
42.715 ms y 39.390 ms.

**Por qué esto importa más acá que allá.** Qulmara puede tolerar 40 s: responde `202` y el
usuario pollea. CuotApp §2 decidió explícitamente lo contrario —*"alcanza un estado de
'interpretando…' en el form"*— y la §5 quiere el input **global, siempre presente**. Un
input global que tarda 40 segundos no es un input global, es un formulario más lento que el
formulario.

### Qué hacer con esto

Se controla con dos perillas, ninguna de las cuales es parte del schema de OpenAI (van en
`extra_body`, la vía del SDK para parámetros del proveedor):

```ts
// apagado
extra_body: { thinking: { type: "disabled" } }
// o bajarlo sin apagarlo — niveles reales: low / high / max
reasoning_effort: "low"
```

**Decisión propuesta para CuotApp: arrancar con el razonamiento apagado, y medirlo.** El
argumento es distinto al de Qulmara y más fuerte: allá el modelo puntúa contra anclas
numéricas y es plausible que razonar ayude; acá el trabajo es *traducir una frase a campos
de un schema fijo*, que es la clase de tarea donde el razonamiento no compra nada.

**Pero hay que medirlo, no suponerlo**, y Qulmara dejó anotado exactamente qué mirar:

- **No solo tokens y latencia: también la tasa de fallas del validador.** Si apagar el
  razonamiento degrada la adherencia al JSON, el ahorro se paga en reintentos, y un
  reintento cuesta una llamada entera. Acá se paga peor todavía: el usuario lo ve.
- **No se sabe si hay interacción con `response_format: json_object`.** Nadie lo documentó.

**Consecuencia inmediata: actualizar el `REBRANDING.md` §2** cuando esto se mida. Los
números que hay ahí hoy son una estimación que un proyecto hermano ya desmintió sobre el
mismo modelo.

---

## 3. Las dos capas, y el schema derivado

Qulmara parte la pipeline en dos módulos con una regla dura:

| Módulo | Responsabilidad | Sabe de |
|---|---|---|
| `services/llm.py` | Transporte: cliente, errores, métricas | Nada del dominio |
| `bug_quality/evaluation.py` | Armado del prompt y validación | Todo del dominio, nada del SDK |

**El motivo no es purismo.** El prompt no vive en el transporte porque el proyecto tiene
un v2 planeado (`qa_docs`): si el prompt de v1 viviera ahí, la capa compartida tendría que
importar una app de negocio, y después dos. Es la misma razón exacta por la que en CuotApp
conviene separar: la §7 del `REBRANDING.md` (foto del ticket, **PDF del resumen**) y el
"agregá mi tarjeta del Galicia" son **más dominios sobre el mismo transporte**.

Traducción a este repo:

```
src/server/lib/llm/
  client.ts        // el único archivo que importa el SDK. Errores, métricas, timeout.
  types.ts         // LLMResponse, LLMError

src/server/lib/extraction/
  prompt.ts        // instructions (estático) + prompt (variable)
  parse.ts         // JSON crudo → valores del form, o campo vacío y marcado
  schema.ts        // el schema de EXTRACCIÓN (ver abajo)
  purchase.ts      // el dominio "compra"
  subscription.ts  // el dominio "suscripción" — mismo mecanismo, otra salida
```

Todo lo de `extraction/` es **función pura sobre datos planos**, con sus tests en Vitest;
lo único que se mockea es `client.ts`. Es lo que el `REBRANDING.md` ya pide (*"el LLM no se
come la cobertura del proyecto"*) y coincide con cómo está `src/server/lib/` hoy.

### El schema de respuesta se genera, no se escribe

En Qulmara `build_response_schema()` genera el JSON Schema **a partir del checklist activo**,
con una clave fija por ítem. El motivo está bien argumentado y aplica igual acá:

> *"las claves fijas hacen un trabajo que ninguna instrucción en prosa hace de forma
> confiable: el modelo no puede inventar un ítem, no puede saltearse uno, no puede devolver
> el mismo dos veces."*

Para CuotApp la versión correcta de esa idea es: **el JSON Schema que se le manda al modelo
se deriva del Zod que ya existe**, no se escribe a mano en paralelo. Un schema escrito a
mano se desincroniza con `purchaseSchema` en el primer cambio y nadie se entera hasta que
un campo llega y se descarta en silencio.

**Advertencia práctica, para que no sorprenda al implementar.** Zod 4 trae
`z.toJSONSchema()`, pero `purchaseSchema` **no es convertible tal cual**: tiene `z.date()`
(que JSON Schema no representa) y un `.superRefine()` (reglas cruzadas que tampoco). La
salida correcta no es pelearse con eso, es tener un **schema de extracción hermano**:

- Fechas como `string` ISO (`"2026-09-02"`), no `Date`.
- Montos en **unidades** (`45000`), nunca centavos — el `REBRANDING.md` ya lo decidió y
  `.claude/rules/dinero-y-fechas.md` lo exige: **la aritmética de plata no se delega a un
  modelo probabilístico**.
- Todos los campos **opcionales**, porque el resultado esperado de una frase ambigua es un
  campo faltante, no un campo adivinado.
- Sin reglas cruzadas: las valida `purchaseSchema` después, que sigue siendo la autoridad.

O sea: `extractionSchema` → normalización (fecha ISO → `Date`, unidades → el form) →
`purchaseSchema.safeParse()` → prefill. **La IA nunca se saltea la puerta que ya existe.**

---

## 4. El caching de prefijo: hacerlo, pero no venderlo como la palanca

Qulmara ordena el prompt para el caching: lo estático primero (`instructions` → mensaje
system), lo variable último (`prompt` → mensaje user). Los proveedores cachean por prefijo
común, y **el prefijo tiene que ser byte-idéntico**, no parecido: un ítem reordenado y el
hit es cero. Hay un test dedicado a custodiarlo
(`test_instructions_are_byte_identical_for_the_same_checklist`), con una justificación que
vale la pena robar textual:

> *"un refactor que reordene ítems destruye el ahorro **sin romper ningún comportamiento**
> y ningún otro test se enteraría."*

Funciona: medido, **98% de hit** una vez caliente el prefijo (H-06). Dato de yapa que
también sirve acá: **la granularidad del cache es de 128 tokens**, no "el prefijo" — así que
los últimos <128 tokens de la parte estática nunca cachean solos.

### El matiz, y es importante

**En CuotApp el caching rinde mucho menos, y conviene decirlo antes de diseñar alrededor.**
Dos razones:

1. **El prompt es un orden de magnitud más chico.** Qulmara cachea ~1.680-2.500 tokens de
   nueve guías de evaluación. Las reglas de extracción de CuotApp (convenciones argentinas,
   formato de salida) son unos cientos de tokens. Con el input cacheado a $0,0028 el millón,
   el ahorro absoluto es ruido.
2. **La lista de tarjetas y categorías del usuario es un problema de ubicación.** Es
   semi-estática (cambia poco) pero **distinta por usuario**, así que:
   - en `instructions` ⇒ cada usuario tiene su propio prefijo (cachea entre sus propias
     cargas, que es igual la mayoría del volumen);
   - en `prompt` ⇒ el prefijo estático es global, pero las tarjetas se pagan enteras siempre.

   Con la granularidad de 128 tokens y una lista de 3-5 tarjetas, **la diferencia es
   despreciable**. Recomendación: ponerla en la mitad variable, junto a la frase, porque ahí
   gana **la otra propiedad** del corte, que sí importa (§6).

**El ordenamiento se hace igual** —es gratis y es correcto— pero el argumento de costo real
en CuotApp es el mismo que en Qulmara resultó dominante: **el output**. Y en CuotApp el
output es chico *si el razonamiento está apagado* (§2). Ahí está la palanca, no en el cache.

---

## 5. Errores: la misma taxonomía, otro destinatario

Qulmara traduce las excepciones del SDK a dos clases propias, y esa distinción es la que
decide si Celery reintenta:

| Clase | Cuándo | En Qulmara |
|---|---|---|
| `LLMTransientError` | timeout, rate limit, 5xx, **JSON malformado** | Celery reintenta (5s, 10s, 20s) |
| `LLMPermanentError` | credenciales, request rechazado | Falla directo, sin quemar reintentos |

**En CuotApp no hay cola, así que la distinción cambia de destinatario: decide qué ve el
usuario.**

| Clase | Qué ve el usuario |
|---|---|
| Transitorio | *"No pude interpretarlo, probá de nuevo"* + botón **Reintentar**, con el texto intacto |
| Permanente (config) | La feature **no debería estar visible** (§11). Si igual pasa: caer al formulario vacío, en silencio |

### `max_retries: 0` transfiere, y el argumento acá es más fuerte

Qulmara apaga los reintentos del SDK con cuatro razones. La primera es la que más aplica:

> *"**El SDK es ciego a nuestra falla más probable.** Un 200 OK con JSON inservible [...] es
> un éxito para el SDK. El error nace en `parse_response`, aguas abajo de todo lo que el SDK
> ve."*

Y no es teórico: **pasó** (H-15, ~1,4% de las llamadas). La predicción se cumplió tal cual.

En CuotApp se suma una razón que allá no existe: **el usuario está mirando**. Tres reintentos
del SDK con backoff son tres veces la latencia con el spinner girando, sin decirle nada a
nadie. **Cero reintentos automáticos y un botón que el usuario aprieta si quiere** — que
además le da el control de gastarse la llamada o no.

### Dos cosas más del manejo de errores que conviene copiar tal cual

- **Nunca loguear la excepción del SDK completa.** Qulmara loguea solo el nombre de la clase,
  porque *"el SDK mete el body del request —que contiene todo el prompt— dentro del mensaje
  de algunas de sus excepciones"*. Acá ese body incluiría el gasto del usuario y los nombres
  de sus tarjetas, y `.claude/rules/seguridad.md` ya prohíbe loguear eso.
- **Los mensajes de error no nombran al proveedor.** *"No pude interpretarlo"*, nunca
  *"DeepSeek devolvió 429"*.

### Y una que a Qulmara le faltó (H-15), por si sirve de aviso

Cuando el parseo falla, `error_message` dice *"malformada"* pero **no guarda el cuerpo
crudo**, así que no se puede saber si fue JSON inválido, un campo faltante o un tipo
equivocado. Se anotaron ellos mismos: *"sin eso, la segunda ocurrencia va a ser igual de
opaca que la primera"*. En CuotApp: cuando el JSON no pasa Zod, **guardar el crudo** (en el
log de extracción de la §8, no en el log de texto). Es la única forma de arreglar un prompt.

---

## 6. Seguridad: el corte del prompt es una defensa, y el nonce tiene un disparador

La razón principal de mandar el texto del usuario en el mensaje **user** y las reglas en el
**system** no es el caching — es que *"deja el texto no confiable del usuario fuera del
mensaje que lleva las instrucciones"*. Ese es el efecto lateral que en CuotApp importa más
que el ahorro.

Qulmara además encierra el texto entre delimitadores constantes:

```python
REPORT_OPEN  = "<<<BUG_REPORT"
REPORT_CLOSE = "BUG_REPORT>>>"
```

Y documenta con honestidad que **son adivinables**, y por qué lo dejan así en v1: *"autor y
víctima son la misma persona [...] no hay datos de otro usuario que alcanzar ni herramientas
que el modelo pueda invocar, y nada aguas abajo que ejecute el output, así que todo el
exploit es auto-sabotaje"*. El fix es un **nonce aleatorio por llamada** en las dos vallas, y
es gratis **solo si va en la mitad variable** — en `instructions` rompería el prefijo
compartido en todas las llamadas.

**Lo interesante es el disparador que se anotaron:** el nonce deja de ser opcional *"una vez
que el texto viene de un tercero anónimo"* (para ellos, el webhook de GitHub).

**CuotApp tiene ese mismo disparador y está en el roadmap: la §7 del `REBRANDING.md`.** Un
ticket del super o el **PDF del resumen de la tarjeta** son texto que el usuario no escribió
— y un PDF de banco es un documento con estructura, texto embebido y potencialmente lo que
sea. El día que la pipeline acepte esas entradas, el texto deja de ser del usuario.

**Recomendación: poner el nonce desde el día uno.** Es literalmente `randomBytes(8).toString("hex")`
en las dos vallas, cuesta nada, y evita tener que acordarse en el momento exacto en que
importa. En Qulmara está pendiente porque el disparador todavía no llegó; acá el disparador
está en el orden sugerido del propio rebranding.

Lo demás ya está resuelto en el `REBRANDING.md` y coincide con lo que Qulmara hace: key
server-side, DTO mínimo (id + nombre) de tarjetas y categorías, y **decirlo en la UI**.

---

## 7. Validar la respuesta: la regla transfiere, la tabla no

Qulmara tiene una regla de una línea y la aplica sin excepciones:

> **El validador repara lo deducible y rechaza lo que habría que inventar.**

| Llega | Queda | Por qué es deducible |
|---|---|---|
| `score: 150` | `100` | La escala es 0-100 por definición |
| `severity: "catastrophic"` | `""` | El campo admite vacío: "no hay severidad" es representable |
| Un ítem que no pedimos | se ignora | Se itera el checklist, nunca las claves de la respuesta |
| Falta un ítem / `score` no numérico | ⛔ falla | Habría que inventarlo |

El razonamiento de por qué reparar en vez de rechazar también transfiere: *"la llamada ya se
pagó y ya tardó: descartar ocho hallazgos correctos por un valor que sabemos corregir es caro
y no compra nada"*.

**La regla es la correcta para CuotApp. La tabla es otra, y mucho más restrictiva**, porque
son datos de plata y porque el `REBRANDING.md` ya fijó el criterio:

> *"Si falta un dato clave [...], el resultado debe llegar **con ese campo vacío y marcado**,
> no adivinado."*

| Llega | Queda | Por qué |
|---|---|---|
| `currency: "pesos"` / `"$"` | `"ARS"` | Vocabulario, no dato: deducible sin ambigüedad |
| `paymentMethod: "credito"` | `"CREDIT"` | Ídem |
| `totalInstallments: 0` o `70` | **vacío + marcado** | Fuera del rango de `purchaseSchema` (1-60): no se clampea plata |
| `totalInstallments: 12.4` | **vacío + marcado** | No se redondea. Si el modelo dudó, que lo diga el form |
| `cardId` que no está en la lista del usuario | **vacío + marcado** | Alucinó una tarjeta; jamás se resuelve "por parecido" |
| `totalAmount` en centavos | **vacío + marcado** | Ambiguo e indistinguible de un monto grande legítimo |
| Un campo que no pedimos | se ignora | Mismo criterio: se itera el schema, no la respuesta |
| JSON que no parsea / no es objeto | ⛔ falla → transitorio | Ofrecer reintento |

**La diferencia con Qulmara en una línea: allá reparar de más cuesta un score levemente
equivocado; acá cuesta una fila de plata mal cargada.** Ante la duda, campo vacío — el
formulario ya sabe pedir lo que falta, que es justamente el argumento del `REBRANDING.md`
para no hacer un chat.

**El beneficio secundario que Qulmara descubrió también aplica:** *"una desviación repetida
en un ítem es la señal de que su guía se lee como escala en vez de como pregunta binaria"*.
Acá: si `currency` llega mal seguido, el prompt no está explicando bien las monedas.
Reparar en silencio sin contarlo tira esa información — **por eso el contador de reparaciones
va en la telemetría** (§8).

---

## 8. Telemetría: lo que Qulmara guarda, más lo que le faltó

`Evaluation` guarda `llm_model`, `prompt_tokens`, `cached_prompt_tokens`,
`completion_tokens`, `duration_ms`. El argumento es de una línea y es correcto:

> *"No presupuestar con estimaciones, presupuestar con telemetría."*

Que era literalmente cierto: la estimación quedó corta 5× (§2), y sin la medición nadie se
hubiera enterado.

**Recomendación para CuotApp: una tabla chica, `ExtractionLog`** — con una columna que
Qulmara no tiene y que acá es la más importante.

```prisma
model ExtractionLog {
  id          String   @id @default(cuid())
  userId      String
  kind        String   // "PURCHASE" | "SUBSCRIPTION" | ...
  model       String
  promptTokens     Int?
  completionTokens Int?
  cachedTokens     Int?
  durationMs       Int?
  // El estado del resultado: si parseó, si Zod lo aceptó, cuántos campos se repararon
  // y cuántos volvieron vacíos-y-marcados (§7).
  outcome     String
  fieldsFilled  Int
  fieldsMissing Int
  // LA columna que importa: ¿el usuario confirmó el prefill o lo descartó?
  accepted    Boolean?
  createdAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([createdAt])
}
```

**Nada del texto del usuario acá dentro** (`.claude/rules/seguridad.md`): la frase del gasto
no se persiste.

### Por qué `accepted` es la columna que justifica la tabla

Qulmara puede medir la calidad de su prompt porque **tiene un corpus con el que compararse**.
CuotApp en producción no: nadie sabe si `totalInstallments: 12` era correcto excepto el
usuario que estaba mirando. **Que confirme o descarte el prefill es la única señal de calidad
que la app va a tener en producción**, y es gratis de capturar porque la confirmación ya es
parte del flujo.

Sin eso, la pregunta "¿el prompt anda bien?" solo se puede responder en el laboratorio (§9), y
nunca con usuarios de verdad.

**Segundo uso, mundano pero real:** el rate limit. El `REBRANDING.md` decide reusar el freno
por IP + global de `demo.ts` (respaldado en la DB, serverless-safe, sin sumar Redis). Esta
tabla es exactamente el estado compartido sobre el que se cuenta — el mismo patrón, sin
infraestructura nueva.

---

## 9. El banco de pruebas: lo más valioso, y acá sale mejor que allá

Qulmara construyó `manage.py evaluate_corpus` **antes** de arrancar la validación del prompt,
y la justificación es transferible palabra por palabra:

> *"la API no sirve para medir (responde `202` y delega en un worker, así que comparar N
> reportes implica cuatro procesos y pollear cada uno)"*

En CuotApp el equivalente del problema es más chico pero igual de real: medir la calidad de la
extracción a través del formulario significa tipear frases a mano en un navegador y mirar
campos. No se puede comparar dos versiones de un prompt así.

### Las cuatro decisiones de diseño que valen

1. **Corre el camino de producción, no una copia.** Llama a las mismas dos funciones que la
   vista y el worker, en un proceso y sin broker. *"Una herramienta que armara su propio
   prompt validaría un prompt que nadie despacha."* En CuotApp: el script tiene que llamar
   al mismo `extractPurchase()` que llama la Server Action.
2. **`--dry-run` no toca ni el proveedor ni la base.** Imprime la mitad cacheable con su
   `sha256` y la mitad variable. *"Es lo único que se puede correr sin API key, y mide de paso
   lo que ninguna respuesta muestra — si el prefijo es idéntico llamada a llamada."*
3. **La tabla de salida tiene una fila de agregado, y ese es el punto.** *"Un score bajo suelto
   es un reporte malo; una columna con media 20 sobre un corpus que incluye reportes buenos es
   una guía mal escrita, y dice cuál."* En CuotApp: **una columna por campo** — si
   `totalInstallments` acierta 19/20 y `cardId` 4/20, el problema es cómo se le describen las
   tarjetas, no el prompt en general.
4. **Un archivo por caso**, el nombre del archivo es la etiqueta.

### La diferencia que juega a favor de CuotApp

Qulmara se prohíbe declarar el resultado esperado, **a propósito**:

> *"No hay forma de declarar el score esperado de un reporte, a propósito: cuánto debería
> sacar es la pregunta que el paso 5 responde, y congelarla en el formato del corpus antes de
> ver un solo resultado sería hornear la suposición que se quiere testear."*

**Esa restricción no existe acá.** "Compré una heladera en 12 cuotas de 45 mil con la del
Galicia" tiene una respuesta objetivamente correcta:

```yaml
# corpus/012-heladera-cuotas.yml
texto: "compré una heladera en 12 cuotas de 45 mil con la del Galicia"
espera:
  paymentMethod: CREDIT
  totalInstallments: 12
  totalAmount: 540000        # 12 × 45.000 — ojo: la frase da la CUOTA, no el total
  currency: ARS
  cardId: "@galicia"         # resuelto contra las tarjetas del fixture
  description: "heladera"
```

Es una extracción, no un juicio. **Entonces el corpus deja de ser una tabla para mirar y pasa
a ser una suite de tests de verdad**, con aciertos y fallos por campo — corrida a mano o en un
job aparte de CI (nunca en el `quality` de cada push: cuesta plata y depende de la red).

Y de paso resuelve la pregunta abierta del `REBRANDING.md`: *"conviene armar un set de frases
de prueba antes de dar la feature por terminada"*. Esta es la forma.

Casos que el corpus tiene que tener sí o sí, porque son los que el rebranding ya anticipa y
son trampas de verdad:

- **"12 cuotas de 45 mil"** vs. **"45 mil en 12 cuotas"** — cuota contra total. El error más
  caro posible, y un factor de 12.
- **"12 cuotas sin interés"** → `financedTotal` ausente, no `0`.
- **"3 pagos de"**, **"3 cuotas"**, **"en 3"** — la misma cosa dicha de tres formas.
- **Montos argentinos**: `45.000` (punto de miles), `45 lucas`, `45k`, `$45.000,50`.
- **Fechas relativas**: "ayer", "el martes pasado", "a fin de mes". *El modelo no sabe qué
  día es hoy* — hay que pasarle la fecha explícita, y el corpus tiene que congelarla o los
  tests fallan solos con el paso del tiempo.
- **"la del Galicia"** con una tarjeta Galicia, con dos, y con ninguna (⇒ vacío + marcado).
- **Ambigüedad deliberada**: "compré una tele" (sin monto, sin cuotas) ⇒ casi todo vacío.
- **Ruteo**: la misma pipeline tiene que mandar *"me suscribí a Spotify, 4200 por mes"* a
  `subscriptionSchema` y no a `purchaseSchema`.

### El `exchange` no transfiere, pero un `fixture` sí

Qulmara tiene un segundo transporte que lee respuestas de disco, para correr el mismo prompt
contra otro modelo y separar *"la guía está mal escrita"* de *"el modelo no da la talla"*. Esa
ambigüedad **no existe acá** (si la extracción falla contra un `espera`, falla y punto).

Pero la mecánica sirve para otra cosa: un transporte **`fixture`** que lee respuestas
guardadas hace que los tests de Vitest corran la cadena entera —prompt, parseo, reparaciones,
Zod, prefill— **sin API key y sin red**. Es la forma limpia de cumplir lo que el
`REBRANDING.md` ya pide (*"la llamada al modelo se mockea"*) sin mockear tan arriba que el
test no pruebe nada. Y las fixtures salen gratis: son las respuestas reales de la corrida del
corpus.

---

## 10. Los errores de método, que es lo más caro de re-aprender

Estos no son código. Son las tres cosas que Qulmara descubrió a los golpes y dejó anotadas.

### a) Medir la barra de ruido ANTES de atribuirle una mejora a un cambio (H-11)

**El mismo texto exacto da resultados distintos entre corridas.** Tres corridas idénticas
movieron 4 celdas de 99. Sin conocer esa barra, cualquier cambio de prompt "mejora" o
"empeora" según el ruido, y se termina persiguiendo fantasmas.

Aplicado a CuotApp: **antes de tocar el prompt, correr el corpus 3 veces sin cambiar nada.**
Los campos que se mueven solos marcan el piso; una mejora que no supere ese piso no es una
mejora. (Probable —y bueno— que con `temperature: 0` y razonamiento apagado la extracción sea
mucho más determinista que un juicio de calidad. Pero eso también hay que medirlo, no
suponerlo.)

### b) Medir por campo, nunca por un agregado global

Qulmara construyó `analyze_noise` **midiendo por celda**, con esta justificación:

> *"el global es el promedio truncado de nueve ítems, así que divide por nueve cualquier
> movimiento y deja que dos ítems que se mueven en sentidos opuestos se cancelen. Es lo que
> pasó de verdad: `scope` se movió 50 puntos mientras el global se movía 4."*

Aplicado: la métrica de CuotApp es **acierto por campo**, jamás "% de cargas correctas". Un
95% global puede ser `cardId` fallando el 100% de las veces.

Y el corolario: **una evaluación fallida se excluye, nunca se cuenta como cero.** Contarla
como cero fabrica un rango de 100 puntos a partir de una llamada que no devolvió nada, en la
herramienta cuyo único trabajo es distinguir movimiento real de ruido. Distinguir "no medido"
de "medido y estable".

### c) El sesgo del corpus escrito por uno mismo — el más caro

Qulmara escribió su corpus a mano, en bloques etiquetados, y se lo anotó como límite:

> *"está medido sobre reportes que escribimos nosotros, en bloques etiquetados que ningún QA
> escribe."*

**Y el sesgo se cobró una vez:** concluyeron que una guía estaba rota porque todo salía `low`,
cuando en realidad el corpus **no contenía lo que esa guía preguntaba**. Estaban juzgando una
guía con un corpus que no la ejercitaba.

Aplicado a CuotApp, y es directo: **las frases que uno escribe pensando en el corpus salen
bien formadas.** "Compré una heladera en 12 cuotas de 45 mil con la tarjeta del Galicia" es
una frase de laboratorio. Lo que la gente tipea en el celular apurada es *"heladera 12x45"* o
*"45 lucas heladera galicia 12 cuotas"*. Hay que **cosechar frases reales** —de uno mismo,
usando la app; de conocidos; de descripciones de gastos de MercadoPago— antes de dar la
calibración por buena.

### d) Una variable por vez

> *"El cambio es chico pero toca la firma del transporte, así que va como paso propio y no
> colgado de otra corrida: mezclarlo con una iteración de guías haría mover dos variables a
> la vez."*

Concretamente: **el experimento del razonamiento (§2) va solo**, antes de calibrar el prompt.
Si cambia la calidad de la extracción, hay que volver a medir la barra de ruido para esa
configuración.

---

## 11. Degradar sin API key

`REBRANDING.md` deja la pregunta abierta: *"¿Y si no hay API key? La feature tiene que degradar
sola (ocultarse), no romper la app."*

Qulmara resuelve la mitad: el cliente se instancia **lazy** y cacheado (`@lru_cache`), *"para
que importar este módulo no requiera una API key, y así el test suite y el arranque de Django
funcionen sin credenciales"*. Sin key, la primera llamada tira un `LLMPermanentError` con un
mensaje que apunta a `.env.example`.

Para CuotApp hace falta un escalón más, porque el requisito es **ocultar**, no fallar mejor:

- Una función de un renglón, `aiEnabled()` = `Boolean(process.env.LLM_API_KEY)`, evaluada en
  el **Server Component** que arma el layout. El input global (§5 del rebranding) sencillamente
  no se renderiza. Nada de un botón que al apretarlo avisa que no hay key.
- El cliente, lazy igual que allá, así los tests y `next build` no necesitan credenciales.
- El modelo **en variable de entorno**, no incrustado — el `REBRANDING.md` ya lo pide, y
  Qulmara tiene la anécdota que lo justifica: el default del repo apuntaba a un alias de
  modelo que DeepSeek dio de baja, *"o sea que la primera llamada real habría fallado sin
  motivo aparente"*.

**Aviso de contexto, del mismo `CLAUDE.md` de Qulmara:** DeepSeek anunció en agosto 2026 dos
aumentos (precios pico/valle de 2× en ciertas franjas, y una suba general "posiblemente
sustancial" sin tarifas ni fecha), y ya rompió su propia configuración una vez en tres
semanas. Nada de eso cambia la elección para CuotApp —a este volumen el precio es ruido— pero
**refuerza que el proveedor entero tenga que ser tres variables de entorno**, no una decisión
horneada en el código.

---

## 12. Lo que explícitamente NO hay que traer

Vale enumerarlo, porque es la mitad del código de Qulmara y traerlo sería sobre-ingeniería:

- **Celery, el `202`, el polling, el estado `pending`.** Existen porque una evaluación tarda
  40 s. Con el razonamiento apagado la extracción de CuotApp debería estar en el orden de
  segundos, y la Server Action puede devolver el resultado directo. Si —medido— la latencia
  no bajara lo suficiente, la conversación cambia; pero se decide con el número, no antes.
- **El snapshot inmutable de lo evaluado.** Existe porque en Qulmara *el historial es el
  producto* y un score de hace seis semanas tiene que seguir siendo explicable. En CuotApp el
  resultado de la extracción **es descartable por diseño**: o se convierte en fila vía la
  Server Action existente, o se tira.
- **El historial de N corridas sobre el mismo objeto.** Ídem.
- **El reintento manual desde una fila persistida.** Acá el reintento es el mismo botón sobre
  el mismo texto que sigue en el input.
- **La telemetría de cache como métrica de éxito.** Ver §4: el diseño se hace igual, pero medir
  el hit rate es un lujo que allá se justifica y acá no.

---

## 13. Orden propuesto

Encastra en el orden que ya tiene el `REBRANDING.md` (donde la IA es el punto 3, después del
onboarding y del alta de tarjetas):

| # | Paso | Depende de |
|---|---|---|
| 0 | **Medir el razonamiento** (§2): tres brazos, `disabled` / `low` / `high`, sobre 3-5 frases. Mirar tokens, latencia **y** adherencia al JSON | Solo una API key. **Va primero y va solo** |
| 1 | Transporte `llm/client.ts`: lazy, `maxRetries: 0`, taxonomía de errores, métricas, log que no filtra | 0 (define si va `extra_body`) |
| 2 | Dominio `extraction/`: schema de extracción derivado del Zod, `instructions`/`prompt`, normalización, tabla de reparaciones (§7) | 1 |
| 3 | **El corpus y su runner** (§9), con `--dry-run` y salida por campo | 2 |
| 4 | **Correr el corpus 3 veces sin tocar nada** → barra de ruido (§10a) | 3 |
| 5 | Recién ahí: calibrar el prompt, una variable por vez | 4 |
| 6 | La Server Action + el prefill + los campos marcados como "sugerido" | 2 |
| 7 | `ExtractionLog` + rate limit reusando el patrón de `demo.ts` (§8) | 6 |
| 8 | El input global (§5 del rebranding) | 6, 7 |

Los pasos 0 a 5 son **backend y laboratorio**: no tocan una sola pantalla y se pueden hacer
mientras las decisiones de identidad (§3 del rebranding) siguen abiertas.

---

## 14. Las tres cosas, si hubiera que quedarse con tres

1. **Medir el razonamiento antes que nada.** El `REBRANDING.md` presupone 1-3 s y costo
   despreciable; Qulmara midió 40 s y 5× el costo estimado sobre el mismo modelo, por una
   opción por omisión que nunca nadie eligió. Es el hallazgo que puede invalidar la UX de la
   §5 del rebranding (el input global), y se resuelve con un parámetro.
2. **Construir el banco de pruebas antes de calibrar el prompt, y medir el ruido antes de
   creerle a una mejora.** Es la disciplina que hace que la calibración sea ingeniería y no
   superstición — y acá sale mejor que en Qulmara, porque la extracción **sí** tiene resultado
   esperado y el corpus puede ser una suite de tests de verdad.
3. **La regla del validador: reparar lo deducible, rechazar lo que habría que inventar** — con
   la tabla corrida hacia "no inventes", porque son datos de plata. Es la traducción exacta de
   *"campo vacío y marcado, no adivinado"* a una regla que se puede testear.

---

## Fuentes

Todo lo citado sale del repo hermano, en estos archivos:

- `backend/services/llm.py` — transporte, taxonomía de errores, `max_retries=0`, métricas
- `backend/bug_quality/evaluation.py` — corte `instructions`/`prompt`, schema generado,
  validador que repara, delimitadores y la nota del nonce
- `backend/bug_quality/tasks.py` — lo que **no** hace falta acá (Celery, snapshot, reintentos)
- `backend/bug_quality/management/commands/evaluate_corpus.py` — el banco de pruebas
- `backend/bug_quality/management/commands/analyze_noise.py` — medir por celda, no global
- `docs/HALLAZGOS.md` — H-04 (razonamiento y costo), H-05 (latencia), H-06 (cache al 98% y la
  granularidad de 128 tokens), H-11 (barra de ruido), H-15 (respuesta malformada)
- `CLAUDE.md` §4.2 a §4.7 — las decisiones de arquitectura y su porqué
