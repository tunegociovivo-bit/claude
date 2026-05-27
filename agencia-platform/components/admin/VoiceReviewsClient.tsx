"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/ui/Modal";
import { Plus, Loader2, Trash2, Edit2, Copy, ExternalLink, Mic } from "lucide-react";

type VoiceBusiness = {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  googleUrl: string | null;
  trustpilotUrl: string | null;
  introText: string | null;
  disclaimer: string | null;
  customPrompt: string | null;
  maxSeconds: number;
  aiProvider: "anthropic" | "openai";
};

export default function VoiceReviewsClient() {
  const [items, setItems] = useState<VoiceBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VoiceBusiness | null>(null);
  const [aiStatus, setAiStatus] = useState<{ anthropic: boolean; openai: boolean } | null>(null);

  async function load() {
    setLoading(true);
    const [bizR, aiR] = await Promise.all([
      fetch("/api/v1/voice-businesses"),
      fetch("/api/v1/admin/ai-settings")
    ]);
    if (bizR.ok) setItems((await bizR.json()).items ?? []);
    if (aiR.ok) {
      const d = await aiR.json();
      setAiStatus({
        anthropic: Boolean(d.hasKey || d.envKey),
        openai: Boolean(d.openai?.hasKey || d.openai?.envKey)
      });
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar el negocio "${name}"?`)) return;
    const r = await fetch(`/api/v1/voice-businesses/${id}`, { method: "DELETE" });
    if (r.ok) load();
  }

  function copyEmbed(slug: string) {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/v/${slug}`;
    const snippet = `<iframe src="${url}" allow="microphone" style="border:0;width:100%;max-width:560px;height:560px"></iframe>`;
    navigator.clipboard.writeText(snippet);
    alert("Snippet copiado.\n\nURL pública: " + url);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Voice Reviews"
        description="Migrado del plugin WP Voice Reviews. Reseñas guiadas por voz con Whisper + Claude."
        actions={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nuevo negocio
          </button>
        }
      />

      {aiStatus && (aiStatus.anthropic && aiStatus.openai) ? (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          ✓ <strong>API keys configuradas:</strong> Anthropic (para redactar borradores) y OpenAI (para Whisper) están operativas.
        </div>
      ) : aiStatus ? (
        <div className="mb-4 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          ⚠️ <strong>Faltan API keys:</strong>
          {!aiStatus.openai && (
            <> OpenAI (para Whisper) → configúrala en <a href="/admin/reviews" className="underline font-medium">/admin/reviews</a>.</>
          )}
          {!aiStatus.anthropic && (
            <> Anthropic (para el borrador) → configúrala en <a href="/admin/ai" className="underline font-medium">/admin/ai</a>.</>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-500">
          Aún no hay negocios.{" "}
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="text-brand-600 underline">
            Crea el primero
          </button>
          .
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="text-left px-5 py-3">Negocio</th>
                <th className="text-left px-3 py-3">Slug</th>
                <th className="text-left px-3 py-3">Max</th>
                <th className="text-left px-3 py-3">Provider</th>
                <th className="text-right px-5 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="font-medium">{b.name}</div>
                    {b.location && <div className="text-xs text-slate-500">{b.location}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{b.slug}</code>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500">{b.maxSeconds}s</td>
                  <td className="px-3 py-3 text-xs text-slate-500 capitalize">{b.aiProvider}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => copyEmbed(b.slug)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Embed
                    </button>
                    <a
                      href={`/v/${b.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver
                    </a>
                    <button
                      onClick={() => {
                        setEditing(b);
                        setFormOpen(true);
                      }}
                      className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(b.id, b.name)}
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

      <BusinessFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        business={editing}
        onSaved={() => {
          setFormOpen(false);
          load();
        }}
      />
    </div>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function BusinessFormModal({
  open,
  onClose,
  business,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  business: VoiceBusiness | null;
  onSaved: () => void;
}) {
  const isEdit = !!business;
  const [form, setForm] = useState({
    slug: "",
    name: "",
    location: "",
    googleUrl: "",
    trustpilotUrl: "",
    introText: "",
    disclaimer: "",
    customPrompt: "",
    maxSeconds: 30,
    aiProvider: "anthropic" as "anthropic" | "openai"
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (business) {
      setForm({
        slug: business.slug,
        name: business.name,
        location: business.location ?? "",
        googleUrl: business.googleUrl ?? "",
        trustpilotUrl: business.trustpilotUrl ?? "",
        introText: business.introText ?? "",
        disclaimer: business.disclaimer ?? "",
        customPrompt: business.customPrompt ?? "",
        maxSeconds: business.maxSeconds,
        aiProvider: business.aiProvider
      });
    } else {
      setForm({
        slug: "",
        name: "",
        location: "",
        googleUrl: "",
        trustpilotUrl: "",
        introText: "",
        disclaimer: "",
        customPrompt: "",
        maxSeconds: 30,
        aiProvider: "anthropic"
      });
    }
  }, [open, business]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const url = isEdit ? `/api/v1/voice-businesses/${business!.id}` : "/api/v1/voice-businesses";
    const method = isEdit ? "PATCH" : "POST";
    const payload: any = { ...form };
    if (isEdit) delete payload.slug;
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
      title={isEdit ? "Editar negocio" : "Nuevo negocio Voice Review"}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg text-sm border bg-white hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="submit"
            form="voice-business-form"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
        </>
      }
    >
      <form id="voice-business-form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Nombre *</label>
            <input
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({ ...f, name, slug: isEdit ? f.slug : slugify(name) }));
              }}
              required
              autoFocus
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Ej. Hotel Dos Romeiros"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Slug {isEdit && <span className="text-slate-400 font-normal">(no editable)</span>}</label>
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
              disabled={isEdit}
              required
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Ubicación</label>
            <input
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="Ribadeo, Lugo"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">URL Google Business</label>
            <input
              value={form.googleUrl}
              onChange={(e) => setForm((f) => ({ ...f, googleUrl: e.target.value }))}
              type="url"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="https://g.page/r/..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">URL Trustpilot</label>
            <input
              value={form.trustpilotUrl}
              onChange={(e) => setForm((f) => ({ ...f, trustpilotUrl: e.target.value }))}
              type="url"
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              placeholder="https://es.trustpilot.com/..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Duración máxima (s)</label>
            <input
              type="number"
              min={5}
              max={120}
              value={form.maxSeconds}
              onChange={(e) => setForm((f) => ({ ...f, maxSeconds: Number(e.target.value) }))}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">IA para redactar</label>
            <select
              value={form.aiProvider}
              onChange={(e) => setForm((f) => ({ ...f, aiProvider: e.target.value as any }))}
              className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="anthropic">Claude (Anthropic)</option>
              <option value="openai">GPT (OpenAI)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Texto intro (lo que ve el cliente)</label>
          <textarea
            value={form.introText}
            onChange={(e) => setForm((f) => ({ ...f, introText: e.target.value }))}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Si lo dejas vacío, se usa un texto por defecto adaptado al nombre."
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Disclaimer / aviso legal</label>
          <textarea
            value={form.disclaimer}
            onChange={(e) => setForm((f) => ({ ...f, disclaimer: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Prompt personalizado (avanzado)</label>
          <textarea
            value={form.customPrompt}
            onChange={(e) => setForm((f) => ({ ...f, customPrompt: e.target.value }))}
            rows={4}
            className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Dejar vacío usa el prompt por defecto con reglas anti-marketing."
          />
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </form>
    </Modal>
  );
}
