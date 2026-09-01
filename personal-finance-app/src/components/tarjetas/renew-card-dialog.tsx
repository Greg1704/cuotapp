"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { renewCardSchema, type RenewCardValues } from "@/lib/validation/card";
import { last4Suffix } from "@/lib/card-view";
import { renewCard } from "@/server/actions/cards";
import { formatExpiration } from "@/server/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

/** Solo lo que el dialog usa (regla rsc-y-payload: DTO mínimo). */
export type RenewCardItem = {
  id: string;
  name: string;
  bank: string;
  last4: string | null;
  expirationDate: Date;
};

/** Enmascara la entrada a MM/AA mientras se tipea. */
function maskExpiration(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Sugerencia por defecto: mismo mes, +3 años (plazo típico de reemisión). */
function suggestedExpiration(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String((now.getFullYear() + 3) % 100).padStart(2, "0");
  return `${mm}/${yy}`;
}

export function RenewCardDialog({
  card,
  trigger,
}: {
  card: RenewCardItem;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const defaultValues: RenewCardValues = { expiration: suggestedExpiration() };

  const form = useForm<RenewCardValues>({
    resolver: zodResolver(renewCardSchema),
    defaultValues,
  });

  async function onSubmit(values: RenewCardValues) {
    try {
      await renewCard(card.id, values);
      toast.success("Tarjeta renovada");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No pudimos renovar la tarjeta.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) form.reset(defaultValues); // el modal abre siempre limpio
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renovar tarjeta</DialogTitle>
          <DialogDescription>
            Es la misma tarjeta: solo cambia el vencimiento. Las cuotas en curso
            siguen asociadas.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{card.name}</span>
          <span className="text-muted-foreground">
            {" "}
            · {card.bank}{last4Suffix(card.last4)} · vencía {formatExpiration(card.expirationDate)}
          </span>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="expiration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nuevo vencimiento (MM/AA)</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="08/29"
                      value={field.value}
                      onChange={(e) => field.onChange(maskExpiration(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Renovando…" : "Renovar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
