/**
 * GET /api/v1/extension/download
 *
 * Devuelve un .zip con la última versión de la extensión de Chrome
 * (chrome-extension/) lista para instalar en sideload. El zip se
 * genera al vuelo desde los ficheros en disco — así cualquier cambio
 * en chrome-extension/ aparece en la siguiente descarga sin pre-build.
 *
 * Auth: requiere sesión (cualquier user logueado del workspace).
 * Las API keys también funcionan si el script lo descarga
 * programáticamente. NO es público — la extensión es interna.
 *
 * Headers de respuesta:
 *   Content-Type: application/zip
 *   Content-Disposition: attachment; filename="hub-extension-vX.Y.Z.zip"
 *
 * El nombre del fichero incluye la versión leída de manifest.json
 * para que el user sepa qué versión tiene instalada.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import archiver from "archiver";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 60s — un zip de ~30KB tarda <1s, pero curtimos por si el disco
// está lento en frío después de un deploy.
export const maxDuration = 60;

const EXT_DIR_NAME = "chrome-extension";

function findExtensionDir(): string {
  // En desarrollo y en standalone build viven en sitios distintos.
  // Probamos los dos paths más probables y devolvemos el primero
  // que exista.
  const candidates = [
    path.join(process.cwd(), EXT_DIR_NAME),
    path.join(process.cwd(), "agencia-platform", EXT_DIR_NAME),
    path.join(__dirname, "..", "..", "..", "..", "..", EXT_DIR_NAME)
  ];
  for (const c of candidates) {
    try {
      // Existencia síncrona no nos preocupa aquí — es de arranque.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("fs").accessSync(c);
      return c;
    } catch {
      // sigue probando
    }
  }
  // Fallback: el primero (cwd/chrome-extension) — fs.readFile lo
  // explotará con un mensaje claro si tampoco está ahí.
  return candidates[0];
}

async function readVersion(extDir: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(extDir, "manifest.json"), "utf8");
    const m = JSON.parse(raw);
    return typeof m.version === "string" ? m.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const GET = withApi({}, async (_req, { api }) => {
  if (!api.userId && !api.apiKeyId) {
    return new NextResponse("Auth required", { status: 401 });
  }

  const extDir = findExtensionDir();
  const version = await readVersion(extDir);

  // archiver streamea el zip mientras lo construye. Lo metemos en
  // un ReadableStream para que Next lo entregue progresivo al user.
  const archive = archiver("zip", { zlib: { level: 6 } });
  // Captura errores para no colgar la respuesta en caso de fallo.
  const errors: string[] = [];
  archive.on("warning", (err: any) => {
    if (err?.code !== "ENOENT") errors.push(`warn: ${err.message}`);
  });
  archive.on("error", (err: any) => {
    errors.push(`error: ${err.message}`);
  });

  // Añadimos el contenido COMPLETO de chrome-extension/ al raíz del
  // zip. Excluimos basura común que no debe llegar al cliente
  // (.DS_Store, node_modules si alguna vez se metiera, .git…).
  archive.glob("**/*", {
    cwd: extDir,
    dot: false,
    ignore: [
      "node_modules/**",
      ".git/**",
      ".DS_Store",
      "**/.DS_Store",
      "Thumbs.db"
    ]
  });

  // Convertimos archiver (Node stream) a un ReadableStream Web
  // compatible con NextResponse.
  const stream = new ReadableStream({
    start(controller) {
      archive.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      archive.on("end", () => controller.close());
      archive.on("error", (err: any) => controller.error(err));
      archive.finalize().catch((err) => controller.error(err));
    }
  });

  return new NextResponse(stream as any, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="hub-extension-v${version}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Extension-Version": version
    }
  });
});
