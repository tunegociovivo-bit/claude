"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50" />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Falta el token en la URL.");
      return;
    }
    fetch("/api/v1/me/email/verify/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          setState("ok");
          setTimeout(() => router.push("/"), 1500);
        } else {
          setState("error");
          setMessage(j?.error?.message ?? "No se pudo verificar el email.");
        }
      })
      .catch(() => {
        setState("error");
        setMessage("Error de red al verificar el email.");
      });
  }, [token, router]);

  return (
    <div className="min-h-screen bg-slate-50 grid place-items-center px-4">
      <div className="bg-white rounded-xl shadow-lg border max-w-md w-full p-8 text-center">
        {state === "loading" && (
          <>
            <Loader2 className="h-10 w-10 text-brand-600 animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900">Verificando email…</h1>
          </>
        )}
        {state === "ok" && (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-600 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-1">Email verificado</h1>
            <p className="text-sm text-slate-600">Te llevamos al panel…</p>
          </>
        )}
        {state === "error" && (
          <>
            <XCircle className="h-12 w-12 text-rose-600 mx-auto mb-4" />
            <h1 className="text-lg font-semibold text-slate-900 mb-1">No se pudo verificar</h1>
            <p className="text-sm text-slate-600 mb-4">{message}</p>
            <Link
              href="/perfil"
              className="inline-block px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
            >
              Ir al perfil para reenviar
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
