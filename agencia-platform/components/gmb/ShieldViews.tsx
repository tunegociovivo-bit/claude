"use client";

/**
 * Escudo de reputación (GMB Hub → Reseñas falsas): vigilancia diaria, centro de retiradas con
 * apelaciones, base de perfiles sospechosos y resultados (qué motivos consiguen retiradas).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Bell, Check, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FileText, Gavel, Loader2, Pause, Play, Plus,
  RefreshCw, Scale, Search, Send, ShieldCheck, Trash2, X
} from "lucide-react";
import { api, BTN_PRIMARY, BTN_SEC, CARD, PlacePicker, Stars, type Ficha } from "@/components/gmb/fr-ui";
import type { Place } from "@/lib/gmb/fake-reviews/core";
import { GOOGLE_OPTIONS, STATUS_LABEL, type CaseStatus, type LearningStats } from "@/lib/gmb/fake-reviews/cases-logic";
import { estimateWatch } from "@/lib/gmb/fake-reviews/estimate";

export const RMT_URL = "https://support.google.com/business/workflow/9945796?hl=es";
export const LEGAL_URL = "https://support.google.com/legal/answer/3110420?hl=es";

type Source = { configured: boolean; provider?: "serpapi" | "serper" | null; left?: number | null } | null;

const fdate = (d?: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");
const fdt = (d?: string | null) => (d ? new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

async function download(url: string, fallbackName: string) {
  const r = await fetch(url);
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error?.message ?? `Error ${r.status}`);
  }
  const blob = await r.blob();
  const cd = r.headers.get("content-disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function CopyBtn({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1800); })}
      className={BTN_SEC}
    >
      {ok ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {ok ? "Copiado" : label}
    </button>
  );
}

function Pill({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "amber" | "rose" | "emerald" | "sky" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-50 text-amber-700 border border-amber-200",
    rose: "bg-rose-50 text-rose-700 border border-rose-200",
    emerald: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    sky: "bg-sky-50 text-sky-700 border border-sky-200"
  }[tone];
  return <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}

const STATUS_TONE: Record<string, "slate" | "amber" | "rose" | "emerald" | "sky"> = {
  preparada: "sky", denunciada: "amber", rechazada: "rose", apelada: "amber", rechazada_final: "rose", legal: "slate", retirada: "emerald", descartada: "slate"
};

/* ═════════════════════════ Vigilancia ═════════════════════════ */

type Watch = {
  id: string; name: string; gmbClientId: string | null; place: Place; competitors: Place[] | null; enabled: boolean; frequencyHours: number;
  deepCheck: boolean; aiCheck: boolean; emails: string; whatsapp: string; monthlyReport: boolean;
  history: { d: string; rating: number | null; reviews: number | null; newReviews: number; newNeg: number; flagged: number }[] | null;
  lastRunAt: string | null; nextRunAt: string; lastError: string | null; apiCalls: number; openCases: number;
};

