"use client";

import { useEffect, useState, useRef } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Plus, Trash2, FileText, Upload, BookOpen } from "lucide-react";

type Item = {
  id: string;
  title: string;
  sourceType: string;
  fileName: string | null;
  preview: string;
  chars: number;
  createdAt: string;
};

export default function SoniaKnowledgeClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const r = await fetch("/api/v1/admin/sonia-knowledge");
    if (r.ok) setItems((await r.json()).items ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function addText() {
    if (!title.trim() || !content.trim()) {
      setMsg("Pon un título y el texto.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/sonia-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? "Error");
      setTitle("");
      setContent("");
      setMsg("Guardado y memorizado.");
      load();
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("title", f.name);
      const r = await fetch("/api/v1/admin/sonia-knowledge/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message ?? "Error al subir");
      setMsg(`Documento procesado: ${d.chars} caracteres extraídos${d.truncated ? " (truncado)" : ""}.`);
      load();
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function del(id: string) {
    if (!confirm("¿Eliminar esta entrada del conocimiento de Sonia?")) return;
    await fetch(`/api/v1/admin/sonia-knowledge?id=${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Conocimiento de Sonia"
        description="Escribe textos de aprendizaje y sube documentos de clientes. Sonia los indexa y los usa para responder tus preguntas en el chat."
      />

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        {/* Texto de aprendizaje */}
        <div className="bg-white rounded-xl border p-4 space-y-2">
          <div className="text-sm font-semibold flex items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-brand-600" /> Texto de aprendizaje
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (ej. Condiciones cliente Eroski)"
            className="w-full px-2.5 py-1.5 rounded-lg border text-sm"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder="Escribe aquí lo que quieres que Sonia sepa: procesos, datos de clientes, precios, instrucciones…"
            className="w-full px-2.5 py-1.5 rounded-lg border text-sm"
          />
          <button
            onClick={addText}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Añadir
          </button>
        </div>

        {/* Documento */}
        <div className="bg-white rounded-xl border p-4 space-y-2">
          <div className="text-sm font-semibold flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-brand-600" /> Documento de cliente
          </div>
          <p className="text-xs text-slate-500">PDF, Word (.docx), Excel (.xlsx), TXT, CSV. Se extrae el texto y se indexa.</p>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.xls,.txt,.csv,.md,.json,.html" onChange={onFile} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border bg-white text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Procesando…" : "Subir documento"}
          </button>
          <p className="text-[11px] text-slate-400">Los PDF escaneados (imagen) no tienen texto extraíble.</p>
        </div>
      </div>

      {msg && <div className="mb-4 text-sm text-slate-700 bg-slate-50 border rounded-lg px-3 py-2">{msg}</div>}

      <div className="bg-white rounded-xl border">
        <div className="px-4 py-2 border-b text-xs font-semibold text-slate-600">
          {items.length} entrada(s) de conocimiento
        </div>
        {loading ? (
          <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-sm text-slate-400 text-center">
            Aún no hay nada. Añade un texto o sube un documento para que Sonia aprenda.
          </div>
        ) : (
          <div className="divide-y">
            {items.map((i) => (
              <div key={i.id} className="px-4 py-3 flex items-start gap-3">
                {i.sourceType === "document" ? (
                  <FileText className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                ) : (
                  <BookOpen className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">{i.title}</div>
                  <div className="text-xs text-slate-500 line-clamp-2">{i.preview}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {i.sourceType === "document" ? `📄 ${i.fileName ?? "documento"} · ` : ""}
                    {i.chars.toLocaleString("es-ES")} caracteres · {new Date(i.createdAt).toLocaleDateString("es-ES")}
                  </div>
                </div>
                <button
                  onClick={() => del(i.id)}
                  className="h-7 w-7 grid place-items-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
