"use client";

import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Play, Mic } from "lucide-react";

const PRESET_TEXTS = [
  "Hola David. He terminado el informe mensual de Champiso. Lo he adjuntado a la tarea con cuatro hojas: tráfico web, SEO orgánico, Meta Ads y Google Ads.",
  "Necesito tu aprobación antes de seguir con activar la campaña Black Friday. Voy a poner en marcha la campaña con cincuenta euros al día.",
  "Te he contestado en revisar el copy del email para el cliente Reva. Échale un vistazo cuando puedas.",
  "Necesito tu ayuda con descargar leads de la campaña verano. El token de Meta ha caducado y no puedo acceder a la cuenta publicitaria.",
  "He terminado de programar el calendario editorial de mayo para Guardamuebles Reva. Treinta posts repartidos entre Instagram, Facebook y Google Business."
];

export default function SoniaVoiceTestPage() {
  const [text, setText] = useState(PRESET_TEXTS[0]);
  const [voiceId, setVoiceId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  async function play() {
    setBusy(true);
    setError(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    try {
      const r = await fetch("/api/v1/sonia/preview-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: voiceId.trim() || undefined,
          modelId: modelId.trim() || undefined
        })
      });
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(errBody.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      const audio = new Audio(url);
      void audio.play();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Probar voz de Sonia"
        description="Genera audio con tu voz configurada en ElevenLabs. Útil para validar tono, velocidad y voiceId antes de que Sonia lo use en notificaciones reales."
      />

      <div className="bg-white rounded-xl border p-6 mb-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Mic className="h-4 w-4 text-brand-600" />
          Texto a sintetizar
        </h2>

        <div className="flex flex-wrap gap-2 mb-3">
          {PRESET_TEXTS.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setText(t)}
              className="text-xs px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              Ejemplo {i + 1}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={600}
          rows={5}
          className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder="Escribe lo que quieres oír…"
        />
        <div className="text-xs text-slate-500 mt-1">{text.length} / 600 caracteres</div>
      </div>

      <div className="bg-white rounded-xl border p-6 mb-4">
        <h2 className="font-semibold mb-3 text-sm">Override puntual (opcional)</h2>
        <p className="text-xs text-slate-500 mb-3">
          Si dejas en blanco se usa la voz configurada en{" "}
          <code className="bg-slate-100 px-1 rounded">
            Workspace.settings.integrations.elevenlabs
          </code>
          . Para probar otra voz, pega su ID de la Voice Library.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-600 block mb-1">voiceId</label>
            <input
              type="text"
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              placeholder="21m00Tcm4TlvDq8ikWAM"
              className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">modelId</label>
            <input
              type="text"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="eleven_multilingual_v2"
              className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={play}
          disabled={busy || !text.trim()}
          className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg font-medium"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sintetizando…
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Reproducir
            </>
          )}
        </button>
        {audioUrl && (
          <a
            href={audioUrl}
            download="sonia-voice.mp3"
            className="text-sm text-brand-600 underline"
          >
            Descargar MP3
          </a>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm p-3 mb-4">
          <strong>Error:</strong> {error}
          <div className="text-xs mt-1 text-rose-700">
            Si dice "ElevenLabs no configurado", configura{" "}
            <code className="bg-rose-100 px-1 rounded">
              Workspace.settings.integrations.elevenlabs.apiKey
            </code>{" "}
            en la base de datos (cifrado con encryptSecret).
          </div>
        </div>
      )}

      {audioUrl && !error && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm">
          <audio src={audioUrl} controls className="w-full" />
        </div>
      )}
    </div>
  );
}
