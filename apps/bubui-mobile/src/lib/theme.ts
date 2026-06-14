/** Paleta y tokens de Bubui (rosa · negro · blanco) con soporte claro/oscuro.
 *
 *  Las pantallas leen los colores con `useTheme()` y construyen sus estilos
 *  con un factory `makeStyles(c)`. Se mantiene un export `colors` = paleta
 *  clara como *fallback* para que cualquier referencia sin migrar siga
 *  renderizando (en claro) sin romper la app.
 */

import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

export type Palette = {
  pink: string;
  pinkDeep: string;
  pinkSoft: string;
  pinkWash: string;
  black: string;
  ink: string;
  gray: string;
  grayLight: string;
  border: string;
  white: string; // superficie base (tarjetas, barras). En oscuro NO es blanco.
  bg: string; // fondo de pantalla
  green: string;
  /** Color de texto/icono SOBRE el acento rosa. Siempre claro en ambos temas. */
  onAccent: string;
};

export const lightColors: Palette = {
  pink: "#EC4899",
  pinkDeep: "#DB2777",
  pinkSoft: "#FCE7F3",
  pinkWash: "#FDF2F8",
  black: "#0A0A0A",
  ink: "#1F1F1F",
  gray: "#6B7280",
  grayLight: "#9CA3AF",
  border: "rgba(0,0,0,0.08)",
  white: "#FFFFFF",
  bg: "#FCF7FB", // lienzo cálido (no #FFF plano) — da “aire” premium
  green: "#059669",
  onAccent: "#FFFFFF"
};

export const darkColors: Palette = {
  pink: "#EC4899",
  pinkDeep: "#F472B6",
  pinkSoft: "#3A2230",
  pinkWash: "#241019",
  black: "#F5F5F7",
  ink: "#E7E7EA",
  gray: "#9AA0AA",
  grayLight: "#6B7280",
  border: "rgba(255,255,255,0.14)",
  white: "#1B1B1F",
  bg: "#0B0B0D",
  green: "#34D399",
  onAccent: "#FFFFFF"
};

/** Fallback estático (claro) para código aún no migrado a `useTheme`. */
export const colors: Palette = lightColors;

/** Gradientes de marca (Bubui 2.0). Dan profundidad y energía frente a las
 *  superficies planas. Son vivos en ambos temas, así que no dependen de
 *  claro/oscuro. Se usan con <Gradient> / expo-linear-gradient. */
export const gradients = {
  /** Rosa → coral: superficies “hero” cálidas (ahorro, CTAs destacados). */
  hero: ["#FF3D9A", "#FF6B5E"] as string[],
  /** Rosa → violeta: profundidad fría (perfil, banners). */
  brand: ["#EC4899", "#7C3AED"] as string[],
  /** Rosa sólido degradado sutil para botones/FAB. */
  pink: ["#F95FB0", "#DB2777"] as string[],
  /** Overlay oscuro de abajo→arriba para legibilidad sobre fotos. */
  scrim: ["transparent", "rgba(8,4,12,0.62)"] as string[]
};

/** Punto de inicio/fin diagonal por defecto para los gradientes hero. */
export const gradientDir = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } };

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999
};

export const shadow = {
  card: {
    shadowColor: "#EC4899",
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3
  },
  btn: {
    shadowColor: "#EC4899",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4
  },
  // Elevación grande para superficies flotantes (nav de cristal, FAB, hero).
  lg: {
    shadowColor: "#DB2777",
    shadowOpacity: 0.22,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12
  }
};

type ThemeValue = { colors: Palette; dark: boolean };

const ThemeContext = createContext<ThemeValue>({ colors: lightColors, dark: false });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const value = useMemo<ThemeValue>(() => ({ colors: dark ? darkColors : lightColors, dark }), [dark]);
  return React.createElement(ThemeContext.Provider, { value }, children);
}

/** Devuelve la paleta activa (clara u oscura según el sistema). */
export function useTheme(): Palette {
  return useContext(ThemeContext).colors;
}

/** Igual que `useTheme` pero incluye el flag `dark` (para StatusBar, etc.). */
export function useThemeMeta(): ThemeValue {
  return useContext(ThemeContext);
}
