# REBRANDING — CuotApp

Notas de **rework** de la v1. No es un compromiso de alcance ni un orden cerrado: es el
registro de las ideas para revisar aspectos **base** del producto que, con la app ya
funcionando end-to-end, se ven flojos.

> Diferencia con `BACKLOG.md`: el backlog son **features nuevas** que se apoyan sobre lo
> que existe. Esto es **cambiar cómo funciona lo que ya existe**. Por eso vive aparte.

**Hilo conductor: la fricción de carga.** La app calcula bien, proyecta bien y testea
bien — pero pide demasiado para que la primera compra entre. Casi todo lo de abajo ataca
ese mismo problema desde cuatro ángulos: **pedir menos** (tarjetas, sección 1), **pedir
distinto** (lenguaje natural, sección 2), **pedir después** (onboarding, sección 4) y
**pedir desde cualquier lado** (entrada global, sección 5). La sección 3 (identidad) es
la decisión que las ordena a todas, y la 6 (explicabilidad) es lo que sostiene la
confianza cuando la carga se vuelve automática. La 7 extiende la 2 a otros tipos de
entrada (foto del ticket, PDF del resumen).

---

## 1. Simplificar el alta de tarjetas

> **Estado: niveles 1 y 2 IMPLEMENTADOS.** `brand`, `owner`, `last4` y `expiration` salieron
> del alta: viven detrás del toggle *"Datos de la tarjeta (opcional)"* y ninguno es
> obligatorio (`last4` pasó a `String?` en la DB, migración `card_optional_last4`). El
> **nivel 3 queda como está por decisión**: el banco sigue siendo requerido y el límite en
> su lugar actual. El **nivel 4 está decidido pero no implementado** (defaults genéricos de
> ciclo, ver más abajo).
>
> Dos trampas que aparecieron al implementarlo, ya resueltas y con test:
> - El chequeo de duplicados era `banco + last4`, y **Prisma ignora un filtro cuyo valor es
>   `undefined`**: sin últimos 4 la consulta se reducía a "cualquier tarjeta de este banco"
>   y marcaba como duplicada la segunda tarjeta del mismo banco.
> - `listActiveCards` filtraba `OR: [débito, expirationDate >= hoy]`. Una tarjeta de crédito
>   **sin** MM/AA no matcheaba ninguna rama —ni la de vencidas— y desaparecía de la UI.

### El problema

El alta de una tarjeta de crédito muestra hoy **11 controles**: tipo, nombre, dueño,
banco, marca, últimos 4, vencimiento MM/AA, día de cierre, día de vencimiento, monedas
y —con el seguimiento de límites activo— límite de crédito.
`src/components/tarjetas/card-form-dialog.tsx` va por las 582 líneas.

### La separación que importa

No todos esos campos pesan lo mismo. Hay que distinguir **lo que el motor necesita** de
**lo que es identidad visual**:

| Campo | ¿Lo necesita el dominio? | Estado hoy |
|---|---|---|
| `type`, `closingDay`, `dueDay`, `currencies` | **Sí.** Sin esto `generateInstallments` no calcula nada | requeridos (ciclo, solo crédito) |
| `name` | Sí, mínimo para distinguir una tarjeta de otra | requerido |
| `bank` | No — etiqueta / color | **requerido** (`min(1, "Elegí un banco")`) |
| `last4` | No — etiqueta | **requerido** (`length(4)`) |
| `brand` | No — etiqueta | opcional |
| `expiration` (MM/AA) | No para las cuotas. Solo alimenta "tarjetas vencidas" y el flujo de renovación | **requerido en crédito** |
| `creditLimit` | No | ya es opt-in |

### Los dos peores ofensores: `last4` y `expiration`

Ambos obligan a **levantarse a buscar el plástico** para poder registrar la primera
compra. Es una barrera enorme en el primer minuto de uso, a cambio de features
secundarias (aviso de vencimiento, identificación visual entre dos tarjetas del mismo
banco).

### Propuesta

Partir el modal en dos:

- **Visible:** lo que el motor necesita — tipo, nombre, día de cierre, día de
  vencimiento, monedas.
- **Colapsable ("Detalles opcionales"):** banco, marca, últimos 4, MM/AA, límite.

