"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, ExternalLink, Loader2, Megaphone, Trash2, AlertCircle,
  Image as ImageIcon, Film, LayoutGrid, Sparkles, Mail, MapPin, Users, Calendar, Euro, Target, Zap, RefreshCw, CheckCircle2
} from "lucide-react";
import { useRouter } from "next/navigation";

type Campaign = any;

const FMT_ICON: Record<string, JSX.Element> = {
  IMAGE: <ImageIcon className="h-3.5 w-3.5" />,
  CAROUSEL: <LayoutGrid className="h-3.5 w-3.5" />,
  VIDEO: <Film className="h-3.5 w-3.5" />
};

const AD_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  PLACEHOLDER:      { label: "Pendiente",   cls: "bg-slate-100 text-slate-600" },
  GENERATING:       { label: "Generando…",  cls: "bg-sky-100 text-sky-700 animate-pulse" },
  READY_FOR_REVIEW: { label: "Listo",       cls: "bg-amber-100 text-amber-800" },
  APPROVED:         { label: "Aprobado",    cls: "bg-emerald-100 text-emerald-700" },
  PUBLISHED:        { label: "Publicado",   cls: "bg-violet-100 text-violet-700" },
  FAILED:           { label: "Error",       cls: "bg-rose-100 text-rose-700" }
};

