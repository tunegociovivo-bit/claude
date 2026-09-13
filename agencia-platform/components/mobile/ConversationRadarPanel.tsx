"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Check,
  Clipboard,
  Eye,
  Loader2,
  MessageCircleReply,
  Pencil,
  Plus,
  Radar,
  Save,
  ShieldCheck,
  Trash2,
  X
} from "lucide-react";
import {
  conversationRadarRuleSchema,
  readStoredConversationRules,
  type ConversationCandidate,
  type ConversationRadarRule
} from "@/lib/mobile/conversation-radar";

type QueueItem = ConversationCandidate & {
  id: string;
  state: "pending" | "approved" | "skipped";
};

type RuleDraft = Omit<ConversationRadarRule, "id"> & { id?: string };

type Props = {
  deviceSerial: string;
  phoneKey: string;
  ready: boolean;
  onCaptureScreen: () => Promise<string>;
  onCopyText: (text: string) => Promise<void>;
  onPasteText: (text: string) => Promise<void>;
};

const EMPTY_RULE: RuleDraft = {
  name: "",
  topic: "",
  goal: "",
  tone: "helpful",
  minimumRelevance: 65
};

const TONE_LABELS: Record<ConversationRadarRule["tone"], string> = {
  natural: "Natural y cercana",
  helpful: "Útil y empática",
  expert: "Experta y clara",
  concise: "Breve y directa"
};

function storageKey(phoneKey: string) {
  return `nv-conversation-radar-rules:${phoneKey}`;
}

async function apiJson(url: string, init: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || "No se ha podido analizar la pantalla");
  }
  return payload;
}

