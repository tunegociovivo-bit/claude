/**
 * Enlace principal del cliente de reseñas: /g/[slug]
 *
 * Redirige (server-side, 307) a una de dos URLs según el switch manual que el
 * admin controla con un botón (campo gateTarget):
 *   - "feedback"  → /g/[slug]/opinar   (URL A: formulario de opinión)
 *   - "generator" → /r/[slug]          (URL B: generador de reseñas IA)
 *
 * El admin comparte SIEMPRE este enlace; cambia el destino cuando quiere.
 */
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function GatePage({ params }: { params: { slug: string } }) {
  const client = await prisma.reviewClient.findFirst({
    where: { slug: params.slug },
    select: { slug: true, gateTarget: true }
  });
  if (!client) notFound();
  if (client.gateTarget === "feedback") redirect(`/g/${client.slug}/opinar`);
  redirect(`/r/${client.slug}`);
}
