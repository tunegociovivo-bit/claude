"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import MetaGuardBadge from "@/components/admin/MetaGuardBadge";
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

      <MetaGuardBadge />

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

      {/* Ajustes de generación: sliders + assets (logo + referencias) */}
      <GenerationSettingsCard campaign={c} onChanged={fetchCampaign} />

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
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    index={i}
                    visualMode={c.visualMode}
                    campaignId={c.id}
                    onRegenerated={fetchCampaign}
                  />
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

type Placement = "square" | "portrait" | "landscape";
const PLACEMENT_LABELS: Record<Placement, { label: string; hint: string; aspect: string }> = {
  square:    { label: "Feed",     hint: "Móvil + desktop · 1:1",  aspect: "aspect-square" },
  portrait:  { label: "Stories",  hint: "Reels · 4:5 / 9:16",      aspect: "aspect-[4/5]" },
  landscape: { label: "Marketplace", hint: "Right col · 1.91:1",   aspect: "aspect-[16/9]" }
};

function AdCard({ ad, index, visualMode, campaignId, onRegenerated }: { ad: any; index: number; visualMode: string; campaignId?: string; onRegenerated?: () => void }) {
  const badge = AD_STATUS_BADGE[ad.contentStatus] ?? { label: ad.contentStatus, cls: "bg-slate-100 text-slate-600" };
  const hasMedia = Array.isArray(ad.mediaUrls) && ad.mediaUrls.length > 0;
  const isCarousel = ad.format === "CAROUSEL";
  const [showRegen, setShowRegen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState<string>(ad.userNotes ?? "");
  const [regenerateCopy, setRegenerateCopy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  async function doRegenerate() {
    if (!campaignId) return;
    setRegenerating(true);
    try {
      const r = await fetch(
        `/api/v1/meta/campaigns/${campaignId}/ads/${ad.id}/regenerate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customPrompt: customPrompt.trim() || null,
            regenerateCopy
          })
        }
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(`Error: ${j?.error?.message ?? r.status}`);
      } else {
        setShowRegen(false);
        onRegenerated?.();
      }
    } finally {
      setRegenerating(false);
    }
  }

  // Variantes por placement (Fase 2). Para IMAGE: {square,portrait,
  // landscape}. Para CAROUSEL: array de esos objetos (una entry por
  // tarjeta). Si mediaVariants no existe (campañas anteriores al
  // cambio), caemos a la cuadrada de mediaUrls.
  const variantsObj: Record<Placement, string> | null = (() => {
    if (!ad.mediaVariants) return null;
    if (isCarousel) return null; // se trata aparte abajo
    return ad.mediaVariants as Record<Placement, string>;
  })();
  const carouselVariants: Record<Placement, string>[] | null =
    isCarousel && Array.isArray(ad.mediaVariants) ? ad.mediaVariants : null;

  const [placement, setPlacement] = useState<Placement>("square");

  return (
    <div className="bg-white rounded border p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
        {FMT_ICON[ad.format]} {ad.format} #{index + 1}
        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {/* Selector de placement — solo si hay variantes generadas */}
      {(variantsObj || carouselVariants) && (
        <div className="flex gap-0.5 mb-2 p-0.5 rounded-md bg-slate-100 text-[10px]">
          {(Object.keys(PLACEMENT_LABELS) as Placement[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlacement(p)}
              className={`flex-1 px-2 py-1 rounded ${
                placement === p
                  ? "bg-white text-slate-900 shadow-sm font-medium"
                  : "text-slate-500 hover:text-slate-800"
              }`}
              title={PLACEMENT_LABELS[p].hint}
            >
              {PLACEMENT_LABELS[p].label}
            </button>
          ))}
        </div>
      )}

      {hasMedia || variantsObj || carouselVariants ? (
        isCarousel ? (
          <div className="grid grid-cols-3 gap-1 mb-2">
            {(carouselVariants ?? ad.mediaUrls.slice(0, 3).map((u: string) => ({ square: u, portrait: u, landscape: u })) as Record<Placement, string>[]).slice(0, 3).map((card: Record<Placement, string>, k: number) => (
              <div
                key={k}
                className={`w-full ${PLACEMENT_LABELS[placement].aspect} rounded bg-slate-50 border overflow-hidden`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card[placement] ?? card.square} alt="" className="w-full h-full object-contain" />
              </div>
            ))}
          </div>
        ) : (
          // IMAGE: muestra la variante seleccionada COMPLETA (object-contain)
          // dentro de un wrapper con el aspect-ratio correcto del placement.
          // Antes usábamos object-cover + altura fija → solo se veía la
          // parte central. Ahora ves el anuncio entero con su composición.
          <div
            className={`w-full ${PLACEMENT_LABELS[placement].aspect} rounded bg-slate-50 border overflow-hidden mb-2`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={variantsObj?.[placement] ?? variantsObj?.square ?? ad.mediaUrls[0]}
              alt=""
              className="w-full h-full object-contain"
            />
          </div>
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

      {/* Botón "Regenerar este anuncio" + textarea opcional para
          dar instrucciones libres al modelo ("misma foto pero en
          exterior", "paleta más oscura"...). Solo si hay campaignId
          y el ad no está GENERATING. */}
      {campaignId && ad.contentStatus !== "GENERATING" && (
        <div className="mt-3 pt-2 border-t">
          {!showRegen ? (
            <button
              type="button"
              onClick={() => setShowRegen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-brand-700 hover:text-brand-900"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerar con mis indicaciones
            </button>
          ) : (
            <div className="space-y-2">
              <label className="block text-[10px] text-slate-600">
                Instrucciones libres para la IA (opcional)
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={2}
                placeholder='Ej: "hazla en interior de oficina moderna, con tonos más cálidos y un café sobre la mesa"'
                className="w-full px-2 py-1.5 rounded border text-xs bg-white"
              />
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                <input
                  type="checkbox"
                  checked={regenerateCopy}
                  onChange={(e) => setRegenerateCopy(e.target.checked)}
                />
                Regenerar también el copy (headline + texto)
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={doRegenerate}
                  disabled={regenerating}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-brand-600 hover:bg-brand-700 text-white text-[11px] font-medium disabled:opacity-50"
                >
                  {regenerating && <Loader2 className="h-3 w-3 animate-spin" />}
                  Regenerar
                </button>
                <button
                  type="button"
                  onClick={() => setShowRegen(false)}
                  className="text-[11px] text-slate-500 hover:text-slate-800"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Ajustes de generación: sliders + logo + imágenes de referencia
// ─────────────────────────────────────────────────────────────────────

function GenerationSettingsCard({ campaign, onChanged }: { campaign: any; onChanged: () => void }) {
  const settings = (campaign.generationSettings ?? {}) as {
    attentionLevel?: number;
    toneFormality?: number;
    energyLevel?: number;
    styleHint?: string;
  };
  const [attentionLevel, setAttentionLevel] = useState<number>(settings.attentionLevel ?? 4);
  const [toneFormality, setToneFormality] = useState<number>(settings.toneFormality ?? 2);
  const [energyLevel, setEnergyLevel] = useState<number>(settings.energyLevel ?? 3);
  const [styleHint, setStyleHint] = useState<string>(settings.styleHint ?? "editorial");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/v1/meta/campaigns/${campaign.id}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attentionLevel, toneFormality, energyLevel, styleHint })
      });
      setSavedMsg("Guardado. Se aplicará en la próxima generación.");
      setTimeout(() => setSavedMsg(null), 3000);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand-600" />
        Estilo del anuncio
      </h3>
      <div className="text-xs text-slate-500 mb-4">
        Ajusta cómo quieres que sea el anuncio antes de generar. Se aplica
        en la próxima generación o regeneración.
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <SliderField
          label="Nivel de atención"
          low="Discreto"
          high="Ultra llamativo"
          value={attentionLevel}
          onChange={setAttentionLevel}
        />
        <SliderField
          label="Tono"
          low="Tuteo cercano"
          high="Usted formal"
          value={toneFormality}
          onChange={setToneFormality}
        />
        <SliderField
          label="Energía"
          low="Calmado"
          high="Urgente / FOMO"
          value={energyLevel}
          onChange={setEnergyLevel}
        />
        <div>
          <label className="text-xs font-medium text-slate-700 block mb-1.5">
            Estilo visual
          </label>
          <select
            value={styleHint}
            onChange={(e) => setStyleHint(e.target.value)}
            className="w-full px-2 py-1.5 rounded border bg-white text-sm"
          >
            <option value="editorial">📷 Editorial (revista/lifestyle)</option>
            <option value="casual">😊 Casual (cercano, fresco)</option>
            <option value="corporate">💼 Corporativo (sobrio, fiable)</option>
            <option value="playful">🎈 Playful (divertido, colorido)</option>
            <option value="luxurious">✨ Lujoso (premium, elegante)</option>
          </select>
        </div>
      </div>

      <hr className="my-4" />

      {/* Logo + imágenes de referencia */}
      <h4 className="font-semibold text-slate-900 mb-2 text-sm">
        Logo y referencias visuales
      </h4>
      <div className="text-xs text-slate-500 mb-3">
        Sube tu logo (aparece de footer en el anuncio) y hasta 5 imágenes de
        referencia (productos, fotos del equipo, brand visuals) — la IA las usa
        de inspiración estilística.
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <AssetUploader
          campaignId={campaign.id}
          kind="logo"
          label="Logo de la marca"
          currentUrls={campaign.logoUrl ? [campaign.logoUrl] : []}
          maxItems={1}
          onChanged={onChanged}
        />
        <AssetUploader
          campaignId={campaign.id}
          kind="reference"
          label={`Imágenes de referencia (${(campaign.referenceImageUrls ?? []).length}/5)`}
          currentUrls={campaign.referenceImageUrls ?? []}
          maxItems={5}
          onChanged={onChanged}
        />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Guardar ajustes
        </button>
        {savedMsg && <span className="text-xs text-emerald-700">{savedMsg}</span>}
      </div>
    </Card>
  );
}

function SliderField({
  label, low, high, value, onChange
}: {
  label: string; low: string; high: string; value: number; onChange: (n: number) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-700 block mb-1.5">
        {label} <span className="text-slate-400">({value}/5)</span>
      </label>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand-600"
      />
      <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function AssetUploader({
  campaignId, kind, label, currentUrls, maxItems, onChanged
}: {
  campaignId: string;
  kind: "logo" | "reference";
  label: string;
  currentUrls: string[];
  maxItems: number;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", kind);
      const r = await fetch(`/api/v1/meta/campaigns/${campaignId}/assets`, {
        method: "POST",
        body: form
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? `Error ${r.status}`);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? "Error al subir");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(url?: string) {
    await fetch(`/api/v1/meta/campaigns/${campaignId}/assets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "logo" ? { kind } : { kind, url })
    });
    onChanged();
  }

  const atMax = currentUrls.length >= maxItems;

  return (
    <div>
      <label className="text-xs font-medium text-slate-700 block mb-1.5">{label}</label>
      {currentUrls.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {currentUrls.map((u) => (
            <div key={u} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="" className="w-16 h-16 object-cover rounded border" />
              <button
                onClick={() => remove(kind === "logo" ? undefined : u)}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-rose-600 text-white text-xs hidden group-hover:grid place-items-center"
                title="Quitar"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        disabled={uploading || atMax}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
        className="block text-xs"
      />
      {atMax && (
        <div className="text-[10px] text-slate-500 mt-1">
          Máximo {maxItems} alcanzado. Borra alguno para subir más.
        </div>
      )}
      {error && <div className="text-[10px] text-rose-700 mt-1">{error}</div>}
      {uploading && (
        <div className="text-[10px] text-slate-500 mt-1 inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Subiendo…
        </div>
      )}
    </div>
  );
}
