import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import VoiceReviewWidget from "@/components/voice/VoiceReviewWidget";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const b = await prisma.voiceBusiness.findFirst({
    where: { slug: params.slug },
    select: { name: true }
  });
  return {
    title: b ? `Reseña por voz — ${b.name}` : "Voice review",
    robots: { index: false, follow: false }
  };
}

export default async function VoiceReviewPublic(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const b = await prisma.voiceBusiness.findFirst({
    where: { slug: params.slug },
    select: {
      slug: true,
      name: true,
      introText: true,
      disclaimer: true,
      googleUrl: true,
      trustpilotUrl: true,
      maxSeconds: true
    }
  });
  if (!b) notFound();

  return (
    <div style={{ padding: "12px", maxWidth: "600px", margin: "0 auto" }}>
      <VoiceReviewWidget
        slug={b.slug}
        name={b.name}
        introText={b.introText}
        disclaimer={b.disclaimer}
        googleUrl={b.googleUrl}
        trustpilotUrl={b.trustpilotUrl}
        maxSeconds={b.maxSeconds}
      />
    </div>
  );
}
