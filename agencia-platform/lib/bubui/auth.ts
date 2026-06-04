/**
 * Auth v1 del panel del negocio Bubui.
 *
 * Tras el login, el panel guarda en localStorage un token `<businessId>:<secret>`
 * y lo envía como `Authorization: Bearer <businessId>:<secret>`. El `<secret>`
 * se compara (en tiempo constante) con el `apiToken` persistido en BubuiBusiness
 * al hacer login.
 *
 * Despliegue progresivo (modo "lazy", por defecto): mientras un negocio aún NO
 * tenga apiToken (sesión creada antes de esta versión), se acepta su token
 * antiguo para no echar a los paneles ya abiertos. En cuanto el dueño vuelve a
 * iniciar sesión, obtiene secreto guardado y queda protegido. Con la variable
 * BUBUI_REQUIRE_BUSINESS_TOKEN="true" se exige secreto válido SIEMPRE.
 */

import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/prisma";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function businessTokenAllows(token: string | null, businessId: string): Promise<boolean> {
  if (!token) return false;
  const m = /^Bearer\s+([\w-]+):([\w-]+)$/.exec(token.trim());
  if (!m || m[1] !== businessId) return false;
  const secret = m[2];

  const b = await prisma.bubuiBusiness.findUnique({ where: { id: businessId }, select: { apiToken: true } });
  if (!b) return false;

  if (b.apiToken) {
    // Negocio con sesión nueva → secreto obligatorio y correcto.
    return safeEqual(b.apiToken, secret);
  }
  // Negocio todavía sin apiToken (sesión previa a esta versión).
  return process.env.BUBUI_REQUIRE_BUSINESS_TOKEN !== "true";
}
