/**
 * Carga y aplicación global de la fuente Poppins.
 *
 * Estrategia:
 * 1) `useAppFonts()` registra las variantes Regular/SemiBold/Bold/ExtraBold/Black.
 * 2) `applyPoppinsToTextDefaults()` parchea Text.render una sola vez para
 *    que cualquier <Text> del árbol use la variante de Poppins que
 *    corresponde a su `fontWeight` actual — sin tocar componente a
 *    componente y respetando overrides explícitos de `fontFamily`.
 *
 * Andriod no aplica `fontWeight` cuando se usa una fuente custom: el
 * mapeo a familias específicas es lo que hace que los pesos se vean.
 */

import { Text, StyleSheet } from "react-native";
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
  Poppins_900Black
} from "@expo-google-fonts/poppins";
import Ionicons from "@expo/vector-icons/Ionicons";

// CAUSA RAÍZ de los iconos en blanco (menú inferior/FAB) en el build Android:
// solo se embebía la fuente Ionicons vía el config plugin (expo-font), pero NUNCA
// se CARGABA en tiempo de ejecución, y @expo/vector-icons necesita que la fuente
// esté registrada en el gestor de fuentes de RN para pintar los glifos (PUA). Al
// no cargarla, los <Ionicons> salían vacíos aunque el .ttf estuviera en el APK.
// Solución: cargar Ionicons.font en el arranque (junto a Poppins) y esperar a
// que estén listas antes de renderizar la UI. No se "tapa" nada: se carga la
// fuente real de los iconos.
export function useAppFonts() {
  return useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    Poppins_900Black,
    // Registra la fuente de iconos (equivale a Ionicons.loadFont()).
    ...Ionicons.font
  });
}

const WEIGHT_TO_FAMILY: Record<string, string> = {
  "100": "Poppins_400Regular",
  "200": "Poppins_400Regular",
  "300": "Poppins_400Regular",
  "400": "Poppins_400Regular",
  normal: "Poppins_400Regular",
  "500": "Poppins_500Medium",
  "600": "Poppins_600SemiBold",
  "700": "Poppins_700Bold",
  bold: "Poppins_700Bold",
  "800": "Poppins_800ExtraBold",
  "900": "Poppins_900Black"
};

let patched = false;

export function applyPoppinsToTextDefaults() {
  if (patched) return;
  patched = true;

  // Parche del render de Text: solo añade fontFamily si no hay uno
  // explícito en el estilo (deja pasar las fuentes especiales).
  const TextAny = Text as any;
  const origRender = TextAny.render;
  TextAny.render = function patchedRender(...args: any[]) {
    const el = origRender.apply(this, args);
    const flat = StyleSheet.flatten(el.props.style) ?? {};
    if (flat.fontFamily) return el;
    const weight = String(flat.fontWeight ?? "400");
    const family = WEIGHT_TO_FAMILY[weight] ?? "Poppins_400Regular";
    // Antepone fontFamily para que cualquier `style` posterior pueda
    // sobreescribirla si hace falta. Mantenemos también el fontWeight
    // por compatibilidad con accessibility/web.
    return {
      ...el,
      props: {
        ...el.props,
        style: [{ fontFamily: family }, el.props.style]
      }
    };
  };
}
