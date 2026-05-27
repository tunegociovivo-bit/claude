"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Loader2,
  Brain,
  Trash2,
  Plus,
  TrendingUp,
  User,
  Bot,
  Sparkles
} from "lucide-react";

type Lesson = {
  id: string;
  scope: string;
  lesson: string;
  triggerPattern: string | null;
  source: string;
  taskId: string | null;
  useCount: number;
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
};

const SOURCE_INFO: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  human: { label: "Tú lo enseñaste", color: "emerald", icon: <User className="h-3 w-3" /> },
  sonia_self: { label: "Sonia (introspección)", color: "violet", icon: <Bot className="h-3 w-3" /> },
  auto_extracted: { label: "Aprendido del feedback", color: "blue", icon: <Sparkles className="h-3 w-3" /> },
  claude: { label: "Claude Code (post-escalación)", color: "amber", icon: <Brain className="h-3 w-3" /> }
};

export default function SoniaLessonsPage() {
  const [items, setItems] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<"all" | string>("all");
  const [autoLearning, setAutoLearning] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newScope, setNewScope] = useState("general");
  const [newLesson, setNewLesson] = useState("");
  const [newTrigger, setNewTrigger] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(
        "/api/v1/admin/ai-agent/lessons" + (filter !== "all" ? `?scope=${filter}` : "")
      );
      if (r.ok) {
        const d = await r.json();
        setItems(d.items ?? []);
      }
      const tr = await fetch("/api/v1/admin/sonia-auto-learning-toggle");
      if (tr.ok) setAutoLearning((await tr.json()).enabled);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [filter]);

  async function toggleAutoLearning(next: boolean) {
    setAutoLearning(next);
    await fetch("/api/v1/admin/sonia-auto-learning-toggle", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next })
    });
  }

  async function deleteLesson(id: string) {
    if (!confirm("¿Borrar esta lección? Sonia dejará de aplicarla.")) return;
    await fetch(`/api/v1/admin/ai-agent/lessons?id=${id}`, { method: "DELETE" });
    load();
  }

  async function addLesson() {
    setAdding(true);
    try {
      const r = await fetch("/api/v1/admin/ai-agent/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: newScope.trim() || "general",
          lesson: newLesson.trim(),
          triggerPattern: newTrigger.trim() || undefined
        })
      });
      if (r.ok) {
        setNewLesson("");
        setNewTrigger("");
        setShowAdd(false);
        load();
      }
    } finally {
      setAdding(false);
    }
  }

  const scopes = Array.from(new Set(items.map((i) => i.scope))).sort();
  const sourceCounts: Record<string, number> = {};
  for (const i of items) sourceCounts[i.source] = (sourceCounts[i.source] ?? 0) + 1;

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Lecciones de Sonia"
        description="Memoria persistente: cosas que Sonia ha aprendido y aplica automáticamente en runs futuros. Puedes añadir, borrar o filtrar manualmente."
        actions={
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="inline-flex items-center gap-1 text-xs bg-brand-600 hover:bg-brand-700 text-white px-3 py-1.5 rounded-lg"
          >
            <Plus className="h-3.5 w-3.5" /> Añadir manual
          </button>
        }
      />

      {/* Auto-learning toggle */}
      <div className="bg-white rounded-xl border p-4 mb-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            ✨ Auto-aprendizaje del feedback humano
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cron diario analiza tus respuestas a Sonia: si detecta correcciones
            ("no, mejor di X" / "evita Y" / "más informal"), extrae una lección
            automática vía Haiku (~$0.01 por lección). Sin tu intervención.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={autoLearning}
            onChange={(e) => toggleAutoLearning(e.target.checked)}
            className="accent-brand-600"
          />
          <span>{autoLearning ? "Activado" : "Desactivado"}</span>
        </label>
      </div>

      {/* Counters por origen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {Object.entries(SOURCE_INFO).map(([key, info]) => (
          <div
            key={key}
            className={`bg-${info.color}-50 border border-${info.color}-200 rounded-lg p-2.5`}
          >
            <div className={`text-[10px] text-${info.color}-700 flex items-center gap-1`}>
              {info.icon} {info.label}
            </div>
            <div className="text-xl font-bold mt-0.5">{sourceCounts[key] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border rounded-xl p-4 mb-4 space-y-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">
              Scope (general / client:ID / task_type:X)
            </label>
            <input
              type="text"
              value={newScope}
              onChange={(e) => setNewScope(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">
              Lección (instrucción breve y accionable)
            </label>
            <textarea
              value={newLesson}
              onChange={(e) => setNewLesson(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              placeholder="Ej: Cuando respondas reseñas negativas, ofrece siempre el teléfono del cliente para mover offline."
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">
              Trigger pattern (opcional, para que se aplique solo en ese contexto)
            </label>
            <input
              type="text"
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2 text-sm"
              placeholder="ej: reseña, review, gmb_reply"
            />
          </div>
          <button
            onClick={addLesson}
            disabled={adding || newLesson.length < 8}
            className="inline-flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-3 py-1.5 rounded-lg"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Guardar
          </button>
        </div>
      )}

      {/* Filtros por scope */}
      {scopes.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-3 text-xs">
          <button
            onClick={() => setFilter("all")}
            className={
              "px-2.5 py-0.5 rounded-md " +
              (filter === "all"
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            Todos
          </button>
          {scopes.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={
                "px-2.5 py-0.5 rounded-md font-mono " +
                (filter === s
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200")
              }
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="text-center py-8 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Cargando…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          Sin lecciones aún. Cuando Sonia procese tareas y tú la corrijas, las irá
          aprendiendo automáticamente (si activas el toggle de arriba).
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((l) => {
            const info = SOURCE_INFO[l.source] ?? SOURCE_INFO.sonia_self;
            return (
              <div key={l.id} className="bg-white border rounded-xl p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 text-xs">
                      <code className={`bg-${info.color}-100 text-${info.color}-800 px-1.5 py-0.5 rounded font-mono`}>
                        {l.scope}
                      </code>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-${info.color}-100 text-${info.color}-700`}
                      >
                        {info.icon} {info.label}
                      </span>
                      {l.useCount > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-slate-500 text-[10px]">
                          <TrendingUp className="h-3 w-3" /> aplicada {l.useCount}× en runs
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-800">{l.lesson}</p>
                    {l.triggerPattern && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        Trigger: <code className="bg-slate-100 px-1 rounded">{l.triggerPattern}</code>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => deleteLesson(l.id)}
                    className="text-slate-400 hover:text-rose-600"
                    title="Borrar lección"
                  >
                    <Trash2 className="h-4 w-4" />
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
