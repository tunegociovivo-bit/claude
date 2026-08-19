"use client";

/**
 * Notificador global (montado en AppChrome): vigila el guardián anti-bloqueo
 * de Meta y, cuando entra en ENFRIAMIENTO (Meta limita la cuenta), avisa por
 * VOZ con la voz de Sonia (ElevenLabs). Cae a la voz del navegador si
 * ElevenLabs no está disponible. Cada enfriamiento se anuncia una sola vez.
 */

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { playSoniaBlob, speakSonia } from "@/lib/voice/sonia-audio";
import { buildMetaGuardAnnouncement } from "@/lib/integrations/meta-guard-message";

const LS_KEY = "meta-cooldown-voiced-until";
const POLL_MS = 60_000;

export default function MetaCooldownVoiceNotifier() {
  const busy = useRef(false);
  const { data: session, status } = useSession();
  const isAdmin = ((session?.user as any)?.role ?? "") === "ADMIN";

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    let stop = false;

    async function announce(minutes: number, reason?: string | null) {
      // 1) Voz de Sonia (ElevenLabs) vía endpoint — por la cola GLOBAL.
      try {
        const r = await fetch("/api/v1/meta/guard-speak", { cache: "no-store" });
        if (r.ok && r.status === 200) {
          const blob = await r.blob();
          await playSoniaBlob(blob);
          return;
        }
      } catch {
        // autoplay bloqueado o error → fallback abajo
      }
      // 2) Fallback: voz del navegador (también por la cola global).
      void speakSonia(
        buildMetaGuardAnnouncement({ minutes, reason })
      );
    }

    async function tick() {
      if (stop || busy.current) return;
      busy.current = true;
      try {
        const r = await fetch("/api/v1/admin/meta/guard-status", { cache: "no-store" });
        if (!r.ok) return;
        const s = await r.json();
        if (!s?.inCooldown || !s?.cooldownUntil) return;
        const already = Number(localStorage.getItem(LS_KEY) || "0");
        if (Number(s.cooldownUntil) === already) return; // ya avisado de este enfriamiento
        localStorage.setItem(LS_KEY, String(s.cooldownUntil));
        await announce(Math.max(1, Math.ceil((s.cooldownMsLeft ?? 0) / 60000)), s.cooldownReason);
      } catch {
        // silencio
      } finally {
        busy.current = false;
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [isAdmin, status]);

  return null;
}
