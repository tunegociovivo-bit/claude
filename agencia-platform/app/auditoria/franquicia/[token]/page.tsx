import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Auditoría privada · Negocio Vivo", robots: { index: false, follow: false } };

export default async function FranchiseAuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(token)) notFound();
  const lead = await prisma.lead.findFirst({
    where: { rawData: { path: ["franchiseGrowth", "publicAudit", "token"], equals: token } },
    select: { id: true, name: true, rawData: true }
  });
  if (!lead) notFound();
  const raw: any = lead.rawData ?? {};
  const audit = raw.franchiseAudit;
  const growth = raw.franchiseGrowth;
  if (!audit?.metrics || !growth?.pilot) notFound();
  const now = new Date().toISOString();
  await prisma.lead.update({ where: { id: lead.id }, data: { rawData: { ...raw, franchiseGrowth: { ...growth, publicAudit: { ...growth.publicAudit, views: (growth.publicAudit?.views ?? 0) + 1, lastViewedAt: now } } } } }).catch(() => null);
  const metrics = audit.metrics;
  const findings = Array.isArray(audit.findings) ? audit.findings : [];
  const signals = Array.isArray(growth.signals) ? growth.signals : [];
  return <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-600/30 to-sky-500/10 p-8">
        <div className="text-xs font-bold uppercase tracking-[0.25em] text-sky-300">Auditoría privada · Negocio Vivo</div>
        <h1 className="mt-3 text-4xl font-black">{lead.name}: salud de la red local</h1>
        <p className="mt-3 max-w-3xl text-slate-300">Análisis sobre una muestra de {metrics.sampled} ubicaciones públicas. Los datos son observaciones verificables; no son estimaciones de facturación.</p>
      </header>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[["Índice", `${audit.score}/100`], ["Muestra", metrics.sampled], ["Valoración", `${metrics.avgRating ?? "—"}★`], ["≤3,5★", `${metrics.lowRatingPct}%`], ["Sin web", `${metrics.noWebsitePct}%`], ["Sin teléfono", `${metrics.noPhonePct}%`]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="text-xs text-slate-400">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></div>)}
      </section>
      <section><h2 className="text-2xl font-bold">Incidencias prioritarias</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{findings.map((finding: any) => <article key={finding.key} className="rounded-2xl border border-white/10 bg-white/5 p-5"><h3 className="font-bold text-sky-200">{finding.title}</h3><p className="mt-2 text-sm text-slate-300">{finding.evidence}</p></article>)}</div></section>
      {signals.length > 0 && <section><h2 className="text-2xl font-bold">Señales recientes</h2><div className="mt-4 space-y-2">{signals.map((signal: any, index: number) => <div key={`${signal.type}-${index}`} className="rounded-xl border border-white/10 bg-white/5 p-4"><div className="text-xs font-bold uppercase text-amber-300">{signal.type.replaceAll("_", " ")}</div><div className="mt-1 text-sm">{signal.evidence}</div>{signal.sourceUrl && <a className="mt-2 inline-block text-xs text-sky-300 underline" href={signal.sourceUrl} target="_blank" rel="noreferrer">Ver fuente pública</a>}</div>)}</div></section>}
      <section className="rounded-3xl border border-emerald-400/30 bg-emerald-400/10 p-7"><h2 className="text-2xl font-black">{growth.pilot.title}</h2><p className="mt-2 text-slate-300">{growth.pilot.design}</p><div className="mt-5 grid gap-3 sm:grid-cols-3"><div><strong>{growth.pilot.interventionLocations}</strong><br/><span className="text-sm text-slate-400">ubicaciones de intervención</span></div><div><strong>{growth.pilot.controlLocations}</strong><br/><span className="text-sm text-slate-400">ubicaciones de control</span></div><div><strong>{growth.pilot.durationDays} días</strong><br/><span className="text-sm text-slate-400">de medición</span></div></div><a href={`mailto:info@negociovivo.com?subject=${encodeURIComponent(`Revisar piloto ${lead.name}`)}`} className="mt-6 inline-flex rounded-xl bg-emerald-400 px-5 py-3 font-bold text-slate-950">Revisar el piloto con Negocio Vivo</a></section>
      <footer className="pb-8 text-center text-xs text-slate-500">Auditoría privada preparada para {lead.name}. No compartir fuera de su organización.</footer>
    </div>
  </main>;
}
