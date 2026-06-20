import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/bubui/og";

export const alt = "Directorio de negocios locales · Bubui";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage("Directorio de negocios locales", "Por sector y localidad, con descuentos");
}