Las features que dependen de esos datos se **activan solo si el usuario los cargó**
(misma filosofía que `User.trackCreditLimits`: opt-in, no obligación).

### Costo real (leer antes de estimar)

- `Card.bank` y `Card.last4` son **`String` NOT NULL** en Postgres. Aflojarlos **no es
  solo tocar Zod**: es una migración a `String?` más revisar todo lo que hoy los
  renderiza asumiendo que están (`card-item.tsx`, los DTO que cruzan a Client
  Components, los selects de tarjeta en compras y suscripciones).
- `expirationDate`, `closingDay` y `dueDay` **ya son nullables** en la DB (por el
  débito): ahí el cambio es solo de validación Zod + UI.
- La sección de **tarjetas vencidas / renovación** tiene que tolerar tarjetas sin MM/AA
  (hoy asume que crédito ⇒ hay vencimiento).

### Nivel 4 — defaults del ciclo (decidido, pendiente de implementar)

`closingDay` y `dueDay` son estructuralmente obligatorios —sin ciclo no hay cuotas— pero
**tampoco son datos que la gente sepa de memoria**.

**Decisión: defaults genéricos, cierre el 1 y vencimiento el 8, editables después.**

- **NO defaults por banco.** Los días de cierre y vencimiento no son uniformes por
  emisor: varían por producto y por cliente. Una tabla "Galicia cierra el 20" sería
  **inventar un dato financiero con apariencia de verdad**, que en una app de plata es
  peor que preguntarlo. Un default genérico es honesto: nadie lo va a confundir con el
  ciclo real de su tarjeta.
- Cierre 1 / vencimiento 8 mantiene la relación correcta (el vencimiento cae después del
  cierre, dentro del mismo mes) y respeta el supuesto de `generateInstallments` de que
  ambos días caen en la primera quincena, donde no hay riesgo de desborde en meses cortos
  (ver ARCHITECTURE.md → ajuste de día hábil).
- El usuario los edita cuando conozca los suyos, y las compras que cargue después se
  recalculan con el ciclo nuevo. **Ojo con lo ya cargado:** las cuotas se materializan al
  crear la compra, así que cambiar el ciclo NO reescribe las cuotas existentes. Definir al
  implementar si se avisa, se ofrece recalcular, o se deja como está.

---

## 2. Entrada por lenguaje natural — un punto común para compras y suscripciones

### La idea

En vez de completar un formulario de 10 campos, escribir lo que pasó:

> *"compré una heladera en 12 cuotas de 45 mil con la del Galicia"*
> *"me suscribí a Spotify, 4200 por mes, débito"*

…y que la app devuelva la carga **pre-completada** para que el usuario **confirme**.

### Por qué esto encaja y no es "pegarle un chatbot a la app"

Porque **el JSON que se quiere ya existe y ya tiene contrato**: `purchaseSchema` (Zod)
define exactamente la forma válida de una compra, y `subscriptionSchema` la de una
suscripción. El modelo no inventa un formato: llena uno que ya está escrito y testeado.

```
texto libre → [LLM] → JSON → schema.parse() → prefill del form → el usuario confirma → Server Action
```

Tres propiedades de este diseño, en orden de importancia:

1. **La IA nunca escribe en la base.** `createPurchase` / `createSubscription` siguen
   siendo la única puerta, con su validación Zod y su filtro por `userId` de sesión. Si
   el modelo alucina, Zod lo rechaza **antes** de que exista una fila. Respeta
   `.claude/rules/seguridad.md` sin excepciones: el LLM queda degradado a *parser de
   lenguaje natural*, nunca a autoridad.
2. **Es incremental.** No reemplaza el formulario: lo **pre-completa**. Si la IA falla,
   está caída o el usuario no la quiere, el flujo actual sigue intacto. Cero riesgo de
   quedar con una app que no se puede usar sin API key.
