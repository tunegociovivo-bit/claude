import GmbWidgetClient from "@/components/gmb/GmbWidgetClient";

export const dynamic = "force-dynamic";

// Página pública embebible (iframe) con las reseñas de una ficha.
export default function GmbWidgetPage({ params }: { params: { id: string } }) {
  return <GmbWidgetClient id={params.id} />;
}
