"use client";

import { useState, useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CalendarIcon } from "lucide-react";

import type { Card, Category } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import { purchaseSchema, type PurchaseFormValues } from "@/lib/validation/purchase";
import { createPurchase } from "@/server/actions/purchases";
import { buildPurchasePlan } from "@/server/lib/purchase-plan";
import { currencyToCents, formatMoney } from "@/server/lib/money";
import { formatDate } from "@/server/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const INSTALLMENT_OPTIONS = Array.from({ length: 60 }, (_, i) => i + 1);
/** Centinela para "Sin categoría" (un Select de Radix no admite value=""). */
const NO_CATEGORY = "__none__";

// Solo los campos que el formulario realmente usa. Pasar el objeto Card/Category
// completo a este Client Component infla el payload RSC y, con varias instancias
// en la página, el serializador de Next (dev) deja de renderizar algunas.
export type PurchaseFormCard = Pick<
  Card,
  "id" | "type" | "name" | "bank" | "last4" | "currencies" | "closingDay" | "dueDay"
> & {
  /**
   * Si la tarjeta tiene límite de crédito cargado. Deriva de `creditLimitCents != null`
   * en el server (no cruzamos el BigInt al cliente). Con el seguimiento activo, dispara el
   * modal de conversión cuando la compra es en otra moneda que la principal del usuario.
   */
  hasCreditLimit: boolean;
};
export type PurchaseFormCategory = Pick<Category, "id" | "name">;

type Props = {
  cards: PurchaseFormCard[];
  categories: PurchaseFormCategory[];
  /** Moneda principal del usuario (Configuración): default de la compra. */
  defaultCurrency: "ARS" | "USD";
  /** Seguimiento de límite de crédito activo: habilita el modal de conversión. */
  trackCreditLimits?: boolean;
  trigger: React.ReactNode;
};

