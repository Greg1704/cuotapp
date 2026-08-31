# Brief de naming — para pasarle a un asistente con capacidad de investigación

Este archivo es el **prompt** a compartir en otra conversación (una con búsqueda web) para
resolver el nombre nuevo del producto. Contexto completo y autocontenido: quien lo lea no
conoce el proyecto. Ver `REBRANDING.md` § 3 para la decisión de identidad que lo motiva.

---

Necesito ayuda para elegir el nombre de un producto de software. Quiero que uses búsqueda
web para verificar colisiones y disponibilidad, no solo para generar ideas: la parte de
investigación es la que más me importa.

## El producto

Es una **app de finanzas personales para el mercado argentino**. Nació enfocada en un
problema puntual que ningún competidor cubre bien: el manejo de **compras en cuotas con
tarjeta de crédito** a lo largo del tiempo.

- Vista consolidada **multi-tarjeta** de las cuotas comprometidas a futuro, mes a mes.
- Su métrica central es el **"ingreso disponible neto de cuotas"**: cuánto de tu ingreso
  futuro ya está comprometido antes de que el mes empiece.
- Simulador previo a la compra: *"si compro esto en 12 cuotas, así queda mi flujo futuro"*.
- Soporta pesos argentinos y dólares.

Con el tiempo creció más allá de las cuotas. Hoy también modela: gastos con débito,
efectivo y transferencia; **ahorro** (saldo disponible proyectado mes a mes); y
**suscripciones / gastos recurrentes**. El tablero principal ya está organizado en **dos
ejes**: el crédito (deuda comprometida) y el ahorro (stock disponible).

Es un **proyecto de portfolio personal**: lo construyo para mostrar capacidad técnica y
hacer una transición de un rol de QA a uno full stack. O sea, el nombre va a estar en mi
CV, en el dominio que muestro en entrevistas y en el repositorio público. No es un
emprendimiento comercial con inversores ni presupuesto de marca — pero quiero que **no
parezca un proyecto de juguete**.

## El problema con el nombre actual

Hoy se llama **CuotApp**. Dos cosas fallan:

1. **El alcance superó al nombre.** La app ya no es solo sobre cuotas: maneja ahorro,
   suscripciones y medios de pago que no son crédito. El nombre quedó chico.
2. **El registro es informal.** El patrón "palabra + App" suena a proyecto de fin de
   cursada, no a producto. Quiero algo **más formal y más serio**.

## La decisión de fondo (importante para juzgar los nombres)

Hay un posicionamiento sin definir del todo, y el nombre depende de él:

- **Rama A — "app de cuotas con extras":** el eje ahorro es soporte; la identidad sigue
  siendo el manejo de compras en cuotas.
- **Rama B — "app de flujo de caja personal cuyo diferencial es que entiende cuotas como
  nadie":** el alcance real es todo el dinero que entra y sale, y las cuotas son la parte
  que hace mejor que la competencia.

**Me inclino por la rama B**, pero quiero ver candidatos de las dos antes de cerrarla. Para
cada nombre que propongas, decime **qué rama asume**.

## Criterios

- **Formal, sin ser acartonado.** Nada de diminutivos, sufijos `-App`, `-ly`, `-ify`, ni
  mezclas de inglés y castellano.
- **En castellano**, y que funcione en el **uso rioplatense**. Que no suene a marca
  extranjera genérica traducida.
- **Pronunciable y escribible al dictado.** Si te lo digo en voz alta en una entrevista,
  tenés que poder tipearlo bien al primer intento.
- **Que no encierre al producto en "cuotas"** si vamos por la rama B.
- Preferentemente **una sola palabra**. Un compuesto corto es aceptable si es muy bueno.
- **No debe sugerir que soy una entidad financiera regulada ni un prestamista.** La app no
  presta plata, no mueve fondos y no es un banco: es una herramienta de visualización y
  proyección. Un nombre que suene a financiera o a crédito rápido es un problema, tanto de
  percepción como potencialmente legal.

## Lo que ya consideré (evaluá esto también, no lo repitas a ciegas)

**Rama A:**
- **Plazo** — "compra en plazos" es el registro formal de "en cuotas". Conserva la
  identidad actual y sube el tono. Contra: encierra igual que hoy.

**Rama B:**
- **Margen** — la métrica central del producto *es* tu margen: lo que queda después de las
  cuotas comprometidas. Describe el producto sin describir el mecanismo.
- **Holgura** — el más preciso ("holgura financiera" = cuánto aire te queda), pero menos
  presente en el vocabulario activo de la gente.
- **Cadencia** — apunta al ritmo de los compromisos futuros (cuotas y suscripciones son,
  las dos, cadencia). El más "marca", pero el más indirecto.
- **Flujo** — el más literal y seguro; también el más genérico, con mucho producto
  financiero ya llamado así.

## Lo que necesito que investigues

Esta es la parte central del pedido. Para los candidatos (los míos y los tuyos):

1. **Colisiones con productos existentes**, sobre todo fintech y finanzas personales en
   **Argentina y Latinoamérica**, y también en **España** (compite por el mismo SEO en
   castellano). Nombres idénticos o confundibles.
2. **Marcas registradas.** Buscá en el registro de marcas de Argentina (INPI) y decime qué
   encontrás en las clases relevantes: **36** (servicios financieros), **42** (software /
   SaaS) y **9** (software). Si no podés consultar el registro directamente, decímelo
   explícitamente en vez de suponer.
3. **Dominios.** Estado de `.com`, `.com.ar` y `.app` para cada candidato, y si el nombre
   está libre como handle en redes. **No inventes disponibilidad**: si no la podés
   verificar, marcá el dato como no verificado.
4. **Connotaciones.** Que la palabra no tenga un doble sentido desafortunado ni una carga
   negativa en el uso rioplatense.
5. **Viabilidad de SEO.** Si es una palabra tan común del castellano que posicionarla sea
   imposible, quiero saberlo — aunque para un portfolio pese menos que para un negocio.

## Entregable

Una **shortlist de 5 a 8 nombres**, y para cada uno:

- Qué significa y por qué encaja con el producto.
- Qué rama de posicionamiento (A o B) asume.
- Riesgos de colisión encontrados, **con las fuentes**.
- Estado de dominios y marcas, distinguiendo claramente **lo que verificaste** de **lo que
  no pudiste verificar**.

Cerrá con una **recomendación única y un segundo lugar**, y explicá por qué en dos o tres
líneas cada uno. Si alguno de mis candidatos tiene un problema serio que yo no vi, decímelo
sin rodeos.

Respondé en **castellano rioplatense**. Priorizá precisión sobre cantidad: prefiero cinco
nombres bien investigados que veinte sin verificar.

## Dato de contexto (no lo investigues, es solo para que sepas que el cambio es viable)

Cambiar el nombre tiene un costo acotado y ya está relevado: hay que tocar el dominio
actual y su configuración, el remitente y las plantillas de los mails, dos variables de
entorno del deploy, los metadatos del sitio y los textos de la interfaz. No hay bloqueo
técnico — la decisión es puramente de producto y marca.
