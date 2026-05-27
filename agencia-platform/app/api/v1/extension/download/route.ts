/**
 * GET /api/v1/extension/download
 *
 * Devuelve un .zip con la última versión de la extensión de Chrome.
 *
 * IMPLEMENTACIÓN: ZIP construido en memoria con fflate.zipSync —
 * pure JS, síncrono, sin streams, sin event loop. El zip pesa <100 KB
 * así que es instantáneo y no merece la pena streamear. Con archiver
 * el endpoint se quedaba colgado en producción ("se queda dando
 * vueltas pero no descarga") — fflate elimina toda esa complejidad.
 *
 * Modo diagnóstico: ?debug=1 devuelve JSON con el path resuelto,
 * cwd, versión, lista de ficheros y tamaño total. Para depurar.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { zipSync, strToU8 } from "fflate";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const EXT_DIR_NAME = "chrome-extension";

async function findExtensionDir(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), EXT_DIR_NAME),
    path.join(process.cwd(), "agencia-platform", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", "..", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", "..", "agencia-platform", EXT_DIR_NAME),
    path.resolve(__dirname, "..", "..", "..", "..", "..", EXT_DIR_NAME),
    path.resolve(__dirname, "..", "..", "..", "..", "..", "..", EXT_DIR_NAME)
  ];
  for (const c of candidates) {
    try {
      const stat = await fs.stat(c);
      if (stat.isDirectory()) return c;
    } catch {
      // sigue probando
    }
  }
  return null;
}

async function listFiles(dir: string, prefix = ""): Promise<{ rel: string; size: number }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: { rel: string; size: number }[] = [];
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === ".DS_Store" || e.name === "Thumbs.db") continue;
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await listFiles(full, rel)));
    } else if (e.isFile()) {
      const st = await fs.stat(full);
      out.push({ rel, size: st.size });
    }
  }
  return out;
}

async function readManifestVersion(extDir: string): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(extDir, "manifest.json"), "utf8");
    const m = JSON.parse(raw);
    return typeof m.version === "string" ? m.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const GET = withApi({}, async (req, { api }) => {
  if (!api.userId && !api.apiKeyId) {
    throw new ApiError(401, "auth_required", "Sesión requerida");
  }

  const extDir = await findExtensionDir();
  if (!extDir) {
    throw new ApiError(
      500,
      "extension_not_bundled",
      "La carpeta chrome-extension/ no se encuentra en este deploy. " +
        "Revisa outputFileTracingIncludes en next.config.js."
    );
  }

  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const version = await readManifestVersion(extDir);
  const files = await listFiles(extDir);

  if (debug) {
    return NextResponse.json({
      extDir,
      cwd: process.cwd(),
      version,
      fileCount: files.length,
      totalBytes: files.reduce((s, f) => s + f.size, 0),
      files: files.slice(0, 100)
    });
  }

  if (files.length === 0) {
    throw new ApiError(500, "empty_extension_dir", `Directorio ${extDir} vacío`);
  }

  // Construir mapa { ruta-relativa: Uint8Array(contenido) } y zipear.
  // fflate.zipSync NO usa streams; es 100% síncrono y predecible —
  // por eso lo elegimos sobre archiver, que dejaba el endpoint colgado.
  const zipMap: Record<string, Uint8Array> = {};
  let buildError: Error | null = null;
  try {
    for (const f of files) {
      const data = await fs.readFile(path.join(extDir, f.rel));
      zipMap[f.rel] = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
  } catch (e: any) {
    buildError = e;
  }
  if (buildError) {
    throw new ApiError(500, "read_failed", `Error leyendo ficheros: ${buildError.message}`);
  }

  let zipBytes: Uint8Array;
  try {
    zipBytes = zipSync(zipMap, { level: 6 });
  } catch (e: any) {
    throw new ApiError(500, "zip_failed", `fflate.zipSync falló: ${e?.message ?? e}`);
  }

  const filename = `hub-extension-v${version}.zip`;
  return new NextResponse(zipBytes as any, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zipBytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Extension-Version": version
    }
  });
});