export default function CampaignDetailClient({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [c, setC] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchCampaign() {
    try {
      const r = await fetch(`/api/v1/meta/campaigns/${campaignId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Error");
      setC(j.campaign);
      return j.campaign;
    } catch (e: any) {
      setError(e?.message ?? "Error");
      return null;
    }
  }

  useEffect(() => {
    fetchCampaign();
  }, [campaignId]);

  // Polling cada 5s cuando hay ads en GENERATING o la campaña está
  // LAUNCHING (que aquí significa "generando contenido", reusamos).
  useEffect(() => {
    if (!c) return;
    const hasGenerating =
      c.status === "LAUNCHING" ||
      c.adsets.some((a: any) => a.ads.some((ad: any) => ad.contentStatus === "GENERATING"));
    if (hasGenerating && !pollRef.current) {
      pollRef.current = setInterval(fetchCampaign, 5000);
    }
    if (!hasGenerating && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current && !hasGenerating) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [c]);

  async function generateContent() {
    if (generating || !c) return;
    setGenerating(true);
    setGenMsg(null);
    try {
      const r = await fetch(`/api/v1/meta/campaigns/${campaignId}/generate-content`, {
        method: "POST"
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Error");
      setGenMsg(j.message ?? "Generación arrancada");
      await fetchCampaign();
    } catch (e: any) {
      setGenMsg(`Error: ${e?.message ?? "?"}`);
    } finally {
      setGenerating(false);
    }
  }

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
          {/* Botón principal de Fase 2 — disponible mientras la campaña
              esté en estados editables (DRAFT, PENDING_REVIEW, FAILED). */}
          {(c.status === "DRAFT" || c.status === "PENDING_REVIEW" || c.status === "FAILED" || c.status === "LAUNCHING") && (
            <button
              onClick={generateContent}
              disabled={generating || c.status === "LAUNCHING"}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
              title={c.status === "LAUNCHING" ? "Generando contenido, espera…" : "Genera copys e imágenes con IA"}
            >
              {generating || c.status === "LAUNCHING" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {c.status === "LAUNCHING" ? "Generando…" : "Generar con IA"}
            </button>
          )}
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
          <div className="grid sm:grid-cols-2 gap-3 text-xs mb-3">
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
        {c.expandedSegmentation ? (
          <div className="rounded-lg bg-brand-50 border border-brand-200 p-3 text-xs space-y-1.5">
            <div className="font-medium text-brand-900 mb-1 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Segmentación expandida por IA
            </div>
            <div>
              <strong>Edades:</strong> {c.expandedSegmentation.ageMin}–{c.expandedSegmentation.ageMax} ·{" "}
              <strong>Género:</strong> {(c.expandedSegmentation.genders ?? []).join(", ")}
            </div>
            <div>
              <strong>Intereses:</strong> {(c.expandedSegmentation.interests ?? []).join(", ")}
            </div>
            {c.expandedSegmentation.behaviors?.length > 0 && (
              <div>
                <strong>Comportamientos:</strong> {c.expandedSegmentation.behaviors.join(", ")}
              </div>
            )}
            {c.expandedSegmentation.excludedInterests?.length > 0 && (
              <div>
                <strong>Excluir:</strong> {c.expandedSegmentation.excludedInterests.join(", ")}
              </div>
            )}
            <div>
              <strong>Tono recomendado:</strong> {c.expandedSegmentation.recommendedTone}
            </div>
            <div className="text-brand-700">
              Tamaño de audiencia estimado: <em>{c.expandedSegmentation.audienceSizeEstimate}</em>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 italic">
            Pulsa <strong>"Generar con IA"</strong> arriba para que la IA expanda esto en intereses,
            edades y comportamientos listos para Meta API.
          </div>
        )}
      </Card>

      {genMsg && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          {genMsg}
        </div>
      )}

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
                  <AdCard key={ad.id} ad={ad} index={i} visualMode={c.visualMode} />
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

function AdCard({ ad, index, visualMode }: { ad: any; index: number; visualMode: string }) {
  const badge = AD_STATUS_BADGE[ad.contentStatus] ?? { label: ad.contentStatus, cls: "bg-slate-100 text-slate-600" };
  const hasMedia = Array.isArray(ad.mediaUrls) && ad.mediaUrls.length > 0;
  const isCarousel = ad.format === "CAROUSEL";

  return (
    <div className="bg-white rounded border p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
        {FMT_ICON[ad.format]} {ad.format} #{index + 1}
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {hasMedia ? (
        isCarousel ? (
          <div className="grid grid-cols-3 gap-1 mb-2">
            {ad.mediaUrls.slice(0, 3).map((src: string, k: number) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k} src={src} alt="" className="w-full h-20 object-cover rounded" />
            ))}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ad.mediaUrls[0]} alt="" className="w-full h-40 object-cover rounded mb-2" />
        )
      ) : ad.format === "VIDEO" ? (
        <div className="w-full h-32 rounded bg-slate-100 border border-dashed border-slate-300 grid place-items-center mb-2">
          <div className="text-[10px] text-slate-500 text-center px-2">
            🎬 Sube el vídeo manualmente cuando esté listo
          </div>
        </div>
      ) : ad.contentStatus === "GENERATING" ? (
        <div className="w-full h-32 rounded bg-sky-50 border border-sky-200 grid place-items-center mb-2">
          <div className="text-[11px] text-sky-700 text-center px-2 flex flex-col items-center gap-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generando imagen…
          </div>
        </div>
      ) : ad.contentStatus === "FAILED" ? (
        <div className="w-full h-32 rounded bg-rose-50 border border-rose-200 grid place-items-center mb-2 px-2">
          <div className="text-[11px] text-rose-700 text-center">
            ⚠️ {ad.lastError ?? "Error desconocido"}
          </div>
        </div>
      ) : (
        <div className="w-full h-32 rounded bg-gradient-to-br from-slate-100 to-slate-200 grid place-items-center mb-2">
          <div className="text-[10px] text-slate-500 text-center px-2">
            {visualMode === "AI_GENERATES"
              ? 'Pulsa "Generar con IA" arriba'
              : "Pendiente de subida manual"}
          </div>
        </div>
      )}

      {ad.headline && (
        <div className="text-sm font-semibold text-slate-900 mb-0.5">{ad.headline}</div>
      )}
      {ad.primaryText ? (
        <div className="text-xs text-slate-700 line-clamp-3">{ad.primaryText}</div>
      ) : ad.contentStatus !== "GENERATING" && ad.contentStatus !== "FAILED" ? (
        <div className="text-[11px] text-slate-400 italic">Copy pendiente</div>
      ) : null}
      {ad.callToAction && (
        <div className="mt-2">
          <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 font-medium">
            CTA: {ad.callToAction}
          </span>
        </div>
      )}
    </div>
  );
}