export default function ConversationRadarPanel({
  deviceSerial,
  phoneKey,
  ready,
  onCaptureScreen,
  onCopyText,
  onPasteText
}: Props) {
  const [rules, setRules] = useState<ConversationRadarRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(EMPTY_RULE);
  const [editingRule, setEditingRule] = useState(true);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRule = useMemo(
    () => rules.find((rule) => rule.id === selectedRuleId) ?? null,
    [rules, selectedRuleId]
  );
  const pendingCount = queue.filter((item) => item.state === "pending").length;

  useEffect(() => {
    let stored: ConversationRadarRule[] = [];
    try {
      stored = readStoredConversationRules(localStorage.getItem(storageKey(phoneKey)));
    } catch {
      stored = [];
    }
    setRules(stored);
    setSelectedRuleId(stored[0]?.id ?? "");
    setRuleDraft(stored[0] ?? EMPTY_RULE);
    setEditingRule(stored.length === 0);
    setQueue([]);
  }, [phoneKey]);

  function persist(next: ConversationRadarRule[]) {
    setRules(next);
    try {
      localStorage.setItem(storageKey(phoneKey), JSON.stringify(next.slice(0, 20)));
    } catch {
      setFeedback("La regla funciona ahora, pero Chrome no ha permitido recordarla.");
    }
  }

  function saveRule(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const candidate = {
      ...ruleDraft,
      id: ruleDraft.id ?? crypto.randomUUID(),
      name: ruleDraft.name.trim(),
      topic: ruleDraft.topic.trim(),
      goal: ruleDraft.goal.trim()
    };
    const parsed = conversationRadarRuleSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa la regla");
      return;
    }
    const next = rules.some((rule) => rule.id === parsed.data.id)
      ? rules.map((rule) => rule.id === parsed.data.id ? parsed.data : rule)
      : [parsed.data, ...rules];
    persist(next);
    setSelectedRuleId(parsed.data.id);
    setRuleDraft(parsed.data);
    setEditingRule(false);
    setFeedback("Regla guardada. Ya puedes reutilizarla en cualquier pantalla.");
  }

  function chooseRule(id: string) {
    const rule = rules.find((item) => item.id === id);
    setSelectedRuleId(id);
    if (rule) setRuleDraft(rule);
    setEditingRule(false);
    setQueue([]);
    setFeedback(null);
    setError(null);
  }

  function removeSelectedRule() {
    if (!selectedRule) return;
    const next = rules.filter((rule) => rule.id !== selectedRule.id);
    persist(next);
    setSelectedRuleId(next[0]?.id ?? "");
    setRuleDraft(next[0] ?? EMPTY_RULE);
    setEditingRule(next.length === 0);
    setQueue([]);
  }

  async function analyzeVisibleScreen() {
    if (!selectedRule || !ready || analyzing) return;
    setAnalyzing(true);
    setError(null);
    setFeedback("Capturando únicamente la pantalla que ves ahora…");
    let screenImage = "";
    try {
      screenImage = await onCaptureScreen();
      const payload = await apiJson("/api/v1/mobile/conversations/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneKey, deviceSerial, screenImage, rule: selectedRule })
      });
      const candidates = Array.isArray(payload?.candidates) ? payload.candidates as ConversationCandidate[] : [];
      const nextQueue = candidates.map((candidate) => ({
        ...candidate,
        id: crypto.randomUUID(),
        state: "pending" as const
      }));
      setQueue(nextQueue);
      setEdits(Object.fromEntries(nextQueue.map((item) => [item.id, item.draftReply])));
      setFeedback(nextQueue.length > 0
        ? `${nextQueue.length} conversación${nextQueue.length === 1 ? "" : "es"} relevante${nextQueue.length === 1 ? "" : "s"} lista${nextQueue.length === 1 ? "" : "s"} para revisar.`
        : "No hay comentarios visibles que superen el nivel de relevancia de esta regla.");
    } catch (analysisError) {
      setQueue([]);
      setError(analysisError instanceof Error ? analysisError.message : "No se ha podido analizar la pantalla");
      setFeedback(null);
    } finally {
      screenImage = "";
      setAnalyzing(false);
    }
  }

  async function copyItem(item: QueueItem) {
    const content = (edits[item.id] ?? item.draftReply).trim();
    if (!content) return;
    setBusyItemId(item.id);
    setError(null);
    try {
      await onCopyText(content);
      setQueue((current) => current.map((candidate) => (
        candidate.id === item.id ? { ...candidate, state: "approved" } : candidate
      )));
      setFeedback("Respuesta aprobada y copiada al móvil. Enfoca el campo de respuesta y pulsa Pegar.");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "No se ha podido copiar la respuesta");
    } finally {
      setBusyItemId(null);
    }
  }

  async function pasteItem(item: QueueItem) {
    const content = (edits[item.id] ?? item.draftReply).trim();
    if (!content) return;
    setBusyItemId(item.id);
    setError(null);
    try {
      await onPasteText(content);
      setQueue((current) => current.map((candidate) => (
        candidate.id === item.id ? { ...candidate, state: "approved" } : candidate
      )));
      setFeedback("Texto pegado. Revísalo en el móvil y decide tú si lo publicas.");
    } catch (pasteError) {
      setError(pasteError instanceof Error ? pasteError.message : "No se ha podido pegar la respuesta");
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <section className="rounded-xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-violet-50 p-3" aria-label="Radar de conversaciones">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Radar className="h-4 w-4 text-fuchsia-700" /> Radar de conversaciones
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">
            Abre un grupo o publicación en el móvil. La IA filtra lo visible y prepara respuestas distintas según tu regla.
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ready ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
          {ready ? "Pantalla lista" : "Abre la pantalla"}
        </span>
      </div>

      {rules.length > 0 && !editingRule && (
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-700">
            Regla activa
            <select value={selectedRuleId} onChange={(event) => chooseRule(event.target.value)} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm">
              {rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-1.5">
            <button type="button" onClick={() => { if (selectedRule) setRuleDraft(selectedRule); setEditingRule(true); }} className="rounded-lg border bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Editar regla"><Pencil className="h-4 w-4" /></button>
            <button type="button" onClick={() => { setRuleDraft(EMPTY_RULE); setEditingRule(true); }} className="rounded-lg border bg-white p-2 text-slate-600 hover:bg-slate-50" aria-label="Nueva regla"><Plus className="h-4 w-4" /></button>
            <button type="button" onClick={removeSelectedRule} className="rounded-lg border bg-white p-2 text-rose-600 hover:bg-rose-50" aria-label="Eliminar regla"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {editingRule && (
        <form onSubmit={saveRule} className="mt-3 space-y-2 rounded-lg border border-fuchsia-100 bg-white/80 p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">{ruleDraft.id ? "Editar regla" : "Crear regla una vez"}</h4>
            {rules.length > 0 && <button type="button" onClick={() => setEditingRule(false)} className="rounded p-1 text-slate-500" aria-label="Cerrar editor"><X className="h-4 w-4" /></button>}
          </div>
          <input value={ruleDraft.name} onChange={(event) => setRuleDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Nombre, por ejemplo: Viajes a Japón" maxLength={80} required className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={ruleDraft.topic} onChange={(event) => setRuleDraft((current) => ({ ...current, topic: event.target.value }))} placeholder="Qué comentarios te interesan: dudas sobre rutas, transporte y alojamiento en Japón" rows={2} maxLength={300} required className="w-full rounded-lg border px-3 py-2 text-sm" />
          <textarea value={ruleDraft.goal} onChange={(event) => setRuleDraft((current) => ({ ...current, goal: event.target.value }))} placeholder="Qué quieres aportar: consejos útiles basados en mi viaje, sin inventar datos" rows={2} maxLength={500} required className="w-full rounded-lg border px-3 py-2 text-sm" />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Tono
              <select value={ruleDraft.tone} onChange={(event) => setRuleDraft((current) => ({ ...current, tone: event.target.value as ConversationRadarRule["tone"] }))} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm">
                {Object.entries(TONE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Relevancia mínima · {ruleDraft.minimumRelevance}%
              <input type="range" min={50} max={95} step={5} value={ruleDraft.minimumRelevance} onChange={(event) => setRuleDraft((current) => ({ ...current, minimumRelevance: Number(event.target.value) }))} className="mt-2 w-full accent-fuchsia-700" />
            </label>
          </div>
          <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-fuchsia-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-fuchsia-800">
            <Save className="h-4 w-4" /> Guardar y usar esta regla
          </button>
        </form>
      )}

      {selectedRule && !editingRule && (
        <div className="mt-3 rounded-lg border border-fuchsia-100 bg-white/80 p-3">
          <p className="text-xs text-slate-600"><span className="font-bold text-slate-800">Busca:</span> {selectedRule.topic}</p>
          <button type="button" onClick={() => void analyzeVisibleScreen()} disabled={!ready || analyzing} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-fuchsia-700 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-800 disabled:opacity-50">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            {analyzing ? "Analizando lo que se ve…" : "Analizar pantalla visible"}
          </button>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-slate-500">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> La captura se usa una sola vez y no se guarda. No se recorren otros comentarios ni pantallas.
          </p>
        </div>
      )}

      {feedback && <p role="status" className="mt-3 rounded-lg bg-violet-100 px-3 py-2 text-xs text-violet-800">{feedback}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-xs text-rose-800">{error}</p>}

      {queue.length > 0 && (
        <div className="mt-4 border-t border-fuchsia-100 pt-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">Revisión rápida · {pendingCount} pendientes</h4>
            <span className="text-[11px] text-slate-500">{queue.length} detectadas</span>
          </div>
          <div className="mt-2 max-h-[38rem] space-y-2 overflow-y-auto pr-1">
            {queue.map((item) => (
              <article key={item.id} className={`rounded-lg border bg-white p-3 shadow-sm ${item.state === "skipped" ? "opacity-55" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <MessageCircleReply className="h-3.5 w-3.5 text-fuchsia-700" /> {item.authorLabel || "Comentario visible"}
                  </div>
                  <span className="rounded-full bg-fuchsia-100 px-2 py-0.5 text-[11px] font-semibold text-fuchsia-800">{item.relevanceScore}% relevante</span>
                </div>
                <blockquote className="mt-2 border-l-2 border-slate-200 pl-2 text-xs leading-5 text-slate-600">“{item.sourceText}”</blockquote>
                <p className="mt-1 text-[11px] leading-4 text-slate-500">{item.reason}</p>
                <textarea value={edits[item.id] ?? item.draftReply} onChange={(event) => setEdits((current) => ({ ...current, [item.id]: event.target.value }))} rows={3} maxLength={800} disabled={item.state === "skipped"} className="mt-2 w-full rounded-lg border px-2.5 py-2 text-xs leading-5 disabled:bg-slate-100" aria-label={`Respuesta para ${item.authorLabel || "comentario"}`} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => void copyItem(item)} disabled={!ready || busyItemId === item.id || item.state === "skipped"} className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {item.state === "approved" ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />} {item.state === "approved" ? "Copiada" : "Aprobar y copiar"}
                  </button>
                  <button type="button" onClick={() => void pasteItem(item)} disabled={!ready || busyItemId === item.id || item.state === "skipped"} className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    <Clipboard className="h-3.5 w-3.5" /> Pegar en campo enfocado
                  </button>
                  <button type="button" onClick={() => setQueue((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, state: candidate.state === "skipped" ? "pending" : "skipped" } : candidate))} className="ml-auto inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold text-slate-600">
                    {item.state === "skipped" ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />} {item.state === "skipped" ? "Recuperar" : "Descartar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-4 text-slate-500">F-Móviles no pulsa Enviar ni Publicar. Así mantienes el control sobre cada intervención.</p>
        </div>
      )}
    </section>
  );
}
