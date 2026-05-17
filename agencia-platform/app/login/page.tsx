"use client";

import { useEffect, useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Eye, EyeOff, Loader2, Mail, Lock, ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  // Cuando el back responde "TotpRequired", entramos en este modo:
  // el password se conserva en estado pero el form pide solo el código.
  const [totpStep, setTotpStep] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ws, setWs] = useState<{ name: string; logo: string | null }>({ name: "Hub", logo: null });

  useEffect(() => {
    fetch("/api/v1/workspace/public")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setWs({ name: d.name ?? "Hub", logo: d.logo ?? null });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get("error")) setError("Credenciales incorrectas o sesión caducada.");
  }, [searchParams]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      // Solo enviar totpCode si estamos en el paso 2
      totpCode: totpStep ? totpCode : "",
      redirect: false
    });
    setLoading(false);
    if (res?.error) {
      if (res.error === "TotpRequired") {
        setTotpStep(true);
        setError(null);
        return;
      }
      if (res.error === "TotpInvalid") {
        setError("Código 2FA incorrecto. Vuelve a intentarlo.");
        setTotpCode("");
        return;
      }
      if (res.error.startsWith("AccountLocked")) {
        const sec = parseInt(res.error.split(":")[1] ?? "900", 10);
        const min = Math.ceil(sec / 60);
        setError(
          `Demasiados intentos fallidos. Cuenta bloqueada temporalmente. ` +
            `Vuelve a intentarlo en ${min} minuto${min === 1 ? "" : "s"}.`
        );
      } else {
        setError("Email o contraseña incorrectos");
        setTotpStep(false);
      }
    } else {
      const callbackUrl = searchParams.get("callbackUrl") || "/";
      router.push(callbackUrl);
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50">
      {/* Panel izquierdo / superior — branding */}
      <div className="relative md:w-1/2 lg:w-2/5 bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white overflow-hidden">
        <div className="absolute inset-0 opacity-20" aria-hidden="true">
          <div className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-white blur-3xl" />
          <div className="absolute bottom-0 -right-32 h-[28rem] w-[28rem] rounded-full bg-brand-300 blur-3xl" />
        </div>

        <div className="relative flex flex-col h-full justify-between p-6 sm:p-8 md:p-12 lg:p-16 min-h-[200px] md:min-h-screen">
          <div className="flex items-center gap-3">
            {ws.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ws.logo}
                alt={ws.name}
                className="h-12 w-12 rounded-xl object-cover bg-white/10 ring-1 ring-white/20"
              />
            ) : (
              <div className="h-12 w-12 rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur grid place-items-center">
                <Sparkles className="h-6 w-6" />
              </div>
            )}
            <div className="leading-tight">
              <div className="text-lg md:text-xl font-semibold">{ws.name}</div>
              <div className="text-xs md:text-sm text-white/70">Plataforma interna de equipo</div>
            </div>
          </div>

          {/* Bloque marketing — oculto en móvil para ahorrar espacio */}
          <div className="hidden md:block max-w-md">
            <h1 className="text-3xl lg:text-4xl font-semibold tracking-tight leading-tight">
              Tu agencia trabajando en un solo sitio.
            </h1>
            <p className="mt-4 text-white/80 text-sm lg:text-base leading-relaxed">
              Tareas, clientes, calendario editorial, leads, reseñas con IA y reportes — todo conectado y accesible desde cualquier dispositivo.
            </p>

            <div className="mt-8 space-y-3">
              <Feature title="Multi-cliente y multi-proyecto" desc="Asigna a cada trabajador solo lo que tiene que ver." />
              <Feature title="IA integrada" desc="Genera contenido, resúmenes y borradores con Claude y GPT." />
              <Feature title="Seguro y respaldado" desc="Backups diarios automáticos y cifrado de credenciales." />
            </div>
          </div>

          <div className="hidden md:flex items-center gap-1.5 text-xs text-white/60">
            <ShieldCheck className="h-3.5 w-3.5" />
            Acceso restringido a miembros del workspace
          </div>
        </div>
      </div>

      {/* Panel derecho / inferior — formulario */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-slate-900 mb-1">Inicia sesión</h2>
          <p className="text-sm text-slate-500 mb-7">Accede con tu cuenta de trabajador.</p>

          <form onSubmit={submit} className="space-y-4">
            {!totpStep ? (
              <>
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    className="w-full px-3 py-2.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                      Contraseña
                    </label>
                    <a
                      href="mailto:soporte@negociovivo.com?subject=Reseteo%20de%20contrase%C3%B1a%20Hub"
                      className="text-xs text-brand-600 hover:underline"
                    >
                      ¿Olvidaste tu contraseña?
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2.5 pr-10 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded text-slate-400 hover:text-slate-700"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                  Código de verificación
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="6 dígitos del authenticator o código de recuperación"
                  className="w-full px-3 py-2.5 rounded-lg border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 font-mono tracking-widest text-center"
                />
                <button
                  type="button"
                  onClick={() => { setTotpStep(false); setTotpCode(""); setError(null); }}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-700"
                >
                  ← Volver a email + contraseña
                </button>
              </div>
            )}

            {error && (
              <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!totpStep && (!email || !password)) || (totpStep && !totpCode)}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-50 transition"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? (totpStep ? "Verificando…" : "Entrando…") : totpStep ? "Verificar" : "Entrar"}
            </button>
          </form>

          {process.env.NEXT_PUBLIC_HAS_GOOGLE === "1" && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] uppercase tracking-wide text-slate-400">o</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <button
                onClick={() => signIn("google")}
                className="w-full py-2.5 rounded-lg border bg-white hover:bg-slate-50 text-sm inline-flex items-center justify-center gap-2"
              >
                <GoogleIcon />
                Continuar con Google
              </button>
            </>
          )}

          <p className="mt-8 text-center text-xs text-slate-400">
            ¿No tienes cuenta? Pide a un administrador del workspace que te añada en{" "}
            <span className="text-slate-500">/admin/usuarios</span>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="h-7 w-7 rounded-lg bg-white/15 ring-1 ring-white/20 grid place-items-center shrink-0">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-white/70">{desc}</div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.8 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.5 4 10 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.9 39.6 16.4 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-3.9 5.4l6.2 5.2C41.4 35.5 44 30.2 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
