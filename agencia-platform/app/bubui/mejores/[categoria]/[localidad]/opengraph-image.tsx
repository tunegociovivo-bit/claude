import { categoryBySlug } from "@/lib/bubui/directory";
import { ogImage, deslug, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/bubui/og";

export const alt = "Ranking Bubui";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image({ params }: { params: { categoria: string; localidad: string } }) {
  const cat = categoryBySlug(params.categoria);
  const catLabel = (cat?.label ?? deslug(params.categoria)).toLowerCase();
  const year = new Date().getFullYear();
  return ogImage(`🏆 Mejores ${catLabel} de ${deslug(params.localidad)}`, `Ranking ${year} · Puntuación Bubui`);
}
