"use client";

import { useEffect, useRef, useState } from "react";

type Stage = "idle" | "recording" | "transcribing" | "drafting" | "ready" | "error";

export default function VoiceReviewWidget({
  slug,
  name,
  introText,
  disclaimer,
  googleUrl,
  trustpilotUrl,
  maxSeconds
}: {
  slug: string;
  name: string;
  introText: string | null;
  disclaimer: string | null;
  googleUrl: string | null;
  trustpilotUrl: string | null;
  maxSeconds: number;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [secondsLeft, setSecondsLeft] = useState(maxSeconds);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [draft, setDraft] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<number | null>(null);

  const defaultIntro = `Muchas gracias por tu visita a ${name}. Pulsa el micrófono y cuenta lo que más te ha gustado (o lo que mejorarías). Redactaremos un borrador a partir de tus palabras y tú lo ajustarás antes de publicarlo.`;
  const defaultDisclaimer = `Adapta el borrador a tu experiencia real antes de publicarlo. Cuanto más personal sea, más útil para los siguientes clientes.`;

  useEffect(() => {
    return () => {
      // limpieza al desmontar
      stopTimer();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function stopTimer() {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  async function startRecording() {
    setError(null);
    setTranscript("");
    setDraft("");
    setSecondsLeft(maxSeconds);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Tu navegador no soporta grabación de audio.");
      setStage("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopTimer();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await handleAudio(blob);
      };
      rec.start();

      setStage("recording");
      tickRef.current = window.setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            stopRecording();
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } catch (e: any) {
      console.error(e);
      setError("No se pudo acceder al micrófono. Acepta el permiso e inténtalo de nuevo.");
      setStage("error");
    }
  }

  function stopRecording() {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state === "recording") {
      rec.stop();
    }
  }

  async function handleAudio(blob: Blob) {
    setStage("transcribing");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("slug", slug);
      fd.append("audio", blob, "recording.webm");
      const tr = await fetch("/api/v1/voice/transcribe", { method: "POST", body: fd });
      const trData = await tr.json();
      if (!tr.ok) throw new Error(trData?.error?.message ?? "Error al transcribir");
      setTranscript(trData.transcript);

      setStage("drafting");
      const dr = await fetch("/api/v1/voice/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, transcript: trData.transcript })
      });
      const drData = await dr.json();
      if (!dr.ok) throw new Error(drData?.error?.message ?? "Error al redactar");
      setDraft(drData.review);
      setStage("ready");
    } catch (e: any) {
      setError(e.message ?? String(e));
      setStage("error");
    }
  }

  async function copyAndGo(url: string) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(draft);
    } catch {
      // si falla, redirigimos igual
    }
    window.location.href = url;
  }

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "16px",
        padding: "24px",
        border: "1px solid #e2e8f0",
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
      }}
    >
      <h1 style={{ fontSize: "22px", fontWeight: 600, margin: "0 0 14px", color: "#0f172a" }}>
        Reseña por voz · {name}
      </h1>

      <p style={{ fontSize: "14px", color: "#475569", lineHeight: "1.55", margin: "0 0 16px" }}>
        {introText || defaultIntro}
      </p>

      {(stage === "idle" || stage === "error") && (
        <div style={{ textAlign: "center" }}>
          <button
            onClick={startRecording}
            style={{
              background: "#5B6CFF",
              color: "#fff",
              border: 0,
              padding: "16px 28px",
              borderRadius: "999px",
              fontWeight: 600,
              fontSize: "15px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px"
            }}
          >
            🎤 Empezar a hablar ({maxSeconds}s máx)
          </button>
        </div>
      )}

      {stage === "recording" && (
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: "44px",
              fontWeight: 600,
              color: secondsLeft <= 5 ? "#dc2626" : "#5B6CFF",
              marginBottom: "12px"
            }}
          >
            {secondsLeft}s
          </div>
          <button
            onClick={stopRecording}
            style={{
              background: "#dc2626",
              color: "#fff",
              border: 0,
              padding: "14px 26px",
              borderRadius: "999px",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer"
            }}
          >
            ⏹ Parar
          </button>
          <p style={{ fontSize: "13px", color: "#64748b", marginTop: "12px" }}>
            Habla con normalidad. Cuanto más concreto seas, mejor saldrá el borrador.
          </p>
        </div>
      )}

      {(stage === "transcribing" || stage === "drafting") && (
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "3px solid #e2e8f0",
              borderTopColor: "#5B6CFF",
              borderRadius: "50%",
              margin: "0 auto 12px",
              animation: "vrspin 0.8s linear infinite"
            }}
          />
          <p style={{ fontSize: "14px", color: "#475569" }}>
            {stage === "transcribing" ? "Transcribiendo tu audio…" : "Redactando borrador…"}
          </p>
          <style>{"@keyframes vrspin { to { transform: rotate(360deg) } }"}</style>
        </div>
      )}

      {stage === "ready" && (
        <>
          {transcript && (
            <details style={{ marginBottom: "12px" }}>
              <summary style={{ cursor: "pointer", fontSize: "12px", color: "#64748b" }}>
                Ver lo que entendimos en tu audio
              </summary>
              <p style={{ fontSize: "13px", color: "#475569", fontStyle: "italic", marginTop: "6px" }}>
                "{transcript}"
              </p>
            </details>
          )}

          <label style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b", display: "block", marginBottom: "6px" }}>
            Borrador editable:
          </label>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            style={{
              width: "100%",
              padding: "12px",
              border: "1px solid #cbd5e1",
              borderRadius: "10px",
              fontSize: "15px",
              lineHeight: "1.55",
              fontFamily: "inherit",
              boxSizing: "border-box",
              resize: "vertical"
            }}
          />

          <p style={{ fontSize: "12px", color: "#64748b", margin: "10px 0 14px" }}>
            {disclaimer || defaultDisclaimer}
          </p>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {googleUrl && (
              <button
                onClick={() => copyAndGo(googleUrl)}
                style={{
                  flex: 1,
                  minWidth: "160px",
                  background: "#4285F4",
                  color: "#fff",
                  border: 0,
                  padding: "12px 16px",
                  borderRadius: "8px",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer"
                }}
              >
                Copiar y abrir Google
              </button>
            )}
            {trustpilotUrl && (
              <button
                onClick={() => copyAndGo(trustpilotUrl)}
                style={{
                  flex: 1,
                  minWidth: "160px",
                  background: "#00B67A",
                  color: "#fff",
                  border: 0,
                  padding: "12px 16px",
                  borderRadius: "8px",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer"
                }}
              >
                Copiar y abrir Trustpilot
              </button>
            )}
            <button
              onClick={() => setStage("idle")}
              style={{
                background: "#fff",
                color: "#475569",
                border: "1px solid #cbd5e1",
                padding: "12px 16px",
                borderRadius: "8px",
                fontWeight: 500,
                fontSize: "13px",
                cursor: "pointer"
              }}
            >
              Grabar otra vez
            </button>
          </div>
        </>
      )}

      {error && (
        <div
          style={{
            marginTop: "14px",
            padding: "10px 14px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            color: "#b91c1c",
            fontSize: "13px"
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
