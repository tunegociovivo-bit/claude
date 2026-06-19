import { categoryBySlug } from "@/lib/bubui/directory";
import { ogImage, deslug, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/bubui/og";

export const alt = "Directorio Bubui";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({ params }: { params: { categoria: string; localidad: string } }) {
  const cat = categoryBySlug(params.categoria);
  const catLabel = cat?.label ?? deslug(params.categoria);
  return ogImage(`${catLabel} en ${deslug(params.localidad)}`, "Descuentos y ofertas cerca de ti");
}
