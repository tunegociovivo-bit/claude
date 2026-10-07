/**
 * Página PÚBLICA de valoración de un negocio (embudo de reseñas del GMB Hub).
 * 4-5 estrellas → enlace directo de reseña en Google. 1-3 → formulario de opinión privada al
 * dueño, con el acceso a Google siempre visible (sin review gating).
 */
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import FunnelStars from "./FunnelStars";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  return prisma.gmbReviewFunnel.findUnique({ where: { slug } }).catch(() => null);
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const f = await load((await props.params).slug);
  return { title: f ? `Valora ${f.businessName}` : "Valoración", robots: { index: false, follow: false } };
}

export default async function OpinaPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const f = await load(slug);
  if (!f || !f.active) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#64748b", padding: 24 }}>
        Esta página de valoración no está disponible.
      </main>
    );
  }
  await prisma.gmbReviewFunnelEvent.create({ data: { workspaceId: f.workspaceId, funnelId: f.id, type: "view" } }).catch(() => {});
  return (
    <FunnelStars
      slug={f.slug}
      name={f.businessName}
      address={f.address}
      headline={f.headline}
      color={/^#[0-9a-fA-F]{6}$/.test(f.color) ? f.color : "#F4600C"}
      logoUrl={f.logoUrl}
    />
  );
}
