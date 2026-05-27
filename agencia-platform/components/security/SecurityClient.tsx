"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldOff,
  Loader2,
  KeyRound,
  Copy,
  CheckCircle2,
  AlertCircle,
  Mail
} from "lucide-react";

type TotpStatus = {
  enabled: boolean;
  enabledAt: string | null;
  backupCodes: { total: number; used: number; remaining: number };
};

type Me = {
  user: { email: string; emailVerified: string | null; totpEnabledAt: string | null };
};

export default function SecurityClient() {
  const [me, setMe] = useState<Me | null>(null);
  const [totp, setTotp] = useState<TotpStatus | null>(null);

  async function reload() {
    const [m, t] = await Promise.all([
      fetch("/api/v1/me").then((r) => r.json()),
      fetch("/api/v1/me/totp/status").then((r) => r.json())
    ]);
    setMe(m);
    setTotp(t);
  }
  useEffect(() => { reload(); }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Seguridad de la cuenta</h1>
        <p className="text-sm text-slate-500 mt-1">
          Protege tu acceso con verificación en dos pasos y supervisa los dispositivos conectados.
        </p>
      </div>

      <EmailVerificationCard me={me} onChange={reload} />
      <TotpCard totp={totp} userEmail={me?.user.email} onChange={reload} />
      <SessionsCard />
    </div>
  );
}

