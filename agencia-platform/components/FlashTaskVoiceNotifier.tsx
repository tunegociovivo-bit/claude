"use client";

/**
 * Notificador global (montado en AppChrome): vigila las llamadas que Sonia
 * acaba de procesar y que tienen tareas que ELLA puede hacer (drafts
 * PENDING). Cuando aparece una nueva:
 *   1. Lo anuncia por VOZ (voz de Sonia vía ElevenLabs; cae a la voz del
 *      navegador si no está configurada).
 *   2. Muestra una tarjeta con la lista y deja responder por botones,
 *      texto o VOZ (micro). Según la respuesta, Sonia ejecuta o no.
 *
 * Cada llamada se anuncia una sola vez (dedupe en localStorage por runId).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const LS_KEY = "flash-voiced-runids";
const POLL_MS = 60_000;

type Draft = { id: string; title: string; kind: string };
type Pending = {
  runId: string;
  taskId: string;
  taskTitle: string | null;
  summary: string | null;
  finishedAt: string | null;
  drafts: Draft[];
};

function voicedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function markVoiced(runId: string) {
  const s = voicedSet();
  s.add(runId);
  // Cap defensivo: últimos 50.
  const arr = Array.from(s).slice(-50);
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

function browserSpeak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    window.speechSynthesis?.speak(u);
  } catch {
    /* sin TTS: nada */
  }
}

export default function FlashTaskVoiceNotifier() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [recording, setRecording] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const polling = useRef(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const announce = useCallback(async (p: Pending) => {
    // 1) Voz de Sonia (ElevenLabs).
    try {
      const r = await fetch(`/api/v1/sonia/voice-inbox/${p.runId}/speak`, { cache: "no-store" });
      if (r.ok && r.status === 200) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        return;
      }
    } catch {
      /* autoplay bloqueado o no configurado → fallback */
    }
    // 2) Voz del navegador.
    const titles = p.drafts.map((d) => d.title).join(", ");
    browserSpeak(`He procesado ${p.taskTitle ?? "una llamada"}. Puedo encargarme de: ${titles}. ¿Quieres que las haga?`);
  }, []);

  // Poll
  useEffect(() => {
    let stop = false;
    async function tick() {
      if (stop || polling.current || pending) return;
      polling.current = true;
      try {
        const r = await fetch("/api/v1/sonia/voice-inbox", { cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        const p: Pending | null = data?.pending ?? null;
        if (!p) return;
        if (voicedSet().has(p.runId)) return;
        markVoiced(p.runId);
        setDoneMsg(null);
        setReplyText("");
        setPending(p);
        announce(p);
      } catch {
        /* silencio */
      } finally {
        polling.current = false;
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [pending, announce]);

  const finish = useCallback((spoken: string | null) => {
    if (spoken) browserSpeak(spoken);
    setDoneMsg(spoken ?? "Listo.");
    setPending(null);
    setBusy(false);
    setReplyText("");
    setTimeout(() => setDoneMsg(null), 6000);
  }, []);

  const respondJson = useCallback(
    async (payload: { decision?: "approve" | "reject"; reply?: string }) => {
      if (!pending || busy) return;
      setBusy(true);
      try {
        const r = await fetch(`/api/v1/sonia/voice-inbox/${pending.runId}/respond`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await r.json().catch(() => ({}));
        finish(data?.spoken ?? null);
      } catch {
        setBusy(false);
      }
    },
    [pending, busy, finish]
  );

  const startRec = useCallback(async () => {
    if (recording || !pending) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (!pending || blob.size === 0) {
          setBusy(false);
          return;
        }
        setBusy(true);
        const form = new FormData();
        form.append("audio", blob, "respuesta.webm");
        try {
          const r = await fetch(`/api/v1/sonia/voice-inbox/${pending.runId}/respond`, {
            method: "POST",
            body: form
          });
          const data = await r.json().catch(() => ({}));
          finish(data?.spoken ?? null);
        } catch {
          setBusy(false);
        }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      /* permiso de micro denegado */
    }
  }, [recording, pending, finish]);

  const stopRec = useCallback(() => {
    if (mediaRef.current && recording) {
      mediaRef.current.stop();
      setRecording(false);
    }
  }, [recording]);

  if (doneMsg && !pending) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 13 }}>{doneMsg}</div>
      </div>
    );
  }
  if (!pending) return null;

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
        🎙️ Sonia · {pending.taskTitle ?? "Llamada procesada"}
      </div>
      <div style={{ fontSize: 13, marginBottom: 8, color: "#444" }}>Puedo encargarme de:</div>
      <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 13 }}>
        {pending.drafts.map((d) => (
          <li key={d.id} style={{ marginBottom: 3 }}>
            {d.title}
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button style={btnPrimary} disabled={busy} onClick={() => respondJson({ decision: "approve" })}>
          Sí, hazlas
        </button>
        <button style={btnGhost} disabled={busy} onClick={() => respondJson({ decision: "reject" })}>
          No
        </button>
        <button
          style={recording ? btnRec : btnGhost}
          disabled={busy}
          onClick={recording ? stopRec : startRec}
          title="Responder por voz"
        >
          {recording ? "■ Parar" : "🎤 Voz"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          style={inputStyle}
          placeholder="…o escríbeme qué hago"
          value={replyText}
          disabled={busy}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && replyText.trim() && respondJson({ reply: replyText.trim() })}
        />
        <button
          style={btnGhost}
          disabled={busy || !replyText.trim()}
          onClick={() => respondJson({ reply: replyText.trim() })}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 20,
  right: 20,
  zIndex: 9999,
  width: 340,
  maxWidth: "calc(100vw - 40px)",
  background: "#fff",
  border: "1px solid #e0e0e0",
  borderRadius: 12,
  boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
  padding: 16,
  fontFamily: "Arial, sans-serif"
};
const btnPrimary: React.CSSProperties = {
  background: "#ff6600",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer"
};
const btnGhost: React.CSSProperties = {
  background: "#f3f3f3",
  color: "#333",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer"
};
const btnRec: React.CSSProperties = { ...btnGhost, background: "#ffebeb", borderColor: "#ff9b9b" };
const inputStyle: React.CSSProperties = {
  flex: 1,
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13
};
