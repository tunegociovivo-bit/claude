/**
 * Landing-demo pública: /bubui/demo/<leadId>
 *
 * Página de venta personalizada que se manda por WhatsApp a un lead (negocio
 * captado en Google Places). Muestra cómo se vería SU negocio en Bubui usando
 * sus propios datos de Google (nombre, nota, reseñas) y explica la mecánica
 * viral. Sin auth: el id de lead (cuid) actúa de clave del enlace.
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

function stars(rating: number | null): string {
  if (rating == null) return "";
  const full = Math.round(rating);
  return "★".repeat(Math.max(0, Math.min(5, full))) + "☆".repeat(Math.max(0, 5 - full));
}

export default async function BubuiDemoPage({ params }: { params: { leadId: string } }) {
  const lead = await prisma.lead.findUnique({
    where: { id: params.leadId },
    select: { name: true, province: true, category: true, rating: true, reviewsCount: true }
  });
  if (!lead) notFound();

  const name = lead.name;
  const rating = lead.rating ?? null;
  const reviews = lead.reviewsCount ?? 0;
  const demoOfferPct = 25;
  const friends = 5;

  return (
    <main className="max-w-md mx-auto px-4 pt-10 pb-24">
      <div className="text-center">
        <h1 className="bubui-wordmark mx-auto justify-center" style={{ fontSize: 48 }}>bubui</h1>
        <p className="mt-3 text-black/60 text-sm">Así se vería tu negocio</p>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-black">{name}</h2>
        {rating != null && (
          <p className="mt-1 text-sm text-black/60">
            <span className="text-amber-500">{stars(rating)}</span> {rating} · {reviews} reseñas en Google
          </p>
        )}
      </div>

      {/* Tarjeta de oferta tipo Bubui (mock con su marca) */}
      <div className="mt-7 rounded-3xl border border-black/10 bg-white shadow-sm overflow-hidden">
        <div className="h-28 bg-gradient-to-br from-pink-400 to-pink-600 flex items-end justify-end p-3">
          <span className="bg-white/95 text-pink-700 font-black text-sm rounded-full px-3 py-1">-{demoOfferPct}%</span>
        </div>
        <div className="p-4">
          <p className="font-extrabold text-black">{name}</p>
          <p className="text-xs text-black/50">{lead.category ?? "Tu negocio"}{lead.province ? ` · ${lead.province}` : ""}</p>
          <div className="mt-3 rounded-2xl border-2 border-pink-300 bg-pink-50 p-3">
            <p className="text-sm font-bold text-pink-700">🔒 Oferta especial desbloqueable</p>
            <p className="text-xs text-black/70 mt-0.5">
              Tras pagar, tu cliente recibe un <b>{demoOfferPct}%</b> que activa al traer a {friends} amigos a Bubui.
            </p>
          </div>
        </div>
      </div>

      {/* Beneficios */}
      <div className="mt-8 space-y-4">
        <Benefit emoji="🔁" title="Clientes que vuelven">
          Escanean su ticket, acumulan ahorro y reciben ofertas para la próxima visita.
        </Benefit>
        <Benefit emoji="🚀" title="Boca a boca de verdad">
          La oferta-reto solo se activa si traen amigos. Cada cliente te trae {friends} nuevos.
        </Benefit>
        <Benefit emoji="⭐" title="Más reseñas de 5★ en Google">
          Justo después de comprar, la app les invita a valorarte en Google. Sube tu nota.
        </Benefit>
        <Benefit emoji="🛡️" title="Sin fraude">
          El importe se valida con foto del ticket; el descuento solo cuenta si han comprado de verdad.
        </Benefit>
      </div>

      <div className="mt-9 rounded-2xl bg-black text-white p-5 text-center">
        <p className="font-extrabold text-lg">¿Lo montamos para {name}?</p>
        <p className="text-white/70 text-sm mt-1">Te lo dejamos listo en minutos, sin permanencia.</p>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`Hola, quiero Bubui para ${name}`)}`}
          className="inline-block mt-4 bg-pink-500 hover:bg-pink-600 transition-colors text-white font-bold rounded-full px-6 py-3"
        >
          Quiero Bubui para mi negocio
        </a>
      </div>

      <p className="mt-8 text-center text-[11px] text-black/40">
        Negocio Vivo · Bubui — fidelización con crecimiento viral para negocios locales.
      </p>
    </main>
  );
}

function Benefit({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="text-2xl leading-none">{emoji}</div>
      <div>
        <p className="font-bold text-black">{title}</p>
        <p className="text-sm text-black/60 leading-snug">{children}</p>
      </div>
    </div>
  );
}
