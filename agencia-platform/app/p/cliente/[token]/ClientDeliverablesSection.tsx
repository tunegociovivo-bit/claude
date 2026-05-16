"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Paperclip,
  FileCheck2,
  Send
} from "lucide-react";

type Deliverable = {
  id: string;
  title: string;
  description: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  dueAt: string | null;
  createdAt: string;
  file: { id: string; name: string; mimeType: string; sizeBytes: number } | null;
  decisions: { id: string; decision: string; comment: string | null; createdAt: string }[];
};

export default function ClientDeliverablesSection({ token, accent }: { token: string; accent: string }) {
  const [items, setItems] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  async function load() {
    try {
      const r = await fetch(`/api/public/approval/${token}/deliverables`);
      if (r.ok) {
        const d = await r.json();
        setItems(d.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [token]);

  async function decide(id: string, decision: "approved" | "rejected" | "comment") {
    setPosting(`${id}-${decision}`);
    try {
      const r = await fetch(`/api/public/approval/${token}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: id,
          decision,
          comment: decision === "comment" ? commentDraft[id] : commentDraft[id] || null
        })
      });
      if (r.ok) {
        setCommentDraft((p) => ({ ...p, [id]: "" }));
        load();
      }
    } finally {
      setPosting(null);
    }
  }

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
        <FileCheck2 className="h-4 w-4" />
        Entregables ({items.length})
      </h2>
      <div className="space-y-3">
        {items.map((d) => (
          <div key={d.id} className="bg-white rounded-xl border p-5">
            <div className="flex items-start gap-3">
              <StatusBadge status={d.status} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900">{d.title}</div>
                {d.description && <p className="text-sm text-slate-600 mt-1">{d.description}</p>}
                <div className="text-[11px] text-slate-500 mt-1">
                  {d.dueAt && <>Vence {new Date(d.dueAt).toLocaleDateString("es-ES")} · </>}
                  Enviado {new Date(d.createdAt).toLocaleDateString("es-ES")}
                </div>
                {d.file && (
                  <a
                    href={`/api/v1/files/${d.file.id}/download?token=${token}`}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
                    style={{ color: accent }}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    {d.file.name} ({(d.file.sizeBytes / 1024 / 1024).toFixed(1)} MB)
                  </a>
                )}

                {d.decisions.length > 0 && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-slate-500">
                      Historial ({d.decisions.length})
                    </summary>
                    <div className="mt-1 space-y-1 pl-3 border-l border-slate-200">
                      {d.decisions.map((dec) => (
                        <div key={dec.id} className="text-slate-600">
                          <span className="font-medium">
                            {dec.decision === "approved" ? "✓ aprobado" : dec.decision === "rejected" ? "✗ rechazado" : "💬 comentario"}
                          </span>
                          {dec.comment && <> · {dec.comment}</>}
                          <span className="text-slate-400 ml-1">({new Date(dec.createdAt).toLocaleString("es-ES")})</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {d.status === "PENDING" && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={commentDraft[d.id] ?? ""}
                      onChange={(e) => setCommentDraft((p) => ({ ...p, [d.id]: e.target.value }))}
                      placeholder="Comentario opcional (si rechazas, explica qué cambiar)…"
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2"
                      style={{ "--tw-ring-color": accent } as React.CSSProperties}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => decide(d.id, "approved")}
                        disabled={posting?.startsWith(d.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
                      >
                        {posting === `${d.id}-approved` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Aprobar
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(d.id, "rejected")}
                        disabled={posting?.startsWith(d.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-medium disabled:opacity-50"
                      >
                        {posting === `${d.id}-rejected` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" />
                        )}
                        Pedir cambios
                      </button>
                      {commentDraft[d.id]?.trim() && (
                        <button
                          type="button"
                          onClick={() => decide(d.id, "comment")}
                          disabled={posting?.startsWith(d.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-slate-700 text-xs disabled:opacity-50"
                        >
                          {posting === `${d.id}-comment` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5" />
                          )}
                          Solo comentario
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: "PENDING" | "APPROVED" | "REJECTED" }) {
  if (status === "APPROVED") return <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />;
  if (status === "REJECTED") return <XCircle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />;
  return <Clock className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />;
}
