"use client";

/**
 * Notificador global (montado en AppChrome): vigila el guardián anti-bloqueo
 * de Meta y, cuando entra en ENFRIAMIENTO (Meta limita la cuenta), avisa por
 * VOZ con la voz de Sonia (ElevenLabs). Cae a la voz del navegador si
 * ElevenLabs no está disponible. Cada enfriamiento se anuncia una sola vez.
 */

import { useEffect, useRef } from "react";

const LS_KEY = "meta-cooldown-voiced-until";
const POLL_MS = 60_000;

export default function MetaCooldownVoiceNotifier() {
  const busy = useRef(false);

  useEffect(() => {
    let stop = false;

    async function announce(minutes: number) {
      // 1) Voz de Sonia (ElevenLabs) vía endpoint.
      try {
        const r = await fetch("/api/v1/meta/guard-speak", { cache: "no-store" });
        if (r.ok && r.status === 200) {
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          await audio.play();
          audio.onended = () => URL.revokeObjectURL(url);
          return;
        }
      } catch {
        // autoplay bloqueado o error → fallback abajo
      }
      // 2) Fallback: voz del navegador.
      try {
        const msg = new SpeechSynthesisUtterance(
          `Atención. Meta está limitando la cuenta de anuncios. He pausado las publicaciones. Espera unos ${minutes} minutos antes de publicar en Meta.`
        );
        msg.lang = "es-ES";
        window.speechSynthesis?.speak(msg);
      } catch {
        // sin TTS disponible: nada que hacer
      }
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
        await announce(Math.max(1, Math.ceil((s.cooldownMsLeft ?? 0) / 60000)));
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
  }, []);

  return null;
}
