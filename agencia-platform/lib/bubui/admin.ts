/**
 * Autenticación mínima del panel de administración de Bubui.
 * Se valida un token compartido (BUBUI_ADMIN_TOKEN) enviado en la cabecera
 * `x-admin-token`. No usa la sesión del Hub: es un panel independiente.
 */

export function adminTokenOk(req: Request): boolean {
  const expected = process.env.BUBUI_ADMIN_TOKEN;
  if (!expected) return false;
  // Convención del panel: `Authorization: Bearer <token>`. Aceptamos también
  // `x-admin-token` por comodidad.
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const got = bearer || req.headers.get("x-admin-token") || "";
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
