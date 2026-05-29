import { Image } from "react-native";

// Logo oficial "bubui" con pin de ubicación (PNG proporcionado por el
// usuario). Ratio ancho/alto del recorte = 940/621.
const RATIO = 940 / 621;

/** Wordmark = logo oficial. `size` controla la altura. `color` se ignora
 *  (el logo es rosa); se mantiene en la firma por compatibilidad. */
export function Wordmark({ size = 48 }: { size?: number; color?: string }) {
  return (
    <Image
      source={require("../../assets/logo.png")}
      style={{ height: size, width: size * RATIO }}
      resizeMode="contain"
    />
  );
}
