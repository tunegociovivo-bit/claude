import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { userCanAccessPlatform } from "@/lib/platforms-server";

const SCRCPY_SERVER_URL =
  "https://github.com/Genymobile/scrcpy/releases/download/v3.3.3/scrcpy-server-v3.3.3";
const SCRCPY_SERVER_SHA256 =
  "7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0";
const SCRCPY_SERVER_MAX_BYTES = 1_000_000;

export const dynamic = "force-dynamic";

export const GET = withApi({ scope: "*" }, async (_req, { api }) => {
  if (
    !api.userId ||
    !(await userCanAccessPlatform(api.workspaceId, api.userId, "mobile_farm"))
  ) {
    throw new ApiError(403, "forbidden", "No tienes acceso a F - Móviles");
  }

  let upstream: Response;
  try {
    upstream = await fetch(SCRCPY_SERVER_URL, {
      cache: "force-cache",
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new ApiError(
      502,
      "scrcpy_download_failed",
      "No se ha podido preparar el servicio de pantalla del móvil"
    );
  }
  if (!upstream.ok) {
    throw new ApiError(
      502,
      "scrcpy_download_failed",
      "No se ha podido preparar el servicio de pantalla del móvil"
    );
  }

  const binary = Buffer.from(await upstream.arrayBuffer());
  if (binary.byteLength > SCRCPY_SERVER_MAX_BYTES) {
    throw new ApiError(
      502,
      "scrcpy_download_too_large",
      "El servicio de pantalla descargado no tiene un tamaño válido"
    );
  }
  const digest = createHash("sha256").update(binary).digest("hex");
  if (digest !== SCRCPY_SERVER_SHA256) {
    throw new ApiError(
      502,
      "scrcpy_integrity_failed",
      "La verificación de seguridad del servicio de pantalla ha fallado"
    );
  }

  return new NextResponse(binary, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(binary.byteLength),
      "Cache-Control": "private, max-age=86400",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
});
