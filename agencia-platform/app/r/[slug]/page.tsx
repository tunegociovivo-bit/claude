import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import ReviewWidget from "@/components/reviews/ReviewWidget";
import StarRedirectWidget from "@/components/reviews/StarRedirectWidget";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const client = await prisma.reviewClient.findFirst({
    where: { slug: params.slug },
    select: { name: true }
  });
  return {
    title: client ? `Deja una reseña — ${client.name}` : "Reseña",
    robots: { index: false, follow: false }
  };
}

export default async function ReviewPublicPage({
  params,
  searchParams
}: {
  params: { slug: string };
  searchParams: { [k: string]: string | string[] | undefined };
}) {
  const client = await prisma.reviewClient.findFirst({
    where: { slug: params.slug },
    select: {
      slug: true,
      name: true,
      mode: true,
      positiveUrl: true,
      negativeUrl: true
    }
  });
  if (!client) notFound();

  // Modo STAR_REDIRECT: landing con 5 estrellas. Si llega ?s=N
  // hacemos redirect server-side — mejor que el JS del plugin PHP
  // original porque el navegador no pinta la landing dos veces
  // (no hay flash de contenido) y los crawlers lo siguen como HTTP
  // 307 limpio.
  if (client.mode === "STAR_REDIRECT") {
    const rawStars = Array.isArray(searchParams.s) ? searchParams.s[0] : searchParams.s;
    const stars = rawStars ? Math.max(0, Math.min(5, parseInt(rawStars, 10) || 0)) : 0;
    if (stars >= 4 && client.positiveUrl) {
      redirect(client.positiveUrl);
    }
    if (stars >= 1 && stars <= 3 && client.negativeUrl) {
      redirect(client.negativeUrl);
    }
    return (
      <div style={{ padding: 8, maxWidth: 560, margin: "0 auto" }}>
        <StarRedirectWidget slug={client.slug} clientName={client.name} />
      </div>
    );
  }

  // Modo AI_GENERATOR (histórico)
  return (
    <div style={{ padding: "8px", maxWidth: "560px", margin: "0 auto" }}>
      <ReviewWidget slug={client.slug} clientName={client.name} />
    </div>
  );
}
