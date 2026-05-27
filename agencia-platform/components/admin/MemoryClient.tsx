"use client";

import { useState } from "react";
import {
  BookOpenText,
  Brain,
  Cpu,
  AlertTriangle,
  ListChecks,
  StickyNote,
  Plus,
  Trash2,
  Save,
  Loader2,
  Copy,
  Check,
  Download
} from "lucide-react";

type Sprint = { range: string; title: string; summary: string };
type Note = {
  id: string;
  title: string;
  body: string;
  createdAt?: string;
  updatedAt?: string;
};

export default function MemoryClient({
  overview,
  architecture,
  gotchas,
  pendientes,
  sprints,
  initialNotes
}: {
  overview: string;
  architecture: string;
  gotchas: string;
  pendientes: string;
  sprints: Sprint[];
  initialNotes: Note[];
}) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  function addNote() {
    setNotes((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        title: "Nueva nota",
        body: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
  }

  function updateNote(id: string, patch: Partial<Note>) {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n))
    );
  }

  function removeNote(id: string) {
    if (!confirm("¿Eliminar esta nota?")) return;
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/v1/admin/claude-memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes })
      });
      if (r.ok) setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  function copyFullMemory() {
    const text = buildFullMemoryText({
      overview,
      architecture,
      gotchas,
      pendientes,
      sprints,
      notes
    });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadJson() {
    const blob = new Blob(
      [
        JSON.stringify(
          { overview, architecture, gotchas, pendientes, sprints, notes, exportedAt: new Date().toISOString() },
          null,
          2
        )
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `memoria-claude-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Acciones globales */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-center gap-2">
        <Brain className="h-5 w-5 text-brand-600" />
        <div className="flex-1 min-w-0 text-sm text-slate-600">
          Toda esta página puede copiarse y pegarse a una sesión nueva de Claude para
          recuperar el contexto completo del proyecto.
        </div>
        <button
          onClick={copyFullMemory}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-sm"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar memoria completa"}
        </button>
        <button
          onClick={downloadJson}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-sm"
        >
          <Download className="h-3.5 w-3.5" />
          Descargar JSON
        </button>
      </div>

      <Section title="Resumen del proyecto" icon={<BookOpenText className="h-4 w-4" />}>
        <Pre>{overview}</Pre>
      </Section>

      <Section title="Arquitectura y decisiones" icon={<Cpu className="h-4 w-4" />}>
        <Pre>{architecture}</Pre>
      </Section>

      <Section title="Gotchas (cosas con las que tener cuidado)" icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}>
        <Pre className="bg-amber-50/50 border-amber-200">{gotchas}</Pre>
      </Section>

      <Section title="Pendientes" icon={<ListChecks className="h-4 w-4" />}>
        <Pre>{pendientes}</Pre>
      </Section>

      <Section title={`Sprints completados (${sprints.length})`} icon={<ListChecks className="h-4 w-4" />}>
        <ol className="space-y-2">
          {sprints.map((s, i) => (
            <li key={s.range} className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  #{String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-mono text-[11px] text-slate-500">{s.range}</span>
                <span className="font-medium text-slate-900">{s.title}</span>
              </div>
              <p className="text-xs text-slate-600 mt-1">{s.summary}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title={`Notas custom del equipo (${notes.length})`}
        icon={<StickyNote className="h-4 w-4 text-amber-500" />}
        right={
          <div className="flex items-center gap-2">
            {savedAt && (
              <span className="text-[11px] text-emerald-600">
                Guardado {new Date(savedAt).toLocaleTimeString("es-ES")}
              </span>
            )}
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-700 text-white text-xs disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar notas
            </button>
            <button
              onClick={addNote}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-white hover:bg-slate-50 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Añadir
            </button>
          </div>
        }
      >
        {notes.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            Sin notas todavía. Añade aquí cualquier cosa que descubras o decidas sobre el
            proyecto: convenciones, decisiones de producto, próximos pasos, contactos…
          </p>
        ) : (
          <div className="space-y-3">
            {notes.map((n) => (
              <div key={n.id} className="rounded-lg border bg-amber-50/30 border-amber-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={n.title}
                    onChange={(e) => updateNote(n.id, { title: e.target.value })}
                    className="flex-1 px-2 py-1 rounded border bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => removeNote(n.id)}
                    className="p-1.5 rounded-md text-rose-600 hover:bg-rose-50"
                    title="Borrar nota"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <textarea
                  value={n.body}
                  onChange={(e) => updateNote(n.id, { body: e.target.value })}
                  rows={5}
                  placeholder="Detalle…"
                  className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                {n.updatedAt && (
                  <div className="text-[10px] text-slate-400 mt-1 text-right">
                    Editada {new Date(n.updatedAt).toLocaleString("es-ES")}
                  </div>
                )}
              </div>
            ))}
            <div className="text-[11px] text-slate-500">
              Las notas se persisten al pulsar "Guardar notas". Se almacenan en
              <code className="mx-1">workspace.settings.claudeMemory</code> de tu BD.
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  icon,
  right,
  children
}: {
  title: string;
  icon: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-900 inline-flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {right}
      </div>
      {children}
    </div>
  );
}

function Pre({
  children,
  className = ""
}: {
  children: string;
  className?: string;
}) {
  return (
    <pre
      className={
        "whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-slate-800 bg-slate-50 rounded-lg border border-slate-200 px-4 py-3 " +
        className
      }
    >
      {children}
    </pre>
  );
}

function buildFullMemoryText(args: {
  overview: string;
  architecture: string;
  gotchas: string;
  pendientes: string;
  sprints: Sprint[];
  notes: Note[];
}): string {
  const parts: string[] = [];
  parts.push("# MEMORIA DEL PROYECTO — AGENCIA HUB", "");
  parts.push("## Resumen", args.overview, "");
  parts.push(args.architecture, "");
  parts.push(args.gotchas, "");
  parts.push(args.pendientes, "");
  parts.push("## Sprints completados", "");
  args.sprints.forEach((s, i) => {
    parts.push(`### ${String(i + 1).padStart(2, "0")}. ${s.title}  \`${s.range}\``);
    parts.push(s.summary, "");
  });
  if (args.notes.length > 0) {
    parts.push("## Notas custom del equipo", "");
    args.notes.forEach((n) => {
      parts.push(`### ${n.title}`);
      if (n.body) parts.push(n.body);
      if (n.updatedAt) parts.push(`_actualizada: ${new Date(n.updatedAt).toLocaleString("es-ES")}_`);
      parts.push("");
    });
  }
  return parts.join("\n");
}
