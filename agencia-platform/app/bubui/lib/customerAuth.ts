"use client";

/**
 * Cabecera Authorization para las llamadas del cliente Bubui (PWA web) a los
 * endpoints /api/bubui/* propios del cliente. Lee el token de sesión guardado
 * en localStorage (bubui.customer.token), emitido por verify-otp / login.
 *
 * Si no hay sesión o token, devuelve {} — en modo lazy el backend lo permite;
 * cuando se active el modo estricto (BUBUI_REQUIRE_CUSTOMER_TOKEN) responderá
 * 401 y la PWA deberá re-loguear.
 */
export function customerAuthHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem("bubui.customer");
    if (!raw) return {};
    const c = JSON.parse(raw);
    if (c?.customerId && c?.token) {
      return { Authorization: `Bearer ${c.customerId}:${c.token}` };
    }
  } catch {}
  return {};
}
