import { ogImage, deslug, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/bubui/og";

export const alt = "Directorio Bubui";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image({ params }: { params: { provincia: string } }) {
  return ogImage(`Negocios en ${deslug(params.provincia)}`, "Descuentos y ofertas en tu provincia");
}
