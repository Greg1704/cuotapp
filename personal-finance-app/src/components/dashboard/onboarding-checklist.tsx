import Link from "next/link";
import { Check } from "lucide-react";

import type { OnboardingFlags } from "@/server/lib/onboarding";
import { Button } from "@/components/ui/button";

type Step = {
  done: boolean;
  title: string;
  description: string;
  href: string;
  cta: string;
};

/**
 * Ventana principal para usuarios nuevos (0–1 pasos hechos): en lugar del dashboard,
 * una checklist con los pasos de alta. Server Component: solo lee `flags` y enlaza a
 * las páginas donde ya viven los formularios.
 */
export function OnboardingChecklist({
  name,
  flags,
}: {
  name: string;
  flags: OnboardingFlags;
}) {
  // Orden canónico: ingreso → gasto → tarjeta (ver `pendingStep` en server/lib/onboarding).
  // Ningún paso bloquea al siguiente: un gasto en efectivo o por transferencia no
  // necesita tarjeta, así que el primer movimiento se puede registrar sin tener una.
  const steps: Step[] = [
    {
      done: flags.hasIncome,
      title: "Configurá tu ingreso mensual",
      description: "Lo usamos para calcular tu disponible neto de cuotas.",
      href: "/configuracion",
      cta: "Configurar ingreso",
    },
    {
      done: flags.hasPurchases,
      title: "Registrá tu primer gasto",
      description: "En efectivo, por transferencia o con tarjeta: lo que hayas gastado.",
      href: "/compras",
      cta: "Registrar gasto",
    },
    {
      done: flags.hasCards,
      title: "Agregá tu primera tarjeta",
      description: "Cuando quieras cargar compras en cuotas, definí su ciclo de cierre y vencimiento.",
      href: "/tarjetas",
      cta: "Agregar tarjeta",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Hola{name ? `, ${name}` : ""} 👋
        </h1>
        <p className="text-muted-foreground text-sm">
          Bienvenido a CuotApp. Empezá por acá: no hace falta cargar una tarjeta para
          registrar tu primer gasto.
        </p>
      </header>

      <ol className="grid gap-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex items-center gap-4 rounded-xl border p-4">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                step.done
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
              }`}
              aria-hidden
            >
              {step.done ? <Check className="size-4" /> : i + 1}
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={`font-medium ${step.done ? "text-muted-foreground line-through" : ""}`}
              >
                {step.title}
              </p>
              <p className="text-muted-foreground text-sm">{step.description}</p>
            </div>

            {step.done ? (
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Listo
              </span>
            ) : (
              <Button asChild size="sm">
                <Link href={step.href}>{step.cta}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