// -------------------------------------------------------------
// EMAIL VERIFICATION
// -------------------------------------------------------------
function EmailVerificationCard({ me, onChange }: { me: Me | null; onChange: () => void }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const verified = !!me?.user.emailVerified;

  async function sendAgain() {
    setSending(true);
    setSent(null);
    try {
      const r = await fetch("/api/v1/me/email/verify/request", { method: "POST" });
      const j = await r.json();
      if (j.ok && j.sent) setSent("Email enviado. Revisa tu bandeja.");
      else if (j.ok && !j.sent && j.debugUrl) setSent(`(dev) Abre: ${j.debugUrl}`);
      else setSent("Ya tienes el email verificado.");
      onChange();
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className={`h-10 w-10 grid place-items-center rounded-lg ${verified ? "bg-emerald-100" : "bg-amber-100"}`}>
          <Mail className={`h-5 w-5 ${verified ? "text-emerald-700" : "text-amber-700"}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">Verificación de email</h2>
            {verified ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Verificado</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Pendiente</span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">
            {verified
              ? `${me?.user.email} está confirmado.`
              : `Confirma ${me?.user.email ?? "tu email"} para recuperar la cuenta si pierdes la contraseña.`}
          </p>
          {!verified && (
            <button
              onClick={sendAgain}
              disabled={sending}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Enviar email de verificación
            </button>
          )}
          {sent && <div className="mt-2 text-xs text-emerald-700">{sent}</div>}
        </div>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------
// TOTP (2FA)
// -------------------------------------------------------------
function TotpCard({
  totp,
  userEmail,
  onChange
}: {
  totp: TotpStatus | null;
  userEmail?: string;
  onChange: () => void;
}) {
  const enabled = totp?.enabled ?? false;
  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className={`h-10 w-10 grid place-items-center rounded-lg ${enabled ? "bg-emerald-100" : "bg-slate-100"}`}>
          {enabled ? <ShieldCheck className="h-5 w-5 text-emerald-700" /> : <ShieldOff className="h-5 w-5 text-slate-500" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">Verificación en dos pasos (2FA)</h2>
            {enabled ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Activo</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">Inactivo</span>
            )}
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Con 2FA, además de tu contraseña hace falta un código de 6 dígitos de tu authenticator
            (Google Authenticator, 1Password, Authy…). Sin esto, una contraseña filtrada compromete
            todo tu workspace.
          </p>

          {enabled ? (
            <TotpEnabledControls totp={totp!} onChange={onChange} />
          ) : (
            <TotpEnrollFlow userEmail={userEmail} onDone={onChange} />
          )}
        </div>
      </div>
    </Card>
  );
}

function TotpEnrollFlow({ userEmail, onDone }: { userEmail?: string; onDone: () => void }) {
  type Step = "idle" | "scanning" | "confirming" | "showing-codes";
  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState<string>("");
  const [qrDataUri, setQrDataUri] = useState<string>("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/me/totp/start", { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Error");
      setSecret(j.secret);
      setQrDataUri(j.qrDataUri);
      setStep("scanning");
    } catch (e: any) {
      setError(e?.message ?? "No se pudo iniciar");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/me/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Código inválido");
      setBackupCodes(j.backupCodes);
      setStep("showing-codes");
    } catch (e: any) {
      setError(e?.message ?? "Código inválido");
    } finally {
      setBusy(false);
    }
  }

  if (step === "idle") {
    return (
      <div className="mt-3">
        <button
          onClick={start}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <ShieldCheck className="h-3.5 w-3.5" />
          Activar 2FA
        </button>
        {error && <div className="mt-2 text-xs text-rose-700">{error}</div>}
      </div>
    );
  }

  if (step === "scanning" || step === "confirming") {
    return (
      <div className="mt-4 p-4 rounded-lg border bg-slate-50 space-y-3">
        <div className="text-sm font-medium text-slate-900">
          Paso 1: escanea el código en tu authenticator
        </div>
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          {qrDataUri && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUri} alt="QR para 2FA" className="bg-white rounded p-2 shadow" />
          )}
          <div className="text-xs text-slate-600 space-y-2 flex-1">
            <div>
              ¿No puedes escanear? Introduce este código manualmente:
              <code className="block mt-1 p-2 rounded bg-white border font-mono text-[11px] break-all">
                {secret}
              </code>
            </div>
            <div className="text-slate-500">
              Issuer: <strong>Hub</strong> · Cuenta: <strong>{userEmail}</strong>
            </div>
          </div>
        </div>
        <hr className="my-2" />
        <div className="text-sm font-medium text-slate-900">
          Paso 2: introduce el código de 6 dígitos
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
            className="px-3 py-2 rounded-lg border text-center font-mono tracking-widest w-32"
          />
          <button
            onClick={confirm}
            disabled={busy || code.length !== 6}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirmar
          </button>
        </div>
        {error && <div className="text-xs text-rose-700">{error}</div>}
      </div>
    );
  }

  if (step === "showing-codes") {
    return (
      <div className="mt-4 p-4 rounded-lg border-2 border-amber-300 bg-amber-50 space-y-3">
        <div className="flex items-center gap-2 text-amber-900">
          <AlertCircle className="h-5 w-5" />
          <span className="font-semibold">Guarda estos códigos de recuperación AHORA</span>
        </div>
        <p className="text-xs text-amber-800">
          Son tu única forma de entrar si pierdes el authenticator. Cada uno se usa una sola vez.
          No volverás a verlos.
        </p>
        <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-white rounded p-3 border">
          {backupCodes.map((c) => (
            <div key={c} className="px-2 py-1">{c}</div>
          ))}
        </div>
        <div className="flex gap-2">
          <CopyButton text={backupCodes.join("\n")} label="Copiar todos" />
          <button
            onClick={() => { onDone(); setStep("idle"); }}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
          >
            Ya los he guardado, continuar
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function TotpEnabledControls({ totp, onChange }: { totp: TotpStatus; onChange: () => void }) {
  const [confirmCode, setConfirmCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/v1/me/totp/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: confirmCode })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Código inválido");
      setShow(false);
      setConfirmCode("");
      onChange();
    } catch (e: any) {
      setError(e?.message ?? "Código inválido");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="text-xs text-slate-600">
        Activado el {totp.enabledAt ? new Date(totp.enabledAt).toLocaleDateString() : "—"}.
        Códigos de recuperación: {totp.backupCodes.remaining} / {totp.backupCodes.total} sin usar.
      </div>
      {!show ? (
        <button
          onClick={() => setShow(true)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 text-sm font-medium"
        >
          <ShieldOff className="h-3.5 w-3.5" />
          Desactivar 2FA
        </button>
      ) : (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 space-y-2">
          <div className="text-xs text-rose-900">
            Introduce un código de 6 dígitos o de recuperación para confirmar la desactivación.
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              placeholder="123456"
              className="px-3 py-2 rounded-lg border text-center font-mono tracking-widest flex-1"
            />
            <button
              onClick={disable}
              disabled={busy || !confirmCode}
              className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Desactivar
            </button>
            <button
              onClick={() => { setShow(false); setConfirmCode(""); setError(null); }}
              className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
          </div>
          {error && <div className="text-xs text-rose-700">{error}</div>}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------
// SESSIONS
// -------------------------------------------------------------
type SessionRow = {
  id: string;
  sid: string;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
};

function SessionsCard() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/v1/me/sessions");
    if (r.ok) {
      const j = await r.json();
      setSessions(j.sessions ?? []);
    }
  }
  useEffect(() => { load(); }, []);

  async function revoke(sid: string) {
    setBusy(true);
    await fetch(`/api/v1/me/sessions/${sid}`, { method: "DELETE" });
    await load();
    setBusy(false);
  }
  async function revokeAllOthers() {
    setBusy(true);
    await fetch("/api/v1/me/sessions?others=1", { method: "DELETE" });
    await load();
    setBusy(false);
  }

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 grid place-items-center rounded-lg bg-slate-100">
          <KeyRound className="h-5 w-5 text-slate-700" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-slate-900">Sesiones activas</h2>
          <p className="text-sm text-slate-600 mt-1">
            Dispositivos donde tu cuenta tiene sesión abierta. Revoca cualquiera que no
            reconozcas.
          </p>

          {sessions === null && (
            <div className="mt-3 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
            </div>
          )}

          {sessions && sessions.length === 0 && (
            <div className="mt-3 text-sm text-slate-500">
              No hay sesiones registradas (todavía). Inicia sesión otra vez para empezar el tracking.
            </div>
          )}

          {sessions && sessions.length > 0 && (
            <>
              <div className="mt-3 divide-y border rounded-lg">
                {sessions.map((s) => (
                  <div key={s.id} className="p-3 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {s.deviceLabel || "Dispositivo desconocido"}
                        {s.current && (
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                            esta sesión
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {s.ip ?? "—"} · última actividad {new Date(s.lastSeenAt).toLocaleString()}
                      </div>
                    </div>
                    {!s.current && (
                      <button
                        onClick={() => revoke(s.sid)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-medium disabled:opacity-50"
                      >
                        Revocar
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {sessions.length > 1 && (
                <button
                  onClick={revokeAllOthers}
                  disabled={busy}
                  className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium disabled:opacity-50"
                >
                  Revocar todas las otras sesiones
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------
// helpers
// -------------------------------------------------------------
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      {children}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border text-sm hover:bg-slate-50"
    >
      {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {done ? "Copiado" : label}
    </button>
  );
}
