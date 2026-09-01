"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarIcon } from "lucide-react";

import type { Card, Category } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import { last4Suffix } from "@/lib/card-view";
import {
  subscriptionSchema,
  type SubscriptionFormValues,
} from "@/lib/validation/subscription";
import {
  createSubscription,
  updateSubscription,
} from "@/server/actions/subscriptions";
import { currencyToCents, formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
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
  FormDescription,
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

const NO_CATEGORY = "__none__";

// DTO mínimo de tarjeta para el form (regla de payload RSC: no el row entero de Prisma).
export type SubscriptionFormCard = Pick<
  Card,
  "id" | "type" | "name" | "bank" | "last4" | "currencies"
> & { hasCreditLimit: boolean };
export type SubscriptionFormCategory = Pick<Category, "id" | "name">;

/** Valores para prefilear el form en modo edición. */
export type SubscriptionEdit = {
  id: string;
  name: string;
  amountValue: number;
  currency: "ARS" | "USD";
  paymentMethod: "CREDIT" | "DEBIT";
  cardId: string | null;
  categoryId: string | null;
  firstChargeDate: string; // ISO
  endDate: string | null; // ISO
  limitRateValue: number | null;
};

type Props = {
  cards: SubscriptionFormCard[];
  categories: SubscriptionFormCategory[];
  defaultCurrency: "ARS" | "USD";
  trackCreditLimits?: boolean;
  /** Si viene, el dialog opera en modo edición. */
  edit?: SubscriptionEdit;
  trigger: React.ReactNode;
};

export function SubscriptionFormDialog({
  cards,
  categories,
  defaultCurrency,
  trackCreditLimits = false,
  edit,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(edit);

  // Suscripción pendiente de cotización (submit en dos fases), igual que en compras.
  const [pendingPayload, setPendingPayload] = useState<SubscriptionFormValues | null>(null);
  const [rateInput, setRateInput] = useState("");

  const creditCards = cards.filter((c) => c.type === "CREDIT");
  const debitCards = cards.filter((c) => c.type === "DEBIT");

  const defaultValues: SubscriptionFormValues = {
    name: edit?.name ?? "",
    // `null` (no `undefined`) para el vacío: con `undefined`, el Controller de RHF vuelve a
    // caer en el defaultValue y "reinserta" el valor al intentar borrarlo (ver .claude/rules/ui.md).
    amount: edit?.amountValue ?? (null as unknown as number),
    currency: edit?.currency ?? defaultCurrency,
    paymentMethod: edit?.paymentMethod ?? "CREDIT",
    cardId: edit?.cardId ?? undefined,
    categoryId: edit?.categoryId ?? undefined,
    firstChargeDate: edit ? new Date(edit.firstChargeDate) : new Date(),
    endDate: edit?.endDate ? new Date(edit.endDate) : undefined,
    limitRate: edit?.limitRateValue ?? undefined,
  };

  const form = useForm<SubscriptionFormValues>({
    resolver: zodResolver(subscriptionSchema),
    defaultValues,
  });

  const paymentMethod = useWatch({ control: form.control, name: "paymentMethod" });
  const cardId = useWatch({ control: form.control, name: "cardId" });
  const isCredit = paymentMethod === "CREDIT";
  // Débito puede tener tarjeta (opcional) o ninguna; crédito la requiere.
  const methodCards = paymentMethod === "DEBIT" ? debitCards : creditCards;

  function onPaymentMethodChange(value: string) {
    form.setValue("paymentMethod", value as SubscriptionFormValues["paymentMethod"]);
    form.setValue("cardId", undefined);
  }

  function onCardChange(id: string) {
    form.setValue("cardId", id);
    const card = cards.find((c) => c.id === id);
    if (card) {
      const preferred = card.currencies.includes(defaultCurrency)
        ? defaultCurrency
        : (card.currencies[0] as "ARS" | "USD");
      form.setValue("currency", preferred);
    }
  }

  const selectedCard = cards.find((c) => c.id === cardId);
  // Con tarjeta, las monedas que opera; sin tarjeta (débito libre), ARS/USD.
  const currencyOptions: ("ARS" | "USD")[] = selectedCard
    ? (selectedCard.currencies as ("ARS" | "USD")[])
    : ["ARS", "USD"];

  async function submitPayload(payload: SubscriptionFormValues) {
    try {
      if (isEdit && edit) {
        await updateSubscription(edit.id, payload);
        toast.success("Suscripción actualizada");
      } else {
        await createSubscription(payload);
        toast.success("Suscripción creada");
      }
      form.reset(defaultValues);
      setPendingPayload(null);
      setOpen(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No pudimos guardar la suscripción. Intentá de nuevo."
      );
    }
  }

  async function onSubmit(raw: SubscriptionFormValues) {
    const payload: SubscriptionFormValues = {
      ...raw,
      cardId: raw.cardId || undefined,
      categoryId: raw.categoryId || undefined,
      endDate: raw.endDate || undefined,
    };

    // ¿Necesita cotización? Crédito + seguimiento activo + tarjeta con límite + moneda ≠
    // principal. El server revalida esta misma condición.
    const card = cards.find((c) => c.id === payload.cardId);
    const needsConversion =
      trackCreditLimits &&
      payload.paymentMethod === "CREDIT" &&
      !!card?.hasCreditLimit &&
      payload.currency !== defaultCurrency;

    if (needsConversion) {
      setRateInput(edit?.limitRateValue ? String(edit.limitRateValue) : "");
      setPendingPayload(payload);
      return;
    }
    await submitPayload(payload);
  }

  async function confirmConversion() {
    if (!pendingPayload) return;
    const rate = Number(rateInput);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error("Ingresá una cotización válida.");
      return;
    }
    await submitPayload({ ...pendingPayload, limitRate: rate });
  }

  const pendingRate = Number(rateInput);
  const convertedPreview =
    pendingPayload && Number.isFinite(pendingRate) && pendingRate > 0
      ? formatMoney(currencyToCents(pendingPayload.amount * pendingRate), defaultCurrency)
      : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) form.reset(defaultValues);
          setPendingPayload(null);
        }}
      >
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Editar suscripción" : "Nueva suscripción"}
            </DialogTitle>
            <DialogDescription>
              Un cargo mensual recurrente (Netflix, Spotify…). Se cobra cada mes el día del
              primer cobro y afecta tu disponible sin recargarlo a mano.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Netflix" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Medio de pago</FormLabel>
                    <Select value={field.value} onValueChange={onPaymentMethodChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="CREDIT">Crédito</SelectItem>
                        <SelectItem value="DEBIT">Débito</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cardId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Tarjeta{!isCredit && " (opcional)"}
                    </FormLabel>
                    {methodCards.length === 0 ? (
                      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                        No tenés tarjetas de {isCredit ? "crédito" : "débito"}. Agregá una en
                        Tarjetas.
                      </p>
                    ) : (
                      <Select value={field.value || undefined} onValueChange={onCardChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Elegí una tarjeta…" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {methodCards.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} · {c.bank}{last4Suffix(c.last4)} ({c.currencies.join("/")})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 items-start gap-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Monto mensual</FormLabel>
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
                              e.target.value === ""
                                ? (null as unknown as number)
                                : e.target.valueAsNumber
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
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Moneda</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={!!selectedCard && currencyOptions.length <= 1}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {currencyOptions.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c === "ARS" ? "ARS (pesos)" : "USD (dólares)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="firstChargeDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Fecha del primer cobro</FormLabel>
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
                          autoFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>
                      Define el día del cobro (ej. el 7 → se cobra el 7 de cada mes).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Baja (opcional)</FormLabel>
                    <div className="flex gap-2">
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              variant="outline"
                              className={cn(
                                "flex-1 justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 size-4" />
                              {field.value
                                ? `Hasta ${formatDate(field.value)}`
                                : "Activa (sin baja)"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={field.onChange}
                            autoFocus
                          />
                        </PopoverContent>
                      </Popover>
                      {field.value && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => field.onChange(undefined)}
                        >
                          Quitar
                        </Button>
                      )}
                    </div>
                    <FormDescription>
                      Deja de cobrarse desde el mes de la baja (incluido ese mes).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría (opc.)</FormLabel>
                    <Select
                      value={field.value || NO_CATEGORY}
                      onValueChange={(v) => field.onChange(v === NO_CATEGORY ? undefined : v)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>Sin categoría</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting
                    ? "Guardando…"
                    : isEdit
                      ? "Guardar cambios"
                      : "Crear suscripción"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Modal de conversión: suscripción de crédito en moneda distinta a la principal y
          tarjeta con límite. Pide la cotización (snapshot en Subscription.limitRate). */}
      <Dialog
        open={pendingPayload != null}
        onOpenChange={(o) => {
          if (!o) setPendingPayload(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cotización para el límite</DialogTitle>
            <DialogDescription>
              Esta suscripción es en {pendingPayload?.currency} pero tu límite de crédito está
              en {defaultCurrency}. Ingresá la cotización para sumarla al uso del límite.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="sub-limit-rate">
                1 {pendingPayload?.currency} = ? {defaultCurrency}
              </Label>
              <Input
                id="sub-limit-rate"
                type="number"
                inputMode="decimal"
                step="0.000001"
                min="0"
                placeholder="0,00"
                value={rateInput}
                onChange={(e) => setRateInput(e.target.value)}
                autoFocus
              />
            </div>
            {convertedPreview && (
              <p className="text-muted-foreground text-sm">
                El cobro impacta el límite como{" "}
                <span className="text-foreground font-medium">{convertedPreview}</span>.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingPayload(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmConversion} disabled={form.formState.isSubmitting}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
