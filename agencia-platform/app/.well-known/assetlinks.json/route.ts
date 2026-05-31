/**
 * Android App Links. Permite que el QR (https://hub.negociovivo.app/bubui/scan/...)
 * abra la app directamente sin el "¿abrir con…?". Se activa cuando configures:
 *   ANDROID_SHA256_FINGERPRINT = "AA:BB:CC:..."  (huella SHA-256 del certificado
 *   de firma del APK/AAB; la da Play Console → App signing, o keytool).
 * Hasta entonces devuelve 404 (no rompe nada; el deep link bubui:// sigue
 * funcionando vía la página puente).
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ANDROID_PACKAGE = "com.negociovivo.bubui";

export async function GET() {
  const fingerprint = process.env.ANDROID_SHA256_FINGERPRINT;
  if (!fingerprint) {
    return new NextResponse("Not configured", { status: 404 });
  }
  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE,
        sha256_cert_fingerprints: [fingerprint]
      }
    }
  ];
  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
