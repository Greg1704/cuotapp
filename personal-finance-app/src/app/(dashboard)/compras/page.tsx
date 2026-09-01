import Link from "next/link";
import { ShoppingBag } from "lucide-react";

import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { listPurchases } from "@/server/actions/purchases";
import { listActiveCards } from "@/server/actions/cards";
import { listCategories } from "@/server/actions/categories";
import type { PurchaseFilters as Filters } from "@/lib/validation/purchase";
import { paymentMethodLabel } from "@/lib/payment-method";
import { formatMoney } from "@/server/lib/money";
import { formatDate, monthParamToDate } from "@/server/lib/dates";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PurchaseFormDialog } from "@/components/compras/purchase-form-dialog";
import { PurchaseFilters } from "@/components/compras/purchase-filters";
import { CategoriesManagerDialog } from "@/components/categorias/categories-manager-dialog";

const PAYMENT_METHODS = ["CREDIT", "DEBIT", "TRANSFER", "CASH"] as const;
type PaymentMethodParam = (typeof PAYMENT_METHODS)[number];

type SearchParams = {
  cardId?: string;
  categoryId?: string;
  currency?: string;
  paymentMethod?: string;
  month?: string; // "YYYY-MM"
  page?: string;
};

export default async function ComprasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  const paymentMethod = PAYMENT_METHODS.includes(sp.paymentMethod as PaymentMethodParam)
    ? (sp.paymentMethod as PaymentMethodParam)
    : undefined;

  const pageParam = Number(sp.page);
  const filters: Filters = {
    cardId: sp.cardId,
    categoryId: sp.categoryId,
    currency: sp.currency === "ARS" || sp.currency === "USD" ? sp.currency : undefined,
    paymentMethod,
    month: monthParamToDate(sp.month),
    page: Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : undefined,
  };

  // Server Component: lee la DB directo. El dinero se formatea acá (server),
  // así ningún BigInt cruza el borde hacia el cliente.
  const user = await requireUser();
  const [purchasesResult, cards, categories, profile] = await Promise.all([
    listPurchases(filters),
    listActiveCards(),
    listCategories(),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { defaultCurrency: true, trackCreditLimits: true },
    }),
  ]);
  const { purchases, page, pageCount, total } = purchasesResult;
  // Moneda principal del usuario (Configuración): default de la compra cuando la
  // tarjeta elegida la opera. Ver PurchaseFormDialog.
  const defaultCurrency: "ARS" | "USD" = profile?.defaultCurrency === "USD" ? "USD" : "ARS";
  const trackCreditLimits = profile?.trackCreditLimits ?? false;

  // URL de una página preservando los filtros activos (la paginación no los pierde).
  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (sp.cardId) params.set("cardId", sp.cardId);
    if (sp.categoryId) params.set("categoryId", sp.categoryId);
    if (sp.currency) params.set("currency", sp.currency);
    if (sp.paymentMethod) params.set("paymentMethod", sp.paymentMethod);
    if (sp.month) params.set("month", sp.month);
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/compras?${qs}` : "/compras";
  };

  // Al diálogo le pasamos solo los campos que usa (no el objeto Card/Category
  // completo): así el payload que cruza al cliente es chico y el serializador RSC
  // renderiza el botón de forma fiable aunque haya varias instancias en la página.
  const dialogCards = cards.map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    bank: c.bank,
    last4: c.last4,
    currencies: c.currencies,
    closingDay: c.closingDay,
    dueDay: c.dueDay,
    // Derivado en el server: no cruzamos el BigInt del límite al cliente (regla
    // rsc-y-payload). Dispara el modal de conversión en compras multi-moneda.
    hasCreditLimit: c.creditLimitCents != null,
  }));
  const dialogCategories = categories.map((c) => ({ id: c.id, name: c.name }));
  // El manager de categorías usa además color/icon y el conteo de compras
  // asociadas (para avisar al borrar). No manda userId/createdAt.
  const managerCategories = categories.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    icon: c.icon,
    purchaseCount: c._count.purchases,
  }));

  // Cada lugar crea su propio elemento (función, no una constante reutilizada en
  // dos posiciones, que el serializador RSC tampoco resuelve bien).
  const renderNewPurchaseButton = () => (
    <PurchaseFormDialog
      cards={dialogCards}
      categories={dialogCategories}
      defaultCurrency={defaultCurrency}
      trackCreditLimits={trackCreditLimits}
      trigger={<Button>+ Nuevo movimiento</Button>}
    />
  );

  const hasFilters = Boolean(
    sp.cardId || sp.categoryId || sp.currency || sp.paymentMethod || sp.month
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mis compras</h1>
          <p className="text-muted-foreground text-sm">
            Registrá compras en cuotas y seguí sus vencimientos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CategoriesManagerDialog categories={managerCategories} />
          {/* Siempre disponible: transferencia y efectivo no requieren tarjeta. */}
          {renderNewPurchaseButton()}
        </div>
      </header>

      {/* Panel de contenido: superficie `bg-card` para despegar del fondo de la página. */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
          <PurchaseFilters
            cards={cards.map((c) => ({ id: c.id, label: `${c.name} ···· ${c.last4}` }))}
            categories={categories.map((c) => ({ id: c.id, label: c.name }))}
            current={{
              cardId: sp.cardId,
              categoryId: sp.categoryId,
              currency: sp.currency,
              paymentMethod: sp.paymentMethod,
              month: sp.month,
            }}
          />

          {purchases.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
              <ShoppingBag className="size-8 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  {hasFilters
                    ? "No hay compras con esos filtros"
                    : "Todavía no registraste compras"}
                </p>
                <p className="text-muted-foreground text-sm">
                  {hasFilters
                    ? "Probá ajustar o limpiar los filtros."
                    : "Cargá tu primera compra para ver el detalle de sus cuotas."}
                </p>
              </div>
              {!hasFilters && renderNewPurchaseButton()}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descripción</TableHead>
                    <TableHead>Medio de pago</TableHead>
                    <TableHead>Tarjeta</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="text-center">Cuotas</TableHead>
                    <TableHead className="text-right">Monto total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.map((p, i) => (
                    // Zebra: dos tonos `muted` (ambos distintos del panel `bg-card`)
                    // para diferenciar filas. El hover los unifica en `bg-muted/50`.
                    <TableRow
                      key={p.id}
                      className={i % 2 === 0 ? "bg-muted/60" : "bg-muted/30"}
                    >
                      <TableCell className="font-medium">
                        <Link href={`/compras/${p.id}`} className="hover:underline">
                          {p.description}
                        </Link>
                        {p.category && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            · {p.category.name}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {paymentMethodLabel(p.paymentMethod)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.card ? `${p.card.name} ···· ${p.card.last4}` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(p.purchaseDate)}
                      </TableCell>
                      <TableCell className="text-center">{p.totalInstallments}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(p.totalAmountCents, p.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Paginación: 15 por página (RF-3.8). Solo si hay más de una página. */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Página {page} de {pageCount} · {total}{" "}
                {total === 1 ? "compra" : "compras"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  asChild={page > 1}
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                >
                  {page > 1 ? (
                    <Link href={pageHref(page - 1)}>Anterior</Link>
                  ) : (
                    <span>Anterior</span>
                  )}
                </Button>
                <Button
                  asChild={page < pageCount}
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                >
                  {page < pageCount ? (
                    <Link href={pageHref(page + 1)}>Siguiente</Link>
                  ) : (
                    <span>Siguiente</span>
                  )}
                </Button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
