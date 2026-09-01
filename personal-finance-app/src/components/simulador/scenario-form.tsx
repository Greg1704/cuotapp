"use client";

import type { UseFormReturn } from "react-hook-form";
import { CalendarIcon, X } from "lucide-react";

import type { SimulatorFormValues } from "@/lib/validation/simulator";
import type { PurchasePlan } from "@/server/lib/purchase-plan";
import { formatMoney } from "@/server/lib/money";
import { formatDate, startOfToday } from "@/server/lib/dates";
import { cn } from "@/lib/utils";
import { last4Suffix } from "@/lib/card-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SimCard } from "./types";

const INSTALLMENT_OPTIONS = Array.from({ length: 60 }, (_, i) => i + 1);

type ScenarioFormProps = {
  form: UseFormReturn<SimulatorFormValues>;
  cards: SimCard[];
  plan: PurchasePlan | null;
  currency: string;
  /** Monedas que opera la tarjeta elegida; si hay más de una, se muestra el select. */
  currencyOptions: string[];
  onCurrencyChange: (c: string) => void;
  /** La compra es en otra moneda que el límite ⇒ pedir la cotización para proyectarlo. */
  showLimitRate?: boolean;
  /** Moneda del límite (la principal del usuario), para etiquetar el input de cotización. */
  limitCurrency?: string;
  title?: string;
  description?: string;
  /** Si se pasa, muestra una X para quitar este escenario (escenario B). */
  onRemove?: () => void;
};

export function ScenarioForm({
  form,
  cards,
  plan,
  currency,
  currencyOptions,
  onCurrencyChange,
  showLimitRate = false,
  limitCurrency = "ARS",
  title = "Compra hipotética",
  description = "Elegí la tarjeta, el monto y las cuotas; calculamos el impacto al instante.",
  onRemove,
}: ScenarioFormProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="grid gap-1.5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Quitar comparación"
              onClick={onRemove}
            >
              <X />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <FormField
              control={form.control}
              name="cardId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tarjeta</FormLabel>
                  <Select value={field.value || undefined} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Elegí una tarjeta…" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {cards.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} · {c.bank}{last4Suffix(c.last4)} ({c.currencies.join("/")})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Solo si la tarjeta opera más de una moneda: el usuario elige cuál simular. */}
            {currencyOptions.length > 1 && (
              <div className="grid gap-2">
                <Label>Moneda</Label>
                <Select value={currency} onValueChange={onCurrencyChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencyOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c === "ARS" ? "ARS (pesos)" : "USD (dólares)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 items-start gap-4">
              <FormField
                control={form.control}
                name="totalAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto total</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="0,00"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : e.target.valueAsNumber
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="totalInstallments"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cuotas</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(Number(v))}
                      value={String(field.value)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {INSTALLMENT_OPTIONS.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 items-start gap-4">
              <FormField
                control={form.control}
                name="financedTotal"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total con recargo (opc.)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="Sin interés"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : e.target.valueAsNumber
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fecha de compra</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {field.value ? formatDate(field.value) : "Elegí una fecha"}
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          // Simular una compra a futuro: no tiene sentido una fecha pasada.
                          disabled={{ before: startOfToday() }}
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Cotización para proyectar el límite cuando la compra es en otra moneda que la
                principal. No afecta el flujo de cuotas, solo la barra de utilización. */}
            {showLimitRate && (
              <FormField
                control={form.control}
                name="limitRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Cotización para el límite (1 {currency} = ? {limitCurrency})
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.000001"
                        min="0"
                        placeholder="0,00"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? undefined : e.target.valueAsNumber
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Resumen del plan: misma cuenta que el preview del form de compra. */}
            {plan && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {plan.rows.length} {plan.rows.length === 1 ? "cuota" : "cuotas"} de{" "}
                  {formatMoney(plan.rows[0].amountCents, currency)}
                  {plan.rows.length > 1 &&
                    plan.rows[plan.rows.length - 1].amountCents !==
                      plan.rows[0].amountCents &&
                    ` (última: ${formatMoney(
                      plan.rows[plan.rows.length - 1].amountCents,
                      currency
                    )})`}
                </p>
                <p className="text-muted-foreground">
                  Primer vencimiento: {formatDate(plan.rows[0].dueDate)}
                </p>
                {plan.hasSurcharge && (
                  <p className="text-muted-foreground">
                    Total a pagar: {formatMoney(plan.totalCents, currency)} · Recargo +
                    {plan.surchargePct.toFixed(1)}% · TEM ≈ {plan.tem.toFixed(1)}%/mes
                  </p>
                )}
              </div>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
