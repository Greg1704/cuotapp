import { CreditCard } from "lucide-react";

import { requireUser } from "@/server/auth/session";
import { last4Suffix } from "@/lib/card-view";
import { prisma } from "@/server/db";
import {
  listActiveCards,
  listExpiredCards,
  listDeactivatedCards,
  getCardsUtilization,
} from "@/server/actions/cards";
import { formatExpiration } from "@/server/lib/dates";
import { formatMoney } from "@/server/lib/money";
import { toCardView } from "@/lib/card-view";
import { Button } from "@/components/ui/button";
import { CardFormDialog } from "@/components/tarjetas/card-form-dialog";
import { CardItem } from "@/components/tarjetas/card-item";
import { DeactivatedCardsDialog } from "@/components/tarjetas/deactivated-cards-dialog";
import { RenewCardDialog } from "@/components/tarjetas/renew-card-dialog";

export default async function TarjetasPage() {
  // Server Component: lee la DB directo, sin fetch ni API intermedia.
  const user = await requireUser();
  const [active, expired, deactivated, profile, utilization] = await Promise.all([
    listActiveCards(),
    listExpiredCards(),
    listDeactivatedCards(),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { defaultCurrency: true, trackCreditLimits: true },
    }),
    getCardsUtilization(),
  ]);

  const hasAny = active.length + expired.length + deactivated.length > 0;
  // Moneda principal del usuario (Configuración): preselección en el alta de tarjeta.
  const defaultCurrency: "ARS" | "USD" = profile?.defaultCurrency === "USD" ? "USD" : "ARS";
  // Con el seguimiento activo, el alta/edición de tarjeta muestra el campo de límite.
  const trackCreditLimits = profile?.trackCreditLimits ?? false;

  // Utilización por tarjeta, ya formateada para la barra (borde serializable).
  const utilByCard = new Map(
    utilization.map((u) => [
      u.cardId,
      {
        currency: u.currency,
        percent: u.percent,
        usedLabel: formatMoney(BigInt(u.usedCents), u.currency),
        limitLabel: formatMoney(BigInt(u.limitCents), u.currency),
      },
    ])
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mis tarjetas</h1>
          <p className="text-muted-foreground text-sm">
            Cada tarjeta define su ciclo de cierre y vencimiento.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {deactivated.length > 0 && (
            <DeactivatedCardsDialog cards={deactivated.map(toCardView)} />
          )}
          <CardFormDialog
            defaultCurrency={defaultCurrency}
            trackCreditLimits={trackCreditLimits}
            trigger={<Button>+ Nueva tarjeta</Button>}
          />
        </div>
      </header>

      {!hasAny ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <CreditCard className="size-8 text-muted-foreground" />
          <div>
            <p className="font-medium">Todavía no tenés tarjetas</p>
            <p className="text-muted-foreground text-sm">
              Agregá tu primera tarjeta para empezar a cargar compras en cuotas.
            </p>
          </div>
          <CardFormDialog
            defaultCurrency={defaultCurrency}
            trackCreditLimits={trackCreditLimits}
            trigger={<Button>+ Nueva tarjeta</Button>}
          />
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((card) => (
                <CardItem
                  key={card.id}
                  card={toCardView(card)}
                  utilization={utilByCard.get(card.id)}
                  trackCreditLimits={trackCreditLimits}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No tenés tarjetas activas.
            </p>
          )}

          {expired.length > 0 && (
            <section className="grid gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Vencidas
              </h2>
              <div className="grid gap-2">
                {expired.map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm opacity-75"
                  >
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      Vencida
                    </span>
                    <span className="font-medium">{card.name}</span>
                    <span className="text-muted-foreground">
                      {card.bank}{last4Suffix(card.last4)} · {formatExpiration(card.expirationDate)}
                    </span>
                    <div className="ml-auto">
                      <RenewCardDialog
                        card={{
                          id: card.id,
                          name: card.name,
                          bank: card.bank,
                          last4: card.last4,
                          // Las vencidas son siempre de crédito → expirationDate no es null.
                          expirationDate: card.expirationDate!,
                        }}
                        trigger={
                          <Button variant="outline" size="sm">
                            Renovar
                          </Button>
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </>
      )}
    </div>
  );
}
