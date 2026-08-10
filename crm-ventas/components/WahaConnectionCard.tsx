"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentName } from "@/components/AgentNameContext";

type Connection = {
  configured: boolean;
  session: string;
  status: string;
  phone: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  NOT_CONFIGURED: "Sin configurar",
  NO_SESSION: "Sin sesión",
  STOPPED: "Parada",
  STARTING: "Arrancando…",
  SCAN_QR_CODE: "Esperando QR",
  WORKING: "Conectado",
  FAILED: "Con error",
};

// Autoservicio de la sesión de WhatsApp del workspace. El QR llega por un
// proxy same-origin del CRM: la URL y la API key de WAHA nunca tocan el
// navegador. El nombre de sesión lo decide el servidor (paula-<workspace>).
export default function WahaConnectionCard() {
  const agentName = useAgentName();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qrKey, setQrKey] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/settings/waha-connection", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) {
      setForbidden(true);
      return null;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "No se pudo consultar el estado");
      return null;
    }
    setError("");
    setConnection(data.connection);
    return data.connection as Connection;
  }, []);

  // Sondeo: cada 4s mientras la sesión está arrancando o esperando QR (y de
  // paso se refresca la imagen del QR); si no, una consulta al montar.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const transitional =
      connection && ["STARTING", "SCAN_QR_CODE"].includes(connection.status);
    if (timer.current) clearInterval(timer.current);
    timer.current = transitional
      ? setInterval(() => {
          void load();
          setQrKey((k) => k + 1);
        }, 4000)
      : null;
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [connection, load]);

  async function mutate(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/settings/waha-connection", { method });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Operación fallida");
      if (data?.connection) setConnection(data.connection);
      else await load();
      setQrKey((k) => k + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operación fallida");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function unlinkAndRenew() {
    if (
      !confirm(
        "Se desvinculará el WhatsApp actual de este negocio y se generará un QR nuevo. ¿Continuar?"
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const del = await fetch("/api/v1/settings/waha-connection", { method: "DELETE" });
      const delData = await del.json().catch(() => null);
      if (!del.ok) throw new Error(delData?.error || "No se pudo desvincular");
      const post = await fetch("/api/v1/settings/waha-connection", { method: "POST" });
      const postData = await post.json().catch(() => null);
      if (!post.ok) throw new Error(postData?.error || "No se pudo generar el QR nuevo");
      if (postData?.connection) setConnection(postData.connection);
      setQrKey((k) => k + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Operación fallida");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-500">
        La conexión de WhatsApp la gestiona un administrador del workspace.
      </div>
    );
  }

  const status = connection?.status ?? "";
  const showQr = status === "SCAN_QR_CODE";

  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">Vincular WhatsApp de este negocio</p>
          <p className="text-xs text-slate-500">
            Sesión propia del negocio, creada y gestionada por el CRM.
          </p>
        </div>
        {connection && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
            {STATUS_LABEL[status] ?? status}
          </span>
        )}
      </div>

      {connection && !connection.configured && (
        <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          El servicio de WhatsApp de este negocio aún no está aprovisionado.
          Contacta con Negocio Vivo para activarlo.
        </p>
      )}

      {status === "WORKING" && (
        <div className="mt-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          WhatsApp conectado{connection?.phone ? <> con el número <b>+{connection.phone}</b></> : null}.
          {agentName} ya puede recibir y responder mensajes.
        </div>
      )}

      {showQr && (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-md bg-slate-50 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={qrKey}
            src={`/api/v1/settings/waha-connection/qr?t=${qrKey}`}
            alt="QR para vincular WhatsApp"
            className="h-52 w-52 rounded-md bg-white p-2"
          />
          <p className="text-center text-xs text-slate-500">
            En el móvil del negocio: WhatsApp → Dispositivos vinculados →
            Vincular dispositivo, y escanea este QR. El código se renueva solo.
          </p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {connection?.configured && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy} onClick={() => mutate("POST")}>
            {busy ? "Un momento…" : status === "WORKING" ? "Reiniciar sesión" : "Generar/Renovar QR"}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={unlinkAndRenew}>
            Desvincular y generar otro QR
          </button>
        </div>
      )}
    </div>
  );
}
