/**
 * Fuentes para las imágenes de next/og (mockup, ranking).
 *
 * IMPORTANTE: si no se pasan fuentes, Satori usa una fuente por defecto que NO
 * cubre glifos como "★"; entonces intenta DESCARGAR una fuente de Google Fonts
 * al vuelo y, si la red falla (o devuelve 400), el render CRASHEA. Cargamos las
 * Inter incluidas en /public/fonts (trazadas en el standalone) para que todo el
 * texto —incluido ★— se renderice sin depender de la red.
 */
import { readFileSync } from "fs";
import { join } from "path";

type OgFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let cached: OgFont[] | null = null;

export function interFonts(): OgFont[] {
  if (cached) return cached;
  const dir = join(process.cwd(), "public", "fonts");
  cached = [
    { name: "Inter", data: readFileSync(join(dir, "Inter-Regular.ttf")), weight: 400, style: "normal" },
    { name: "Inter", data: readFileSync(join(dir, "Inter-Bold.ttf")), weight: 700, style: "normal" }
  ];
  return cached;
}
