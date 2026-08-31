# REBRANDING — CuotApp

Notas de **rework** de la v1. No es un compromiso de alcance ni un orden cerrado: es el
registro de las ideas para revisar aspectos **base** del producto que, con la app ya
funcionando end-to-end, se ven flojos.

> Diferencia con `BACKLOG.md`: el backlog son **features nuevas** que se apoyan sobre lo
> que existe. Esto es **cambiar cómo funciona lo que ya existe**. Por eso vive aparte.

**Hilo conductor: la fricción de carga.** La app calcula bien, proyecta bien y testea
bien — pero pide demasiado para que la primera compra entre. Las dos ideas de abajo
atacan el mismo problema desde dos ángulos: **pedir menos** (tarjetas) y **pedir
distinto** (lenguaje natural).

---

## 1. Simplificar el alta de tarjetas

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

### Pregunta abierta

`closingDay` y `dueDay` son estructuralmente obligatorios, pero **tampoco son datos que
la gente sepa de memoria**. Un set de **defaults por banco** (o un "no lo sé, poné algo
razonable y lo ajusto después") podría bajar más la fricción que cualquier rediseño del
modal.

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
- **Costo:** una extracción así ronda ~1-2K tokens de entrada y ~150 de salida ⇒
  fracciones de centavo por carga, incluso con los modelos tope de gama. No es el
  problema; el problema es el abuso sin freno.
- **Latencia:** 1-3 s. No hace falta streaming (el JSON se necesita entero igual): alcanza
  un estado de "interpretando…" en el form.

### Preguntas abiertas

- **Qué modelo.** Es una decisión de costo/calidad, y conviene medirla con casos reales
  argentinos ("12 cuotas sin interés", "3 pagos de", montos con punto de miles) antes de
  fijarla. Los modelos más chicos pueden alcanzar de sobra para una extracción acotada.
- **Structured outputs vs. tool use.** Las dos formas de forzar un JSON con forma
  garantizada. Hay que elegir una y documentar por qué.
- **¿Chat o input único?** "Chat" sugiere ida y vuelta; para una extracción de un turno
  quizás alcance **un input y un resultado**, sin historial. Más simple, más barato, y
  probablemente mejor UX. El ida y vuelta solo se justifica para repreguntar lo faltante.
- **¿Y si no hay API key?** La feature tiene que **degradar sola** (ocultarse), no romper
  la app. Importa para que el repo siga siendo clonable y usable por cualquiera.

---

## Orden sugerido

1. **Tarjetas primero.** No por ser más fácil, sino porque la entrada por lenguaje
   natural necesita resolver "la del Galicia" contra las tarjetas del usuario: cuanto más
   liviano y temprano sea el alta de tarjetas, mejor funciona la IA encima.
2. **Entrada por lenguaje natural después**, empezando por compras (el schema más rico) y
   sumando suscripciones, que es el mismo mecanismo con otro schema de salida.

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
