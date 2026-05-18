"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Play, Mic, Settings2, Check, Trash2, ExternalLink } from "lucide-react";

const PRESET_TEXTS = [
  "Hola David. He terminado el informe mensual de Champiso. Lo he adjuntado a la tarea con cuatro hojas: tráfico web, SEO orgánico, Meta Ads y Google Ads.",
  "Necesito tu aprobación antes de seguir con activar la campaña Black Friday. Voy a poner en marcha la campaña con cincuenta euros al día.",
  "Te he contestado en revisar el copy del email para el cliente Reva. Échale un vistazo cuando puedas.",
  "Necesito tu ayuda con descargar leads de la campaña verano. El token de Meta ha caducado y no puedo acceder a la cuenta publicitaria.",
  "He terminado de programar el calendario editorial de mayo para Guardamuebles Reva. Treinta posts repartidos entre Instagram, Facebook y Google Business."
];

type ElevenStatus = { hasKey: boolean; voiceId: string | null; modelId: string | null };

export default function SoniaVoiceTestPage() {
  const [text, setText] = useState(PRESET_TEXTS[0]);
  const [voiceId, setVoiceId] = useState("");
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Estado de configuración persistente
  const [status, setStatus] = useState<ElevenStatus | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configApiKey, setConfigApiKey] = useState("");
  const [configVoiceId, setConfigVoiceId] = useState("");
  const [configModelId, setConfigModelId] = useState("eleven_multilingual_v2");
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function loadStatus() {
    try {
      const r = await fetch("/api/v1/admin/elevenlabs-settings");
      if (r.ok) {
        const s: ElevenStatus = await r.json();
        setStatus(s);
        if (s.voiceId) setConfigVoiceId(s.voiceId);
        if (s.modelId) setConfigModelId(s.modelId);
        // Abre panel automáticamente si no hay key
        if (!s.hasKey) setShowConfig(true);
      }
    } catch {}
  }
  useEffect(() => {
    loadStatus();
  }, []);

  async function saveConfig() {
    setSavingConfig(true);
    setConfigMsg(null);
    try {
      const r = await fetch("/api/v1/admin/elevenlabs-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: configApiKey,
          voiceId: configVoiceId,
          modelId: configModelId
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setConfigMsg({
        type: "ok",
        text: `Guardado. Voz validada: ${data.voiceName ?? data.voiceId}`
      });
      setConfigApiKey("");
      await loadStatus();
    } catch (e: any) {
      setConfigMsg({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setSavingConfig(false);
    }
  }

  async function deleteConfig() {
    if (!confirm("¿Borrar la configuración de ElevenLabs del workspace?")) return;
    await fetch("/api/v1/admin/elevenlabs-settings", { method: "DELETE" });
    setConfigMsg(null);
    await loadStatus();
  }

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

      {/* Estado + botón abrir config */}
      <div
        className={
          "rounded-xl border p-4 mb-4 flex items-center justify-between " +
          (status?.hasKey
            ? "bg-emerald-50 border-emerald-200"
            : "bg-amber-50 border-amber-200")
        }
      >
        <div className="text-sm">
          {status?.hasKey ? (
            <>
              <strong className="text-emerald-800">
                <Check className="h-4 w-4 inline mr-1" />
                ElevenLabs configurado
              </strong>
              <div className="text-xs text-emerald-700 mt-1">
                voiceId: <code className="bg-white px-1 rounded">{status.voiceId}</code>{" "}
                · modelId: <code className="bg-white px-1 rounded">{status.modelId}</code>
              </div>
            </>
          ) : (
            <>
              <strong className="text-amber-800">ElevenLabs aún no configurado</strong>
              <div className="text-xs text-amber-700 mt-1">
                Mete tu API key y voiceId abajo para que Sonia pueda hablar.
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-white border hover:bg-slate-50"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {showConfig ? "Ocultar" : "Configurar"}
        </button>
      </div>

      {/* Panel configuración */}
      {showConfig && (
        <div className="bg-white rounded-xl border p-6 mb-4">
          <h2 className="font-semibold mb-3 text-sm flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-brand-600" />
            Configuración persistente
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            Esto se guarda CIFRADO en el workspace. La key NO se muestra después de
            guardarla — para cambiarla, vuelve a pegarla aquí.{" "}
            <a
              href="https://elevenlabs.io/app/settings/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 underline inline-flex items-center gap-0.5"
            >
              Obtener key <ExternalLink className="h-3 w-3" />
            </a>
            {" — "}
            <a
              href="https://elevenlabs.io/app/voice-library"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 underline inline-flex items-center gap-0.5"
            >
              elegir voz <ExternalLink className="h-3 w-3" />
            </a>
          </p>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-600 block mb-1">
                ElevenLabs API key {status?.hasKey && "(deja en blanco para mantener la actual)"}
              </label>
              <input
                type="password"
                value={configApiKey}
                onChange={(e) => setConfigApiKey(e.target.value)}
                placeholder="sk_..."
                className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-600 block mb-1">
                  voiceId <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={configVoiceId}
                  onChange={(e) => setConfigVoiceId(e.target.value)}
                  placeholder="21m00Tcm4TlvDq8ikWAM"
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">modelId</label>
                <input
                  type="text"
                  value={configModelId}
                  onChange={(e) => setConfigModelId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm font-mono"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={saveConfig}
              disabled={savingConfig || !configVoiceId.trim() || (!configApiKey && !status?.hasKey)}
              className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              {savingConfig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Validar y guardar
            </button>
            {status?.hasKey && (
              <button
                type="button"
                onClick={deleteConfig}
                className="inline-flex items-center gap-1 text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg text-sm"
              >
                <Trash2 className="h-4 w-4" />
                Borrar
              </button>
            )}
          </div>

          {configMsg && (
            <div
              className={
                "mt-3 text-sm p-2 rounded-lg " +
                (configMsg.type === "ok"
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-rose-50 border border-rose-200 text-rose-800")
              }
            >
              {configMsg.text}
            </div>
          )}
        </div>
      )}

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
          Si dejas en blanco se usa la voz configurada arriba. Para probar otra voz sin
          cambiar la persistente, pega su ID aquí.
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
          {error.toLowerCase().includes("elevenlabs no configurado") && (
            <div className="text-xs mt-1">
              Abre el panel de configuración arriba y mete tu API key + voiceId.
            </div>
          )}
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
