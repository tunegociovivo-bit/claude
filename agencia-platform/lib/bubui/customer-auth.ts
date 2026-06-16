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

/**
 * Extrae el customerId de la cabecera Authorization (`Bearer <id>:<secret>`), sin
 * validar el token. Útil como fuente FIABLE del customerId en peticiones
 * multipart (en React Native los campos de texto del form se pierden a veces).
 * La validación real la sigue haciendo customerAuthOk con ese mismo id.
 */
export function customerIdFromAuth(req: Request): string | null {
  return parseAuth(req.headers.get("authorization"))?.customerId ?? null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * ¿La petición está autenticada como `customerId`? Ver nota de despliegue arriba.
 *
 * - Si se presenta un token (cabecera Authorization), DEBE ser válido para este
 *   cliente. Así protegemos a quien ya envía token (la app móvil) frente a
 *   tokens falsos o de otro cliente — sin importar el modo.
 * - Si NO se presenta token: en modo estricto se bloquea; en modo lazy (por
 *   defecto) se permite, para no romper a los clientes que todavía no envían
 *   token durante la transición (la PWA web y las apps móviles antiguas).
 */
export async function customerAuthOk(req: Request, customerId: string | null | undefined): Promise<boolean> {
  if (!customerId) return false;
  const auth = parseAuth(req.headers.get("authorization"));

  if (auth) {
    if (auth.customerId !== customerId) return false;
    const c = await prisma.bubuiCustomer.findUnique({ where: { id: customerId }, select: { apiToken: true } });
    return !!c?.apiToken && safeEqual(c.apiToken, auth.secret);
  }

  // Sin token presentado.
  return process.env.BUBUI_REQUIRE_CUSTOMER_TOKEN !== "true";
}
