import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import ReviewWidget from "@/components/reviews/ReviewWidget";

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

export default async function ReviewPublicPage({ params }: { params: { slug: string } }) {
  const client = await prisma.reviewClient.findFirst({
    where: { slug: params.slug },
    select: { slug: true, name: true }
  });
  if (!client) notFound();

  return (
    <div style={{ padding: "8px", maxWidth: "560px", margin: "0 auto" }}>
      <ReviewWidget slug={client.slug} clientName={client.name} />
    </div>
  );
}
