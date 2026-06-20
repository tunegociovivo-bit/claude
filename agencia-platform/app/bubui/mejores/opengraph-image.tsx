import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/bubui/og";

export const alt = "Rankings Bubui";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  const year = new Date().getFullYear();
  return ogImage("🏆 Los mejores negocios locales", `Rankings ${year} · Puntuación Bubui`);
}
