"use client";

import { useState } from "react";

import type { InstallmentStatus } from "@/generated/prisma/client";
import { last4Suffix } from "@/lib/card-view";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { INSTALLMENT_STATUS_META } from "./installment-status-meta";
import { useInstallmentMutations } from "./use-installment-mutations";

/**
 * Cuota del mes ya serializada para el cliente (regla rsc-y-payload): sin BigInt
 * ni Date crudos. Monto y vencimiento llegan formateados; `status` ya computado en
 * el server (incluye OVERDUE).
 */
export type MonthInstallmentView = {
  id: string;
  description: string;
  cardName: string;
  cardLast4: string | null;
  installmentNumber: number;
  totalInstallments: number;
  dueDate: string;
  amount: string;
  status: InstallmentStatus;
};

/**
 * Modal del dashboard para marcar/revertir las cuotas que vencen en el mes mostrado,
 * sin salir del resumen (RF-4.2/4.3). La lista viene del server; al marcar, el Server
 * Action revalida `/dashboard` y `router.refresh()` (vía el hook) actualiza estas
 * filas en vivo, sin cerrar el modal.
 */
export function MonthInstallmentsDialog({
  monthLabel,
  installments,
}: {
  monthLabel: string;
  installments: MonthInstallmentView[];
}) {
  const [open, setOpen] = useState(false);
  const mutations = useInstallmentMutations();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Gestionar cuotas
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="capitalize">Cuotas de {monthLabel}</DialogTitle>
          <DialogDescription>
            Marcá las cuotas que ya pagaste. Por defecto se descuentan de tu ahorro.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
          {installments.map((inst) => (
            <MonthInstallmentRow key={inst.id} inst={inst} mutations={mutations} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MonthInstallmentRow({
  inst,
  mutations,
}: {
  inst: MonthInstallmentView;
  mutations: ReturnType<typeof useInstallmentMutations>;
}) {
  const { isPending, markPaid, revert } = mutations;
  const meta = INSTALLMENT_STATUS_META[inst.status];
  const isPaid = inst.status === "PAID";
  const [fromSavings, setFromSavings] = useState(true);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 text-sm">
      <div className="grid min-w-0">
        <span className="truncate font-medium">{inst.description}</span>
        <span className="text-muted-foreground text-xs">
          {inst.cardName}{last4Suffix(inst.cardLast4)} · {inst.installmentNumber}/
          {inst.totalInstallments} · vence {inst.dueDate}
        </span>
      </div>
      <Badge variant={meta.variant} className={cn("ml-auto", meta.className)}>
        {meta.label}
      </Badge>
      <span className="font-medium whitespace-nowrap">{inst.amount}</span>
      {isPaid ? (
        <Button variant="ghost" size="sm" disabled={isPending} onClick={() => revert(inst.id)}>
          Revertir
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="accent-primary size-3.5"
              checked={fromSavings}
              onChange={(e) => setFromSavings(e.target.checked)}
            />
            De ahorros
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => markPaid(inst.id, fromSavings)}
          >
            Marcar paga
          </Button>
        </div>
      )}
    </div>
  );
}
