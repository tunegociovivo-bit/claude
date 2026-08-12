"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { loginDestination, type LoginDestination } from "@/lib/login-routing";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode = (submitter?.value === "admin" ? "admin" : "crm") as LoginDestination;
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Email o contraseña incorrectos");
      return;
    }
    const admin = mode === "admin"
      ? await fetch("/api/v1/admin/me", { cache: "no-store" }).catch(() => null)
      : null;
    router.push(loginDestination(mode, Boolean(admin?.ok)));
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <img
            src="https://www.negociovivo.com/wp-content/uploads/2020/08/negociovivo.png"
            alt="Negocio Vivo"
            className="mx-auto mb-3 h-16 w-16 rounded-2xl object-contain"
          />
          <h1 className="text-xl font-semibold">CRM Ventas</h1>
          <p className="text-sm text-slate-500">Recepcionista IA</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" name="destination" value="crm" className="btn-primary w-full justify-center" disabled={loading}>
            {loading ? "Entrando…" : "Entrar"}
          </button>
          <button type="submit" name="destination" value="admin" className="btn-ghost w-full justify-center" disabled={loading}>
            Administración general
          </button>
        </form>
      </div>
    </main>
  );
}
