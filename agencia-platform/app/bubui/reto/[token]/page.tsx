/**
 * Landing del RETO personalizado: /reto/<token> (dominio bubui.app).
 *
 * Server component: genera metadata Open Graph ESPECÍFICA del reto para que, al
 * compartir el enlace por WhatsApp, aparezca una tarjeta con el negocio y el
 * descuento (verificable SIN JavaScript) en vez del título genérico de Bubui.
 * La imagen OG la genera opengraph-image.tsx. La interacción (aceptar, abrir la
 * app, alta) la hace RetoClient (cliente).
 */
import type { Metadata } from "next";
import { getCustomDealPublic, customDealShareCopy } from "@/lib/bubui/custom-deal";
import { recordDealTrace } from "@/lib/bubui/deal-trace";
import { bubuiUrl } from "@/lib/bubui/url";
import RetoClient from "./RetoClient";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { token: string } }): Promise<Metadata> {
  const deal = await getCustomDealPublic(params.token).catch(() => null);
  const { title, description } = customDealShareCopy(deal);
  const url = bubuiUrl(`/reto/${params.token}`);
  // La imagen OG absoluta la sirve opengraph-image.tsx en esta misma ruta.
  const image = bubuiUrl(`/reto/${params.token}/opengraph-image`);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: "Bubui",
      images: [{ url: image, width: 1200, height: 630, alt: title }]
    },
    twitter: { card: "summary_large_image", title, description, images: [image] }
  };
}

export default async function RetoPage({ params }: { params: { token: string } }) {
  // Traza segura (sin PII): la página del reto se ha abierto/crawleado.
  await recordDealTrace({ token: params.token, stage: "web_page_view", platform: "web", source: "server" });
  const deal = await getCustomDealPublic(params.token).catch(() => null);
  if (deal?.friendShareUrl) redirect(deal.friendShareUrl);
  return <RetoClient token={params.token} />;
}
