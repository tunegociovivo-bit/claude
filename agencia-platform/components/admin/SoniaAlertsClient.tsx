"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  Loader2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Send
} from "lucide-react";

type Status = {
  hasBotToken: boolean;
  telegram: { enabled: boolean; chatId: string | null };
  whatsapp: { enabled: boolean; phone: string | null };
  respectWorkingHours: boolean;
  workingHours: { start: number; end: number; timezone: string };
  minLevel: "warning" | "critical";
};

export default function SoniaAlertsClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [botToken, setBotToken] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [respectHours, setRespectHours] = useState(true);
  const [hourStart, setHourStart] = useState(9);
  const [hourEnd, setHourEnd] = useState(19);
  const [minLevel, setMinLevel] =
    useState<"warning" | "critical">("warning");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(
    null
  );

  async function load() {
    const r = await fetch("/api/v1/admin/sonia-alerts");
    if (r.ok) {
      const d: Status = await r.json();
      setStatus(d);
      setTelegramEnabled(d.telegram.enabled);
      setTelegramChatId(d.telegram.chatId ?? "");
      setWhatsappEnabled(d.whatsapp.enabled);
      setWhatsappPhone(d.whatsapp.phone ?? "");
      setRespectHours(d.respectWorkingHours);
      setHourStart(d.workingHours.start);
      setHourEnd(d.workingHours.end);
      setMinLevel(d.minLevel);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/sonia-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramBotToken: botToken || undefined,
          telegram: { enabled: telegramEnabled, chatId: telegramChatId },
          whatsapp: { enabled: whatsappEnabled, phone: whatsappPhone },
          respectWorkingHours: respectHours,
          workingHours: {
            start: hourStart,
            end: hourEnd,
            timezone: "Europe/Madrid"
          },
          minLevel
        })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setMsg({ type: "ok", text: "Guardado." });
      setBotToken("");
      await load();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/sonia-alerts", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      const ok = d.result?.ok ?? [];
      const errs = d.result?.errors ?? {};
      const errList = Object.entries(errs)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ");
      if (ok.length > 0) {
        setMsg({
          type: "ok",
          text: `Test enviado por: ${ok.join(", ")}${errList ? `. Errores: ${errList}` : ""}`
        });
      } else {
        setMsg({
          type: "err",
          text: errList
            ? `Sin éxito. ${errList}`
            : "Sin canales activados o sin destinatario configurado."
        });
      }
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Alertas multi-canal de Sonia"
        description="Sonia te avisa por WhatsApp y/o Telegram fuera del Hub cuando una tarea necesita tu atención (FAILED, REQUIRES_HUMAN). Útil para findes, viajes y horas no laborales."
      />

      <div className="rounded-xl border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold">Telegram</h2>
        <p className="text-sm text-zinc-600">
          Crea un bot con{" "}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline"
          >
            @BotFather
          </a>{" "}
          (comando /newbot), copia el token, pégalo abajo. Después abre tu
          bot, dale /start, y consigue tu chatId en{" "}
          <a
            href="https://t.me/userinfobot"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline"
          >
            @userinfobot
          </a>
          .
        </p>
        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">
            Bot token{" "}
            {status?.hasBotToken && (
              <span className="text-green-600">(ya configurado)</span>
            )}
          </label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder={
              status?.hasBotToken
                ? "Déjalo vacío para mantener el actual"
                : "123456:AAH..."
            }
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={telegramEnabled}
            onChange={(e) => setTelegramEnabled(e.target.checked)}
          />
          Activado
        </label>
        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">
            Tu chatId
          </label>
          <input
            value={telegramChatId}
            onChange={(e) => setTelegramChatId(e.target.value)}
            placeholder="123456789"
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold">WhatsApp</h2>
        <p className="text-sm text-zinc-600">
          Usa el WAHA configurado del workspace (mismo que envía mensajes a
          leads). Si no lo tienes configurado, este canal no funcionará.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={whatsappEnabled}
            onChange={(e) => setWhatsappEnabled(e.target.checked)}
          />
          Activado
        </label>
        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">
            Tu teléfono (formato internacional, +34…)
          </label>
          <input
            value={whatsappPhone}
            onChange={(e) => setWhatsappPhone(e.target.value)}
            placeholder="+34 600 000 000"
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5 space-y-4">
        <h2 className="text-base font-semibold">Reglas de envío</h2>
        <div>
          <label className="block text-xs font-medium text-zinc-700 mb-1">
            Severidad mínima
          </label>
          <select
            value={minLevel}
            onChange={(e) =>
              setMinLevel(e.target.value as "warning" | "critical")
            }
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="warning">⚠️ warning + 🚨 critical</option>
            <option value="critical">🚨 solo critical (REQUIRES_HUMAN, FAILED)</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={respectHours}
            onChange={(e) => setRespectHours(e.target.checked)}
          />
          Solo fuera de horario laboral (las críticas se envían siempre)
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span>De</span>
          <input
            type="number"
            min={0}
            max={23}
            value={hourStart}
            onChange={(e) => setHourStart(Number(e.target.value))}
            className="w-16 rounded-lg border px-2 py-1 text-sm"
          />
          <span>h a</span>
          <input
            type="number"
            min={0}
            max={24}
            value={hourEnd}
            onChange={(e) => setHourEnd(Number(e.target.value))}
            className="w-16 rounded-lg border px-2 py-1 text-sm"
          />
          <span>h (Europe/Madrid)</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Guardar
        </button>
        <button
          onClick={sendTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
        >
          {testing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar mensaje de prueba
        </button>
      </div>

      {msg && (
        <div
          className={
            msg.type === "ok"
              ? "rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900 flex items-start gap-2"
              : "rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 flex items-start gap-2"
          }
        >
          {msg.type === "ok" ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <span>{msg.text}</span>
        </div>
      )}
    </div>
  );
}
