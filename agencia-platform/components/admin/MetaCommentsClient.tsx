"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageSquare, RefreshCw, Send } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import MetaConnectionModal from "@/components/campanas-meta/MetaConnectionModal";

const CAMPAIGN_ID = "120247270045340145";
type Feed = { campaignId: string; campaignName: string | null; adAccountId: string | null; adAccountName: string | null; clientName: string; active: boolean; lastSyncAt: string | null; lastError: string | null };
type AdAccount = { id: string; name: string; status: number; currency: string };
type Campaign = { id: string; name: string; status: string; objective?: string };
type Comment = { id: string; authorName: string | null; message: string; sentiment: string; sentimentReason: string | null; aiDraft: string | null; status: string; commentCreatedAt: string; adName: string | null; feed: { clientName: string } };

export default function MetaCommentsClient() {
  const [items, setItems] = useState<Comment[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [importResult, setImportResult] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState(CAMPAIGN_ID);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/meta-comments", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "No se pudieron cargar los comentarios");
    setItems(data.items ?? []); setFeeds(data.feeds ?? []);
    setDrafts((old) => Object.fromEntries((data.items ?? []).map((item: Comment) => [item.id, old[item.id] ?? item.aiDraft ?? ""])));
    return data;
  }, []);

  const loadAccounts = useCallback(async () => {
    setBusy("accounts");
    try {
      const response = await fetch("/api/v1/meta-comments?catalog=accounts", { cache: "no-store" }); const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "No se pudieron cargar las cuentas publicitarias");
      setAccounts(data.items ?? []);
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }, []);

  const loadCampaigns = useCallback(async (accountId: string) => {
    setSelectedAccountId(accountId); setCampaigns([]); if (!accountId) return;
    setBusy("campaigns");
    try { const response = await fetch(`/api/v1/meta-comments?catalog=campaigns&accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message ?? "No se pudieron cargar las campañas"); setCampaigns(data.items ?? []); }
    catch (cause: any) { setError(String(cause?.message ?? cause)); } finally { setBusy(null); }
  }, []);

  const syncFeed = useCallback(async (feed: Feed) => {
    setBusy(`sync:${feed.campaignId}`); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", campaignId: feed.campaignId, clientName: feed.clientName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Meta no ha permitido sincronizar la campaña");
      await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }, [load]);

  useEffect(() => { load().catch((cause) => setError(String(cause.message ?? cause))); void loadAccounts(); }, [load, loadAccounts]);

  async function toggleCampaign(campaign: Campaign) {
    const account = accounts.find((item) => item.id === selectedAccountId); if (!account) return;
    const monitored = feeds.some((feed) => feed.campaignId === campaign.id && feed.active);
    setBusy(`toggle:${campaign.id}`); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(monitored ? { action: "unmonitor", campaignId: campaign.id } : { action: "monitor", campaignId: campaign.id, campaignName: campaign.name, accountId: account.id, accountName: account.name }) });
      const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo cambiar la monitorización"); await load();
      if (!monitored) setSelectedCampaignId(campaign.id);
    } catch (cause: any) { setError(String(cause?.message ?? cause)); } finally { setBusy(null); }
  }

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

  async function importPeriod() {
    if (!fromDate || !toDate) return;
    setBusy("import"); setError(null); setImportResult(null);
    try {
      const from = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
      const to = new Date(`${toDate}T23:59:59.999Z`).toISOString();
      let imported = 0; let discovered = 0; let remaining = 0; let rounds = 0;
      const selectedFeed = feeds.find((feed) => feed.campaignId === selectedCampaignId);
      if (!selectedFeed) throw new Error("Selecciona primero una campaña monitorizada");
      do {
        const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", campaignId: selectedFeed.campaignId, clientName: selectedFeed.clientName, from, to }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo importar el periodo");
        imported += data.created ?? 0; discovered = data.discovered ?? discovered; remaining = data.remaining ?? 0; rounds++;
      } while (remaining > 0 && rounds < 20);
      setImportResult(`Importación terminada: ${imported} comentarios nuevos de ${discovered} encontrados en el periodo.`);
      await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }

  const visible = useMemo(() => items.filter((item) => filter === "all" || (filter === "pending" ? item.status !== "replied" : filter === "negative" ? item.sentiment === "negative" : item.status === "replied")), [items, filter]);
  const feed = feeds.find((item) => item.campaignId === selectedCampaignId);

  return <div className="max-w-6xl mx-auto">
    <PageHeader title="Comentarios de anuncios Meta" description="Bandeja de comentarios, borradores con IA y alertas por reputación. Ninguna respuesta se publica sin confirmación." />
    <div className="mb-5 rounded-xl border bg-white p-4">
      <div className="mb-3"><div className="font-semibold text-slate-900">1. Cuenta publicitaria</div><div className="text-xs text-slate-500">Se muestran todas las cuentas autorizadas en tu conexión de Meta.</div></div>
      <div className="flex flex-wrap gap-2"><select value={selectedAccountId} onChange={(event) => void loadCampaigns(event.target.value)} className="w-full max-w-xl rounded-lg border px-3 py-2 text-sm"><option value="">Selecciona una cuenta publicitaria…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id} · {account.currency}</option>)}</select><button onClick={() => setConnectionOpen(true)} className="rounded-lg border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Gestionar conexión Meta</button></div>
      {busy === "accounts" && <span className="ml-3 text-xs text-slate-500">Cargando cuentas…</span>}
    </div>
    {selectedAccountId && <div className="mb-5 rounded-xl border bg-white p-4">
      <div className="mb-3"><div className="font-semibold text-slate-900">2. Campañas activas</div><div className="text-xs text-slate-500">Activa las campañas cuyos comentarios quieres registrar y responder desde el Hub.</div></div>
      {busy === "campaigns" ? <div className="text-sm text-slate-500">Cargando campañas activas…</div> : campaigns.length === 0 ? <div className="text-sm text-slate-500">Esta cuenta no tiene campañas activas.</div> : <div className="divide-y rounded-lg border">{campaigns.map((campaign) => { const monitored = feeds.some((item) => item.campaignId === campaign.id && item.active); return <label key={campaign.id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-slate-50"><input type="checkbox" checked={monitored} onChange={() => void toggleCampaign(campaign)} disabled={busy === `toggle:${campaign.id}`} className="h-4 w-4" /><span className="flex-1"><span className="block text-sm font-medium text-slate-800">{campaign.name}</span><span className="text-xs text-slate-500">{campaign.id} · {campaign.objective ?? campaign.status}</span></span>{monitored && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Monitorizada</span>}</label>; })}</div>}
    </div>}
    {feeds.filter((item) => item.active).length > 0 && <div className="mb-5 space-y-2">{feeds.filter((item) => item.active).map((item) => <div key={item.campaignId} className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-4"><div className="min-w-[240px] flex-1"><div className="font-semibold">{item.campaignName ?? item.clientName}</div><div className="text-xs text-slate-500">{item.adAccountName ? `${item.adAccountName} · ` : ""}{item.campaignId} · {item.lastSyncAt ? `Última sincronización ${new Date(item.lastSyncAt).toLocaleString("es-ES")}` : "Pendiente de primera sincronización"}</div></div><button onClick={() => void syncFeed(item)} disabled={busy === `sync:${item.campaignId}`} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === `sync:${item.campaignId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar</button></div>)}</div>}
    <div className="mb-5 rounded-xl border bg-white p-4">
      <div className="mb-3"><div className="font-semibold text-slate-900">Importar comentarios antiguos</div><div className="text-xs text-slate-500">Selecciona un periodo y se recorrerán todas las páginas de resultados de Meta sin duplicar comentarios ya guardados.</div></div>
      <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-medium text-slate-700">Campaña<select value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)} className="mt-1 block max-w-xs rounded-lg border px-3 py-2 text-sm">{feeds.filter((item) => item.active).map((item) => <option key={item.campaignId} value={item.campaignId}>{item.campaignName ?? item.clientName}</option>)}</select></label><label className="text-xs font-medium text-slate-700">Desde<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs font-medium text-slate-700">Hasta<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" /></label><button onClick={importPeriod} disabled={busy === "import" || !selectedCampaignId || !fromDate || !toDate || fromDate > toDate} className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 disabled:opacity-50">{busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Importar periodo</button></div>
      {importResult && <div className="mt-3 text-sm font-medium text-emerald-700">{importResult}</div>}
    </div>
    {(error || feed?.lastError) && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><b>No se ha podido completar la sincronización:</b> {error ?? feed?.lastError}<div className="mt-1 text-xs">El token debe incluir pages_read_engagement y pages_manage_engagement y tener acceso a la página del anuncio.</div><button onClick={() => setConnectionOpen(true)} className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100">Reconectar Meta</button></div>}
    <div className="mb-4 flex flex-wrap gap-2">{[["all", "Todos"], ["pending", "Pendientes"], ["negative", "Negativos"], ["replied", "Respondidos"]].map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === key ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}>{label}</button>)}</div>
    {visible.length === 0 ? <div className="rounded-xl border bg-white p-10 text-center text-slate-500"><MessageSquare className="mx-auto mb-3 h-8 w-8 text-slate-300" /><div className="font-medium text-slate-700">No hay comentarios en este filtro</div><div className="mt-1 text-sm">Pulsa “Sincronizar ahora” para consultar Meta.</div></div> : <div className="space-y-4">{visible.map((item) => <article key={item.id} className={`rounded-xl border bg-white p-5 ${item.sentiment === "negative" ? "border-rose-300" : ""}`}>
      <div className="mb-3 flex flex-wrap items-start gap-2"><div className="flex-1"><div className="font-semibold">{item.authorName ?? "Usuario de Meta"}</div><div className="text-xs text-slate-500">{item.feed.clientName} · {item.adName ?? "Anuncio"} · {new Date(item.commentCreatedAt).toLocaleString("es-ES")}</div></div><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${item.sentiment === "negative" ? "bg-rose-100 text-rose-700" : item.sentiment === "positive" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{item.sentiment === "negative" && <AlertTriangle className="h-3 w-3" />}{item.sentiment === "negative" ? "Negativo" : item.sentiment === "positive" ? "Positivo" : "Neutral"}</span></div>
      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{item.message}</div>
      {item.sentimentReason && <div className="mb-3 text-xs text-slate-500">Análisis IA: {item.sentimentReason}</div>}
      <label className="text-xs font-medium text-slate-700">Borrador de respuesta (editable)</label><textarea value={drafts[item.id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={item.status === "replied"} rows={3} className="mt-1 w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50" />
      <div className="mt-3 flex justify-end">{item.status === "replied" ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Respondido en Meta</span> : <button onClick={() => reply(item)} disabled={busy === item.id || !drafts[item.id]?.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publicar respuesta</button>}</div>
    </article>)}</div>}
    <MetaConnectionModal open={connectionOpen} onClose={() => setConnectionOpen(false)} onSaved={() => { setError(null); void loadAccounts(); }} />
  </div>;
}
