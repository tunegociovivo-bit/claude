/**
 * Autenticación del panel de administración de Bubui.
 *
 * Antes: token compartido (BUBUI_ADMIN_TOKEN) vía cabecera `x-admin-token`.
 * Ahora: sesión NextAuth del Hub. El usuario debe estar logueado en el
 * Hub y tener rol ADMIN. Esto evita compartir un token y reutiliza la
 * misma cuenta + 2FA + audit del Hub.
 *
 * `isBubuiAdmin()` es async y solo funciona en contexto server (route
 * handlers o server components). El parámetro `req` se mantiene en la
 * firma para no romper los call sites, pero ya no se usa.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function isBubuiAdmin(_req?: Request): Promise<boolean> {
  const s = await getServerSession(authOptions);
  const role = (s?.user as any)?.role;
  return role === "ADMIN";
}

// Compatibilidad: las rutas existentes llaman `adminTokenOk(req)`.
// Mantenemos el nombre como alias async y dejamos el chequeo nuevo
// para no tener que tocar todas las rutas con un rename masivo.
export async function adminTokenOk(req: Request): Promise<boolean> {
  return isBubuiAdmin(req);
}
