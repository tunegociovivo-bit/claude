"use client";

/**
 * Captura el código de referido de la URL (?ref=CODE) cuando un amigo llega
 * a la página pública del negocio a través de una oferta compartida, y lo
 * guarda en localStorage `bubui.ref`. El alta del cliente (app/page.tsx) lo
 * lee para acreditar al que invitó. No renderiza nada.
 */

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function RefCapture() {
  const params = useSearchParams();
  useEffect(() => {
    const ref = params.get("ref");
    if (ref) {
      try {
        localStorage.setItem("bubui.ref", ref);
      } catch {}
    }
  }, [params]);
  return null;
}
