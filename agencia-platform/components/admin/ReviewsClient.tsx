"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Plus, Loader2, Trash2, Edit2, Copy, ExternalLink, Key } from "lucide-react";

type ReviewClient = {
  id: string;
  slug: string;
  name: string;
  webUrl: string | null;
  destinationUrl: string;
  topics: string;
  bannedWords: string | null;
  recommendedWords: string | null;
  extraInstructions: string | null;
  model: string;
};

const DEFAULT_TOPICS = "Descanso y habitación\nComida y guisos\nEl entorno y naturaleza\nTrato personal y rapidez";
const DEFAULT_BANNED = "místico, cosmos, aromas, mágico, excelencia";
const DEFAULT_RECOMMENDED = "sitio de diez, de lujo, repetiré";
const DEFAULT_INSTRUCTIONS = "Lenguaje de calle, de WhatsApp. No saludes. Solo el texto.";

export default function ReviewsClient() {
  const [items, setItems] = useState<ReviewClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [openaiKey, setOpenaiKey] = useState<{ hasKey: boolean; keyMasked: string | null; envKey: boolean } | null>(null);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ReviewClient | null>(null);

  async function load() {
    setLoading(true);
    const [cr, sr] = await Promise.all([
      fetch("/api/v1/reviews/clients"),
      fetch("/api/v1/admin/ai-settings")
    ]);
    if (cr.ok) setItems((await cr.json()).items ?? []);
    if (sr.ok) {
      const d = await sr.json();
      setOpenaiKey(d.openai);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar el cliente "${name}"? Se borra también su histórico.`)) return;
    const r = await fetch(`/api/v1/reviews/clients/${id}`, { method: "DELETE" });
    if (r.ok) load();
  }

  function copyEmbed(slug: string) {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/r/${slug}`;
    const snippet = `<iframe src="${url}" style="border:0;width:100%;max-width:540px;height:280px"></iframe>`;
    navigator.clipboard.writeText(snippet);
    alert("Snippet copiado.\n\nO pega directamente esta URL: " + url);
  }

  const apiKeyConfigured = openaiKey?.hasKey || openaiKey?.envKey;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Generador de reseñas IA"
        description="Migrado de Generador de Reseñas IA PRO (WP) → ahora nativo en Hub."
        actions={
          <>
            <button
              onClick={() => setKeyModalOpen(true)}
              className={
                "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border " +
                (apiKeyConfigured
                  ? "bg-white text-slate-700 hover:bg-slate-50"
                  : "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100")
              }
            >
              <Key className="h-4 w-4" />
              {apiKeyConfigured ? "OpenAI configurada" : "Configurar OpenAI"}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Nuevo cliente
            </button>
          </>
        }
      />

      {!apiKeyConfigured && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          ⚠️ Aún no has configurado la API key de OpenAI. Los widgets generarán "Todo perfecto, recomendado" como fallback hasta que la añadas.
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
          Aún no hay clientes de reseñas.{" "}
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="text-brand-600 underline">
            Crea el primero
          </button>
          .
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3">Cliente</th>
                <th className="text-left px-3 py-3">Slug</th>
                <th className="text-left px-3 py-3">Destino</th>
                <th className="text-left px-3 py-3">Modelo</th>
                <th className="text-right px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{c.name}</td>
                  <td className="px-3 py-3">
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{c.slug}</code>
                  </td>
                  <td className="px-3 py-3">
                    <a
                      href={c.destinationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-brand-600"
                    >
                      {new URL(c.destinationUrl).hostname}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">{c.model}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => copyEmbed(c.slug)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                      title="Copiar iframe"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Embed
                    </button>
                    <a
                      href={`/r/${c.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver
                    </a>
                    <button
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(c.id, c.name)}
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ClientFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        client={editing}
        onSaved={() => {
          setFormOpen(false);
          load();
        }}
      />

      <OpenAiKeyModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        current={openaiKey}
        onSaved={() => {
          setKeyModalOpen(false);
          load();
        }}
      />
    </div>
  );
}

function ClientFormModal({
  open,
  onClose,
  client,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  client: ReviewClient | null;
  onSaved: () => void;
}) {
  const isEdit = !!client;
  const [form, setForm] = useState({
    slug: "",
    name: "",
    webUrl: "",
    destinationUrl: "",
    topics: DEFAULT_TOPICS,
    bannedWords: DEFAULT_BANNED,
    recommendedWords: DEFAULT_RECOMMENDED,
    extraInstructions: DEFAULT_INSTRUCTIONS,
    model: "gpt-4o-mini"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (client) {
      setForm({
        slug: client.slug,
        name: client.name,
        webUrl: client.webUrl ?? "",
        destinationUrl: client.destinationUrl,
        topics: client.topics,
        bannedWords: client.bannedWords ?? "",
        recommendedWords: client.recommendedWords ?? "",
        extraInstructions: client.extraInstructions ?? "",
        model: client.model
      });
    } else {
      setForm({
        slug: "",
        name: "",
        webUrl: "",
        destinationUrl: "",
        topics: DEFAULT_TOPICS,
        bannedWords: DEFAULT_BANNED,
        recommendedWords: DEFAULT_RECOMMENDED,
        extraInstructions: DEFAULT_INSTRUCTIONS,
        model: "gpt-4o-mini"
      });
    }
  }, [open, client]);

  function slugify(s: string) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const url = isEdit ? `/api/v1/reviews/clients/${client!.id}` : "/api/v1/reviews/clients";
    const method = isEdit ? "PATCH" : "POST";
    const payload: any = { ...form };
    if (isEdit) delete payload.slug; // no se puede cambiar el slug en edición
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.error?.message || j.message || `Error ${r.status}`);
    }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Editar cliente" : "Nuevo cliente de reseñas"}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="review-client-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <form id="review-client-form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Nombre del cliente *</label>
            <input
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  name,
                  slug: isEdit ? f.slug : slugify(name)
                }));
              }}
              required
              autoFocus
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Ej. Hotel Dos Romeiros"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Slug {isEdit && <span className="text-slate-400 font-normal">(no editable)</span>}
            </label>
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
              disabled={isEdit}
              required
              pattern="[a-z0-9\-]+"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Modelo OpenAI</label>
            <select
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="gpt-4o-mini">gpt-4o-mini (rápido y barato)</option>
              <option value="gpt-4o">gpt-4o (mejor calidad)</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">URL web del cliente</label>
            <input
              value={form.webUrl}
              onChange={(e) => setForm((f) => ({ ...f, webUrl: e.target.value }))}
              type="url"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="https://midominio.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">URL destino (Trustpilot/Google) *</label>
            <input
              value={form.destinationUrl}
              onChange={(e) => setForm((f) => ({ ...f, destinationUrl: e.target.value }))}
              type="url"
              required
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="https://es.trustpilot.com/evaluate/..."
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Temas (uno por línea)</label>
          <textarea
            value={form.topics}
            onChange={(e) => setForm((f) => ({ ...f, topics: e.target.value }))}
            rows={4}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">Se elige uno al azar en cada generación.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Palabras prohibidas</label>
          <input
            value={form.bannedWords}
            onChange={(e) => setForm((f) => ({ ...f, bannedWords: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Palabras / expresiones recomendadas</label>
          <input
            value={form.recommendedWords}
            onChange={(e) => setForm((f) => ({ ...f, recommendedWords: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Instrucciones extra al prompt</label>
          <textarea
            value={form.extraInstructions}
            onChange={(e) => setForm((f) => ({ ...f, extraInstructions: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}

function OpenAiKeyModal({
  open,
  onClose,
  current,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  current: { hasKey: boolean; keyMasked: string | null; envKey: boolean } | null;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey("");
      setError(null);
    }
  }, [open]);

  async function save() {
    setSaving(true);
    setError(null);
    const r = await fetch("/api/v1/admin/ai-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openaiApiKey: key })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return setError(j.error?.message || j.message || `Error ${r.status}`);
    }
    onSaved();
  }

  async function remove() {
    if (!confirm("¿Quitar la API key de OpenAI del workspace?")) return;
    const r = await fetch("/api/v1/admin/ai-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openaiApiKey: null })
    });
    if (r.ok) onSaved();
  }

  return (
    <Modal open={open} onClose={onClose} title="OpenAI API Key" size="md">
      {current?.hasKey ? (
        <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          API key configurada: <code>{current.keyMasked}</code>
        </div>
      ) : current?.envKey ? (
        <div className="mb-3 px-3 py-2 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-800">
          Usando OPENAI_API_KEY de variables de entorno.
        </div>
      ) : (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          No hay API key. Sin ella, el generador no llama a OpenAI.
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Nueva API key</label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <p className="text-[11px] text-slate-500 mt-1">
          Se guarda cifrada (AES-256-GCM) en el workspace. Empieza por <code>sk-</code>.
        </p>
      </div>

      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}

      <div className="mt-4 flex items-center justify-end gap-2">
        {current?.hasKey && (
          <button
            type="button"
            onClick={remove}
            className="mr-auto text-xs text-rose-600 hover:underline"
          >
            Quitar key actual
          </button>
        )}
        <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={saving || !key}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
      </div>
    </Modal>
  );
}
