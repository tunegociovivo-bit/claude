"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("u1@agencia.local");
  const [password, setPassword] = useState("agencia123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("Credenciales incorrectas");
    } else {
      router.push("/");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white border rounded-2xl p-7">
        <div className="flex items-center gap-2 mb-6">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">Agencia Hub</div>
            <div className="text-xs text-slate-500">Plataforma interna</div>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-700">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">Contraseña</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        {process.env.NEXT_PUBLIC_HAS_GOOGLE === "1" && (
          <button
            onClick={() => signIn("google")}
            className="mt-3 w-full py-2 rounded-lg border bg-white hover:bg-slate-50 text-sm"
          >
            Entrar con Google
          </button>
        )}

        <p className="text-[11px] text-slate-400 mt-6 text-center">
          Tras el seed: u1@agencia.local / agencia123
        </p>
      </div>
    </div>
  );
}
