import { NextRequest } from "next/server";
import { ApiError } from "./auth";

/**
 * Protección CSRF por comprobación de ORIGEN para endpoints que cambian estado
 * y se llaman con la cookie de sesión (mismo-origen). Si la cabecera Origin (o,
 * en su defecto, Referer) está presente, su host debe coincidir con el host de
 * la petición. Bloquea peticiones cruzadas de otros sitios.
 */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  if (!origin) return; // navegadores modernos envían Origin en POST; clientes server-to-server no
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "csrf", "Origen no válido");
  }
  const reqHost = req.headers.get("host") || "";
  const allowed = new Set<string>([reqHost]);
  for (const env of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    if (env) {
      try {
        allowed.add(new URL(env).host);
      } catch {
        /* ignore */
      }
    }
  }
  if (!allowed.has(originHost)) {
    throw new ApiError(403, "csrf", "Petición cruzada bloqueada (CSRF)");
  }
}
