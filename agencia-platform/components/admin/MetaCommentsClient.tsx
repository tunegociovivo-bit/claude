"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Loader2, MessageSquare, Pencil, RefreshCw, Send, Trash2, UserX, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import MetaConnectionModal from "@/components/campanas-meta/MetaConnectionModal";

const CAMPAIGN_ID = "120247270045340145";
type Feed = { campaignId: string; campaignName: string | null; adAccountId: string | null; adAccountName: string | null; clientName: string; displayName: string | null; active: boolean; lastSyncAt: string | null; lastError: string | null };
type AdAccount = { id: string; name: string; status: number; currency: string };
type Campaign = { id: string; name: string; status: string; configured_status?: string; effective_status?: string; objective?: string };
type Comment = { id: string; authorName: string | null; authorId: string | null; authorBlockedAt: string | null; platform: string; message: string; sentiment: string; sentimentReason: string | null; aiDraft: string | null; status: string; commentCreatedAt: string; adName: string | null; feed: { clientName: string; displayName: string | null; adAccountName: string | null } };

function canonicalClientName(name: string) {
  return name.trim().replace(/\s+(nueva|nuevo)$/i, "").replace(/\s+/g, " ");
}

function clientNameOf(value: { clientName: string; displayName?: string | null; adAccountName?: string | null }) {
  return value.displayName?.trim() || canonicalClientName(value.adAccountName || value.clientName);
}

function clientKeyOf(value: { clientName: string; adAccountName?: string | null }) {
  return canonicalClientName(value.adAccountName || value.clientName).toLocaleLowerCase("es-ES");
}

