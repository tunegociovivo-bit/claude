"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { Loader2, Mail, Save, CheckCircle2, AlertTriangle, Trash2, Plug } from "lucide-react";

type Account = {
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  loginUser: string;
};

export default function EmailAccountClient() {
  const [connected, setConnected] = useState(false);
  const [form, setForm] = useState<Account>({
    email: "",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    loginUser: ""
  });
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const r = await fetch("/api/v1/admin/email-account");
    if (r.ok) {
      const d = await r.json();
      setConnected(d.connected);
      if (d.account) {
        setForm({
          email: d.account.email,
          imapHost: d.account.imapHost,
          imapPort: d.account.imapPort,
          imapSecure: d.account.imapSecure,
          smtpHost: d.account.smtpHost,
          smtpPort: d.account.smtpPort,
          smtpSecure: d.account.smtpSecure,
          loginUser: d.account.loginUser
        });
      }
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof Account>(k: K, v: Account[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Autocompleta login con el email si está vacío
  function onEmailBlur() {
    if (!form.loginUser && form.email) set("loginUser", form.email);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/email-account", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, password: password || undefined })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error?.message ?? `Error ${r.status}`);
      }
      setPassword("");
      setMsg({ type: "ok", text: "Guardado." });
      await load();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await fetch("/api/v1/admin/email-account/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, password: password || undefined })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error?.message ?? `Error ${r.status}`);
      if (d.imap && d.smtp) {
        setMsg({ type: "ok", text: "✓ IMAP y SMTP conectan correctamente." });
      } else {
        setMsg({
          type: "err",
          text: `IMAP: ${d.imap ? "OK" : "fallo"} · SMTP: ${d.smtp ? "OK" : "fallo"}${d.error ? ` — ${d.error}` : ""}`
        });
      }
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message ?? String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    if (!confirm("¿Desconectar tu cuenta de correo? Sonia ya no podrá leer ni enviar emails por ti.")) return;
    await fetch("/api/v1/admin/email-account", { method: "DELETE" });
    setConnected(false);
    setPassword("");
    setMsg(null);
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        title="Mi correo (Sonia)"
        description="Conecta tu cuenta de correo (IMAP/SMTP) para que Sonia pueda buscar/leer tus emails y enviarlos cuando se lo pidas. Solo TÚ puedes usar tu correo desde tu sesión."
      />

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 mb-5 text-xs text-sky-900 flex items-start gap-2">
        <Plug className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Para hosting propio (cPanel): los datos IMAP/SMTP están en cPanel → Cuentas de correo → "Conectar
          dispositivos". Usa el email completo como usuario y, si tu proveedor lo soporta, crea una
          <strong> contraseña de aplicación</strong> en vez de tu contraseña principal.
        </span>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="bg-white rounded-xl border p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-brand-600" />
            <span className="font-semibold text-sm">
              {connected ? `Conectado: ${form.email}` : "Conectar cuenta"}
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
            <input
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              onBlur={onEmailBlur}
              placeholder="info@negociovivo.com"
              className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 rounded-lg border p-3">
              <div className="text-xs font-semibold text-slate-600">IMAP (recibir/leer)</div>
              <input
                value={form.imapHost}
                onChange={(e) => set("imapHost", e.target.value)}
                placeholder="mail.negociovivo.com"
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={form.imapPort}
                  onChange={(e) => set("imapPort", Number(e.target.value))}
                  className="w-24 px-3 py-2 rounded-lg border text-sm"
                />
                <label className="text-xs flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={form.imapSecure}
                    onChange={(e) => set("imapSecure", e.target.checked)}
                  />
                  SSL/TLS
                </label>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="text-xs font-semibold text-slate-600">SMTP (enviar)</div>
              <input
                value={form.smtpHost}
                onChange={(e) => set("smtpHost", e.target.value)}
                placeholder="mail.negociovivo.com"
                className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={form.smtpPort}
                  onChange={(e) => set("smtpPort", Number(e.target.value))}
                  className="w-24 px-3 py-2 rounded-lg border text-sm"
                />
                <label className="text-xs flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={form.smtpSecure}
                    onChange={(e) => set("smtpSecure", e.target.checked)}
                  />
                  SSL/TLS
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Usuario de login</label>
            <input
              value={form.loginUser}
              onChange={(e) => set("loginUser", e.target.value)}
              placeholder="info@negociovivo.com (normalmente el email completo)"
              className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Contraseña {connected && <span className="text-slate-400">(déjala vacía para mantener la actual)</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={connected ? "•••• guardada" : "Contraseña o app-password"}
              className="w-full px-3 py-2 rounded-lg border text-sm font-mono"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </button>
            <button
              onClick={test}
              disabled={testing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              Probar conexión
            </button>
            {connected && (
              <button
                onClick={disconnect}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-200 text-rose-600 text-sm hover:bg-rose-50 ml-auto"
              >
                <Trash2 className="h-4 w-4" />
                Desconectar
              </button>
            )}
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
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span>{msg.text}</span>
            </div>
          )}

          {connected && (
            <p className="text-xs text-slate-500 pt-2 border-t">
              Ya puedes pedirle a Sonia en el chat: <em>"¿tengo correos sin leer?"</em>,{" "}
              <em>"busca emails de [cliente]"</em>, <em>"envía un correo a X diciendo Y"</em>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
