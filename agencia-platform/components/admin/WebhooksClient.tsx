"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Loader2, Webhook as WebhookIcon, Power, PowerOff, Send, Copy, Check, AlertTriangle } from "lucide-react";

type Webhook = {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  createdAt: string;
  _count?: { deliveries: number };
};

export default function WebhooksClient() {
  const [items, setItems] = useState<Webhook[]>([]);
  const [knownEvents, setKnownEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Form de creación
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/v1/webhooks");
      if (r.ok) {
        const data = await r.json();
        setItems(data.items ?? []);
        setKnownEvents(data.knownEvents ?? []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    if (!url.match(/^https?:\/\//)) return setError("La URL debe empezar por http(s)://");
    if (selectedEvents.size === 0) return setError("Selecciona al menos un evento");
    setCreating(true);
    try {
      const r = await fetch("/api/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, events: Array.from(selectedEvents) })
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.message ?? `HTTP ${r.status}`);
      }
      const h = await r.json();
      setItems((prev) => [h, ...prev]);
      setRevealSecret(h.id); // mostramos secret una vez al crear
      setUrl("");
      setSelectedEvents(new Set());
    } catch (e: any) {
      setError(e?.message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(h: Webhook) {
    setWorking(h.id);
    try {
      const r = await fetch(`/api/v1/webhooks/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !h.active })
      });
      if (r.ok) setItems((prev) => prev.map((x) => (x.id === h.id ? { ...x, active: !x.active } : x)));
    } finally {
      setWorking(null);
    }
  }

  async function remove(h: Webhook) {
    if (!confirm(`¿Eliminar el webhook a ${h.url}?\n\nDejará de recibir eventos al instante.`)) return;
    setWorking(h.id);
    try {
      const r = await fetch(`/api/v1/webhooks/${h.id}`, { method: "DELETE" });
      if (r.ok) setItems((prev) => prev.filter((x) => x.id !== h.id));
    } finally {
      setWorking(null);
    }
  }

  async function test(h: Webhook) {
    setWorking(h.id);
    try {
      const r = await fetch(`/api/v1/webhooks/${h.id}?action=test`, { method: "POST" });
      if (r.ok) alert("Evento de prueba enviado. Revisa el log de entregas en tu endpoint.");
      else alert("No se pudo enviar el evento de prueba.");
    } finally {
      setWorking(null);
    }
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function toggleEvent(e: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* Crear nuevo */}
      <div className="bg-white rounded-xl border p-5">
        <h2 className="font-semibold text-slate-900 mb-3 inline-flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nuevo webhook
        </h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">URL del receptor</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.make.com/abc123..."
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1.5">Eventos a recibir</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
              {knownEvents.map((e) => (
                <label
                  key={e}
                  className={
                    "inline-flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs cursor-pointer " +
                    (selectedEvents.has(e)
                      ? "bg-brand-50 border-brand-300 text-brand-700"
                      : "bg-white hover:bg-slate-50")
                  }
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.has(e)}
                    onChange={() => toggleEvent(e)}
                    className="h-3 w-3"
                  />
                  <span className="font-mono">{e}</span>
                </label>
              ))}
            </div>
          </div>
          {error && (
            <p className="text-xs text-rose-600 inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </p>
          )}
          <button
            onClick={create}
            disabled={creating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-sm disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Crear webhook
          </button>
        </div>
      </div>

      {/* Lista */}
      <div>
        <h2 className="font-semibold text-slate-900 mb-2 inline-flex items-center gap-2">
          <WebhookIcon className="h-4 w-4" /> Webhooks activos
        </h2>
        {loading ? (
          <div className="text-sm text-slate-500 inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No hay webhooks configurados.</p>
        ) : (
          <div className="space-y-3">
            {items.map((h) => (
              <div
                key={h.id}
                className={
                  "bg-white rounded-xl border p-4 " +
                  (h.active ? "" : "opacity-60")
                }
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm text-slate-800 truncate" title={h.url}>
                      {h.url}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Creado {new Date(h.createdAt).toLocaleString("es-ES")} ·{" "}
                      {h._count?.deliveries ?? 0} entregas
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {h.events.map((e) => (
                        <span
                          key={e}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700"
                        >
                          {e}
                        </span>
                      ))}
                    </div>
                    {revealSecret === h.id && (
                      <div className="mt-2 p-2 rounded-md bg-amber-50 border border-amber-200">
                        <div className="text-[11px] text-amber-900 font-medium mb-1">
                          Guarda este secret — solo se muestra una vez:
                        </div>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-2 py-1 rounded bg-white border text-[11px] font-mono break-all">
                            {h.secret}
                          </code>
                          <button
                            onClick={() => copy(h.secret, h.id)}
                            className="px-2 py-1 rounded bg-white border text-xs hover:bg-slate-50"
                          >
                            {copied === h.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          </button>
                        </div>
                        <p className="text-[10px] text-amber-900 mt-1">
                          Cada POST llega con cabecera <code className="bg-white px-1 rounded">X-Hub-Signature-256: sha256=&lt;hmac&gt;</code>.
                          Verifica con HMAC-SHA256(secret, body).
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => test(h)}
                      disabled={working === h.id}
                      className="p-1.5 rounded-md border bg-white hover:bg-brand-50 text-slate-600 hover:text-brand-700 disabled:opacity-50"
                      title="Enviar evento de prueba"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => toggleActive(h)}
                      disabled={working === h.id}
                      className="p-1.5 rounded-md border bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-50"
                      title={h.active ? "Desactivar" : "Activar"}
                    >
                      {h.active ? <Power className="h-3.5 w-3.5" /> : <PowerOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => remove(h)}
                      disabled={working === h.id}
                      className="p-1.5 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 disabled:opacity-50"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
