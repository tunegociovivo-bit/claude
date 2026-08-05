import {
  forbidden,
  isSameOrigin,
  requireWorkspaceAdmin,
  requireWorkspaceId,
  unauthorized,
} from "@/lib/auth";
import { getWorkspaceSettings, saveWorkspaceSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const MAX_LOGO_BYTES = 500 * 1024;

// El tipo real se decide por magic bytes; el content-type del navegador se
// ignora (es manipulable).
function sniffImageMime(buf: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function authError(error: unknown) {
  if ((error as Error)?.message === "UNAUTHORIZED") return unauthorized();
  if ((error as Error)?.message === "FORBIDDEN") return forbidden();
  return null;
}

// Cualquier usuario del workspace puede leer el logo (lo pinta el AppShell).
export async function GET() {
  try {
    const workspaceId = await requireWorkspaceId();
    const settings = await getWorkspaceSettings(workspaceId);
    return Response.json({
      logoDataUrl: settings.branding.logoDataUrl || null,
      businessName: settings.sonia.businessName || null,
    });
  } catch (error) {
    return authError(error) || Response.json({ error: "Error interno" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();

    const form = await request.formData().catch(() => null);
    const file = form?.get("logo");
    if (!(file instanceof Blob)) {
      return Response.json({ error: "Falta el archivo del logo" }, { status: 400 });
    }
    // Tamaño REAL de los bytes recibidos, no el que declare el cliente.
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_LOGO_BYTES) {
      return Response.json(
        { error: "El logo debe ocupar como máximo 500KB" },
        { status: 400 }
      );
    }
    const mime = sniffImageMime(buf);
    if (!mime) {
      return Response.json(
        { error: "Formato no válido: solo PNG, JPG o WebP" },
        { status: 400 }
      );
    }

    const logoDataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    await saveWorkspaceSettings(workspaceId, { branding: { logoDataUrl } });
    return Response.json({ ok: true, logoDataUrl });
  } catch (error) {
    return authError(error) ||
      Response.json({ error: "No se pudo guardar el logo" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isSameOrigin(request)) return forbidden();
    const { workspaceId } = await requireWorkspaceAdmin();
    await saveWorkspaceSettings(workspaceId, { branding: { logoDataUrl: "" } });
    return Response.json({ ok: true });
  } catch (error) {
    return authError(error) ||
      Response.json({ error: "No se pudo quitar el logo" }, { status: 500 });
  }
}