export default function MetaCommentsClient() {
  const [items, setItems] = useState<Comment[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});
  const [editingClient, setEditingClient] = useState<string | null>(null);
  const [clientNameDraft, setClientNameDraft] = useState("");
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

  const syncClient = useCallback(async (clientKey: string, clientFeeds: Feed[]) => {
    setBusy(`sync-client:${clientKey}`); setError(null);
    try {
      for (const feed of clientFeeds) {
        const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", campaignId: feed.campaignId, clientName: feed.clientName }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? `Meta no ha permitido sincronizar ${feed.campaignName ?? feed.clientName}`);
      }
      await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }, [load]);

  const renameClient = useCallback(async (clientKey: string, clientFeeds: Feed[]) => {
    const displayName = clientNameDraft.trim(); if (!displayName) return;
    setBusy(`rename-client:${clientKey}`); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rename_client", campaignIds: clientFeeds.map((feed) => feed.campaignId), displayName }) });
      const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo guardar el nombre del cliente");
      setEditingClient(null); await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }, [clientNameDraft, load]);

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

  async function selectAllCampaigns() {
    const account = accounts.find((item) => item.id === selectedAccountId); if (!account || campaigns.length === 0) return;
    setBusy("select-all"); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "monitor_many", accountId: account.id, accountName: account.name, campaigns: campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name })) }) });
      const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message ?? "No se pudieron seleccionar todas las campañas"); await load();
      setImportResult(`${data.selected ?? campaigns.length} campañas activas seleccionadas para monitorización.`);
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

  async function moderate(item: Comment, action: "delete_comment" | "block_author") {
    const deleting = action === "delete_comment";
    const question = deleting ? `¿Eliminar definitivamente de Meta el comentario de ${item.authorName ?? "este usuario"}? Esta acción no se puede deshacer.` : `¿Bloquear en la página de Meta a ${item.authorName ?? "este usuario"}? Dejará de poder interactuar con la página.`;
    if (!confirm(question) || !confirm(deleting ? "Confirma de nuevo: el comentario desaparecerá también de Meta." : "Confirma de nuevo: se bloqueará al usuario en Meta.")) return;
    setBusy(`${action}:${item.id}`); setError(null);
    try {
      const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, commentId: item.id }) });
      const data = await response.json(); if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo completar la moderación en Meta"); await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); } finally { setBusy(null); }
  }

  async function importPeriod() {
    if (!fromDate || !toDate) return;
    setBusy("import"); setError(null); setImportResult(null);
    try {
      const from = new Date(`${fromDate}T00:00:00.000Z`).toISOString();
      const to = new Date(`${toDate}T23:59:59.999Z`).toISOString();
      let imported = 0; let discovered = 0; let remaining = 0; let rounds = 0; let diagnostics: any = null;
      const selectedFeed = feeds.find((feed) => feed.campaignId === selectedCampaignId);
      if (!selectedFeed) throw new Error("Selecciona primero una campaña monitorizada");
      do {
        const response = await fetch("/api/v1/meta-comments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", campaignId: selectedFeed.campaignId, clientName: selectedFeed.clientName, from, to }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo importar el periodo");
        imported += data.created ?? 0; discovered = data.discovered ?? discovered; remaining = data.remaining ?? 0; diagnostics = data.diagnostics ?? diagnostics; rounds++;
      } while (remaining > 0 && rounds < 20);
      const detail = diagnostics ? ` Meta revisó ${diagnostics.ads} anuncios, ${diagnostics.facebookTargets} publicaciones de Facebook y ${diagnostics.instagramTargets} de Instagram; ${diagnostics.adsWithoutPost} anuncios no tenían publicación accesible.` : "";
      setImportResult(`Importación terminada: ${imported} comentarios nuevos de ${discovered} encontrados en el periodo.${detail}`);
      await load();
    } catch (cause: any) { setError(String(cause?.message ?? cause)); }
    finally { setBusy(null); }
  }

  const clientGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; feeds: Feed[] }>();
    for (const item of feeds.filter((feed) => feed.active)) {
      const key = clientKeyOf(item);
      const group = groups.get(key) ?? { key, name: clientNameOf(item), feeds: [] };
      group.feeds.push(item); groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [feeds]);
  const clientOptions = useMemo(() => {
    const options = new Map(clientGroups.map((group) => [group.key, group.name]));
    for (const item of items) options.set(clientKeyOf(item.feed), clientNameOf(item.feed));
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [clientGroups, items]);
  const visible = useMemo(() => items.filter((item) =>
    (clientFilter === "all" || clientKeyOf(item.feed) === clientFilter)
    && (filter === "all" || (filter === "pending" ? item.status !== "replied" : filter === "negative" ? item.sentiment === "negative" : item.status === "replied"))
  ), [items, filter, clientFilter]);
  const feed = feeds.find((item) => item.campaignId === selectedCampaignId);

  return <div className="max-w-6xl mx-auto">
    <PageHeader title="Comentarios de anuncios Meta" description="Bandeja de comentarios, borradores con IA y alertas por reputación. Ninguna respuesta se publica sin confirmación." />
    <div className="mb-5 rounded-xl border bg-white p-4">
      <div className="mb-3"><div className="font-semibold text-slate-900">1. Cuenta publicitaria</div><div className="text-xs text-slate-500">Se muestran todas las cuentas autorizadas en tu conexión de Meta.</div></div>
      <div className="flex flex-wrap gap-2"><select value={selectedAccountId} onChange={(event) => void loadCampaigns(event.target.value)} className="w-full max-w-xl rounded-lg border px-3 py-2 text-sm"><option value="">Selecciona una cuenta publicitaria…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id} · {account.currency}</option>)}</select><button onClick={() => setConnectionOpen(true)} className="rounded-lg border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Gestionar conexión Meta</button></div>
      {busy === "accounts" && <span className="ml-3 text-xs text-slate-500">Cargando cuentas…</span>}
    </div>
    {selectedAccountId && <div className="mb-5 rounded-xl border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3"><div className="flex-1"><div className="font-semibold text-slate-900">2. Campañas activas</div><div className="text-xs text-slate-500">Solo aparecen campañas cuyo estado efectivo en Meta es ACTIVO.</div></div><button onClick={() => void selectAllCampaigns()} disabled={busy === "select-all" || campaigns.length === 0 || campaigns.every((campaign) => feeds.some((feed) => feed.campaignId === campaign.id && feed.active))} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy === "select-all" && <Loader2 className="h-4 w-4 animate-spin" />} Seleccionar todas las activas</button></div>
      {busy === "campaigns" ? <div className="text-sm text-slate-500">Cargando campañas activas…</div> : campaigns.length === 0 ? <div className="text-sm text-slate-500">Esta cuenta no tiene campañas activas.</div> : <div className="divide-y rounded-lg border">{campaigns.map((campaign) => { const monitored = feeds.some((item) => item.campaignId === campaign.id && item.active); return <label key={campaign.id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-slate-50"><input type="checkbox" checked={monitored} onChange={() => void toggleCampaign(campaign)} disabled={busy === `toggle:${campaign.id}`} className="h-4 w-4" /><span className="flex-1"><span className="block text-sm font-medium text-slate-800">{campaign.name}</span><span className="text-xs text-slate-500">{campaign.id} · {campaign.objective ?? campaign.status}</span></span><span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Activa</span>{monitored && <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">Monitorizada</span>}</label>; })}</div>}
    </div>}
    {clientGroups.length > 0 && <div className="mb-5 space-y-3">{clientGroups.map((group) => {
      const expanded = Boolean(expandedClients[group.key]);
      const editing = editingClient === group.key;
      return <section key={group.key} className="overflow-hidden rounded-xl border bg-white">
        <div className={`flex flex-wrap items-center gap-3 bg-slate-50 px-4 py-3 ${expanded ? "border-b" : ""}`}>
          <button type="button" onClick={() => setExpandedClients((current) => ({ ...current, [group.key]: !expanded }))} aria-expanded={expanded} className="flex min-w-[220px] flex-1 items-center gap-3 text-left">
            <ChevronDown className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`} />
            <span><span className="block font-semibold text-slate-900">{group.name}</span><span className="block text-xs text-slate-500">{group.feeds.length} {group.feeds.length === 1 ? "campaña monitorizada" : "campañas monitorizadas"}</span></span>
          </button>
          {editing ? <div className="flex items-center gap-1"><input aria-label={`Nuevo nombre para ${group.name}`} autoFocus value={clientNameDraft} onChange={(event) => setClientNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void renameClient(group.key, group.feeds); if (event.key === "Escape") setEditingClient(null); }} maxLength={120} className="w-56 rounded-lg border bg-white px-3 py-2 text-sm" /><button title="Guardar nombre" onClick={() => void renameClient(group.key, group.feeds)} disabled={!clientNameDraft.trim() || busy === `rename-client:${group.key}`} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{busy === `rename-client:${group.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button><button title="Cancelar" onClick={() => setEditingClient(null)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div> : <button title="Cambiar nombre del cliente" onClick={() => { setEditingClient(group.key); setClientNameDraft(group.name); }} className="rounded-lg border bg-white p-2 text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>}
          <button onClick={() => void syncClient(group.key, group.feeds)} disabled={busy === `sync-client:${group.key}`} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === `sync-client:${group.key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sincronizar cliente</button>
        </div>
        {expanded && <div className="divide-y">{group.feeds.map((item) => <div key={item.campaignId} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-[240px] flex-1"><div className="text-sm font-semibold">{item.campaignName ?? item.clientName}</div><div className="text-xs text-slate-500">{item.campaignId} · {item.lastSyncAt ? `Última sincronización ${new Date(item.lastSyncAt).toLocaleString("es-ES")}` : "Pendiente de primera sincronización"}</div></div><button onClick={() => void syncFeed(item)} disabled={busy === `sync:${item.campaignId}` || busy === `sync-client:${group.key}`} className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">{busy === `sync:${item.campaignId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sincronizar campaña</button></div>)}</div>}
      </section>;
    })}</div>}
    <div className="mb-5 rounded-xl border bg-white p-4">
      <div className="mb-3"><div className="font-semibold text-slate-900">Importar comentarios antiguos</div><div className="text-xs text-slate-500">Selecciona un periodo y se recorrerán todas las páginas de resultados de Meta sin duplicar comentarios ya guardados.</div></div>
      <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-medium text-slate-700">Campaña<select value={selectedCampaignId} onChange={(event) => setSelectedCampaignId(event.target.value)} className="mt-1 block max-w-xs rounded-lg border px-3 py-2 text-sm">{feeds.filter((item) => item.active).map((item) => <option key={item.campaignId} value={item.campaignId}>{item.campaignName ?? item.clientName}</option>)}</select></label><label className="text-xs font-medium text-slate-700">Desde<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" /></label><label className="text-xs font-medium text-slate-700">Hasta<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 block rounded-lg border px-3 py-2 text-sm" /></label><button onClick={importPeriod} disabled={busy === "import" || !selectedCampaignId || !fromDate || !toDate || fromDate > toDate} className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 disabled:opacity-50">{busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Importar periodo</button></div>
      {importResult && <div className="mt-3 text-sm font-medium text-emerald-700">{importResult}</div>}
    </div>
    {(error || feed?.lastError) && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><b>No se ha podido completar la sincronización:</b> {error ?? feed?.lastError}<div className="mt-1 text-xs">El token debe incluir pages_read_engagement y pages_manage_engagement y tener acceso a la página del anuncio.</div><button onClick={() => setConnectionOpen(true)} className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100">Reconectar Meta</button></div>}
    <div className="mb-4 flex flex-wrap items-center gap-2"><select aria-label="Filtrar comentarios por cliente" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="mr-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-slate-700"><option value="all">Todos los clientes</option>{clientOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>{[["all", "Todos"], ["pending", "Pendientes"], ["negative", "Negativos"], ["replied", "Respondidos"]].map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === key ? "bg-slate-900 text-white" : "border bg-white text-slate-600"}`}>{label}</button>)}</div>
    {visible.length === 0 ? <div className="rounded-xl border bg-white p-10 text-center text-slate-500"><MessageSquare className="mx-auto mb-3 h-8 w-8 text-slate-300" /><div className="font-medium text-slate-700">No hay comentarios en este filtro</div><div className="mt-1 text-sm">Pulsa “Sincronizar ahora” para consultar Meta.</div></div> : <div className="space-y-4">{visible.map((item) => <article key={item.id} className={`rounded-xl border bg-white p-5 ${item.sentiment === "negative" ? "border-rose-300" : ""}`}>
      <div className="mb-3 flex flex-wrap items-start gap-2"><div className="flex-1"><div className="font-semibold">{item.authorName ?? "Usuario de Meta"}</div><div className="text-xs text-slate-500">{clientNameOf(item.feed)} · {item.adName ?? "Anuncio"} · {new Date(item.commentCreatedAt).toLocaleString("es-ES")}</div></div><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${item.sentiment === "negative" ? "bg-rose-100 text-rose-700" : item.sentiment === "positive" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{item.sentiment === "negative" && <AlertTriangle className="h-3 w-3" />}{item.sentiment === "negative" ? "Negativo" : item.sentiment === "positive" ? "Positivo" : "Neutral"}</span></div>
      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{item.message}</div>
      {item.sentimentReason && <div className="mb-3 text-xs text-slate-500">Análisis IA: {item.sentimentReason}</div>}
      <label className="text-xs font-medium text-slate-700">Borrador de respuesta (editable)</label><textarea value={drafts[item.id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={item.status === "replied"} rows={3} className="mt-1 w-full rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-50" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2"><button onClick={() => void moderate(item, "delete_comment")} disabled={busy === `delete_comment:${item.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">{busy === `delete_comment:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Eliminar de Meta</button><button onClick={() => void moderate(item, "block_author")} disabled={!item.authorId || item.platform !== "facebook" || Boolean(item.authorBlockedAt) || busy === `block_author:${item.id}`} title={!item.authorId ? "Meta no ha proporcionado la identidad del autor" : item.platform !== "facebook" ? "El bloqueo no está disponible para Instagram mediante esta conexión" : undefined} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><UserX className="h-3.5 w-3.5" /> {item.authorBlockedAt ? "Usuario bloqueado" : "Bloquear usuario"}</button></div>{item.status === "replied" ? <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Respondido en Meta</span> : <button onClick={() => reply(item)} disabled={busy === item.id || !drafts[item.id]?.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Publicar respuesta</button>}</div>
    </article>)}</div>}
    <MetaConnectionModal open={connectionOpen} onClose={() => setConnectionOpen(false)} onSaved={() => { setError(null); void loadAccounts(); }} />
  </div>;
}
