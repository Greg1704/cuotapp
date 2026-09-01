"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import type { CardView } from "@/lib/card-view";
import { cn } from "@/lib/utils";
import { cardSchema, type CardFormValues } from "@/lib/validation/card";
import { KNOWN_BANKS, OTHER_BANK, NEUTRAL_MODAL_CLASS, findBank } from "@/lib/banks";
import { formatExpiration, isCardExpired } from "@/server/lib/dates";
import { createCard, updateCard, reactivateCard } from "@/server/actions/cards";
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BRANDS = ["Visa", "Mastercard", "Amex", "Otra"] as const;
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Enmascara la entrada del vencimiento a MM/AA mientras se tipea. */
function maskExpiration(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

type Props = {
  /** Si viene una tarjeta, el dialog opera en modo edición; si no, en modo alta. */
  card?: CardView;
  /**
   * Moneda principal del usuario (Configuración). En el alta preselecciona esta moneda
   * entre las que opera la tarjeta. Solo aplica al crear (en edición manda `card`).
   */
  defaultCurrency?: "ARS" | "USD";
  /**
   * Seguimiento de límite de crédito activo (`User.trackCreditLimits`). Solo con esto en
   * `true` se muestra el campo de límite; si no, la tarjeta se crea sin límite.
   */
  trackCreditLimits?: boolean;
  /** El elemento que dispara la apertura (botón "Nueva tarjeta" o "Editar"). */
  trigger: React.ReactNode;
};

export function CardFormDialog({
  card,
  defaultCurrency = "ARS",
  trackCreditLimits = false,
  trigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const isEdit = Boolean(card);
  // Los datos identificatorios (dueño, marca, últimos 4, MM/AA) arrancan SIEMPRE
  // colapsados, también en edición: el modal abre mostrando lo esencial y quien quiera
  // tocarlos los despliega.
  const [showDetails, setShowDetails] = useState(false);

  // Si createCard detecta un duplicado, guardamos la tarjeta existente y los
  // valores ingresados para ofrecer reactivar / crear igual.
  const [duplicate, setDuplicate] = useState<CardView | null>(null);
  const [pendingValues, setPendingValues] = useState<CardFormValues | null>(null);

  // Opción elegida en el Select de banco: un banco conocido, "Otro", o "" (ninguno).
  // En edición: si el banco guardado es conocido lo preselecciona; si no, "Otro".
  const initialBankChoice = card?.bank
    ? findBank(card.bank)
      ? card.bank
      : OTHER_BANK
    : "";
  const [bankChoice, setBankChoice] = useState(initialBankChoice);

  const defaultValues: CardFormValues = {
    type: (card?.type as "CREDIT" | "DEBIT") ?? "CREDIT",
    name: card?.name ?? "",
    owner: card?.owner ?? "",
    bank: card?.bank ?? "",
    brand: card?.brand ?? "",
    last4: card?.last4 ?? "",
    expiration: card ? formatExpiration(card.expirationDate) : "",
    closingDay: card?.closingDay ?? 1,
    dueDay: card?.dueDay ?? 1,
    currencies: (card?.currencies as ("ARS" | "USD")[]) ?? [defaultCurrency],
    // El límite viaja en centavos (string) y el form trabaja en unidades enteras.
    // `null` (no `undefined`) para el vacío: con `undefined`, el Controller de RHF vuelve
    // a caer en el defaultValue y "reinserta" el valor al intentar borrarlo.
    creditLimit: card?.creditLimitCents ? Number(card.creditLimitCents) / 100 : null,
  };

  const form = useForm<CardFormValues>({
    resolver: zodResolver(cardSchema),
    defaultValues,
  });

  // El ciclo de cierre/vencimiento y el vencimiento MM/AA solo aplican a crédito.
  const cardType = useWatch({ control: form.control, name: "type" });
  const isCredit = cardType === "CREDIT";

  function resetAndClose() {
    setDuplicate(null);
    setPendingValues(null);
    setOpen(false);
  }

  async function onSubmit(values: CardFormValues) {
    // Los opcionales vacíos se persisten como undefined (no como "").
    const payload: CardFormValues = {
      ...values,
      owner: values.owner || undefined,
      brand: values.brand || undefined,
      last4: values.last4 || undefined,
    };

    try {
      if (isEdit && card) {
        await updateCard(card.id, payload);
        toast.success("Tarjeta actualizada");
        resetAndClose();
        return;
      }

      const result = await createCard(payload);
      if (result.status === "duplicate") {
        setDuplicate(result.existing);
        setPendingValues(payload);
        return;
      }
      toast.success("Tarjeta creada");
      resetAndClose();
    } catch (e) {
      // El server puede lanzar un mensaje propio (ej. hay cuotas pendientes en una
      // moneda que se intenta quitar). Lo mostramos tal cual en vez del genérico.
      toast.error(
        e instanceof Error ? e.message : "No pudimos guardar la tarjeta. Intentá de nuevo."
      );
    }
  }

  async function handleReactivate() {
    if (!duplicate) return;
    try {
      await reactivateCard(duplicate.id);
      toast.success("Tarjeta reactivada");
      resetAndClose();
    } catch {
      toast.error("No pudimos reactivar la tarjeta.");
    }
  }

  async function handleForceCreate() {
    if (!pendingValues) return;
    try {
      await createCard(pendingValues, true);
      toast.success("Tarjeta creada");
      resetAndClose();
    } catch {
      toast.error("No pudimos crear la tarjeta.");
    }
  }

  // Mensaje y acciones del panel de duplicado según el estado de la existente.
  function renderDuplicatePanel(existing: CardView) {
    const deactivated = !existing.isActive;
    const expired = existing.isActive && isCardExpired(existing.expirationDate);

    return (
      <div className="scrollbar-subtle grid min-h-0 gap-4 overflow-y-auto -mx-6 px-6">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          {deactivated ? (
            <>
              Ya tenés una tarjeta <strong>desactivada</strong> con ese banco y esos
              últimos 4 dígitos (<strong>{existing.name}</strong>). ¿Querés reactivarla
              en vez de crear una nueva?
            </>
          ) : expired ? (
            <>
              Ya tenés una tarjeta <strong>vencida</strong> con ese banco y esos
              últimos 4 dígitos (<strong>{existing.name}</strong>). Podés renovarla
              desde la sección &quot;Vencidas&quot;, o crear una nueva.
            </>
          ) : (
            <>
              Ya tenés una tarjeta <strong>activa</strong> con ese banco y esos últimos
              4 dígitos (<strong>{existing.name}</strong>).
            </>
          )}
        </div>
        <DialogFooter className="gap-2">
          {deactivated && <Button onClick={handleReactivate}>Reactivar</Button>}
          <Button variant="outline" onClick={handleForceCreate}>
            {deactivated ? "Crear igual" : "Crear nueva igual"}
          </Button>
          <Button variant="ghost" onClick={() => setDuplicate(null)}>
            Cancelar
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Al abrir, el modal arranca limpio: valores por defecto, sin errores
        // ni panel de duplicado colgando de una sesión anterior.
        if (o) {
          form.reset(defaultValues);
          setBankChoice(initialBankChoice);
          setShowDetails(false);
        }
        setDuplicate(null);
        setPendingValues(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-40px)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar tarjeta" : "Nueva tarjeta"}</DialogTitle>
          <DialogDescription>
            {isCredit
              ? "Configurá el ciclo de cierre y vencimiento para calcular bien las cuotas."
              : "El débito gasta contra tu saldo al instante: sin ciclo de facturación."}
          </DialogDescription>
        </DialogHeader>

        {duplicate ? (
          renderDuplicatePanel(duplicate)
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              // min-h-0 + overflow-y-auto: el cuerpo scrollea dentro del alto máximo del
              // modal. -mx-6 px-6 negan el padding del DialogContent para que la barra de
              // scroll quede al borde y los focus rings de los inputs no se recorten.
              className="scrollbar-subtle grid min-h-0 gap-4 overflow-y-auto -mx-6 px-6"
            >
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      // El tipo se fija al crear: cambiarlo en una tarjeta con compras
                      // dejaría cuotas sin ciclo. Para cambiarlo, dar de alta otra.
                      disabled={isEdit}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="CREDIT">Crédito (en cuotas)</SelectItem>
                        <SelectItem value="DEBIT">Débito</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input placeholder="Tarjeta principal" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />


              {/* Banco: select de conocidos + "Otro" con input libre.
                  El recuadro arranca gris y toma el color del banco al elegirlo. */}
              <FormField
                control={form.control}
                name="bank"
                render={({ field }) => (
                  <FormItem
                    className={cn(
                      "rounded-md border p-3 transition-colors",
                      findBank(bankChoice)?.modalClass ?? NEUTRAL_MODAL_CLASS
                    )}
                  >
                    <FormLabel>Banco</FormLabel>
                    <Select
                      value={bankChoice || undefined}
                      onValueChange={(v) => {
                        setBankChoice(v);
                        field.onChange(v === OTHER_BANK ? "" : v);
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Elegí tu banco…" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {KNOWN_BANKS.map((b) => (
                          <SelectItem key={b.value} value={b.value}>
                            {b.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={OTHER_BANK}>Otro…</SelectItem>
                      </SelectContent>
                    </Select>
                    {bankChoice === OTHER_BANK && (
                      <FormControl>
                        <Input placeholder="Nombre del banco" autoFocus {...field} />
                      </FormControl>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />



              {isCredit && (
              <div className="grid grid-cols-2 items-start gap-4">
                <FormField
                  control={form.control}
                  name="closingDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Día de cierre</FormLabel>
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
                          {DAYS.map((d) => (
                            <SelectItem key={d} value={String(d)}>
                              {d}
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
                  name="dueDay"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Día de vencimiento</FormLabel>
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
                          {DAYS.map((d) => (
                            <SelectItem key={d} value={String(d)}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              )}

              {isCredit && trackCreditLimits && (
                <FormField
                  control={form.control}
                  name="creditLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Límite de crédito ({defaultCurrency})</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          placeholder="2000000"
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "");
                            // Vacío ⇒ `null` (no `undefined`), para poder borrar el campo
                            // sin que RHF lo reinserte con el valor original.
                            field.onChange(digits ? Number(digits) : null);
                          }}
                        />
                      </FormControl>
                      <FormDescription>
                        Opcional, en {defaultCurrency} (tu moneda principal). Habilita la
                        barra de utilización: cuánto del límite está comprometido en cuotas.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="currencies"
                render={({ field }) => {
                  const toggle = (c: "ARS" | "USD") => {
                    const set = new Set(field.value ?? []);
                    // No dejar la lista vacía: si es la única moneda, no la quita.
                    if (set.has(c) && set.size === 1) return;
                    if (set.has(c)) set.delete(c);
                    else set.add(c);
                    field.onChange(Array.from(set));
                  };
                  return (
                    <FormItem>
                      <FormLabel>Monedas</FormLabel>
                      <div className="flex gap-2">
                        {(["ARS", "USD"] as const).map((c) => {
                          const active = field.value?.includes(c);
                          return (
                            <Button
                              key={c}
                              type="button"
                              variant={active ? "default" : "outline"}
                              onClick={() => toggle(c)}
                              aria-pressed={active}
                            >
                              {c === "ARS" ? "ARS (pesos)" : "USD (dólares)"}
                            </Button>
                          );
                        })}
                      </div>
                      <FormDescription>
                        Una tarjeta puede operar en más de una moneda (mismo ciclo de
                        cierre/vencimiento). La compra elige entre estas.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />

              {/* Datos identificatorios: NO los usa el motor de cuotas (que solo
                  necesita el ciclo de cierre/vencimiento), solo sirven para reconocer el
                  plástico en la UI. Van detrás de un toggle para que el alta no obligue a
                  tener la tarjeta en la mano: se pueden completar después, editando. */}
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground w-fit justify-start px-0 hover:bg-transparent"
                  onClick={() => setShowDetails((v) => !v)}
                  aria-expanded={showDetails}
                >
                  <ChevronDown
                    className={cn("size-4 transition-transform", showDetails && "rotate-180")}
                  />
                  Datos de la tarjeta (opcional)
                </Button>

                {showDetails && (
                  <div className="grid gap-4">
                <FormField
                  control={form.control}
                  name="owner"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dueño</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Juan Lopez"
                          {...field}
                          onChange={(e) =>
                            field.onChange(e.target.value.replace(/[^\p{L}\s]/gu, ""))
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 items-start gap-4">
                  <FormField
                    control={form.control}
                    name="brand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marca</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value || undefined}
                        >
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Elegí…" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {BRANDS.map((b) => (
                              <SelectItem key={b} value={b}>
                                {b}
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
                    name="last4"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Últimos 4 dígitos</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="numeric"
                            maxLength={4}
                            placeholder="1234"
                            {...field}
                            onChange={(e) =>
                              field.onChange(e.target.value.replace(/\D/g, "").slice(0, 4))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isCredit && (
                  <FormField
                    control={form.control}
                    name="expiration"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vencimiento (MM/AA)</FormLabel>
                        <FormControl>
                          <Input
                            inputMode="numeric"
                            maxLength={5}
                            placeholder="08/27"
                            value={field.value ?? ""}
                            onChange={(e) => field.onChange(maskExpiration(e.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting
                    ? "Guardando…"
                    : isEdit
                      ? "Guardar cambios"
                      : "Crear tarjeta"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
