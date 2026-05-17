/**
 * GET /api/v1/extension/download
 *
 * Devuelve un .zip con la última versión de la extensión de Chrome
 * (chrome-extension/) lista para sideload. El zip se genera al vuelo
 * desde los ficheros en disco — así cualquier cambio en
 * chrome-extension/ aparece en la siguiente descarga sin pre-build.
 *
 * Implementación: NO usamos ReadableStream (causaba "Da error" en
 * algunas combinaciones de Next 14 + standalone). El zip de la
 * extensión pesa <100 KB, lo construimos completo en un Buffer y lo
 * devolvemos como NextResponse(buffer). Más simple y robusto.
 *
 * Auth: requiere sesión o API key. La extensión es interna; no la
 * exponemos al público.
 *
 * Query:
 *   ?debug=1   → devuelve JSON con el path resuelto, ficheros y
 *                tamaño total, en lugar del zip. Sirve para
 *                diagnosticar cuando la descarga falla.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import archiver from "archiver";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const EXT_DIR_NAME = "chrome-extension";

/**
 * Busca chrome-extension/ probando varias ubicaciones — el directorio
 * vive en un sitio distinto en dev (process.cwd() = agencia-platform/)
 * vs standalone build (process.cwd() = .next/standalone/agencia-platform/).
 * Devolvemos el primero que existe.
 */
async function findExtensionDir(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), EXT_DIR_NAME),
    path.join(process.cwd(), "agencia-platform", EXT_DIR_NAME),
    // Standalone: el server.js corre desde .next/standalone/<app>/
    // y el trace de Next copia chrome-extension al mismo nivel.
    path.resolve(process.cwd(), "..", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", "..", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", "..", "agencia-platform", EXT_DIR_NAME),
    // Por si fs.tracing lo deja junto al binario:
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

/**
 * Recolecta recursivamente todos los ficheros bajo `dir` y devuelve
 * rutas relativas a `dir`. Usado para listar lo que vamos a zipear
 * y poder responder al modo ?debug=1.
 */
async function listFiles(dir: string, prefix = ""): Promise<{ rel: string; size: number }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: { rel: string; size: number }[] = [];
  for (const e of entries) {
    // Ignoramos basura del sistema y carpetas que no deben llegar al
    // user (node_modules, .git…).
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
        "Revisa outputFileTracingIncludes en next.config.js y re-deploya."
    );
  }

  const debug = new URL(req.url).searchParams.get("debug") === "1";
  if (debug) {
    const files = await listFiles(extDir);
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    return NextResponse.json({
      extDir,
      cwd: process.cwd(),
      version: await readManifestVersion(extDir),
      fileCount: files.length,
      totalBytes,
      files: files.slice(0, 100)
    });
  }

  const version = await readManifestVersion(extDir);

  // Construimos el zip COMPLETO en un Buffer leyendo los ficheros con
  // fs.readFile y haciendo archive.append(buffer). Es más verboso pero
  // muchísimo más fiable que archive.directory() que internamente usa
  // streams y se queda colgado si Railway tarda en abrir algún fd o
  // si fs.stat falla en cualquier fichero (p. ej. un symlink raro).
  // Para 12 ficheros / 50KB no merece la pena streamear.
  const files = await listFiles(extDir);
  if (files.length === 0) {
    throw new ApiError(500, "empty_extension_dir", `Directorio ${extDir} vacío`);
  }

  let zipBuffer: Buffer;
  try {
    zipBuffer = await new Promise<Buffer>(async (resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 6 }, forceLocalTime: true });
      const chunks: Buffer[] = [];
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", (err) => reject(err));
      archive.on("warning", (err: any) => {
        // ENOENT no rompe. Otros warnings tampoco — antes los
        // tratábamos como fatal y eso podía cancelar el zip por
        // problemas de permisos triviales.
        console.warn("[extension-download] archiver warn:", err?.message ?? err);
      });

      try {
        for (const f of files) {
          const full = path.join(extDir, f.rel);
          const buf = await fs.readFile(full);
          archive.append(buf, { name: f.rel });
        }
        await archive.finalize();
      } catch (err) {
        reject(err);
      }
    });
  } catch (e: any) {
    throw new ApiError(
      500,
      "zip_failed",
      `No se pudo generar el zip: ${e?.message ?? e}. Path: ${extDir}, ficheros: ${files.length}`
    );
  }

  const filename = `hub-extension-v${version}.zip`;
  // Los typings de NextResponse en Next 14 mezclan BodyInit Web y
  // Node; Buffer/Uint8Array técnicamente son válidos en runtime pero
  // TS se queja. Cast a `any` justificado: solo aquí.
  return new NextResponse(zipBuffer as any, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zipBuffer.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Extension-Version": version
    }
  });
});