function Spark({ h }: { h: Watch["history"] }) {
  const rows = (h ?? []).slice(-30);
  if (!rows.length) return <div className="text-[11px] text-slate-400">Sin datos todavía</div>;
  const max = Math.max(1, ...rows.map((r) => r.newNeg));
  return (
    <div className="flex items-end gap-[2px] h-8" title="Negativas nuevas por día (30 días)">
      {rows.map((r) => (
        <div key={r.d} title={`${fdate(r.d)} · ${r.newNeg} negativas${r.flagged ? `, ${r.flagged} sospechosas` : ""}`} className={`w-1.5 rounded-sm ${r.flagged ? "bg-rose-500" : r.newNeg ? "bg-amber-400" : "bg-slate-200"}`} style={{ height: `${Math.max(8, (r.newNeg / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function WatchForm({ source, onDone, onCancel }: { source: Source; onDone: () => void; onCancel: () => void }) {
  const [fichas, setFichas] = useState<Ficha[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [gmbClientId, setGmbClientId] = useState<string | null>(null);
  const [comps, setComps] = useState<(Place | null)[]>([]);
  const [freq, setFreq] = useState(24);
  const [deep, setDeep] = useState(true);
  const [ai, setAi] = useState(true);
  const [emails, setEmails] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [monthly, setMonthly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/v1/gmb/clients").then((r) => (r.ok ? r.json() : null)).then((d) => d && setFichas(d.clients ?? [])).catch(() => {});
  }, []);
  const chosen = comps.filter(Boolean) as Place[];
  const est = estimateWatch({ provider: source?.provider ?? null, gbp: !!gmbClientId, frequencyHours: freq, competitors: chosen.length, deepCheck: deep });

  async function save() {
    if (!place) return setErr("Elige la ficha a vigilar.");
    setBusy(true);
    setErr(null);
    try {
      await api("/api/v1/gmb/shield/watches", {
        method: "POST",
        body: JSON.stringify({ gmbClientId, place, competitors: chosen, frequencyHours: freq, deepCheck: deep, aiCheck: ai, emails, whatsapp, monthlyReport: monthly })
      });
      onDone();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-4">
      <div className="space-y-4">
        <div className={CARD}>
          <PlacePicker label="Ficha a vigilar" value={place} onChange={setPlace} fichas={fichas} onFicha={setGmbClientId} placeholder="Nombre + ciudad, URL de Google Maps o Place ID" />
          <p className="mt-2 text-[11px] text-slate-500">
            Si eliges una ficha del GMB Hub conectada con Google, las reseñas se leen con la API oficial (gratis y al momento).
          </p>
        </div>
        <div className={`${CARD} space-y-3`}>
          <div className="text-xs font-semibold text-slate-700">Competencia a vigilar (opcional)</div>
          <p className="text-xs text-slate-500">Una vez por semana se buscan picos de reseñas de 5★ y positivas con indicios de no ser auténticas.</p>
          {comps.map((c, i) => (
            <PlacePicker key={i} label={`Competidor ${i + 1}`} value={c} onChange={(p) => setComps((a) => a.map((x, j) => (j === i ? p : x)))} placeholder="Nombre o URL" onRemove={() => setComps((a) => a.filter((_, j) => j !== i))} />
          ))}
          {comps.length < 5 && (
            <button onClick={() => setComps((a) => [...a, null])} className="text-sm text-brand-600 hover:underline inline-flex items-center gap-1">
              <Plus className="h-4 w-4" /> Añadir competidor
            </button>
          )}
        </div>
      </div>
      <div className={`${CARD} space-y-3 h-fit`}>
        <label className="block text-xs text-slate-600">
          Frecuencia de revisión
          <select value={freq} onChange={(e) => setFreq(Number(e.target.value))} className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm bg-white">
            <option value={6}>Cada 6 horas</option>
            <option value={12}>Cada 12 horas</option>
            <option value={24}>Cada día</option>
            <option value={48}>Cada 2 días</option>
            <option value={168}>Cada semana</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="mt-0.5" />
          <span><b>Investigar el perfil</b> de cada nueva negativa (1 búsqueda por reseña).</span>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="mt-0.5" />
          <span><b>Revisar el contenido con IA</b> frente a las políticas de Google.</span>
        </label>
        <label className="block text-xs text-slate-600">
          Avisos por email (separados por comas)
          <input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="tu@agencia.com, cliente@empresa.com" className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm" />
        </label>
        <label className="block text-xs text-slate-600">
          Avisos por WhatsApp (opcional)
          <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+34 600 000 000" className="mt-1 w-full px-2 py-1.5 rounded-lg border text-sm" />
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} className="mt-0.5" />
          <span><b>Informe mensual automático</b> en PDF a los emails indicados (día 1 de cada mes).</span>
        </label>
        <div className="rounded-lg bg-slate-900 text-white text-xs px-3 py-2 space-y-0.5">
          <div>Consumo estimado: <b className="text-amber-300">≈ {est.searches}</b> búsquedas/mes (≈ {est.eur.toFixed(2).replace(".", ",")} €)</div>
          <div className="text-slate-400">{est.runs} revisiones al mes{gmbClientId ? " · lectura con la API oficial de Google" : ""}</div>
        </div>
        {err && <p className="text-xs text-rose-600">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onCancel} className={BTN_SEC}>Cancelar</button>
          <button onClick={save} disabled={busy || !place} className={`${BTN_PRIMARY} flex-1 justify-center`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Activar vigilancia
          </button>
        </div>
      </div>
    </div>
  );
}

export function WatchesView({ source }: { source: Source }) {
  const [rows, setRows] = useState<Watch[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  });
  const load = useCallback(() => api<{ watches: Watch[] }>("/api/v1/gmb/shield/watches").then((d) => setRows(d.watches)).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (adding) return <WatchForm source={source} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500 max-w-2xl">
          Cada ficha vigilada se revisa sola: las negativas nuevas se analizan al momento (perfil, vínculos con la competencia, reincidencia y
          contenido), la denuncia queda preparada con sus pruebas y te avisamos por email o WhatsApp. También detecta ataques (picos de negativas).
        </p>
        <button onClick={() => setAdding(true)} className={BTN_PRIMARY}><Plus className="h-4 w-4" /> Vigilar una ficha</button>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {!rows ? (
        <div className="py-10 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : !rows.length ? (
        <div className={`${CARD} text-sm text-slate-500 text-center py-10`}>Todavía no vigilas ninguna ficha.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {rows.map((w) => {
            const last = w.history?.[w.history.length - 1];
            return (
              <div key={w.id} className={`${CARD} space-y-3 ${w.enabled ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{w.name}</div>
                    <div className="text-xs text-slate-500 truncate">{w.place.address}</div>
                    <div className="text-xs mt-0.5">
                      {last?.rating != null && <><b>{last.rating.toFixed(1).replace(".", ",")}</b> <Stars n={last.rating} /> </>}
                      {last?.reviews != null && <span className="text-slate-500">{last.reviews} reseñas</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {w.enabled ? <Pill tone="emerald">Activa</Pill> : <Pill>En pausa</Pill>}
                    {w.openCases > 0 && <Pill tone="amber">{w.openCases} en curso</Pill>}
                  </div>
                </div>
                <Spark h={w.history} />
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <div>Última revisión: {fdt(w.lastRunAt)} · próxima: {w.enabled ? fdt(w.nextRunAt) : "—"} · cada {w.frequencyHours} h</div>
                  {w.competitors?.length ? <div>Competencia: {w.competitors.map((c) => c.title).join(", ")}</div> : null}
                  <div>Avisos: {[w.emails && "email", w.whatsapp && "WhatsApp"].filter(Boolean).join(" + ") || "sólo en el hub"}{w.monthlyReport ? " · informe mensual" : ""} · {w.apiCalls} búsquedas usadas</div>
                  {w.lastError && <div className="text-rose-600">Último error: {w.lastError}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button disabled={busy === w.id} onClick={() => act(w.id, () => api(`/api/v1/gmb/shield/watches/${w.id}/run`, { method: "POST" }))} className={BTN_SEC}>
                    {busy === w.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Revisar ahora
                  </button>
                  <button onClick={() => act(w.id, () => api(`/api/v1/gmb/shield/watches/${w.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !w.enabled }) }))} className={BTN_SEC}>
                    {w.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {w.enabled ? "Pausar" : "Reanudar"}
                  </button>
                  <div className="flex items-center gap-1">
                    <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="px-2 py-1.5 rounded-lg border text-xs" />
                    <button onClick={() => act(w.id, () => download(`/api/v1/gmb/shield/watches/${w.id}/monthly?month=${month}`, "informe-mensual.pdf"))} className={BTN_SEC} title="Informe mensual (PDF)">
                      <Download className="h-4 w-4" /> Informe
                    </button>
                  </div>
                  <button
                    onClick={() => confirm(`¿Dejar de vigilar ${w.name}? Los casos y pruebas se conservan.`) && act(w.id, () => api(`/api/v1/gmb/shield/watches/${w.id}`, { method: "DELETE" }))}
                    className="text-xs text-rose-600 hover:underline inline-flex items-center gap-1 ml-auto"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Quitar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════ Centro de retiradas ═════════════════════════ */

type Reason = { kind: string; category?: string; label: string; policy: string; detail: string };
type Case = {
  id: string; target: string; placeKey: string; placeTitle: string; placeUrl: string; reviewLink: string; author: string; authorLink: string; rating: number;
  reviewDate: string; text: string | null; reasons: Reason[] | null; score: number; likelihood: string; googleOption: string; status: CaseStatus; channel: string;
  reportText: string | null; appealText: string | null; legalText: string | null; replyDraft: string | null; replyPublishedAt: string | null; appealBatch: string | null;
  reportedAt: string | null; rejectedAt: string | null; appealedAt: string | null; removedAt: string | null; lastCheckedAt: string | null; checkMisses: number;
  notes: string | null; createdAt: string;
};
type Batch = { placeKey: string; placeTitle: string; batchId: string | null; text: string | null; cases: { id: string; author: string; rating: number; reviewDate: string }[] };

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="h-5 w-5 shrink-0 rounded-full bg-slate-900 text-white text-[11px] grid place-items-center">{n}</span>
      <div className="text-[13px] text-slate-700">{children}</div>
    </li>
  );
}

function CaseDetail({ c, onChange }: { c: Case; onChange: (c?: Case) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [appeal, setAppeal] = useState(c.appealText ?? "");
  const [reply, setReply] = useState(c.replyDraft ?? "");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setAppeal(c.appealText ?? "");
    setReply(c.replyDraft ?? "");
  }, [c.appealText, c.replyDraft]);

  async function run<T>(key: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(key);
    setErr(null);
    setNote(null);
    try {
      const r = await fn();
      after?.(r);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }
  const action = (a: string, extra: Record<string, unknown> = {}) =>
    run(a, () => api<{ case: Case }>(`/api/v1/gmb/shield/cases/${c.id}`, { method: "PATCH", body: JSON.stringify({ action: a, ...extra }) }), (r) => onChange(r.case));
  const patch = (data: Record<string, unknown>) =>
    run("patch", () => api<{ case: Case }>(`/api/v1/gmb/shield/cases/${c.id}`, { method: "PATCH", body: JSON.stringify(data) }), (r) => onChange(r.case));
  const option = GOOGLE_OPTIONS[c.googleOption as keyof typeof GOOGLE_OPTIONS] ?? c.googleOption;
  const B = (k: string) => (busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : null);

  return (
    <div className="border-t bg-slate-50/60 p-4 space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">Reseña</div>
          <div className="rounded-lg bg-white border p-3 text-sm">
            <div className="text-xs text-slate-500 mb-1"><Stars n={c.rating} /> · {fdate(c.reviewDate)} · {c.author}</div>
            <p className="whitespace-pre-wrap">{c.text?.trim() ? `«${c.text}»` : <i className="text-slate-400">Sin texto</i>}</p>
            <div className="flex gap-3 mt-2 text-xs">
              {c.reviewLink && <a href={c.reviewLink} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1">Ver reseña <ExternalLink className="h-3 w-3" /></a>}
              {c.authorLink && <a href={c.authorLink} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline inline-flex items-center gap-1">Perfil del autor <ExternalLink className="h-3 w-3" /></a>}
            </div>
          </div>
          <div className="text-xs font-semibold text-slate-700 pt-1">Motivos</div>
          <ul className="space-y-1.5">
            {(c.reasons ?? []).map((r, i) => (
              <li key={i} className="text-xs rounded-lg bg-white border p-2">
                <b>{r.label}</b>{r.policy ? <span className="text-slate-500"> · {r.policy}</span> : null}
                <div className="text-slate-600 mt-0.5">{r.detail}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-slate-700">Motivo a marcar en Google:</span>
            <select value={c.googleOption} onChange={(e) => patch({ googleOption: e.target.value })} className="px-2 py-1 rounded-lg border bg-white text-xs">
              {Object.entries(GOOGLE_OPTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>

          {(c.status === "preparada" || c.status === "descartada") && (
            <ol className="space-y-2">
              {c.target === "cliente" ? (
                <>
                  <Step n={1}>Abre la <a href={RMT_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Herramienta de gestión de reseñas</a> con la cuenta propietaria de la ficha y elige <b>{c.placeTitle}</b>.</Step>
                  <Step n={2}>Busca la reseña de <b>{c.author}</b> ({c.rating}★, {fdate(c.reviewDate)}), pulsa <b>Denunciar</b> y marca <b>«{option}»</b>.</Step>
                </>
              ) : (
                <>
                  <Step n={1}>Abre la <a href={c.reviewLink || c.placeUrl} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">reseña en Google Maps</a> (ficha de la competencia).</Step>
                  <Step n={2}>Menú <b>⋮</b> → <b>Denunciar reseña</b> → marca <b>«{option}»</b>. Google permite denunciar reseñas de cualquier ficha.</Step>
                </>
              )}
              <Step n={3}>Si el formulario pide detalles, pega este texto: <div className="mt-1 flex gap-2 items-start"><span className="text-xs text-slate-500 line-clamp-2">{c.reportText}</span>{c.reportText && <CopyBtn text={c.reportText} label="Copiar motivo" />}</div></Step>
              <Step n={4}>Márcala como denunciada: a partir de ahí comprobamos solos si Google la retira.</Step>
            </ol>
          )}
          {c.status === "denunciada" && (
            <p className="text-[13px] text-slate-700">
              Denunciada el {fdt(c.reportedAt)}. Google suele decidir en unos días y avisa por email. Comprobamos automáticamente si sigue publicada
              {c.lastCheckedAt ? <> (última comprobación: {fdt(c.lastCheckedAt)})</> : null}. Si Google te comunica que no la retira, márcala como rechazada y la apelación se redacta sola.
            </p>
          )}
          {(c.status === "rechazada" || c.status === "apelada") && (
            <div className="space-y-2">
              <p className="text-[13px] text-slate-700">
                {c.status === "rechazada"
                  ? <>Google no la retiró. Tienes <b>una apelación</b> por reseña: ábrela en la <a href={RMT_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Herramienta de gestión de reseñas</a> (pestaña de apelaciones, hasta 10 reseñas a la vez) y pega este texto. Si hay más rechazadas de esta ficha, usa el lote de apelación de arriba.</>
                  : <>Apelada el {fdt(c.appealedAt)}. La decisión llega por email; seguimos comprobando si sigue publicada.</>}
              </p>
              <textarea value={appeal} onChange={(e) => setAppeal(e.target.value)} rows={8} className="w-full rounded-lg border p-2 text-xs font-mono bg-white" placeholder="La apelación se prepara al marcarla como rechazada." />
              <div className="flex flex-wrap gap-2">
                <CopyBtn text={appeal} label="Copiar apelación" />
                {appeal !== (c.appealText ?? "") && <button onClick={() => patch({ appealText: appeal })} className={BTN_SEC}>{B("patch")} Guardar texto</button>}
              </div>
            </div>
          )}
          {(c.status === "rechazada_final" || c.status === "legal") && (
            <div className="space-y-2">
              <p className="text-[13px] text-slate-700">
                Google no la retiró tras apelar. Si el contenido es difamatorio o expone datos personales, queda la vía legal: el
                <a href={LEGAL_URL} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline"> formulario de retirada por motivos legales</a> (Reglamento de Servicios Digitales). Te recomendamos revisarlo con un abogado.
              </p>
              {c.legalText ? (
                <>
                  <textarea readOnly value={c.legalText} rows={7} className="w-full rounded-lg border p-2 text-xs font-mono bg-white" />
                  <CopyBtn text={c.legalText} label="Copiar texto legal" />
                </>
              ) : null}
            </div>
          )}
          {c.status === "retirada" && <p className="text-[13px] text-emerald-700 inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4" /> Retirada por Google el {fdt(c.removedAt)}.</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            {(c.status === "preparada" || c.status === "descartada") && <button onClick={() => action("report", { channel: c.target === "cliente" ? "tool" : "maps" })} className={BTN_PRIMARY}>{B("report") ?? <Send className="h-4 w-4" />} Ya la he denunciado</button>}
            {c.status === "denunciada" && <button onClick={() => action("reject")} className={BTN_SEC}>{B("reject") ?? <X className="h-4 w-4" />} Google la rechazó</button>}
            {c.status === "rechazada" && <button onClick={() => action("appeal", appeal !== (c.appealText ?? "") ? { appealText: appeal } : {})} className={BTN_PRIMARY}>{B("appeal") ?? <Send className="h-4 w-4" />} Apelación enviada</button>}
            {c.status === "apelada" && <button onClick={() => action("appeal_rejected")} className={BTN_SEC}>{B("appeal_rejected") ?? <X className="h-4 w-4" />} Rechazada tras apelar</button>}
            {["rechazada", "apelada", "rechazada_final"].includes(c.status) && <button onClick={() => action("legal")} className={BTN_SEC}>{B("legal") ?? <Scale className="h-4 w-4" />} Vía legal</button>}
            {["denunciada", "apelada", "rechazada", "rechazada_final", "legal"].includes(c.status) && (
              <button
                onClick={() => run("verify", () => api<{ case: Case; found: boolean | null }>(`/api/v1/gmb/shield/cases/${c.id}/verify`, { method: "POST" }), (r) => { onChange(r.case); setNote(r.found === false ? "No aparece en la ficha: se confirmará en la próxima comprobación." : r.found ? "Sigue publicada." : null); })}
                className={BTN_SEC}
              >
                {B("verify") ?? <Search className="h-4 w-4" />} Comprobar ahora
              </button>
            )}
            {c.status !== "retirada" && <button onClick={() => action("removed")} className={BTN_SEC}>{B("removed") ?? <Check className="h-4 w-4" />} Retirada</button>}
            {c.status !== "descartada" && c.status !== "retirada" && <button onClick={() => action("dismiss")} className="text-xs text-slate-500 hover:underline">Descartar</button>}
            {(c.status === "descartada" || c.status === "retirada" || c.status === "rechazada_final") && <button onClick={() => action("reopen")} className="text-xs text-slate-500 hover:underline">Reabrir</button>}
            <button onClick={() => run("evidence", () => download(`/api/v1/gmb/shield/cases/${c.id}/evidence`, "acta-evidencias.pdf"))} className={BTN_SEC}>
              {B("evidence") ?? <FileText className="h-4 w-4" />} Acta de evidencias
            </button>
          </div>
          {note && <p className="text-xs text-slate-600">{note}</p>}
          {err && <p className="text-xs text-rose-600">{err}</p>}
        </div>
      </div>

      {c.target === "cliente" && c.status !== "retirada" && (
        <div className="rounded-lg border bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-700">Respuesta pública sugerida {c.replyPublishedAt && <Pill tone="emerald">Publicada {fdate(c.replyPublishedAt)}</Pill>}</div>
            <button onClick={() => run("gen", () => api<{ text: string }>(`/api/v1/gmb/shield/cases/${c.id}/reply`, { method: "POST" }), (r) => setReply(r.text))} className={BTN_SEC}>
              {B("gen") ?? <RefreshCw className="h-4 w-4" />} {reply ? "Regenerar" : "Sugerir respuesta"}
            </button>
          </div>
          {reply && (
            <>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} className="w-full rounded-lg border p-2 text-sm" />
              <p className="text-[11px] text-slate-500">Mientras Google decide, una respuesta serena del propietario reduce el daño de la reseña ante otros clientes.</p>
              <div className="flex flex-wrap gap-2">
                <CopyBtn text={reply} />
                <button
                  onClick={() =>
                    confirm("Se publicará esta respuesta en Google como propietario de la ficha. ¿Continuar?") &&
                    run("publish", () => api(`/api/v1/gmb/shield/cases/${c.id}/reply`, { method: "PUT", body: JSON.stringify({ text: reply, publish: true }) }), () => onChange())
                  }
                  className={BTN_PRIMARY}
                >
                  {B("publish") ?? <Send className="h-4 w-4" />} Publicar en Google
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AppealBatches({ onChange }: { onChange: () => void }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, { batchId: string; text: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api<{ batches: Batch[] }>("/api/v1/gmb/shield/appeals").then((d) => setBatches(d.batches)).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!batches.length) return null;
  const key = (b: Batch) => `${b.placeKey}:${b.cases.map((c) => c.id).join(",")}`;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-3">
      <div className="text-sm font-semibold flex items-center gap-2"><Gavel className="h-4 w-4 text-rose-600" /> Apelaciones pendientes</div>
      <p className="text-xs text-slate-600">
        Google rechazó estas reseñas en la primera denuncia. Cada reseña admite <b>una</b> apelación y se pueden apelar <b>hasta 10 a la vez</b>: la
        herramienta agrupa las de cada ficha y redacta la apelación con toda la evidencia de los análisis.
      </p>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {batches.map((b) => {
        const k = key(b);
        const t = texts[k] ?? (b.batchId && b.text ? { batchId: b.batchId, text: b.text } : null);
        return (
          <div key={k} className="rounded-lg bg-white border p-3 space-y-2">
            <div className="text-sm"><b>{b.placeTitle}</b> · {b.cases.length} reseña(s): <span className="text-slate-500">{b.cases.map((c) => `${c.author} (${c.rating}★)`).join(", ")}</span></div>
            {t ? (
              <>
                <textarea value={t.text} onChange={(e) => setTexts((x) => ({ ...x, [k]: { ...t, text: e.target.value } }))} rows={9} className="w-full rounded-lg border p-2 text-xs font-mono" />
                <div className="flex flex-wrap gap-2">
                  <CopyBtn text={t.text} label="Copiar apelación" />
                  <a href={RMT_URL} target="_blank" rel="noopener noreferrer" className={BTN_SEC}><ExternalLink className="h-4 w-4" /> Abrir herramienta de Google</a>
                  <button
                    onClick={async () => {
                      setBusy(k);
                      try {
                        await api("/api/v1/gmb/shield/appeals", { method: "PATCH", body: JSON.stringify({ batchId: t.batchId, text: t.text }) });
                        await load();
                        onChange();
                      } catch (e: any) {
                        setErr(e.message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                    className={BTN_PRIMARY}
                  >
                    {busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Apelación enviada
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={async () => {
                  setBusy(k);
                  setErr(null);
                  try {
                    const d = await api<{ batchId: string; text: string }>("/api/v1/gmb/shield/appeals", { method: "POST", body: JSON.stringify({ caseIds: b.cases.map((c) => c.id) }) });
                    setTexts((x) => ({ ...x, [k]: d }));
                  } catch (e: any) {
                    setErr(e.message);
                  } finally {
                    setBusy(null);
                  }
                }}
                className={BTN_PRIMARY}
              >
                {busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Redactar apelación conjunta
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CasesView() {
  const [data, setData] = useState<{ cases: Case[]; counts: Record<string, number>; places: { key: string; title: string; n: number }[] } | null>(null);
  const [status, setStatus] = useState("abiertas");
  const [target, setTarget] = useState("");
  const [place, setPlace] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ status, target, place, q });
    return api<typeof data & {}>(`/api/v1/gmb/shield/cases?${qs}`).then(setData).catch((e) => setErr(e.message));
  }, [status, target, place, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q, tick]);

  const counts = data?.counts ?? {};
  const openN = ["preparada", "denunciada", "rechazada", "apelada", "legal"].reduce((s, k) => s + (counts[k] ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {([
          ["abiertas", `En curso (${openN})`],
          ["preparada", `Por denunciar (${counts.preparada ?? 0})`],
          ["denunciada", `Denunciadas (${counts.denunciada ?? 0})`],
          ["rechazada", `Por apelar (${counts.rechazada ?? 0})`],
          ["apelada", `Apeladas (${counts.apelada ?? 0})`],
          ["retirada", `Retiradas (${counts.retirada ?? 0})`],
          ["", "Todas"]
        ] as const).map(([k, l]) => (
          <button key={k || "all"} onClick={() => setStatus(k)} className={`px-3 py-1.5 rounded-full border ${status === k ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-slate-50"}`}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="px-2 py-1.5 rounded-lg border text-sm bg-white">
          <option value="">Cliente y competencia</option>
          <option value="cliente">Negativas al cliente</option>
          <option value="competidor">Positivas falsas de la competencia</option>
        </select>
        <select value={place} onChange={(e) => setPlace(e.target.value)} className="px-2 py-1.5 rounded-lg border text-sm bg-white max-w-xs">
          <option value="">Todas las fichas</option>
          {(data?.places ?? []).map((p) => <option key={p.key} value={p.key}>{p.title} ({p.n})</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar autor, texto o ficha" className="px-3 py-1.5 rounded-lg border text-sm flex-1 min-w-[180px]" />
      </div>

      <AppealBatches onChange={() => setTick((t) => t + 1)} />
      {err && <p className="text-xs text-rose-600">{err}</p>}

      {!data ? (
        <div className="py-10 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : !data.cases.length ? (
        <div className={`${CARD} text-sm text-slate-500 text-center py-10`}>
          No hay reseñas en esta vista. Los análisis y la vigilancia diaria envían aquí automáticamente las reseñas que se pueden denunciar.
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden divide-y">
          {data.cases.map((c) => (
            <div key={c.id}>
              <button onClick={() => setOpen(open === c.id ? null : c.id)} className="w-full text-left p-3 hover:bg-slate-50 flex items-start gap-3">
                {open === c.id ? <ChevronDown className="h-4 w-4 mt-1 text-slate-400" /> : <ChevronRight className="h-4 w-4 mt-1 text-slate-400" />}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <b className="truncate max-w-[200px]">{c.author || "Usuario de Google"}</b>
                    <Stars n={c.rating} />
                    <span className="text-xs text-slate-500">{fdate(c.reviewDate)} · {c.placeTitle}</span>
                    {c.target === "competidor" && <Pill tone="sky">Competencia</Pill>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{c.text?.trim() ? `«${c.text}»` : "Sin texto"}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 truncate">{(c.reasons ?? []).map((r) => r.label).join(" · ")}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={STATUS_TONE[c.status] ?? "slate"}>{STATUS_LABEL[c.status] ?? c.status}</Pill>
                  <span className={`text-[11px] ${c.likelihood === "alta" ? "text-rose-600" : c.likelihood === "media" ? "text-amber-600" : "text-slate-400"}`}>retirada {c.likelihood}</span>
                </div>
              </button>
              {open === c.id && (
                <CaseDetail
                  c={c}
                  onChange={(nc) => {
                    if (nc) setData((d) => (d ? { ...d, cases: d.cases.map((x) => (x.id === nc.id ? { ...x, ...nc } : x)) } : d));
                    setTick((t) => t + 1);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════ Perfiles ═════════════════════════ */

type Profile = {
  id: string; contributorId: string; name: string; link: string; maxScore: number; level: string; status: string; timesFlagged: number;
  places: { title: string; role?: string; at: string }[] | null; removedCount: number; lastSeenAt: string; notes: string | null;
};

export function ProfilesView() {
  const [data, setData] = useState<{ profiles: Profile[]; totals: { total: number; confirmed: number; multi: number } } | null>(null);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const load = useCallback(() => {
    const qs = new URLSearchParams({ q, level, status });
    return api<typeof data & {}>(`/api/v1/gmb/shield/profiles?${qs}`).then(setData).catch(() => {});
  }, [q, level, status]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  const setProfile = async (id: string, s: string) => {
    await api(`/api/v1/gmb/shield/profiles/${id}`, { method: "PATCH", body: JSON.stringify({ status: s }) }).catch(() => {});
    load();
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 max-w-3xl">
        Cada análisis y cada vigilancia alimentan esta base. Cuando un perfil vuelve a aparecer en otra ficha, el análisis lo detecta al momento y
        suma puntos de riesgo; si Google retira una de sus reseñas pasa a «confirmado». Sólo se guardan datos públicos de Google Maps.
      </p>
      {data && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill>{data.totals.total} perfiles</Pill>
          <Pill tone="amber">{data.totals.multi} reincidentes (≥ 2 fichas)</Pill>
          <Pill tone="rose">{data.totals.confirmed} confirmados por Google</Pill>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o id" className="px-3 py-1.5 rounded-lg border text-sm flex-1 min-w-[180px]" />
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="px-2 py-1.5 rounded-lg border text-sm bg-white">
          <option value="">Cualquier riesgo</option>
          <option value="alto">Riesgo alto</option>
          <option value="medio">Riesgo medio</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="px-2 py-1.5 rounded-lg border text-sm bg-white">
          <option value="">Cualquier estado</option>
          <option value="sospechoso">Sospechoso</option>
          <option value="confirmado">Confirmado</option>
          <option value="descartado">Descartado</option>
        </select>
      </div>
      {!data ? (
        <div className="py-10 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : !data.profiles.length ? (
        <div className={`${CARD} text-sm text-slate-500 text-center py-10`}>Aún no hay perfiles. Se añaden solos al terminar cada análisis.</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="text-left p-3 font-medium">Perfil</th>
                <th className="text-left p-3 font-medium">Riesgo</th>
                <th className="text-left p-3 font-medium">Fichas</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">Dónde aparece</th>
                <th className="text-left p-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.profiles.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="p-3">
                    {p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{p.name || p.contributorId}</a> : <span className="font-medium">{p.name || p.contributorId}</span>}
                    <div className="text-[11px] text-slate-400">visto {fdate(p.lastSeenAt)}{p.removedCount ? ` · ${p.removedCount} retirada(s)` : ""}</div>
                  </td>
                  <td className="p-3"><Pill tone={p.level === "alto" ? "rose" : p.level === "medio" ? "amber" : "slate"}>{p.level} · {p.maxScore}</Pill></td>
                  <td className="p-3">{p.timesFlagged}</td>
                  <td className="p-3 text-xs text-slate-600 hidden md:table-cell">
                    {[...new Map((p.places ?? []).map((x) => [x.title, x])).values()].slice(0, 4).map((x) => `${x.title}${x.role ? ` (${x.role})` : ""}`).join(" · ")}
                  </td>
                  <td className="p-3">
                    <select value={p.status} onChange={(e) => setProfile(p.id, e.target.value)} className="px-2 py-1 rounded-lg border text-xs bg-white">
                      <option value="sospechoso">Sospechoso</option>
                      <option value="confirmado">Confirmado</option>
                      <option value="descartado">Descartado</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════ Resultados ═════════════════════════ */

const REASON_LABEL: Record<string, string> = {
  fake: "Perfil vinculado a la competencia", network: "Red de perfiles", known: "Perfil reincidente", competitor: "Positiva falsa (competencia)",
  acoso_insultos: "Acoso o insultos", lenguaje_obsceno: "Lenguaje soez", odio_discriminacion: "Odio o discriminación", informacion_personal: "Información personal",
  conflicto_interes: "Conflicto de intereses", fuera_de_tema: "Fuera de tema", contenido_falso: "Contenido falso", sexual: "Contenido sexual",
  peligroso_ilegal: "Peligroso o ilegal", suplantacion: "Suplantación", spam_enlaces: "Spam o publicidad", policy: "Políticas de contenido"
};

function RateTable({ title, rows }: { title: string; rows: [string, { total: number; decided: number; removed: number; rate: number; avgDays: number | null } | undefined][] }) {
  const list = rows.filter(([, b]) => b && b.total > 0).sort((a, b) => (b[1]?.rate ?? 0) - (a[1]?.rate ?? 0) || (b[1]?.decided ?? 0) - (a[1]?.decided ?? 0));
  return (
    <div className={CARD}>
      <div className="text-xs font-semibold text-slate-700 mb-2">{title}</div>
      {!list.length ? (
        <p className="text-xs text-slate-400">Sin datos todavía.</p>
      ) : (
        <div className="space-y-2">
          {list.map(([k, b]) => (
            <div key={k}>
              <div className="flex justify-between text-xs">
                <span>{k}</span>
                <span className="text-slate-500">{b!.decided ? `${Math.round(b!.rate * 100)}% · ${b!.removed}/${b!.decided}` : `${b!.total} enviadas, sin decisión`}{b!.avgDays != null ? ` · ${String(b!.avgDays).replace(".", ",")} d` : ""}</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${Math.round(b!.rate * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StatsView() {
  const [s, setS] = useState<LearningStats | null>(null);
  useEffect(() => {
    api<{ stats: LearningStats }>("/api/v1/gmb/shield/stats").then((d) => setS(d.stats)).catch(() => {});
  }, []);
  const decided = useMemo(() => (s ? Object.values(s.byOption).reduce((t, b) => t + (b?.decided ?? 0), 0) : 0), [s]);
  if (!s) return <div className="py-10 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-4 gap-3">
        {([
          ["Reseñas en el centro", s.total],
          ["Pendientes de Google", s.pending],
          ["Retiradas", s.removed],
          ["Tasa de éxito", decided ? `${Math.round((s.removed / Math.max(1, decided)) * 100)}%` : "—"]
        ] as const).map(([l, v]) => (
          <div key={l} className={CARD}><div className="text-xs text-slate-500">{l}</div><div className="text-2xl font-semibold">{v}</div></div>
        ))}
      </div>
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 flex gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          Cuando un motivo acumula 5 o más decisiones de Google, el sistema lo usa para <b>elegir la opción de denuncia</b> con más éxito, <b>calibrar la probabilidad</b> de retirada de cada caso y
          <b> priorizar los argumentos</b> de las apelaciones.
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <RateTable title="Por opción marcada en Google" rows={Object.entries(s.byOption).map(([k, b]) => [GOOGLE_OPTIONS[k as keyof typeof GOOGLE_OPTIONS] ?? k, b])} />
        <RateTable title="Por motivo detectado" rows={Object.entries(s.byReason).map(([k, b]) => [REASON_LABEL[k] ?? k, b])} />
        <RateTable title="Cliente vs. competencia" rows={Object.entries(s.byTarget).map(([k, b]) => [k === "competidor" ? "Positivas falsas de la competencia" : "Negativas al cliente", b])} />
        <RateTable title="Por vía" rows={[...Object.entries(s.byChannel).map(([k, b]) => [{ tool: "Herramienta de gestión de reseñas", maps: "Denuncia en Maps", legal: "Vía legal" }[k] ?? k, b] as [string, typeof b]), ["Tras apelar", s.appealRate]]} />
      </div>
    </div>
  );
}

