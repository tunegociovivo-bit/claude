/**
 * Auth de sesión del cliente final de la app Bubui.
 *
 * La app guarda, tras verificar el OTP / hacer login, un token con la forma
 * `Bearer <customerId>:<secret>` y lo envía en cada llamada a los endpoints
 * propios del cliente. El secret se compara (en tiempo constante) con el
 * `apiToken` persistido en BubuiCustomer.
 *
 * Despliegue progresivo (modo "lazy", por defecto): mientras un cliente aún
 * NO tenga apiToken (sesión creada antes de esta versión), se le deja pasar
 * para no romper a los testers que todavía no han actualizado la app. En
 * cuanto el cliente inicia sesión con la app nueva, obtiene token y queda
 * protegido. Con la variable de entorno BUBUI_REQUIRE_CUSTOMER_TOKEN="true"
 * se exige token SIEMPRE (estado final, una vez todos han actualizado).
 */

import { randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/prisma";

/** Genera un token opaco y lo persiste en el cliente. Se renueva en cada login. */
export async function issueCustomerToken(customerId: string): Promise<string> {
  const token = randomBytes(24).toString("hex"); // 48 chars hex → solo [\w]
  await prisma.bubuiCustomer.update({ where: { id: customerId }, data: { apiToken: token } });
  return token;
}

function parseAuth(header: string | null): { customerId: string; secret: string } | null {
  if (!header) return null;
  const m = /^Bearer\s+([\w-]+):([\w-]+)$/.exec(header.trim());
  return m ? { customerId: m[1], secret: m[2] } : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * ¿La petición está autenticada como `customerId`? Ver nota de despliegue arriba.
 * Hace una única lectura del cliente (apiToken). Devuelve false si no existe.
 */
export async function customerAuthOk(req: Request, customerId: string | null | undefined): Promise<boolean> {
  if (!customerId) return false;
  const c = await prisma.bubuiCustomer.findUnique({ where: { id: customerId }, select: { apiToken: true } });
  if (!c) return false;
  const auth = parseAuth(req.headers.get("authorization"));
  if (c.apiToken) {
    // Cliente con app actualizada → token obligatorio y correcto.
    return !!auth && auth.customerId === customerId && safeEqual(c.apiToken, auth.secret);
  }
  // Cliente todavía sin token (sesión antigua).
  if (process.env.BUBUI_REQUIRE_CUSTOMER_TOKEN === "true") return false;
  return true; // modo lazy: no bloquear durante la transición
}