export function PurchaseFormDialog({
  cards,
  categories,
  defaultCurrency,
  trackCreditLimits = false,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  // Compra pendiente de cotización: se llena cuando la compra a crédito es en otra moneda
  // que la principal y la tarjeta tiene límite (submit en dos fases). Abre el modal de
  // conversión; al confirmar con la tasa se envía. null = no hay conversión pendiente.
  const [pendingPayload, setPendingPayload] = useState<PurchaseFormValues | null>(null);
  const [rateInput, setRateInput] = useState("");

  const creditCards = cards.filter((c) => c.type === "CREDIT");
  const debitCards = cards.filter((c) => c.type === "DEBIT");

  /**
   * Medio de pago inicial: crédito si hay tarjeta de crédito, débito si solo hay de
   * débito, y efectivo si no hay ninguna. El onboarding ya no exige cargar una tarjeta
   * antes del primer gasto (ver `pendingStep` en server/lib/onboarding), así que el
   * form no puede abrir en un medio de pago que ese usuario no está en condiciones de
   * completar: abriría directo en el cartel de "no tenés tarjetas".
   */
  const initialPaymentMethod: PurchaseFormValues["paymentMethod"] =
    creditCards.length > 0 ? "CREDIT" : debitCards.length > 0 ? "DEBIT" : "CASH";

  const defaultValues: PurchaseFormValues = {
    paymentMethod: initialPaymentMethod,
    cardId: undefined,
    categoryId: undefined,
    description: "",
    merchant: "",
    totalAmount: undefined as unknown as number,
    currency: defaultCurrency,
    totalInstallments: 1,
    purchaseDate: new Date(),
    financedTotal: undefined,
    notes: "",
  };

  const form = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues,
  });

  const paymentMethod = useWatch({ control: form.control, name: "paymentMethod" });
  const isCredit = paymentMethod === "CREDIT";
  const needsCard = paymentMethod === "CREDIT" || paymentMethod === "DEBIT";
  const methodCards = paymentMethod === "DEBIT" ? debitCards : creditCards;

  // Al cambiar de medio de pago, limpiamos lo que no aplica: tarjeta, cuotas (pago
  // único) y recargo. Transferencia/efectivo no heredan moneda de una tarjeta.
  function onPaymentMethodChange(value: string) {
    form.setValue("paymentMethod", value as PurchaseFormValues["paymentMethod"]);
    form.setValue("cardId", undefined);
    if (value !== "CREDIT") {
      form.setValue("totalInstallments", 1);
      form.setValue("financedTotal", undefined);
    }
    if (value === "TRANSFER" || value === "CASH") {
      form.setValue("currency", defaultCurrency);
    }
  }

  // Al elegir tarjeta, la moneda default es la principal del usuario si la tarjeta la
  // opera; si no, la primera de la tarjeta. Con varias (ej. ARS y USD) se puede cambiar
  // en el select.
  function onCardChange(cardId: string) {
    form.setValue("cardId", cardId);
    const card = cards.find((c) => c.id === cardId);
    if (card) {
      const preferred = card.currencies.includes(defaultCurrency)
        ? defaultCurrency
        : (card.currencies[0] as "ARS" | "USD");
      form.setValue("currency", preferred);
    }
  }

  // Preview en vivo de las cuotas (solo crédito). Reusa la lógica pura de dominio.
  const cardId = useWatch({ control: form.control, name: "cardId" });
  const totalAmount = useWatch({ control: form.control, name: "totalAmount" });
  const totalInstallments = useWatch({ control: form.control, name: "totalInstallments" });
  const financedTotal = useWatch({ control: form.control, name: "financedTotal" });
  const purchaseDate = useWatch({ control: form.control, name: "purchaseDate" });
  const currency = useWatch({ control: form.control, name: "currency" });

  // Monedas elegibles: con tarjeta, las que opera la tarjeta seleccionada; para
  // transferencia/efectivo, ARS o USD libres. Si la tarjeta opera una sola, el select
  // queda deshabilitado (la moneda ya quedó fijada por onCardChange).
  const selectedCard = cards.find((c) => c.id === cardId);
  const currencyOptions: ("ARS" | "USD")[] = needsCard
    ? ((selectedCard?.currencies as ("ARS" | "USD")[]) ?? [])
    : ["ARS", "USD"];

  const preview = useMemo(() => {
    if (!isCredit) return null;
    const card = creditCards.find((c) => c.id === cardId);
    if (!card || card.closingDay == null || card.dueDay == null) return null;
    if (!totalAmount || totalAmount <= 0) return null;
    // Moneda del preview: la elegida si la tarjeta la opera, si no la primera.
    const previewCurrency = currency && card.currencies.includes(currency)
      ? currency
      : card.currencies[0];
    try {
      const plan = buildPurchasePlan({
        cardClosingDay: card.closingDay,
        cardDueDay: card.dueDay,
        purchaseDate: purchaseDate ?? new Date(),
        totalInstallments: totalInstallments || 1,
        totalAmountCents: currencyToCents(totalAmount),
        financedTotalCents: financedTotal ? currencyToCents(financedTotal) : undefined,
        currency: previewCurrency,
      });
      return { ...plan, currency: previewCurrency };
    } catch {
      return null;
    }
  }, [
    isCredit,
    creditCards,
    cardId,
    totalAmount,
    totalInstallments,
    financedTotal,
    purchaseDate,
    currency,
  ]);

  // Envía la compra al server y limpia el form. Reutilizado por el submit directo y por
  // la confirmación del modal de conversión (que agrega `limitRate` al payload).
  async function submitPayload(payload: PurchaseFormValues) {
    try {
      await createPurchase(payload);
      toast.success(payload.paymentMethod === "CREDIT" ? "Compra registrada" : "Gasto registrado");
      form.reset(defaultValues);
      setPendingPayload(null);
      setOpen(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "No pudimos registrar el movimiento. Intentá de nuevo."
      );
    }
  }

  async function onSubmit(raw: PurchaseFormValues) {
    // Los opcionales vacíos se mandan como undefined (no como "").
    const payload: PurchaseFormValues = {
      ...raw,
      cardId: raw.cardId || undefined,
      merchant: raw.merchant || undefined,
      notes: raw.notes || undefined,
      categoryId: raw.categoryId || undefined,
      financedTotal: raw.paymentMethod === "CREDIT" ? raw.financedTotal || undefined : undefined,
      totalInstallments: raw.paymentMethod === "CREDIT" ? raw.totalInstallments : 1,
    };

    // ¿Necesita cotización? Solo compra a crédito, con seguimiento activo, tarjeta con
    // límite y moneda distinta a la principal. En ese caso, pasamos al modal de conversión
    // en vez de enviar (el rate se agrega ahí). El server revalida esta misma condición.
    const card = cards.find((c) => c.id === payload.cardId);
    const needsConversion =
      trackCreditLimits &&
      payload.paymentMethod === "CREDIT" &&
      !!card?.hasCreditLimit &&
      payload.currency !== defaultCurrency;

    if (needsConversion) {
      setRateInput("");
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

  // Monto convertido a la moneda principal para el preview del modal de conversión.
  const pendingRate = Number(rateInput);
  const convertedPreview =
    pendingPayload && Number.isFinite(pendingRate) && pendingRate > 0
      ? formatMoney(currencyToCents(pendingPayload.totalAmount * pendingRate), defaultCurrency)
      : null;

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // El modal abre siempre limpio.
        if (o) form.reset(defaultValues);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
          <DialogDescription>
            {isCredit
              ? "Compra en cuotas: calculamos los vencimientos según el ciclo de la tarjeta."
              : "Gasto de pago único: se descuenta de tus ahorros."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
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
                      <SelectItem value="CREDIT">Crédito (en cuotas)</SelectItem>
                      <SelectItem value="DEBIT">Débito</SelectItem>
                      <SelectItem value="TRANSFER">Transferencia</SelectItem>
                      <SelectItem value="CASH">Efectivo</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {needsCard && (
              <FormField
                control={form.control}
                name="cardId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tarjeta</FormLabel>
                    {methodCards.length === 0 ? (
                      <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm">
                        No tenés tarjetas de {paymentMethod === "DEBIT" ? "débito" : "crédito"}.
                        Agregá una en Tarjetas.
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
                              {c.name} · {c.bank} ···· {c.last4} ({c.currencies.join("/")})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input placeholder="Notebook Lenovo" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Moneda</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      // Con tarjeta de una sola moneda, la fija la tarjeta. Con varias
                      // (ej. ARS y USD), el usuario elige entre las que opera.
                      disabled={needsCard && currencyOptions.length <= 1}
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

            {isCredit && (
              <div className="grid grid-cols-2 items-start gap-4">
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
              </div>
            )}

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
                        autoFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 items-start gap-4">
              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría (opc.)</FormLabel>
                    <Select
                      value={field.value || NO_CATEGORY}
                      onValueChange={(v) =>
                        field.onChange(v === NO_CATEGORY ? undefined : v)
                      }
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

              <FormField
                control={form.control}
                name="merchant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comercio (opc.)</FormLabel>
                    <FormControl>
                      <Input placeholder="Garbarino" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opc.)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Regalo de cumpleaños…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {preview && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">
                  {preview.rows.length}{" "}
                  {preview.rows.length === 1 ? "cuota" : "cuotas"} de{" "}
                  {formatMoney(preview.rows[0].amountCents, preview.currency)}
                  {preview.rows.length > 1 &&
                    preview.rows[preview.rows.length - 1].amountCents !==
                      preview.rows[0].amountCents &&
                    ` (última: ${formatMoney(
                      preview.rows[preview.rows.length - 1].amountCents,
                      preview.currency
                    )})`}
                </p>
                <p className="text-muted-foreground">
                  Primer vencimiento: {formatDate(preview.rows[0].dueDate)}
                </p>
                {preview.hasSurcharge && (
                  <p className="text-muted-foreground">
                    Total a pagar: {formatMoney(preview.totalCents, preview.currency)} · Recargo
                    +{preview.surchargePct.toFixed(1)}% · TEM ≈ {preview.tem.toFixed(1)}%/mes
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Guardando…" : "Registrar"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    {/* Modal de conversión: la compra es en una moneda distinta a la principal y la
        tarjeta tiene límite. Pide la cotización para imputarla al límite de crédito
        (snapshot en Purchase.limitRate). Cancelar vuelve al form sin enviar. */}
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
            Esta compra es en {pendingPayload?.currency} pero tu límite de crédito está en{" "}
            {defaultCurrency}. Ingresá la cotización para sumarla al uso del límite.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="limit-rate">
              1 {pendingPayload?.currency} = ? {defaultCurrency}
            </Label>
            <Input
              id="limit-rate"
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
              La compra impacta el límite como <span className="text-foreground font-medium">{convertedPreview}</span>.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setPendingPayload(null)}>
            Cancelar
          </Button>
          <Button onClick={confirmConversion} disabled={form.formState.isSubmitting}>
            Confirmar y registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
