"use client";

/**
 * Redirección del enlace de invitación al alta de la app. Separada en cliente
 * para que la página (server) pueda generar metadata OG (preview rico en
 * WhatsApp).
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ReferralRedirect({ code }: { code: string }) {
  const router = useRouter();
  useEffect(() => {
    try {
      if (code) localStorage.setItem("bubui.ref", code);
    } catch {}
    router.replace(`/bubui/app?ref=${encodeURIComponent(code ?? "")}`);
  }, [code, router]);
  return null;
}
