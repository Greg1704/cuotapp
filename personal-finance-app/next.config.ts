import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad aplicadas a todas las rutas (hardening HTTP). Van acá y no
 * en un proxy/edge para que valgan tanto en Vercel como en el Dockerfile standalone.
 *
 * - CSP: `frame-ancestors 'none'` (anti-clickjacking, junto con X-Frame-Options),
 *   `object-src 'none'`, `base-uri 'self'` y `form-action 'self'` cierran vectores
 *   clásicos sin romper Next. `script-src`/`style-src` admiten `'unsafe-inline'`
 *   como compromiso pragmático del MVP: Next inyecta scripts de hidratación inline y
 *   `next-themes` un script inline; recharts y `chart.tsx` inyectan estilos inline.
 *   El endurecimiento a futuro es una CSP con nonces (requiere inyectarlos por
 *   proxy). Aun con `'unsafe-inline'`, la CSP ya bloquea orígenes externos de
 *   script/estilo/conexión/imagen, que es la mayor parte del valor.
 * - HSTS: fuerza HTTPS (solo tiene efecto sobre https; inofensivo en dev http).
 */
// En DESARROLLO, Next/Turbopack y React (modo dev) necesitan `eval()` para HMR y
// features de debugging → hay que permitir `'unsafe-eval'`. En PRODUCCIÓN React nunca
// usa eval, así que la CSP queda estricta (sin unsafe-eval). Vercel buildea con
// NODE_ENV=production, así que ahí sale la versión estricta automáticamente.
const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // `standalone` es para el Dockerfile de producción (camino VPS a futuro). En Vercel
  // NO va: rompe el wiring de rutas del App Router y devuelve 404 en todo. Vercel
  // expone VERCEL=1 en el build, así que ahí lo desactivamos.
  // En CI tampoco: los E2E sirven la app con `next start`, que no soporta standalone
  // (avisa "does not work with output: standalone"). El bundle standalone solo lo
  // consume el Dockerfile, que el CI no construye.
  output: process.env.VERCEL || process.env.CI ? undefined : "standalone",
  reactCompiler: true,
  // En dev, Next bloquea los assets /_next/* pedidos desde orígenes que no sean
  // localhost. El E2E en Docker entra por el alias del contenedor (cuotapp:3000),
  // así que hay que permitirlo o la página nunca hidrata. No afecta producción.
  allowedDevOrigins: ["cuotapp", "cuotapp:3000"],
};

export default nextConfig;
