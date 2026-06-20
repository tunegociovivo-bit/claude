import { categoryBySlug } from "@/lib/bubui/directory";
import { ogImage, deslug, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/bubui/og";

export const alt = "Directorio Bubui";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: { categoria: string } }) {
  const cat = categoryBySlug(params.categoria);
  // Puede ser sector o localidad; si no es sector, mostramos el slug como localidad.
  return cat
    ? ogImage(cat.label, "Encuentra negocios con descuentos cerca de ti")
    : ogImage(`Negocios en ${deslug(params.categoria)}`, "Descuentos y ofertas en tu localidad");
}
