/**
 * Número que sube animado desde 0 hasta `value` (ease-out). Ideal para
 * "Has ahorrado 12,40 €" o contadores de compras. Respeta reduce-motion.
 */
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Text, type StyleProp, type TextStyle } from "react-native";
import { useReduceMotion } from "../lib/anim";

type Props = {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
};

export function CountUp({ value, duration = 900, decimals = 0, prefix = "", suffix = "", style }: Props) {
  const reduce = useReduceMotion();
  const av = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduce || value === 0) { setDisplay(value); return; }
    av.setValue(0);
    const id = av.addListener(({ value: v }) => setDisplay(v));
    Animated.timing(av, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => av.removeListener(id);
  }, [value, duration, reduce, av]);

  return (
    <Text style={style}>
      {prefix}
      {display.toFixed(decimals)}
      {suffix}
    </Text>
  );
}
