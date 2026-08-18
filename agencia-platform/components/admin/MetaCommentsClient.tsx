"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";
import PageHeader from "@/components/PageHeader";

const CAMPAIGN_ID = "120247270045340145";
type Feed = { campaignId: string; lastSyncAt: string | null; lastError: string | null };
type Comment = { id: string; authorName: string | null; message: string; sentiment: string; sentimentReason: string | null; aiDraft: string | null; status: string; commentCreatedAt: string; adName: string | null; feed: { clientName: string } };

export default function MetaCommentsClient() {
  const [items, setItems] = useState<Comment[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/meta-comments", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "No se pudieron cargar los comentarios");
    setItems(data.items ?? []); setFeeds(data.feeds ?? []);
    setDrafts((old) => Object.fromEntries((data.items ?? []).map((item: Comment) => [item.id, old[item.id] ?? item.aiDraft ?? ""])));
    return data;
  }, []);

  const sync = useCallback(async () => {
    setBusy("sync"); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", campaignId: CAMPAIGN_ID, clientName: "ESAEM" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Meta no ha permitido sincronizar la campaña");
      await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }, [load]);

  useEffect(() => { load().then((data) => { if (!(data.feeds ?? []).some((feed: Feed) => feed.campaignId === CAMPAIGN_ID)) void sync(); }).catch((cause) => setError(String(cause.message ?? cause))); }, [load, sync]);

  async function reply(item: Comment) {
    const message = drafts[item.id]?.trim();
    if (!message || !confirm(`¿Publicar esta respuesta en Meta como respuesta a ${item.authorName ?? "este usuario"}?`)) return;
    setBusy(item.id); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reply", commentId: item.id, message }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo publicar la respuesta");
      await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }

  const visible = useMemo(() => items.filter((item) => filter === "all" || (filter === "pending" ? item.status !== "replied" : filter === "negative" ? item.sentiment === "negative" : item.status === "replied")), [items, filter]);
  const feed = feeds.find((item) => item.campaignId === CAMPAIGN_ID);

  return <div className="max-w-6xl mx-auto">
    <PageHeader title="Comentarios de anuncios Meta" description="Bandeja de comentarios, borradores con IA y alertas por reputación. Ninguna respuesta se publica sin confirmación." />
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4">
      <div className="min-w-[240px] flex-1"><div className="font-semibold">ESAEM</div><div className="text-xs text-slate-500">Campaña {CAMPAIGN_ID} · {feed?.lastSyncAt ? `Última sincronización ${new Date(feed.lastSyncAt).toLocaleString("es-ES")}` : "Pendiente de primera sincronización"}</div></div>
      <button onClick={sync} disabled={busy === "sync"} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar ahora</button>
    </div>
    {(error || feed?.lastError) && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><b>No se ha podido completar la sincronización:</b> {error ?? feed?.lastError}<div className="mt-1 text-xs">El token debe incluir pages_read_engagement y pages_manage_engagement y tener acceso a la página del anuncio.</div></div>}
    <div className="mb-4 flex flex-wrap gap-2">{[["all", "Todos"], ["pending", "Pendientes"], ["negative", "Negativos"], ["replied", "Respondidos"]].map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === key ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}>{label}</button>)}</div>
    {visible.length === 0 ? <div className="rounded-xl border bg-white p-10 text-center text-slate-500"><MessageSquare className="mx-auto mb-3 h-8 w-8 text-slate-300" /><div className="font-medium text-slate-700">No hay comentarios en este filtro</div><div className="mt-1 text-sm">Pulsa “Sincronizar ahora” para consultar Meta.</div></div> : <div className="space-y-4">{visible.map((item) => <article key={item.id} className={`rounded-xl border bg-white p-5 ${item.sentiment === "negative" ? "border-rose-300" : ""}`}>
      <div className="mb-3 flex flex-wrap items-start gap-2"><div className="flex-1"><div className="font-semibold">{item.authorName ?? "Usuario de Meta"}</div><div className="text-xs text-slate-500">{item.feed.clientName} · {item.adName ?? "Anuncio"} · {new Date(item.commentCreatedAt).toLocaleString("es-ES")}</div></div><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${item.sentiment === "negative" ? "bg-rose-100 text-rose-700" : item.sentiment === "positive" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{item.sentiment === "negative" && <AlertTriangle className="h-3 w-3" />}{item.sentiment === "negative" ? "Negativo" : item.sentiment === "positive" ? "Positivo" : "Neutral"}</span></div>
      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{item.message}</div>
      {item.sentimentReason && <div className="mb-3 text-xs text-slate-500">Análisis IA: {item.sentimentReason}</div>}
      <label className="text-xs font-medium text-slate-700">Borrador de respuesta (editable)</label><textarea value={drafts[item.id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={item.status === "replied"} rows={3} className="mt-1 w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50" />
      <div className="mt-3 flex justify-end">{item.status === "replied" ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Respondido en Meta</span> : <button onClick={() => reply(item)} disabled={busy === item.id || !drafts[item.id]?.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publicar respuesta</button>}</div>
    </article>)}</div>}
  </div>;
}
