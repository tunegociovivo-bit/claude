/**
 * Wrapper fino sobre expo-linear-gradient con dirección diagonal por defecto
 * (la que usan las superficies “hero” de Bubui 2.0). Mantiene el JSX de las
 * pantallas limpio: <Gradient colors={gradients.hero} style={…}>…</Gradient>.
 */
import { LinearGradient } from "expo-linear-gradient";
import type { StyleProp, ViewStyle } from "react-native";
import { gradientDir } from "../lib/theme";

type Point = { x: number; y: number };

export function Gradient({
  colors,
  style,
  children,
  start = gradientDir.start,
  end = gradientDir.end
}: {
  colors: string[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  start?: Point;
  end?: Point;
}) {
  return (
    <LinearGradient colors={colors} start={start} end={end} style={style}>
      {children}
    </LinearGradient>
  );
}
