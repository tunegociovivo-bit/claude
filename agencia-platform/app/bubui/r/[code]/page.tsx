/**
 * Enlace de invitación: /bubui/r/<code>
 *
 * Server component: genera metadata Open Graph PERSONALIZADA para que, al
 * compartir el enlace por WhatsApp/redes, aparezca una tarjeta con gancho
 * ("Un amigo te regala un cupón en <negocio>") en vez de texto pelado — sube
 * mucho el clic. La redirección al alta la hace ReferralRedirect (cliente).
 * La imagen OG la genera opengraph-image.tsx.
 */
import type { Metadata } from "next";
import { getReferralInvite } from "@/lib/bubui/referral";
import ReferralRedirect from "./ReferralRedirect";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { code: string } }): Promise<Metadata> {
  const invite = await getReferralInvite(params.code).catch(() => null);
  const title = invite
    ? `Un amigo te regala un cupón en ${invite.businessName} 🎁`
    : "Un amigo te invita a Bubui 🎁";
  const description = invite
    ? `Únete a Bubui y llévate un ${invite.welcomePct}% de bienvenida en ${invite.businessName}` +
      `${invite.city ? ` (${invite.city})` : ""}. Y descubre descuentos en negocios de tu barrio.`
    : "Únete a Bubui con el cupón de bienvenida de tu amigo y ahorra en negocios de tu barrio.";
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary_large_image", title, description }
  };
}

export default function ReferralLanding({ params, searchParams }: { params: { code: string }; searchParams: { offer?: string } }) {
  return (
    <main className="max-w-md mx-auto px-4 py-20 text-center">
      <h1 className="bubui-wordmark mx-auto justify-center" style={{ fontSize: 56 }}>
        bubui
      </h1>
      <p className="text-black/60 mt-4">Un amigo te invita a Bubui 🎁</p>
      <p className="text-black/45 text-sm mt-1">Llevándote un cupón de bienvenida. Te llevamos al registro…</p>
      <ReferralRedirect code={params.code} offerId={searchParams.offer} />
    </main>
  );
}
