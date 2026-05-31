/**
 * Entrada suave de contenido: fade + leve desplazamiento vertical.
 * - `delay` para escalonar (stagger) varios elementos.
 * - `replayOnFocus` re-anima al volver a la pantalla (efecto "la página
 *   cobra vida" cada vez que la abres desde el menú inferior).
 * Respeta reduce-motion (aparece sin movimiento).
 */
import { useCallback, useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { easeOut, useReduceMotion } from "../lib/anim";

type Props = {
  children: React.ReactNode;
  delay?: number;
  dy?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  replayOnFocus?: boolean;
};

export function FadeIn({ children, delay = 0, dy = 14, duration = 460, style, replayOnFocus = false }: Props) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;

  const run = useCallback(() => {
    if (reduce) { v.setValue(1); return; }
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration, delay, easing: easeOut, useNativeDriver: true }).start();
  }, [v, duration, delay, reduce]);

  // Mount (cuando NO se re-anima por foco).
  useEffect(() => {
    if (!replayOnFocus) run();
  }, [replayOnFocus, run]);

  // Re-anima en cada foco de la pantalla (incluye el primero).
  useFocusEffect(
    useCallback(() => {
      if (replayOnFocus) run();
    }, [replayOnFocus, run])
  );

  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] });
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
