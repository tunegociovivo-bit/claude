/**
 * Fuente del vídeo de presentación del onboarding (pre-registro).
 *
 * Se sirve por streaming desde el backend, en una ruta PÚBLICA (sin login,
 * porque el onboarding es previo al registro):
 *   <API_BASE>/bubui/onboarding-intro.mp4
 * El archivo vive en agencia-platform/public/bubui/onboarding-intro.mp4 y se
 * publica al desplegar el backend (Railway).
 *
 * Si en el futuro se quiere empaquetar en el binario (offline), colocar el
 * .mp4 en apps/bubui-mobile/assets/ y usar require() en su lugar.
 */
import { API_BASE } from "./api";

export const ONBOARDING_VIDEO_URL = `${API_BASE}/bubui/onboarding-intro.mp4`;

/** Devuelve la fuente para <Video source={...} /> o null si no hay vídeo. */
export function onboardingVideoSource(): { uri: string } | null {
  return ONBOARDING_VIDEO_URL ? { uri: ONBOARDING_VIDEO_URL } : null;
}
