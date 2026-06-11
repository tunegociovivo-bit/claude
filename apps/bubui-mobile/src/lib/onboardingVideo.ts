/**
 * Fuente del vídeo de presentación del onboarding (pre-registro).
 *
 * El vídeo va EMPAQUETADO en el binario mediante require(), para que se
 * reproduzca de inmediato y de forma fiable, sin depender de la red ni del
 * backend: el onboarding es lo primero que ve el usuario (antes de
 * registrarse) y hacer streaming en ese punto dejaba la reproducción en negro.
 *
 * El archivo vive en apps/bubui-mobile/assets/onboarding-intro.mp4.
 * (La copia pública en agencia-platform/public/bubui/onboarding-intro.mp4 se
 * mantiene para la versión web.)
 */
import type { AVPlaybackSource } from "expo-av";

// require() incrusta el asset en la app a través de Metro.
const ONBOARDING_VIDEO: AVPlaybackSource = require("../../assets/onboarding-intro.mp4");

/** Devuelve la fuente para <Video source={...} />. */
export function onboardingVideoSource(): AVPlaybackSource {
  return ONBOARDING_VIDEO;
}
