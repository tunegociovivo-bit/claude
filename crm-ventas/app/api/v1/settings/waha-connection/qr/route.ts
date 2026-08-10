import { forbidden, requireWorkspaceAdmin, unauthorized } from "@/lib/auth";
import { WahaUrlNotAllowedError } from "@/lib/waha";
import { fetchQrPng, WahaSelfServiceError } from "@/lib/waha-connection";

export const dynamic = "force-dynamic";

// Proxy same-origin del QR de vinculación: el navegador nunca ve la URL de
// WAHA ni la API key. PNG ≤ 1MB, sin caché.
export async function GET() {
  try {
    const { workspaceId } = await requireWorkspaceAdmin();
    const png = await fetchQrPng(workspaceId);
    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
    if ((error as Error)?.message === "FORBIDDEN") return forbidden();
    if (error instanceof WahaUrlNotAllowedError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof WahaSelfServiceError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "QR no disponible" }, { status: 502 });
  }
}
