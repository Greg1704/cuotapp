import { test, expect, type Page } from "@playwright/test";

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@cuotapp.test`;
}

/** Alta + sesión: deja la página en /dashboard logueada. */
async function signup(page: Page, name: string) {
  const email = uniqueEmail();
  // networkidle espera la hidratación: en dev Next compila la página en la primera
  // visita y un click prematuro dispara el submit GET nativo del form.
  await page.goto("/signup");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nombre").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill("password-segura-123");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Selecciona una opción en un Select de Radix. shadcn cablea `id={formItemId}` en el
 * trigger y `htmlFor` en el FormLabel, así que el combobox es alcanzable por su label;
 * las opciones se portalizan fuera del dialog, por eso van por `page` (no scopeadas).
 */
async function selectOption(page: Page, label: string, optionName: string | RegExp) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: optionName, exact: typeof optionName === "string" }).click();
}

test.describe("autenticación (RNF-6.3, parte 1)", () => {
  test("signup → dashboard → logout → login", async ({ page }) => {
    const email = uniqueEmail();
    const password = "password-segura-123";
    const name = "QA Tester";

    // signup. networkidle espera la hidratación: en dev Next compila la página en
    // la primera visita y un click prematuro dispara el submit GET nativo del form.
    await page.goto("/signup");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Nombre").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();

    // logout: el sign-out vive en el menú de usuario del sidebar (footer)
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login/);

    // login con las mismas credenciales
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("el middleware redirige a /login si no hay sesión", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("compra en cuotas (RNF-6.3, parte 2)", () => {
  test("crear tarjeta → compra en 6 cuotas → calendario → marcar cuota pagada", async ({
    page,
  }) => {
    // Nombres únicos: la DB de test puede persistir entre corridas.
    const stamp = Date.now();
    const cardName = `Visa E2E ${stamp}`;
    const description = `Notebook E2E ${stamp}`;

    await signup(page, "QA Compra");

    // 1) Crear tarjeta (banco conocido; el ciclo de cierre/venc. queda en su default).
    await page.goto("/tarjetas");
    await page.waitForLoadState("networkidle");
    // Sin tarjetas aún hay dos botones (header + estado vacío): tomamos el primero.
    await page.getByRole("button", { name: "+ Nueva tarjeta" }).first().click();
    const cardDialog = page.getByRole("dialog");
    await expect(cardDialog).toBeVisible();
    // Alta MÍNIMA: nombre + banco. Los últimos 4 y el MM/AA son opcionales y viven en la
    // sección plegada "Datos de la tarjeta (opcional)": no hace falta tener el plástico a
    // mano para empezar a usar la app. El límite es opt-in (Configuración).
    await cardDialog.getByLabel("Nombre").fill(cardName);
    await selectOption(page, "Banco", "Galicia");
    await cardDialog.getByRole("button", { name: "Crear tarjeta" }).click();
    await expect(cardDialog).toBeHidden();
    await expect(page.getByText(cardName)).toBeVisible();

    // 2) Registrar una compra en 6 cuotas con esa tarjeta.
    await page.goto("/compras");
    await page.waitForLoadState("networkidle");
    // Igual que en tarjetas: sin compras hay dos botones (header + estado vacío).
    await page.getByRole("button", { name: "+ Nuevo movimiento" }).first().click();
    const purchaseDialog = page.getByRole("dialog");
    await expect(purchaseDialog).toBeVisible();
    await selectOption(page, "Tarjeta", new RegExp(cardName));
    await purchaseDialog.getByLabel("Descripción").fill(description);
    await purchaseDialog.getByLabel("Monto total").fill("60000");
    await selectOption(page, "Cuotas", "6");
    await purchaseDialog.getByRole("button", { name: "Registrar" }).click();
    await expect(purchaseDialog).toBeHidden();
    await expect(page.getByRole("link", { name: description })).toBeVisible();

    // 3) Ver el calendario: la compra reparte 6 cuotas en meses futuros. Navegamos
    //    por `?month=YYYY-MM` (goto directo, sin la soft-nav del botón "Mes siguiente"
    //    que compite con el "Compiling…" del dev server) desde el mes actual hasta dar
    //    con la primera cuota. El loop usa el reloj del runner (mismo que el de la app).
    const calendarLink = page.getByRole("link", { name: new RegExp(description) });
    const now = new Date();
    let found = false;
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await page.goto(`/calendario?month=${ym}`);
      await page.waitForLoadState("networkidle");
      if (await calendarLink.first().isVisible().catch(() => false)) {
        found = true;
        break;
      }
    }
    expect(found, "la cuota debería aparecer en el calendario").toBe(true);

    // 4) Entrar al detalle desde el calendario y marcar la primera cuota como pagada.
    await calendarLink.first().click();
    await expect(page.getByRole("heading", { name: description })).toBeVisible();
    await expect(page.getByText("0/6 pagas")).toBeVisible();
    await page.getByRole("button", { name: "Marcar pagada" }).first().click();
    await expect(page.getByText("1/6 pagas")).toBeVisible();
    // La fila pagada ahora ofrece revertir (toggle de estado).
    await expect(page.getByRole("button", { name: "Revertir" }).first()).toBeVisible();
  });
});

test.describe("gasto no-crédito (ahorros)", () => {
  test("efectivo: aparece en compras y NO en el calendario de cuotas", async ({ page }) => {
    const stamp = Date.now();
    const description = `Feria E2E ${stamp}`;

    await signup(page, "QA Gasto");

    // Registrar un gasto en efectivo (sin tarjeta, pago único, descuenta del ahorro).
    await page.goto("/compras");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "+ Nuevo movimiento" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await selectOption(page, "Medio de pago", "Efectivo");
    await dialog.getByLabel("Descripción").fill(description);
    await dialog.getByLabel("Monto total").fill("15000");
    await dialog.getByRole("button", { name: "Registrar" }).click();
    await expect(dialog).toBeHidden();

    // Aparece en el historial de compras, con "Efectivo" como origen (sin tarjeta).
    await expect(page.getByRole("link", { name: description })).toBeVisible();
    await expect(page.getByText("Efectivo").first()).toBeVisible();

    // NO genera cuotas: no debe aparecer en el calendario de ningún mes próximo.
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      await page.goto(`/calendario?month=${ym}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(description)).toHaveCount(0);
    }
  });
});
