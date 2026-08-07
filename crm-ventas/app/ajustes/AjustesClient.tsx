"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import BusinessPhoneCard from "@/components/BusinessPhoneCard";
import PhoneActivationGuide from "@/components/PhoneActivationGuide";
import OperatorPhoneCard from "@/components/OperatorPhoneCard";
import WahaConnectionCard from "@/components/WahaConnectionCard";
import UsersCard from "@/components/UsersCard";
import LogoCard from "@/components/LogoCard";

type SettingsData = {
  sonia: {
    businessName: string;
    businessInfo: string;
    openingHours: string;
    promptExtra: string;
    slotMinutes: number;
    firstMessage: string;
    vapiModelProvider: string;
    vapiModel: string;
    vapiVoiceProvider: string;
    vapiVoiceId: string;
  };
  whatsapp: {
    countryCode: string;
    autoReplyEnabled: boolean;
  };
  webhooks: { vapi: string };
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export default function AjustesClient() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/settings/sonia")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("No se pudo cargar la configuración"));
  }, []);

  if (!data) {
    return <p className="text-sm text-slate-500">{error ?? "Cargando…"}</p>;
  }

  function patchSonia<K extends keyof SettingsData["sonia"]>(
    key: K,
    value: SettingsData["sonia"][K]
  ) {
    setData((d) => (d ? { ...d, sonia: { ...d.sonia, [key]: value } } : d));
  }
  function patchWhatsapp<K extends keyof SettingsData["whatsapp"]>(
    key: K,
    value: SettingsData["whatsapp"][K]
  ) {
    setData((d) => (d ? { ...d, whatsapp: { ...d.whatsapp, [key]: value } } : d));
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    const body = {
      sonia: data.sonia,
      whatsapp: {
        countryCode: data.whatsapp.countryCode,
        autoReplyEnabled: data.whatsapp.autoReplyEnabled,
      },
    };
    const res = await fetch("/api/v1/settings/sonia", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      setError("No se pudo guardar");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ajustes de PAULA</h1>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar cambios"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">Negocio y prompt</h2>
        <Field label="Nombre del negocio">
          <input
            className="input"
            value={data.sonia.businessName}
            onChange={(e) => patchSonia("businessName", e.target.value)}
            placeholder="Clínica Dental Sonrisa"
          />
        </Field>
        <Field
          label="Información del negocio"
          hint="Todo lo que PAULA puede contar: servicios, precios, dirección, preguntas frecuentes…"
        >
          <textarea
            className="input"
            rows={6}
            value={data.sonia.businessInfo}
            onChange={(e) => patchSonia("businessInfo", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Horario">
            <input
              className="input"
              value={data.sonia.openingHours}
              onChange={(e) => patchSonia("openingHours", e.target.value)}
            />
          </Field>
          <Field label="Duración de cita (min)">
            <input
              className="input"
              type="number"
              min={5}
              value={data.sonia.slotMinutes}
              onChange={(e) => patchSonia("slotMinutes", Number(e.target.value))}
            />
          </Field>
        </div>
        <Field
          label="Instrucciones específicas (prompt del cliente)"
          hint="Instrucciones extra para este negocio: tono, qué no decir, cómo tratar casos especiales…"
        >
          <textarea
            className="input"
            rows={5}
            value={data.sonia.promptExtra}
            onChange={(e) => patchSonia("promptExtra", e.target.value)}
          />
        </Field>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">Llamadas (Vapi)</h2>
        <Field label="Saludo inicial de la llamada">
          <input
            className="input"
            value={data.sonia.firstMessage}
            onChange={(e) => patchSonia("firstMessage", e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Proveedor del modelo" hint='Normalmente "anthropic"'>
            <input
              className="input"
              value={data.sonia.vapiModelProvider}
              onChange={(e) => patchSonia("vapiModelProvider", e.target.value)}
            />
          </Field>
          <Field label="Modelo">
            <input
              className="input"
              value={data.sonia.vapiModel}
              onChange={(e) => patchSonia("vapiModel", e.target.value)}
            />
          </Field>
          <Field label="Proveedor de voz" hint='Normalmente "11labs"'>
            <input
              className="input"
              value={data.sonia.vapiVoiceProvider}
              onChange={(e) => patchSonia("vapiVoiceProvider", e.target.value)}
            />
          </Field>
          <Field label="Voice ID">
            <input
              className="input"
              value={data.sonia.vapiVoiceId}
              onChange={(e) => patchSonia("vapiVoiceId", e.target.value)}
            />
          </Field>
        </div>
        <BusinessPhoneCard />
        <PhoneActivationGuide />
        <details className="rounded-lg border border-slate-200 p-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-slate-500">Datos técnicos (soporte Negocio Vivo)</summary>
          <p className="mt-2 text-xs text-slate-500">
            URL que debe recibir cada llamada (Server URL del número, con el asistente vacío). La usa Negocio Vivo al
            conectar la línea; el prompt vive en este CRM, no en Vapi.
          </p>
          <div className="mt-2 flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1">
            <code className="min-w-0 flex-1 truncate text-xs">{data.webhooks.vapi}</code>
            <CopyButton value={data.webhooks.vapi} />
          </div>
        </details>
      </section>

      <OperatorPhoneCard />

      <section className="card space-y-4 p-6">
        <h2 className="font-semibold">WhatsApp</h2>
        <WahaConnectionCard />
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Prefijo de país por defecto"
            hint="Se usa para completar teléfonos sin prefijo (34 = España)"
          >
            <input
              className="input"
              value={data.whatsapp.countryCode}
              onChange={(e) => patchWhatsapp("countryCode", e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.whatsapp.autoReplyEnabled}
            onChange={(e) => patchWhatsapp("autoReplyEnabled", e.target.checked)}
          />
          PAULA responde automáticamente a los mensajes entrantes
        </label>
      </section>

      <LogoCard />
      <UsersCard />
    </div>
  );
}
