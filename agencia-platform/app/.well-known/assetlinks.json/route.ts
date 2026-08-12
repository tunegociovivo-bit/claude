/**
 * Android App Links (Digital Asset Links). Asocia el dominio (bubui.app y
 * hub.negociovivo.app — mismo deploy) con la app, para que enlaces como
 * https://bubui.app/reto/<token> abran la app SIN el "¿abrir con…?" y sin rebotar
 * al navegador. Es lo que Play Console reclama con "tus dominios web no están
 * asociados a tu aplicación".
 *
 * Configúralo con la env (Railway):
 *   ANDROID_SHA256_FINGERPRINT = "AA:BB:..."   (una o VARIAS, separadas por coma)
 *
 * IMPORTANTE: con **Play App Signing**, Google RE-FIRMA la app. La huella que
 * Android verifica en producción es la del **certificado de la clave de firma de
 * la app** (Play Console → Integridad de la app → Certificado de la clave de
 * firma de la app → SHA-256), NO la de la clave de SUBIDA. Para que verifiquen
 * TAMBIÉN los APK de prueba interna (firmados con la clave de subida), incluye
 * ambas huellas separadas por coma:
 *   ANDROID_SHA256_FINGERPRINT = "<APP_SIGNING_SHA256>,<UPLOAD_SHA256>"
 *
 * Hasta configurarla devuelve 404 (no rompe nada; el esquema bubui:// sigue
 * funcionando vía la página puente).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ANDROID_PACKAGE = "com.negociovivo.bubui";

/** Normaliza y valida huellas SHA-256 (32 bytes hex en mayúsculas, separados por ':'). */
export function parseFingerprints(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
}

/** Cuerpo del assetlinks.json para las huellas dadas (vacío si no hay ninguna). */
export function buildAssetlinks(fingerprints: string[]): unknown[] {
  if (fingerprints.length === 0) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints
      }
    }
  ];
}

export async function GET() {
  const fingerprints = parseFingerprints(process.env.ANDROID_SHA256_FINGERPRINT);
  if (fingerprints.length === 0) {
    return new NextResponse("Not configured", { status: 404 });
  }
  return new NextResponse(JSON.stringify(buildAssetlinks(fingerprints)), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
