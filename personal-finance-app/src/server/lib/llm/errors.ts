/**
 * Taxonomía de fallas de la capa LLM.
 *
 * La distinción no es decorativa: decide **qué ve el usuario**. Un error transitorio
 * merece un botón "reintentar" (la misma frase, otra tirada); uno permanente no —
 * reintentar vuelve a fallar igual, así que se cae al formulario vacío sin molestar.
 *
 * (En Qulmara, el proyecto hermano, esta misma taxonomía decide si Celery reintenta
 * solo. Acá no hay cola: la extracción es síncrona y el usuario está mirando, así que
 * el destinatario de la decisión es la UI.)
 *
 * Los mensajes son de UI: van en español y **nunca nombran al proveedor** ni traen
 * stack trace. "No pude interpretarlo", no "DeepSeek devolvió 429".
 */
export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Falla que un reintento podría arreglar: timeout, rate limit, 5xx, JSON malformado. */
export class LLMTransientError extends LLMError {}

/** Falla que reintentar no arregla: sin credenciales, request rechazado, mala config. */
export class LLMPermanentError extends LLMError {}
