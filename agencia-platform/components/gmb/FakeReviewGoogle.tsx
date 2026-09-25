"use client";

/**
 * Vistas para Google del Detector de reseñas: informe de evidencias (perfiles con patrón +
 * reseñas con contenido prohibido) y escrito a soporte (IA, editable, PDF).
 */
import { useMemo, useState } from "react";
import { Copy, Check, Download, Loader2, Sparkles, Save, ExternalLink } from "lucide-react";
import { buildGoogleCase } from "@/lib/gmb/fake-reviews/google";
import { POLICY_CATEGORIES } from "@/lib/gmb/fake-reviews/policy";
import type { AnalysisResults } from "@/lib/gmb/fake-reviews/analyzer";

const CARD = "bg-white rounded-xl border p-4";
const BTN = "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium";
const BTN_PRIMARY = `${BTN} bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50`;
const BTN_SEC = `${BTN} border bg-white hover:bg-slate-50 disabled:opacity-50`;

/** Descarga vía fetch+blob (funciona también en la app de escritorio, donde window.print está bloqueado). */
export async function downloadPdf(id: string, type: "cliente" | "google" | "carta", setBusy?: (b: boolean) => void, onError?: (m: string) => void) {
  setBusy?.(true);
  try {
    const r = await fetch(`/api/v1/gmb/fake-reviews/${id}/pdf?type=${type}`);
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d?.error?.message ?? `Error ${r.status}`);
    }
    const cd = r.headers.get("content-disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `${type}.pdf`;
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e: any) {
    onError?.(e.message);
  } finally {
    setBusy?.(false);
  }
}

function Stars({ n }: { n: number }) {
  const r = Math.round(n || 0);
  return (
    <span className="whitespace-nowrap">
      <span className="text-amber-500">{"★".repeat(r)}</span>
      <span className="text-slate-300">{"★".repeat(Math.max(0, 5 - r))}</span>
    </span>
  );
}

const fdate = (d?: string) => (d ? d.split("-").reverse().join("/") : "—");
const LIK: Record<string, string> = { alta: "bg-rose-50 text-rose-700", media: "bg-amber-50 text-amber-700", baja: "bg-slate-100 text-slate-600" };

