import GmbWidgetClient from "@/components/gmb/GmbWidgetClient";

export const dynamic = "force-dynamic";

// Página pública embebible (iframe) con las reseñas de una ficha.
export default async function GmbWidgetPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <GmbWidgetClient id={params.id} />;
}
