import { defineConfig, devices } from "@playwright/test";

// Puerto único para el server y para las URLs de los tests. Se pasa también al
// webServer (abajo) para que el server arranque EN el mismo puerto que Playwright
// espera: `npm run dev` lo lee en `next dev -p ${PORT:-3005}` y `next start` lo toma
// de la variable de entorno. Sin esto, el default de dev (3005) y el baseURL no
// coinciden y el arranque expira.
const PORT = process.env.PORT ?? "3000";
// En Docker, PLAYWRIGHT_BASE_URL apunta al servicio "app" de docker-compose.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // En CI corremos contra el BUILD de producción, no contra el dev server: `next dev`
    // compila cada ruta en la primera visita, y esa demora (varios segundos) agota los
    // timeouts de la primera navegación de cada test. `next start` sirve todo compilado
    // ⇒ menos flakiness y más parecido a lo que ve el usuario real. En local se sigue
    // usando `dev` para no tener que buildear en cada corrida.
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Los E2E corren contra una DB de test separada (ver DATABASE_URL_TEST en .env.example).
    env: {
      PORT,
      DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "",
    },
  },
});
