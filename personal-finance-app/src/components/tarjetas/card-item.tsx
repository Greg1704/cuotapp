"use client";

import { CreditCard } from "lucide-react";

import type { CardView } from "@/lib/card-view";
import { cn } from "@/lib/utils";
import { findBank } from "@/lib/banks";
import { formatExpiration } from "@/server/lib/dates";
import { utilizationLevel } from "@/server/lib/card-utilization";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CardFormDialog } from "@/components/tarjetas/card-form-dialog";
import { DeactivateCardButton } from "@/components/tarjetas/deactivate-card-button";

/** Utilización ya calculada y formateada en el server (borde serializable). */
export type CardUtilization = {
  currency: string;
  percent: number;
  usedLabel: string;
  limitLabel: string;
};

/** Color de la barra según el nivel de utilización (mismo criterio que el dashboard). */
const BAR_CLASS: Record<ReturnType<typeof utilizationLevel>, string> = {
  ok: "bg-primary",
  warning: "bg-amber-500",
  over: "bg-destructive",
};

export function CardItem({
  card,
  utilization,
  trackCreditLimits = false,
}: {
  card: CardView;
  utilization?: CardUtilization;
  /** Propaga el flag al dialog de edición para mostrar el campo de límite. */
  trackCreditLimits?: boolean;
}) {
  // Banco conocido → color de fondo de marca; "Otro"/sin banco → neutro.
  const bank = findBank(card.bank);

  return (
    // TODO (futuro): ícono del banco en una esquina del header (bank.icon).
    <Card size="sm" className={cn(bank?.cardClass)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          {card.name}
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-1 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          {card.bank && <span className="text-foreground font-medium">{card.bank}</span>}
          {card.brand && <span>{card.brand}</span>}
          {card.last4 && <span>•••• {card.last4}</span>}
          <span className="ml-auto flex gap-1">
            {card.currencies.map((c) => (
              <span
                key={c}
                className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
              >
                {c}
              </span>
            ))}
          </span>
        </div>
        {card.owner && <p>Dueño: {card.owner}</p>}
        {card.type === "DEBIT" ? (
          <p>Débito · gasta contra tu saldo al instante</p>
        ) : (
          <>
            <p>
              Cierre día {card.closingDay} · Vence día {card.dueDay}
            </p>
            {/* El MM/AA es opcional: sin fecha cargada no mostramos la línea vacía. */}
            {card.expirationDate && (
              <p>Vto. tarjeta: {formatExpiration(card.expirationDate)}</p>
            )}
          </>
        )}

        {/* Utilización del límite: cuánto de la tarjeta está comprometido en cuotas. */}
        {utilization && (
          <div className="mt-1 grid gap-1">
            <div className="flex items-center justify-between text-xs">
              <span>Límite {utilization.currency}</span>
              <span className="text-foreground font-medium">
                {utilization.percent.toLocaleString("es-AR")}% usado
              </span>
            </div>
            <div
              className="bg-muted h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={Math.round(utilization.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={cn("h-full rounded-full", BAR_CLASS[utilizationLevel(utilization.percent)])}
                style={{ width: `${Math.min(utilization.percent, 100)}%` }}
              />
            </div>
            <p className="text-xs">
              {utilization.usedLabel} de {utilization.limitLabel}
            </p>
          </div>
        )}
      </CardContent>

      <CardFooter className="gap-2">
        <CardFormDialog
          card={card}
          trackCreditLimits={trackCreditLimits}
          trigger={
            <Button variant="outline" size="sm">
              Editar
            </Button>
          }
        />
        <DeactivateCardButton cardId={card.id} />
      </CardFooter>
    </Card>
  );
}
