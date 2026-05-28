"use client";

/**
 * Enlace de invitación: /bipi/r/<code>
 * Guarda el código de referido y manda al alta de la app.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ReferralLanding() {
  const params = useParams() as { code: string };
  const router = useRouter();

  useEffect(() => {
    try {
      if (params.code) localStorage.setItem("bipi.ref", params.code);
    } catch {}
    router.replace(`/bipi/app?ref=${encodeURIComponent(params.code ?? "")}`);
  }, [params.code, router]);

  return (
    <main className="max-w-md mx-auto px-4 py-20 text-center">
      <h1 className="bipi-wordmark mx-auto justify-center" style={{ fontSize: 56 }}>bipi</h1>
      <p className="text-black/60 mt-4">Un amigo te invita a Bipi 🎁</p>
      <p className="text-black/45 text-sm mt-1">Llevándote un cupón de bienvenida. Te llevamos al registro…</p>
    </main>
  );
}