3. **No rompe el diferencial de testing.** Toda la parte determinista (resolver "la del
   Galicia" → `cardId`, "el martes pasado" → fecha, JSON validado → valores del form) va
   como **función pura en `src/server/lib/` con sus tests**; la llamada al modelo se
   mockea. El LLM no se come la cobertura del proyecto.

### El punto común (la parte que más entusiasma)

En vez de un chat por pantalla, **un solo punto de entrada**: *"contame qué gastaste"*.
El mismo mecanismo, con el schema de salida elegido según lo que el texto describa:

| Lo que dice el usuario | A dónde rutea |
|---|---|
| "compré X en N cuotas" | `purchaseSchema` → alta de compra |
| "me suscribí a X, tanto por mes" | `subscriptionSchema` → alta de suscripción |
| "pagué X en efectivo" | `purchaseSchema` con `paymentMethod = CASH` |
| (a futuro) "agregá mi tarjeta del Galicia" | `cardSchema` → alta de tarjeta |

Es **una sola feature** con tres salidas, no tres features. Y encaja con el modelo de
datos actual: compra y suscripción ya son entidades hermanas.

### Detalles que en la práctica salen mal (decidirlos de entrada)

- **Fechas relativas.** El modelo no sabe qué día es hoy: hay que pasarle la fecha
  actual explícita, o "ayer" y "el martes pasado" salen cualquier cosa.
- **Dinero.** Que devuelva el monto en **unidades** (`45000`), nunca en centavos, y que
  la conversión a `BigInt` la siga haciendo nuestro código. **No se le delega aritmética
  de plata a un modelo probabilístico** — es exactamente lo que prohíbe
  `.claude/rules/dinero-y-fechas.md`.
- **Contexto del usuario.** Para resolver "la del Galicia" hay que mandarle la lista de
  tarjetas y categorías (id + nombre, nada más — DTO mínimo, mismo criterio que
  `.claude/rules/rsc-y-payload.md`). Son datos del usuario saliendo hacia un tercero:
  **decirlo en la UI**.
- **Ambigüedad.** Si falta un dato clave (no dijo cuántas cuotas, o tiene tres tarjetas y
  no aclaró cuál), el resultado debe llegar **con ese campo vacío y marcado**, no
  adivinado. El form ya sabe pedir lo que falta: que lo pida.
- **Confianza visible.** Los campos que vinieron de la IA conviene marcarlos ("sugerido")
  para que confirmar no sea un acto de fe.

### Seguridad, costo y abuso

- La API key va **server-side** (`ANTHROPIC_API_KEY` en las env vars de Vercel), nunca en
  el cliente. La llamada vive en una Server Action / route handler, jamás en un Client
  Component.
- **El usuario demo público es un endpoint que cuesta plata por click.** Hace falta rate
  limit sí o sí — y el patrón ya está resuelto en el repo: el freno por IP + global
  respaldado en la DB de `src/server/actions/demo.ts`. Se reusa tal cual (serverless-safe,
  sin sumar Redis; ver la decisión en `ARCHITECTURE.md` → Redis).
- **Costo:** una extracción así ronda ~1-2K tokens de entrada y ~150 de salida, y con el
  modelo chico elegido el costo por carga es despreciable. El problema no es el costo
  unitario sino el **abuso sin freno** de un endpoint público.
- **Latencia:** 1-3 s. No hace falta streaming (el JSON se necesita entero igual): alcanza
  un estado de "interpretando…" en el form.

### Decisiones tomadas

- **Input único, no chat.** Es una extracción de UN turno: un campo de texto y un
  resultado, sin historial de conversación. Más simple, más barato y mejor UX que un chat.
  Lo que falte no se repregunta por chat: el resultado llega con ese campo **vacío y
  marcado**, y lo completa el formulario, que ya sabe pedir lo que falta.
- **Proveedor: DeepSeek, su modelo más chico.** La tarea es una extracción acotada a un
  schema fijo; no necesita un modelo grande, y el costo por carga es el argumento
  principal en una feature que se dispara en cada gasto que el usuario registre.
  - **Verificar el identificador exacto del modelo y su precio en la documentación de
    DeepSeek al momento de implementar** — su catálogo cambia y no conviene hardcodear un
    nombre de memoria. El modelo debe quedar en una **variable de entorno**, no incrustado
    en el código, para poder cambiarlo sin tocar la app.
  - **Verificar también la forma de forzar un JSON con estructura garantizada** que ofrezca
    su API (modo JSON, function calling, o pedirlo por prompt). De eso depende cuánta
    tolerancia a fallos hay que poner del lado nuestro. En el peor caso —el modelo devuelve
    algo malformado— la defensa ya está: `schema.parse()` lo rechaza y el usuario ve el
    formulario vacío, nunca un dato inventado.
  - **Implicancia de privacidad:** el texto del gasto y la lista de nombres de tarjetas y
    categorías del usuario salen hacia DeepSeek. Hay que decirlo en la UI (ya anotado
    arriba) y no mandar más que id + nombre.

### Preguntas abiertas

- **¿Y si no hay API key?** La feature tiene que **degradar sola** (ocultarse), no romper
  la app. Importa para que el repo siga siendo clonable y usable por cualquiera.
- **Calidad del prompt con frases argentinas reales** ("12 cuotas sin interés", "3 pagos
  de", montos con punto de miles, "la del Galicia"). Solo se puede medir con la key puesta
  y casos de verdad; conviene armar un set de frases de prueba antes de dar la feature por
  terminada.

---

## 3. Identidad: el nombre y el alcance ya no coinciden

**Este es el rebranding literal, y condiciona a todos los demás puntos.**

CuotApp nació para compras en cuotas. Hoy el modelo de datos incluye débito, efectivo,
transferencias, suscripciones y ahorro con ancla temporal; el dashboard está armado
explícitamente **"por ejes"** (crédito y ahorro). La sección se llama "Compras" pero
guarda gastos que no son compras a crédito. **La app se volvió más grande que su nombre
y todavía se presenta con el nombre viejo.**

Hay una decisión de posicionamiento que ordena todo lo demás:

- **App de cuotas con extras** ⇒ el eje ahorro es soporte y la navegación actual tiene
  sentido como está.
- **App de flujo de caja personal cuyo diferencial es que entiende cuotas como nadie**
  ⇒ cambia la jerarquía entera (navegación, dashboard, onboarding).

Dato no menor: el punto común de entrada por lenguaje natural (sección 2) se enuncia
como *"contame qué gastaste"*, no *"qué compraste en cuotas"* — **ya asume la segunda
lectura**. Conviene tomar la decisión de forma consciente antes de rediseñar pantallas,
porque define si los puntos 4 y 5 son mejoras o contradicciones.

### Nombre

Decisión tomada: **el nombre nuevo debe ser más formal** que "CuotApp". El candidato
concreto queda pendiente. Criterios a respetar cuando se elija:

- Que no encierre al producto en "cuotas" si la lectura elegida es la de flujo de caja.
- Que funcione en el mercado argentino sin sonar a marca extranjera genérica.
- Que sobreviva al portfolio: es el nombre que va a estar en el CV y en el dominio.

El brief completo para resolverlo (contexto, candidatos ya evaluados y qué investigar:
colisiones, marcas en INPI, dominios) está en **`docs/NAMING-BRIEF.md`**, listo para
pasarle a un asistente con búsqueda web.

Impacto técnico del renombre (acotado, pero hay que listarlo): dominio actual
`cuotapp.gfirm.dev` y su configuración (`docs/SETUP-DOMINIO.md`), remitente y plantillas
de mails (`docs/SETUP-EMAILS.md`, `src/server/email/`), `BETTER_AUTH_URL` /
`NEXT_PUBLIC_APP_URL` en Vercel, metadatos del layout raíz, y los textos de la UI. El
nombre del paquete (`personal-finance-app`) y el del repo son cosméticos y pueden quedar.

---

## 4. La barrera de la primera tarjeta es artificial

**El motor es más flexible que el onboarding que lo envuelve.**

`purchaseSchema` **ya permite** registrar efectivo y transferencia sin ninguna tarjeta
(`cardId` solo es requerido para `CREDIT`/`DEBIT`). Pero `pendingStep()` en
`src/server/lib/onboarding.ts` impone el orden canónico **ingreso → tarjeta → compra**, y
`shouldShowChecklist()` reemplaza el dashboard por el checklist mientras haya menos de 2
pasos hechos.

Resultado: el producto **exige cargar una tarjeta** —el formulario de 11 campos de la
sección 1— antes de dejar registrar un gasto que **no necesita tarjeta**.

**Rework:** invertir el orden canónico a **ingreso → primer gasto → tarjeta** (la tarjeta
cuando el usuario quiera cuotas, que es cuando recién ahí el ciclo importa). Alguien
puede empezar a usar la app en 20 segundos y sumar la tarjeta cuando le sirva.

- **Esfuerzo:** bajo. `onboarding.ts` es una función pura ya testeada: cambia el orden y
  se ajustan sus tests, más los textos del checklist y del banner.
- **No depende de la IA.** Se puede hacer ya.

---

## 5. Nada en la navegación es una acción

Los 7 items del sidebar (`src/components/layout/app-sidebar.tsx`) son todos **lugares**:
Dashboard, Tarjetas, Compras, Suscripciones, Calendario, Simulador, Configuración.

Para registrar una compra hay que navegar a `/compras`: `PurchaseFormDialog` se monta
**únicamente** ahí. Para una suscripción, a `/suscripciones`.

Si el punto común de la sección 2 existe, **tiene que ser global**: un input siempre
presente en el layout del dashboard, un `⌘K`, o un botón flotante en mobile. Un punto
común escondido dentro de una sección no es un punto común — es un cuarto formulario.

Es lo que hace que la idea rinda de verdad: la app deja de ser *"un lugar donde
consulto"* y pasa a *"un lugar donde anoto"*. El rebranding se percibe en el primer
segundo de uso.

---

## 6. Explicabilidad: volver visible la precisión que ya existe

La app deriva la TEM por bisección, reparte los centavos sobrantes para que la suma de
cuotas cierre exacta, y corre al lunes los vencimientos que caen fin de semana. **Nada de
eso se explica en la UI.**

Un "¿por qué esta fecha?" / "¿por qué este monto de cuota?" en el detalle de compra
cuesta poco y hace dos cosas:

- **Para el usuario:** genera confianza en los números.
- **Para el portfolio:** muestra el dominio que hoy está enterrado en `installments.ts` y
  `dates.ts` y no se ve desde afuera.

Con la IA pre-completando campos (sección 2) la explicabilidad **pasa de lindo a
necesario**: si algo se completó solo, el usuario necesita ver por qué.

- **No depende de la IA** para empezar, pero se vuelve obligatoria cuando la IA exista.

---

## 7. La misma pipeline con otras entradas: foto y PDF

Extensión de la sección 2, no una feature aparte. El pipeline
`entrada → [modelo] → JSON → Zod → confirmar` **no depende de que la entrada sea texto
tipeado**: los modelos reciben imágenes y documentos igual que texto. Cambia el tipo de
entrada; el resto de la cadena queda idéntica (mismos schemas, misma validación, misma
confirmación, mismas Server Actions).

| Entrada | Ejemplo | Salida |
|---|---|---|
| Texto | *"compré una heladera en 12 cuotas"* | 1 compra pre-completada |
| **Foto** | foto del ticket del super | 1 compra pre-completada |
| **PDF** | resumen de la tarjeta del mes | **N** compras pre-completadas |

Las dos primeras son la misma feature con otro botón. La tercera es la interesante.

### Por qué esto abarata el ítem #3 del backlog

`BACKLOG.md` #3 es **"Import de resumen (CSV/PDF)"**. Escrito como parser tradicional es
un trabajo feo y frágil: cada banco tiene su formato y cuando rediseñan el PDF se rompe.
Con extracción por modelo, ese ítem pasa a ser **"tirale el PDF"**, reusando exactamente
la pipeline que ya se construyó para el texto.

Es decir: la feature de IA no solo resuelve la carga manual — **abarata una feature del
backlog que hoy parece cara**. Ese es el argumento más fuerte para construir la pipeline
bien desde el principio (schemas como contrato, extracción separada de la confirmación),
en vez de atarla al caso "una compra por vez".

### Las dos advertencias

- **N compras ⇒ otra UI.** Un resumen trae muchos movimientos de golpe: la confirmación
  deja de ser un formulario pre-completado y pasa a ser una **lista revisable** (aceptar
  / editar / descartar por fila, y detectar duplicados contra lo ya cargado). Es bastante
  más trabajo de UI del que sugiere "tirale el PDF".
- **Costo por request.** Un PDF entero pesa muchísimo más que una frase. Acá el freno por
  IP + global de `demo.ts` no alcanza como único control: conviene además un límite de
  tamaño/páginas y, si hace falta, dejar el import fuera del usuario demo público.

### Orden

Va **después** de que el texto funcione end-to-end. Si la pipeline está bien separada,
sumar foto es chico; sumar PDF es la lista revisable, que es casi una pantalla nueva.

---
## Para analizar más adelante

### Simulador y alta de compra: ¿el mismo flujo?

> **Estado: NO decidido. Analizar recién DESPUÉS de que el chatbot esté hecho.** El
> simulador se mantiene como está: es una feature que funciona y que se quiere conservar.

Observación que dispara el análisis: `simulatorSchema` es hoy un **subconjunto exacto**
de `purchaseSchema`.

| Campos | Simulador | Compra |
|---|---|---|
| `cardId`, `currency`, `totalAmount`, `totalInstallments`, `purchaseDate`, `financedTotal`, `limitRate` | sí | sí |
| `paymentMethod`, `description`, `merchant`, `categoryId`, `notes` | — | sí |

La diferencia no es de datos, es de **tiempo verbal**: *"si compro esto en 12 cuotas"* vs.
*"compré esto en 12 cuotas"*.

La hipótesis a evaluar después del chatbot es si conviene un flujo único
(escribir → ver el impacto proyectado → **Guardar** o **Descartar**), que convertiría al
simulador en el paso de confirmación de toda compra a crédito — "la app te muestra el
daño antes, siempre", no después.

**Por qué se difiere:** el chatbot va a cambiar cómo entra la información a los dos
formularios. Recién con esa pieza construida se puede ver si la unificación simplifica o
si rompe una feature que hoy tiene valor propio.

---
## Orden sugerido

**Primero, sin escribir código:** tomar la decisión de identidad (sección 3). Define si
los puntos 4 y 5 son mejoras o contradicciones, y de qué lado cae el nombre nuevo.

Después, en este orden:

1. **Invertir el onboarding** (sección 4). Mejor relación valor/esfuerzo de la lista, no
   depende de nada más y ataca la barrera del primer minuto.
2. **Simplificar el alta de tarjetas** (sección 1). Va antes que la IA porque la entrada
   por lenguaje natural necesita resolver "la del Galicia" contra las tarjetas del
   usuario: cuanto más liviano y temprano sea el alta, mejor funciona la IA encima.
3. **Entrada por lenguaje natural** (sección 2), empezando por compras (el schema más
   rico) y sumando suscripciones, que es el mismo mecanismo con otro schema de salida.
4. **Hacerla global** (sección 5) — no tiene sentido antes de que el punto común exista.
5. **Explicabilidad** (sección 6). Se puede adelantar en cualquier momento; se vuelve
   obligatoria una vez que la IA pre-completa campos.
6. **Otras entradas: foto y PDF** (sección 7), una vez que el texto funcione end-to-end.
   Es la extensión que además destraba el ítem #3 del backlog.

Al final del recorrido, retomar el análisis diferido del simulador.

### Qué NO depende de la IA

Las secciones **4** (onboarding), **6** (explicabilidad) y buena parte de la **1**
(tarjetas) se pueden hacer ya, sin API key ni proveedor definido. Es el camino para
avanzar mientras las decisiones de la sección 2 siguen abiertas.

---

## Otros pendientes detectados (no son parte del rework)

Registrados acá para no perderlos; son deuda de documentación, no de producto:

- **`README.md` de la raíz dice solo "Prueba inicial"** y el de `personal-finance-app/`
  sigue siendo el boilerplate de `create-next-app`. Es la primera pantalla que ve
  cualquiera que entre al repo, y contrasta con la calidad de `docs/PROJECT_BRIEF.md`.
- **`MAPA-PROYECTO.md` quedó desactualizado:** describe `dashboard/page.tsx` como
  "placeholder", habla de `Card.currency` en singular (hoy es `currencies`) y no menciona
  `src/server/queries/`, ahorros ni suscripciones.
- **9 warnings de lint** (`_a` sin usar) en `src/server/lib/demo-data.test.ts`.
