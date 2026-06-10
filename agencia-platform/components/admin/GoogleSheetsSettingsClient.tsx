"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  ExternalLink,
  Copy,
  Sheet
} from "lucide-react";

type Status = {
  configured: boolean;
  usingDriveServiceAccount: boolean;
  serviceAccountEmail: string | null;
};

type TestResult =
  | { ok: true; serviceAccountEmail: string; title: string; tabs: string[] }
  | { ok: false; error: string };

export default function GoogleSheetsSettingsClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [json, setJson] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [spreadsheet, setSpreadsheet] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/v1/admin/google-sheets", { cache: "no-store" });
      if (r.ok) setStatus(await r.json());
    } catch {}
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    const trimmed = json.trim();
    if (trimmed.length < 50) {
      setMsg({ kind: "err", text: "Pega el service_account.json completo." });
      return;
    }
    // Validación rápida en cliente antes de mandarlo.
    try {
      const sa = JSON.parse(trimmed);
      if (!sa.client_email || !sa.private_key) {
        setMsg({ kind: "err", text: "El JSON no tiene client_email o private_key." });
        return;
      }
    } catch {
      setMsg({ kind: "err", text: "El JSON no es válido (revisa que esté completo)." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/google-sheets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceAccountJson: trimmed })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ kind: "err", text: data?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setJson("");
      setMsg({ kind: "ok", text: "Service account guardado y cifrado." });
      await load();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "Error al guardar" });
    } finally {
      setSaving(false);
    }
  }

  async function clearSa() {
    if (!confirm("¿Borrar el service account de Sheets? Si tienes Drive configurado, se reusará ese.")) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/google-sheets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceAccountJson: null })
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setMsg({ kind: "err", text: data?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setMsg({ kind: "ok", text: "Service account propio de Sheets borrado." });
      setTest(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    if (spreadsheet.trim().length < 5) {
      setMsg({ kind: "err", text: "Pega el ID o la URL de una hoja para probar." });
      return;
    }
    setTesting(true);
    setTest(null);
    try {
      const r = await fetch("/api/v1/admin/google-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", spreadsheet: spreadsheet.trim() })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTest({ ok: false, error: data?.error?.message ?? `Error ${r.status}` });
        return;
      }
      setTest(data as TestResult);
    } catch (e: any) {
      setTest({ ok: false, error: e?.message ?? "Error en la prueba" });
    } finally {
      setTesting(false);
    }
  }

  function copyEmail() {
    if (!status?.serviceAccountEmail) return;
    navigator.clipboard?.writeText(status.serviceAccountEmail).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-5">
      {/* Estado */}
      <div className="bg-white border rounded-xl p-4">
        {status == null ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Comprobando estado…
          </div>
        ) : status.configured ? (
          <div className="flex items-start gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">Google Sheets configurado.</div>
              <div className="text-xs text-emerald-600 mt-0.5 break-words">
                {status.usingDriveServiceAccount
                  ? "Reusando el service account de Google Drive."
                  : "Service account propio de Sheets."}
              </div>
              {status.serviceAccountEmail && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="text-xs bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 break-all">
                    {status.serviceAccountEmail}
                  </code>
                  <button
                    onClick={copyEmail}
                    className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
                  >
                    <Copy className="h-3 w-3" /> {copied ? "Copiado" : "Copiar email"}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-sm text-slate-600">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
            <div>Aún no hay ningún service account configurado para Sheets.</div>
          </div>
        )}
      </div>

      {/* Paso clave: compartir la hoja */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 space-y-1">
        <div className="font-medium flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Importante: comparte la hoja con el service account
        </div>
        <p className="text-xs leading-relaxed">
          La cuenta de servicio solo puede leer/escribir hojas que hayas{" "}
          <strong>compartido con su email</strong> (el{" "}
          <code className="bg-amber-100 rounded px-1">…@…iam.gserviceaccount.com</code> de arriba) con permiso de{" "}
          <strong>Editor</strong>. Sin ese paso, dará error 403/404 aunque la credencial sea correcta.
        </p>
      </div>

      {/* Formulario: pegar el JSON */}
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-brand-600" /> service_account.json
        </label>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder={
            status?.configured
              ? '{ "type": "service_account", … }  (ya configurado — pega uno nuevo para reemplazar)'
              : 'Pega aquí el JSON completo del service account de Google Cloud'
          }
          rows={8}
          spellCheck={false}
          className="w-full px-3 py-2 rounded-lg border bg-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 resize-y"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 bg-brand-600 text-white text-sm px-3 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Guardar
          </button>
          {status?.configured && !status.usingDriveServiceAccount && (
            <button
              onClick={clearSa}
              disabled={saving}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Borrar
            </button>
          )}
          {msg && (
            <span className={`text-xs ${msg.kind === "ok" ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Se guarda <strong>cifrado</strong> (AES-256-GCM) y solo lo usa el servidor. Equivale a usar{" "}
          <code className="bg-slate-100 rounded px-1">gspread</code> con la cuenta de servicio: Sonia podrá leer y
          escribir en las hojas que compartas con su email.
        </p>
      </div>

      {/* Probar conexión a una hoja */}
      <div className="bg-white border rounded-xl p-4 space-y-3">
        <label className="flex items-center gap-1.5 text-sm font-medium">
          <Sheet className="h-4 w-4 text-brand-600" /> Probar acceso a una hoja
        </label>
        <input
          value={spreadsheet}
          onChange={(e) => setSpreadsheet(e.target.value)}
          placeholder="Pega el ID o la URL de la hoja (https://docs.google.com/spreadsheets/d/…)"
          className="w-full px-3 py-2 rounded-lg border bg-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          onClick={runTest}
          disabled={testing || !status?.configured}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Probar conexión
        </button>
        {test && test.ok && (
          <div className="flex items-start gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Acceso correcto a «{test.title}».</div>
              <div className="text-xs text-emerald-600 mt-0.5">
                Pestañas: {test.tabs.length ? test.tabs.join(", ") : "(sin pestañas)"}
              </div>
            </div>
          </div>
        )}
        {test && !test.ok && (
          <div className="flex items-start gap-2 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="break-words">{test.error}</div>
          </div>
        )}
      </div>

      {/* Ayuda */}
      <div className="bg-slate-50 border rounded-xl p-4 text-sm text-slate-600 space-y-1">
        <div className="font-medium text-slate-700">¿De dónde saco el service_account.json?</div>
        <p>
          En Google Cloud Console:{" "}
          <span className="font-medium">
            IAM y administración → Cuentas de servicio → (crear o elegir una) → Claves → Agregar clave → JSON
          </span>
          . Activa además la <span className="font-medium">Google Sheets API</span> en el proyecto.
        </p>
        <a
          href="https://console.cloud.google.com/iam-admin/serviceaccounts"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand-600 hover:underline"
        >
          Cuentas de servicio en Google Cloud <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