export function GoogleCaseView({ id, results }: { id: string; results: AnalysisResults }) {
  const gc = useMemo(() => buildGoogleCase(results), [results]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const links = gc.removals.map((r) => r.link).filter(Boolean).join("\n");

  return (
    <div className="space-y-4">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="text-sm">
          <b>{gc.removals.length}</b> reseñas cuya retirada se puede solicitar · <b>{gc.fakeProfiles.length}</b> perfiles con patrón claro ·{" "}
          <b>{gc.policyReviews.length}</b> con contenido prohibido
          {!results.policy && <span className="text-slate-500"> (este análisis no incluyó la revisión de contenido)</span>}
        </div>
        <div className="flex gap-2">
          <button className={BTN_SEC} disabled={!links} onClick={() => { navigator.clipboard?.writeText(links); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} Copiar enlaces
          </button>
          <button className={BTN_PRIMARY} disabled={busy || !gc.removals.length} onClick={() => downloadPdf(id, "google", setBusy, setErr)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF para Google
          </button>
        </div>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {!gc.removals.length && (
        <div className={`${CARD} text-sm text-slate-600`}>No hay perfiles con patrón claro ni reseñas con contenido prohibido en este análisis.</div>
      )}

      {gc.fakeProfiles.length > 0 && (
        <div className={CARD}>
          <h3 className="font-semibold mb-1">A · Perfiles con patrón de interacción falsa</h3>
          <p className="text-xs text-slate-500 mb-3">Valoran negativamente al cliente y positivamente a competidores directos (riesgo medio o alto).</p>
          <div className="space-y-3">
            {gc.fakeProfiles.map((a, i) => (
              <div key={a.cid || i} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {a.name}{" "}
                    {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-xs underline text-slate-500">perfil</a>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${a.level === "alto" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                    riesgo {a.level} · {a.score}
                  </span>
                </div>
                <div className="grid md:grid-cols-2 gap-2 mt-2 text-sm">
                  {a.clientReviews.map((r, j) => (
                    <div key={`c${j}`} className="rounded bg-rose-50/60 p-2">
                      <div className="text-xs"><Stars n={r.rating} /> {fdate(r.date)} · al cliente</div>
                      <div className="text-[13px]">{r.text || <i className="text-slate-400">Sin texto</i>}</div>
                      {r.link && <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-xs underline">Abrir reseña</a>}
                    </div>
                  ))}
                  {a.compReviews.filter((c) => c.rating >= (results.params.posThreshold ?? 4)).map((c, j) => (
                    <div key={`p${j}`} className="rounded bg-amber-50/60 p-2">
                      <div className="text-xs"><Stars n={c.rating} /> {fdate(c.date)} · {results.competitors[c.comp ?? 0]?.title ?? c.title}</div>
                      <div className="text-[13px]">{c.text || <i className="text-slate-400">Sin texto</i>}</div>
                      {c.link && <a href={c.link} target="_blank" rel="noopener noreferrer" className="text-xs underline">Abrir reseña</a>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {gc.policyReviews.length > 0 && (
        <div className={CARD}>
          <h3 className="font-semibold mb-1">B · Reseñas con contenido prohibido</h3>
          <p className="text-xs text-slate-500 mb-3">Detectadas con reglas {results.policy?.aiUsed ? "e inteligencia artificial" : ""} frente a la política de contenido de Google Maps.</p>
          <div className="space-y-3">
            {gc.policyReviews.map((f, i) => (
              <div key={f.reviewId || i} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">{f.author || "Usuario de Google"} · <Stars n={f.rating} /> <span className="text-slate-500 text-xs">{fdate(f.date)}</span></div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${LIK[f.likelihood]}`}>retirada {f.likelihood}</span>
                </div>
                <p className="text-[13px] mt-1">«{f.text}»</p>
                <ul className="mt-2 space-y-1">
                  {f.violations.map((v, j) => (
                    <li key={j} className="text-xs">
                      <b>{POLICY_CATEGORIES[v.category].label}</b> · <span className="text-slate-500">{POLICY_CATEGORIES[v.category].google}</span>: «{v.evidence}» — {v.explanation}
                    </li>
                  ))}
                </ul>
                {f.link && <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-xs underline">Abrir reseña</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${CARD} text-xs text-slate-600 space-y-1`}>
        <b>Cómo presentarlo a Google</b>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>Denuncia cada reseña desde el Perfil de Empresa (⋮ → «Denunciar reseña») eligiendo el motivo indicado.</li>
          <li>Sigue el estado en la herramienta de gestión de reseñas de Google y, si se rechaza, pide una apelación adjuntando este PDF.</li>
          <li>Para casos masivos, abre un caso con el soporte del Perfil de Empresa y envía el escrito de la pestaña «Escrito a soporte».</li>
        </ol>
        <a href="https://support.google.com/business/workflow/9945796?hl=es" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">
          Herramienta de gestión de reseñas <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

export function LetterView({ id, results, onSaved }: { id: string; results: AnalysisResults; onSaved: (r: AnalysisResults) => void }) {
  const gc = useMemo(() => buildGoogleCase(results), [results]);
  const [text, setText] = useState(results.letter?.text ?? "");
  const [busy, setBusy] = useState<"gen" | "save" | "pdf" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dirty = text !== (results.letter?.text ?? "");

  async function generate() {
    if (results.letter?.text && !confirm("¿Volver a redactar el escrito? Se perderán los cambios manuales.")) return;
    setBusy("gen");
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/fake-reviews/${id}/letter`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? d?.message ?? `Error ${r.status}`);
      setText(d.letter.text);
      onSaved({ ...results, letter: d.letter });
      if (!d.ai) setMsg("La IA no estaba disponible: se ha usado la plantilla estándar.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  }
  async function save() {
    setBusy("save");
    setMsg(null);
    try {
      const r = await fetch(`/api/v1/gmb/fake-reviews/${id}/letter`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? `Error ${r.status}`);
      onSaved({ ...results, letter: d.letter });
      setMsg("Cambios guardados.");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="text-sm">
          Escrito para el soporte del Perfil de Empresa de Google solicitando la retirada de <b>{gc.removals.length}</b> reseñas.
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={BTN_SEC} onClick={generate} disabled={!!busy || !gc.removals.length}>
            {busy === "gen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {results.letter?.text ? "Volver a redactar" : "Redactar con IA"}
          </button>
          <button className={BTN_SEC} onClick={save} disabled={!!busy || !dirty || text.trim().length < 20}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar cambios
          </button>
          <button className={BTN_SEC} disabled={!text} onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} Copiar
          </button>
          <button className={BTN_PRIMARY} disabled={!!busy || dirty || !gc.removals.length} title={dirty ? "Guarda los cambios antes de descargar" : ""} onClick={() => downloadPdf(id, "carta", (b) => setBusy(b ? "pdf" : null), setMsg)}>
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
          </button>
        </div>
      </div>
      {msg && <p className="text-sm text-slate-600">{msg}</p>}
      {!gc.removals.length ? (
        <div className={`${CARD} text-sm text-slate-600`}>No hay reseñas que reclamar en este análisis.</div>
      ) : !text ? (
        <div className={`${CARD} text-sm text-slate-600`}>
          Pulsa <b>Redactar con IA</b> para generar el escrito con todas las reseñas del informe para Google, su motivo y la política aplicable. Si
          descargas el PDF sin redactarlo, se usa una plantilla estándar.
        </div>
      ) : (
        <textarea value={text} onChange={(e) => setText(e.target.value)} className="w-full min-h-[520px] rounded-xl border p-4 text-sm font-mono leading-relaxed" />
      )}
    </div>
  );
}
