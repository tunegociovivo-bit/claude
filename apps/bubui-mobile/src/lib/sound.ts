/**
 * Sonido + haptics para las acciones clave de Bubui (expo-av / expo-haptics).
 *
 * - Sonidos cortos generados localmente (assets/sfx) → sin licencias.
 * - Se precargan y se reproducen con replayAsync (baja latencia).
 * - `playsInSilentModeIOS` para que el sonido de celebración suene aunque el
 *   móvil esté en silencio.
 * - Tolerante a fallos: si el audio no carga, no rompe la acción.
 * - `setSoundEnabled(false)` permite silenciar (futuro ajuste en Cuenta).
 */
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";

const SOURCES = {
  tap: require("../../assets/sfx/tap.wav"),
  success: require("../../assets/sfx/success.wav"),
  coin: require("../../assets/sfx/coin.wav")
} as const;
type SfxName = keyof typeof SOURCES;

let enabled = true;
let configured = false;
const cache: Partial<Record<SfxName, Audio.Sound>> = {};

export function setSoundEnabled(v: boolean) {
  enabled = v;
}

async function ensureConfigured() {
  if (configured) return;
  configured = true;
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, shouldDuckAndroid: true });
  } catch {}
}

async function getSound(name: SfxName): Promise<Audio.Sound | null> {
  const existing = cache[name];
  if (existing) return existing;
  try {
    await ensureConfigured();
    const { sound } = await Audio.Sound.createAsync(SOURCES[name], { volume: 0.55 });
    cache[name] = sound;
    return sound;
  } catch {
    return null;
  }
}

async function play(name: SfxName) {
  if (!enabled) return;
  try {
    const s = await getSound(name);
    if (s) await s.replayAsync();
  } catch {}
}

/** API por acción: combina sonido + haptic acorde a la intensidad. */
export const sfx = {
  /** Toque en un botón clave. */
  tap: () => {
    void play("tap");
    Haptics.selectionAsync().catch(() => {});
  },
  /** Éxito importante (ahorro aplicado). */
  success: () => {
    void play("success");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  /** Recompensa / desbloqueo. */
  coin: () => {
    void play("coin");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  /** Solo vibración sutil (para pulsaciones genéricas, sin sonido). */
  haptic: () => {
    Haptics.selectionAsync().catch(() => {});
  }
};
