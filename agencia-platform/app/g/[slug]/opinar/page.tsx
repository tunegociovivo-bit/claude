/**
 * URL "A" del switch: /g/[slug]/opinar
 *
 * Muestra el texto editable de cabecera (gateHeader) que el admin configura, y
 * debajo un formulario donde el usuario deja su opinión sobre ese texto. Las
 * opiniones quedan guardadas (privadas) para que la agencia las consulte.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/prisma";
import OpinarForm from "@/components/reviews/OpinarForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const client = await prisma.reviewClient.findFirst({ where: { slug: params.slug }, select: { name: true } });
  return { title: client ? `Tu opinión — ${client.name}` : "Opinión", robots: { index: false, follow: false } };
}

export default async function OpinarPage({ params }: { params: { slug: string } }) {
  const client = await prisma.reviewClient.findFirst({
    where: { slug: params.slug },
    select: { slug: true, name: true, gateHeader: true }
  });
  if (!client) notFound();

  const header = (client.gateHeader ?? "").trim();

  return (
    <main className="min-h-screen bg-slate-50 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8">
          {/* Cabecera editable */}
          {header ? (
            <div className="prose prose-slate max-w-none whitespace-pre-wrap text-slate-800 text-[15px] leading-relaxed">
              {header}
            </div>
          ) : (
            <h1 className="text-xl font-bold text-slate-900">Déjanos tu opinión</h1>
          )}

          <div className="mt-6 border-t border-slate-100 pt-6">
            <OpinarForm slug={client.slug} />
          </div>
        </div>
        <p className="text-center text-[11px] text-slate-400 mt-4">{client.name}</p>
      </div>
    </main>
  );
}
