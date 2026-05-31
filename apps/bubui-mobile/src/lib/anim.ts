/**
 * Utilidades de animación de Bubui (API Animated nativa — sin dependencias).
 *
 * Principios: ease-out fuerte para entradas, duraciones cortas (<500ms para
 * UI), transform/opacity en GPU (`useNativeDriver`) y respeto de "reduce
 * motion" del sistema (entonces se hace fade mínimo o aparición instantánea).
 */
import { useEffect, useState } from "react";
import { Easing, AccessibilityInfo } from "react-native";

// Curva ease-out fuerte (entradas/salidas) y ease-in-out para movimiento.
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1);
export const easeInOut = Easing.bezier(0.77, 0, 0.175, 1);

/** Delay base entre elementos de un grupo escalonado (stagger). */
export const STAGGER = 60;
export const stagger = (index: number, base = STAGGER, start = 0) => start + index * base;

/** ¿El usuario ha pedido reducir el movimiento? (accesibilidad) */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (alive) setReduce(!!v); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduce(!!v));
    return () => {
      alive = false;
      // RN moderno devuelve { remove }; versiones antiguas, una función.
      const anySub = sub as unknown as { remove?: () => void } | (() => void) | undefined;
      if (anySub && typeof (anySub as { remove?: () => void }).remove === "function") {
        (anySub as { remove: () => void }).remove();
      } else if (typeof anySub === "function") {
        (anySub as () => void)();
      }
    };
  }, []);
  return reduce;
}
