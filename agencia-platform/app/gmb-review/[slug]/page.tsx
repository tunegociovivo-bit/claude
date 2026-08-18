/**
 * Landing PÚBLICA de captación de reseñas. Un único CTA que lleva a Google para TODOS (sin review
 * gating, sin filtrar por sentimiento, sin incentivos). No pide la valoración antes. Server component.
 */
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export default async function ReviewLanding({ params, searchParams }: { params: { slug: string }; searchParams: { ct?: string } }) {
  const campaign = await prisma.gmbReviewCampaign.findUnique({ where: { publicSlug: params.slug } }).catch(() => null);
  if (!campaign || !campaign.active) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div style={{ textAlign: "center", color: "#64748b" }}>Esta página de reseña no está disponible.</div>
      </main>
    );
  }
  const client = await prisma.gmbClient.findUnique({ where: { id: campaign.clientId } }).catch(() => null);
  const ct = typeof searchParams?.ct === "string" ? `?ct=${encodeURIComponent(searchParams.ct)}` : "";
  const goUrl = `/api/v1/gmb/public/review/${campaign.publicSlug}/go${ct}`;
  const name = client?.name ?? "nuestro negocio";

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
      <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 28, textAlign: "center", boxShadow: "0 4px 24px rgba(0,0,0,.06)" }}>
        <div style={{ fontSize: 40 }}>⭐</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "12px 0 4px" }}>{name}</h1>
        <p style={{ color: "#475569", fontSize: 14, lineHeight: 1.5, margin: "8px 0 20px" }}>Tu opinión nos ayuda muchísimo. Si te apetece, deja una reseña en Google. ¡Gracias por tu confianza!</p>
        <a href={goUrl} style={{ display: "inline-block", background: "#F4600C", color: "#fff", padding: "12px 20px", borderRadius: 10, textDecoration: "none", fontWeight: 600 }}>Dejar reseña en Google</a>
        <p style={{ color: "#94a3b8", fontSize: 11, marginTop: 18 }}>No pedimos valoración previa ni condicionamos tu opinión. Todas las reseñas van directas a Google.</p>
      </div>
    </main>
  );
}
