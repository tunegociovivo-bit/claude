/**
 * Autenticación mínima del panel de administración de Bubui.
 * Se valida un token compartido (BUBUI_ADMIN_TOKEN) enviado en la cabecera
 * `x-admin-token`. No usa la sesión del Hub: es un panel independiente.
 */

export function adminTokenOk(req: Request): boolean {
  const expected = process.env.BUBUI_ADMIN_TOKEN;
  if (!expected) return false;
  const got = req.headers.get("x-admin-token") ?? "";
  // Comparación de longitud constante simple.
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
