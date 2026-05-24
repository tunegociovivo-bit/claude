"use client";

/**
 * Ventana emergente (modal) de aprobación: cuando Sonia deja acciones
 * PENDIENTES (llamadas, email, WhatsApp…), aparece un modal central en
 * CUALQUIER página del Hub con la lista RESUMIDA de lo que va a hacer.
 * Todas vienen MARCADAS por defecto; desmarcas las que no quieras y, al
 * pulsar "Aprobar", se ejecutan las marcadas y se descartan las demás.
 * Además lo anuncia por voz una vez.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { playSoniaBlob, speakSonia } from "@/lib/voice/sonia-audio";

const POLL_MS = 20_000;
const VOICED_KEY = "sonia-approval-voiced";

type Draft = { id: string; title: string; kind: string; detail?: string };
type Pending = {
  runId: string;
  taskId: string | null;
  taskTitle: string | null;
  summary: string | null;
  drafts: Draft[];
};

function kindIcon(kind: string): string {
  switch (kind) {
    case "PHONE_CALL":
      return "📞";
    case "EMAIL":
      return "✉️";
    case "WHATSAPP":
      return "💬";
    case "CALENDAR_EVENT":
      return "📅";
    case "HOLDED_INVOICE":
    case "HOLDED_QUOTE":
      return "🧾";
    default:
      return "📋";
  }
}

/** Resumen corto: la parte antes de ":" suele ser la acción concreta. */
function shortLabel(title: string): string {
  const base = title.includes(":") ? title.split(":")[0] : title;
  return base.trim().slice(0, 80);
}

function voicedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VOICED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function markVoiced(runId: string) {
  const s = voicedSet();
  s.add(runId);
  localStorage.setItem(VOICED_KEY, JSON.stringify(Array.from(s).slice(-50)));
}

export default function FlashTaskVoiceNotifier() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const dismissedRef = useRef<Set<string>>(new Set());
  const pollingRef = useRef(false);

  const announce = useCallback(async (p: Pending) => {
    if (voicedSet().has(p.runId)) return;
    markVoiced(p.runId);
    try {
      const r = await fetch(`/api/v1/sonia/voice-inbox/${p.runId}/speak`, { cache: "no-store" });
      if (r.ok && r.status === 200) {
        await playSoniaBlob(await r.blob());
        return;
      }
    } catch {
      /* autoplay bloqueado → fallback */
    }
    const titles = p.drafts.map((d) => shortLabel(d.title)).join(", ");
    void speakSonia(
      `Tengo ${p.drafts.length === 1 ? "una acción" : p.drafts.length + " acciones"} esperando tu visto bueno: ${titles}.`
    );
  }, []);

  // Poll: si hay pendientes (no descartados), abre el modal.
  useEffect(() => {
    let stop = false;
    async function tick() {
      if (stop || pollingRef.current || pending) return;
      pollingRef.current = true;
      try {
        const r = await fetch("/api/v1/sonia/voice-inbox", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        const p: Pending | null = data?.pending ?? null;
        if (!p || !p.drafts?.length) return;
        if (dismissedRef.current.has(p.runId)) return;
        setPending(p);
        setDrafts(p.drafts);
        setSelected(new Set(p.drafts.map((d) => d.id))); // todas marcadas por defecto
        announce(p);
      } catch {
        /* silencio */
      } finally {
        pollingRef.current = false;
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [pending, announce]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const close = useCallback(() => {
    setPending(null);
    setDrafts([]);
    setSelected(new Set());
  }, []);

  const approve = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Marcadas → aprobar (ejecutar). Desmarcadas → rechazar (descartar).
      for (const d of drafts) {
        const action = selected.has(d.id) ? "approve" : "reject";
        await fetch(`/api/v1/admin/ai-agent/drafts/${d.id}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
      }
      const n = selected.size;
      if (n > 0) void speakSonia(n === 1 ? "Hecho, me pongo con ello." : `Hecho, me encargo de las ${n}.`);
      close();
    } catch {
      setBusy(false);
    }
  }, [busy, drafts, selected, close]);

  const dismiss = useCallback(() => {
    if (pending) dismissedRef.current.add(pending.runId);
    close();
  }, [pending, close]);

  if (!pending || drafts.length === 0) return null;

  return (
    <div style={overlay} onClick={dismiss}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>🎙️ Sonia necesita tu OK</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>
          Marca lo que quieres que haga y pulsa Aprobar:
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {drafts.map((d) => {
            const on = selected.has(d.id);
            const isOpen = expanded.has(d.id);
            const hasDetail = !!(d.detail && d.detail.trim() && d.detail.trim() !== shortLabel(d.title));
            return (
              <div key={d.id} style={{ ...row, opacity: on ? 1 : 0.5 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={() => toggle(d.id)}
                    style={{ width: 18, height: 18, flexShrink: 0 }}
                  />
                  <span
                    style={{ fontSize: 14, cursor: hasDetail ? "pointer" : "default", flex: 1 }}
                    title={hasDetail ? d.detail : undefined}
                    onClick={() => hasDetail && toggleExpand(d.id)}
                  >
                    <span style={{ marginRight: 6 }}>{kindIcon(d.kind)}</span>
                    {shortLabel(d.title)}
                    {hasDetail && <span style={{ color: "#999", marginLeft: 6, fontSize: 12 }}>{isOpen ? "▲" : "ⓘ"}</span>}
                  </span>
                </div>
                {isOpen && hasDetail && (
                  <div style={detailBox}>{d.detail}</div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <button style={linkBtn} disabled={busy} onClick={dismiss}>
            Ahora no
          </button>
          <button style={btnApprove} disabled={busy} onClick={approve}>
            {busy ? "Procesando…" : selected.size === drafts.length ? "Aprobar todo" : `Aprobar (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  fontFamily: "Arial, sans-serif"
};
const modal: React.CSSProperties = {
  width: 460,
  maxWidth: "100%",
  background: "#fff",
  borderRadius: 14,
  boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  padding: 22
};
const row: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background: "#f7f7f8",
  border: "1px solid #ececec",
  borderRadius: 10,
  padding: "10px 12px"
};
const detailBox: React.CSSProperties = {
  fontSize: 12.5,
  color: "#444",
  background: "#fff",
  border: "1px solid #ececec",
  borderRadius: 8,
  padding: "8px 10px",
  whiteSpace: "pre-wrap",
  maxHeight: 160,
  overflowY: "auto"
};
const btnApprove: React.CSSProperties = {
  background: "#16a34a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer"
};
const linkBtn: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  border: "none",
  fontSize: 13,
  cursor: "pointer"
};
