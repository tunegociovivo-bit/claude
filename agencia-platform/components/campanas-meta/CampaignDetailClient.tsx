"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ExternalLink, Loader2, Megaphone, Trash2, AlertCircle,
  Image as ImageIcon, Film, LayoutGrid, Sparkles, Mail, MapPin, Users, Calendar, Euro, Target
} from "lucide-react";
import { useRouter } from "next/navigation";

type Campaign = any;

const FMT_ICON: Record<string, JSX.Element> = {
  IMAGE: <ImageIcon className="h-3.5 w-3.5" />,
  CAROUSEL: <LayoutGrid className="h-3.5 w-3.5" />,
  VIDEO: <Film className="h-3.5 w-3.5" />
};

export default function CampaignDetailClient({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [c, setC] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/meta/campaigns/${campaignId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error?.message ?? "Error");
        setC(j.campaign);
      })
      .catch((e) => setError(e?.message ?? "Error"));
  }, [campaignId]);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <AlertCircle className="h-10 w-10 text-rose-600 mx-auto mb-2" />
        <p className="text-slate-700">{error}</p>
        <Link href="/campanas-meta" className="text-brand-600 underline mt-3 inline-block">
          Volver al listado
        </Link>
      </div>
    );
  }

  if (!c) {
    return (
      <div className="py-12 text-center text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        Cargando…
      </div>
    );
  }

  async function destroy() {
    if (!confirm(`¿Mandar "${c.name}" a la papelera? La podrás restaurar 30 días.`)) return;
    await fetch(`/api/v1/meta/campaigns/${campaignId}`, { method: "DELETE" });
    router.push("/campanas-meta");
  }

  const totalAds = c.adsets.reduce(
    (s: number, a: any) => s + a.ads.length,
    0
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Link href="/campanas-meta" className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-0.5">
            <Megaphone className="h-3.5 w-3.5" />
            Campaña Meta · {c.status}
          </div>
          <h1 className="text-xl font-bold text-slate-900 truncate">{c.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          {c.adsManagerUrl && (
            <a
              href={c.adsManagerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Admin Meta
            </a>
          )}
          {c.taskId && (
            <Link
              href={`/tareas?task=${c.taskId}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm hover:bg-slate-50"
            >
              Ver tarea
            </Link>
          )}
          <button
            onClick={destroy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 text-sm"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Eliminar
          </button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard icon={<Target className="h-4 w-4 text-brand-600" />} label="Objetivo" value={c.objective} />
        <StatCard icon={<Euro className="h-4 w-4 text-emerald-600" />} label="€/día" value={`${(c.dailyBudgetCents / 100).toFixed(2)} €`} />
        <StatCard
          icon={<Calendar className="h-4 w-4 text-violet-600" />}
          label="Fechas"
          value={`${new Date(c.startDate).toLocaleDateString()}${
            c.endDate ? ` → ${new Date(c.endDate).toLocaleDateString()}` : " → sin fin"
          }`}
        />
        <StatCard icon={<Users className="h-4 w-4 text-sky-600" />} label="Conjuntos / Anuncios" value={`${c.adsets.length} / ${totalAds}`} />
      </div>

      {/* Descripción */}
      {c.description && (
        <Card>
          <h3 className="font-semibold text-slate-900 mb-2">Briefing</h3>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.description}</p>
        </Card>
      )}

      {/* Segmentación */}
      <Card>
        <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" />
          Segmentación
        </h3>
        <p className="text-sm text-slate-700 whitespace-pre-wrap mb-3">{c.segmentationRaw}</p>
        {(c.locationsIncluded.length > 0 || c.locationsExcluded.length > 0) && (
          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded bg-emerald-50 border border-emerald-200">
              <div className="font-medium text-emerald-900 mb-1 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Incluidas
              </div>
              {c.locationsIncluded.length > 0 ? c.locationsIncluded.join(", ") : "—"}
            </div>
            <div className="p-3 rounded bg-rose-50 border border-rose-200">
              <div className="font-medium text-rose-900 mb-1 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> Excluidas
              </div>
              {c.locationsExcluded.length > 0 ? c.locationsExcluded.join(", ") : "—"}
            </div>
          </div>
        )}
        {!c.expandedSegmentation && (
          <div className="mt-3 text-xs text-slate-500 italic">
            Pendiente Fase 2: la IA expandirá esto en intereses, edades y comportamientos para Meta API.
          </div>
        )}
      </Card>

      {/* Conjuntos + anuncios */}
      <Card>
        <h3 className="font-semibold text-slate-900 mb-3">Conjuntos de anuncios</h3>
        <div className="space-y-4">
          {c.adsets.map((adset: any) => (
            <div key={adset.id} className="rounded-lg border bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-medium text-slate-900">{adset.label}</div>
                  {adset.audienceBrief && (
                    <div className="text-xs text-slate-500 mt-0.5">{adset.audienceBrief}</div>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {adset.ads.length} anuncio{adset.ads.length === 1 ? "" : "s"}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-2">
                {adset.ads.map((ad: any, i: number) => (
                  <div key={ad.id} className="bg-white rounded border p-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
                      {FMT_ICON[ad.format]} {ad.format} #{i + 1}
                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {ad.contentStatus}
                      </span>
                    </div>
                    {ad.mediaUrls.length > 0 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ad.mediaUrls[0]} alt="" className="w-full h-32 object-cover rounded mb-2" />
                    ) : (
                      <div className="w-full h-32 rounded bg-gradient-to-br from-slate-100 to-slate-200 grid place-items-center mb-2">
                        <div className="text-[10px] text-slate-500 text-center px-2">
                          {c.visualMode === "AI_GENERATES"
                            ? "La IA generará la imagen en Fase 2"
                            : "Pendiente de subida manual"}
                        </div>
                      </div>
                    )}
                    {ad.primaryText ? (
                      <div className="text-xs text-slate-700 line-clamp-3">{ad.primaryText}</div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic">
                        Copy pendiente (Fase 2: la IA lo generará)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Leads (si aplica) */}
      {c.objective === "LEADS" && (
        <Card>
          <h3 className="font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4 text-brand-600" />
            Leads
          </h3>
          {c.leadEmails.length > 0 ? (
            <>
              <div className="text-xs text-slate-500 mb-1">Emails que reciben los leads:</div>
              <div className="flex flex-wrap gap-1.5">
                {c.leadEmails.map((e: string) => (
                  <span key={e} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 border">
                    {e}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-500">No hay emails configurados.</div>
          )}
          {c.formQuestions && Array.isArray(c.formQuestions) && c.formQuestions.length > 0 && (
            <>
              <div className="text-xs text-slate-500 mt-3 mb-1">Preguntas del formulario:</div>
              <ol className="text-sm text-slate-700 list-decimal list-inside space-y-0.5">
                {c.formQuestions.map((q: any, i: number) => (
                  <li key={i}>
                    {q.question}{" "}
                    <span className="text-[11px] text-slate-400">({q.type}{q.required ? " · obligatoria" : ""})</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <div className="mt-3 text-xs text-slate-500 italic">
            Pendiente Fase 3: escenario de Make que recoge los leads y los envía por email a estos destinatarios.
          </div>
        </Card>
      )}

      {/* Revisión automática */}
      {c.reviewAt && (
        <Card>
          <h3 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-violet-600" />
            Revisión automática
          </h3>
          <p className="text-sm text-slate-700">
            La IA evaluará la campaña el <strong>{new Date(c.reviewAt).toLocaleDateString()}</strong>{" "}
            y te enviará un informe con recomendaciones.
            {c.reviewSentAt && <> Último informe: {new Date(c.reviewSentAt).toLocaleString()}</>}
          </p>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
        {icon} {label}
      </div>
      <div className="font-semibold text-slate-900 text-sm truncate">{value}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border p-4 mb-4">{children}</div>;
}
