"use client";

/**
 * Ventana emergente (modal) de aprobación: cuando Sonia deja acciones
 * PENDIENTES (llamadas, email, WhatsApp…), aparece un modal central que las
 * lista y deja dar el OK o el NO a cada una (o a todas). Además lo anuncia
 * por voz una vez. Todo lo aprobado se ejecuta; lo rechazado se descarta.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { playSoniaBlob, speakSonia } from "@/lib/voice/sonia-audio";

const POLL_MS = 20_000;
const VOICED_KEY = "sonia-approval-voiced";

type Draft = { id: string; title: string; kind: string };
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
  const [busyId, setBusyId] = useState<string | null>(null);
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
    const titles = p.drafts.map((d) => d.title).join(", ");
    void speakSonia(`Tengo ${p.drafts.length === 1 ? "una acción" : p.drafts.length + " acciones"} esperando tu visto bueno: ${titles}.`);
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

  const closeIfEmpty = useCallback((remaining: Draft[]) => {
    if (remaining.length === 0) {
      setPending(null);
      setDrafts([]);
    }
  }, []);

  const act = useCallback(
    async (draftId: string, action: "approve" | "reject") => {
      if (busyId) return;
      setBusyId(draftId);
      try {
        await fetch(`/api/v1/admin/ai-agent/drafts/${draftId}/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const remaining = drafts.filter((d) => d.id !== draftId);
        setDrafts(remaining);
        closeIfEmpty(remaining);
      } catch {
        /* deja el botón disponible para reintentar */
      } finally {
        setBusyId(null);
      }
    },
    [busyId, drafts, closeIfEmpty]
  );

  const actAll = useCallback(
    async (action: "approve" | "reject") => {
      if (busyId) return;
      setBusyId("__all__");
      try {
        for (const d of [...drafts]) {
          await fetch(`/api/v1/admin/ai-agent/drafts/${d.id}/${action}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
          });
        }
        setDrafts([]);
        setPending(null);
        if (action === "approve") void speakSonia("Hecho, me pongo con ello.");
      } catch {
        /* noop */
      } finally {
        setBusyId(null);
      }
    },
    [busyId, drafts]
  );

  const dismiss = useCallback(() => {
    if (pending) dismissedRef.current.add(pending.runId);
    setPending(null);
    setDrafts([]);
  }, [pending]);

  if (!pending || drafts.length === 0) return null;

  return (
    <div style={overlay} onClick={dismiss}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>🎙️ Sonia necesita tu OK</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 14 }}>
          {pending.taskTitle ? pending.taskTitle : "Acciones preparadas"} — aprueba o rechaza:
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {drafts.map((d) => (
            <div key={d.id} style={row}>
              <div style={{ fontSize: 14, flex: 1, minWidth: 0 }}>
                <span style={{ marginRight: 6 }}>{kindIcon(d.kind)}</span>
                {d.title}
              </div>
              <button style={btnOk} disabled={!!busyId} onClick={() => act(d.id, "approve")}>
                ✓ Sí
              </button>
              <button style={btnNo} disabled={!!busyId} onClick={() => act(d.id, "reject")}>
                ✗ No
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <button style={linkBtn} disabled={!!busyId} onClick={dismiss}>
            Ahora no
          </button>
          <button style={btnNoAll} disabled={!!busyId} onClick={() => actAll("reject")}>
            Rechazar todo
          </button>
          <button style={btnOkAll} disabled={!!busyId} onClick={() => actAll("approve")}>
            Aprobar todo
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
  alignItems: "center",
  gap: 8,
  background: "#f7f7f8",
  border: "1px solid #ececec",
  borderRadius: 10,
  padding: "10px 12px"
};
const btnOk: React.CSSProperties = {
  background: "#16a34a",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap"
};
const btnNo: React.CSSProperties = {
  background: "#f3f3f3",
  color: "#b91c1c",
  border: "1px solid #e4c4c4",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap"
};
const btnOkAll: React.CSSProperties = { ...btnOk, padding: "9px 16px", fontWeight: 600 };
const btnNoAll: React.CSSProperties = {
  background: "#fff",
  color: "#b91c1c",
  border: "1px solid #e4c4c4",
  borderRadius: 8,
  padding: "9px 16px",
  fontSize: 13,
  cursor: "pointer"
};
const linkBtn: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  border: "none",
  fontSize: 13,
  cursor: "pointer"
};
