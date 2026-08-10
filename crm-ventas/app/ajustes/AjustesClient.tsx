"use client";

import { useEffect, useState } from "react";
import BusinessPhoneCard from "@/components/BusinessPhoneCard";
import WahaConnectionCard from "@/components/WahaConnectionCard";
import UsersCard from "@/components/UsersCard";
import LogoCard from "@/components/LogoCard";
import GoogleCalendarCard from "@/components/GoogleCalendarCard";

type SettingsData = {
  sonia: {
    agentName: string;
    websiteUrl: string;
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
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzedLogo, setAnalyzedLogo] = useState<string | null>(null);
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

  function changeAgentName(value: string) {
    setData((current) => {
      if (!current) return current;
      const previous = current.sonia.agentName || "Paula";
      const firstMessage = current.sonia.firstMessage.replace(
        /^(Hola, soy )[^,]+,/i,
        `$1${value || previous},`
      );
      return {
        ...current,
        sonia: { ...current.sonia, agentName: value, firstMessage },
      };
    });
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
    if (analyzedLogo) {
      const [header, encoded] = analyzedLogo.split(",", 2);
      const mime = header.match(/^data:([^;]+);base64$/)?.[1];
      if (mime && encoded) {
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
        const form = new FormData();
        form.append("logo", new File([bytes], "logo-web", { type: mime }));
        const logoResponse = await fetch("/api/v1/settings/logo", { method: "POST", body: form });
        if (!logoResponse.ok) {
          setError("Los textos se guardaron, pero no se pudo guardar el logo detectado.");
          return;
        }
        setAnalyzedLogo(null);
        window.dispatchEvent(new Event("business-logo-changed"));
      }
    }
    setSaved(true);
    window.dispatchEvent(
      new CustomEvent("agent-name-changed", { detail: data.sonia.agentName.trim() })
    );
    setTimeout(() => setSaved(false), 2000);
  }

  async function analyzeWebsite() {
    if (!data) return;
    const url = data.sonia.websiteUrl.trim();
    if (!url) {
      setError("Introduce primero la página web del negocio.");
      return;
    }
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/settings/analyze-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, agentName: data.sonia.agentName }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok) throw new Error(result?.error || "No se pudo analizar la web.");
      setData((current) =>
        current
          ? {
              ...current,
              sonia: {
                ...current.sonia,
                websiteUrl: result.websiteUrl,
                businessName: result.businessName || current.sonia.businessName,
                businessInfo: result.businessInfo,
                promptExtra: result.promptExtra,
                firstMessage: result.firstMessage,
              },
            }
          : current
      );
      setAnalyzedLogo(result.logoDataUrl ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo analizar la web.");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Ajustes de {data.sonia.agentName}</h1>
        <button className="btn-primary w-full sm:w-auto" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar cambios"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="card p-4 sm:p-6">
        <Field
          label="NOMBRE DEL AGENTE IA"
          hint="Este nombre se actualizará en el asistente de llamadas, WhatsApp y el CRM."
        >
          <input
            className="input"
            value={data.sonia.agentName}
            onChange={(e) => changeAgentName(e.target.value)}
            placeholder="Paula"
            maxLength={50}
          />
        </Field>
        {analyzedLogo && (
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={analyzedLogo} alt="Logo detectado" className="h-12 w-12 rounded-lg object-contain" />
            Logo detectado. Se aplicará al guardar los cambios.
          </div>
        )}
      </section>

      <section className="card space-y-4 p-4 sm:p-6">
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
          label="Página web de la empresa"
          hint="Analizaremos las páginas públicas del sitio para preparar una propuesta que podrás revisar antes de guardar."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input flex-1"
              type="url"
              value={data.sonia.websiteUrl}
              onChange={(e) => patchSonia("websiteUrl", e.target.value)}
              placeholder="https://www.miempresa.com"
            />
            <button type="button" className="btn-primary w-full whitespace-nowrap sm:w-auto" onClick={analyzeWebsite} disabled={analyzing}>
              {analyzing ? "Analizando…" : "Analizar web y preparar agente"}
            </button>
          </div>
        </Field>
        <Field
          label="Información del negocio"
          hint={`Todo lo que ${data.sonia.agentName} puede contar: servicios, precios, dirección, preguntas frecuentes…`}
        >
          <textarea
            className="input"
            rows={6}
            value={data.sonia.businessInfo}
            onChange={(e) => patchSonia("businessInfo", e.target.value)}
          />
        </Field>
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

      <section className="card space-y-4 p-4 sm:p-6">
        <h2 className="font-semibold">Llamadas (Vapi)</h2>
        <Field label="Saludo inicial de la llamada">
          <input
            className="input"
            value={data.sonia.firstMessage}
            onChange={(e) => patchSonia("firstMessage", e.target.value)}
          />
        </Field>
        <p className="text-xs text-slate-500">
          {data.sonia.agentName} detecta y atiende en español, inglés, francés, alemán e italiano. Los resúmenes se guardan siempre en español.
        </p>
        <BusinessPhoneCard />
      </section>

      <section className="card space-y-4 p-4 sm:p-6">
        <h2 className="font-semibold">WhatsApp</h2>
        <WahaConnectionCard />
        <div className="grid gap-4 sm:grid-cols-2">
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
          {data.sonia.agentName.toUpperCase()} responde automáticamente a los mensajes entrantes
        </label>
      </section>

      <GoogleCalendarCard />
      <LogoCard />
      <UsersCard />
    </div>
  );
}
