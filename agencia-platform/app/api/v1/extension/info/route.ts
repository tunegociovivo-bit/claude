/**
 * GET /api/v1/extension/info
 *
 * Devuelve metadatos ligeros de la extensión: versión + tamaño
 * aproximado + nº de ficheros. Lo usa la página /admin/extension
 * para mostrar "v0.1.0 · ~50 KB" SIN tener que iniciar la descarga
 * del zip — el endpoint /download era pesado y bloqueaba.
 */

import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXT_DIR_NAME = "chrome-extension";

async function findExtensionDir(): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), EXT_DIR_NAME),
    path.join(process.cwd(), "agencia-platform", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", "..", EXT_DIR_NAME),
    path.resolve(process.cwd(), "..", "..", "agencia-platform", EXT_DIR_NAME)
  ];
  for (const c of candidates) {
    try {
      const stat = await fs.stat(c);
      if (stat.isDirectory()) return c;
    } catch {}
  }
  return null;
}

async function totalSize(dir: string): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  async function walk(d: string) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        count++;
        const st = await fs.stat(full);
        bytes += st.size;
      }
    }
  }
  await walk(dir);
  return { count, bytes };
}

export const GET = withApi({}, async () => {
  const extDir = await findExtensionDir();
  if (!extDir) {
    throw new ApiError(500, "extension_not_bundled", "Carpeta chrome-extension/ no encontrada");
  }
  let version = "0.0.0";
  try {
    const raw = await fs.readFile(path.join(extDir, "manifest.json"), "utf8");
    const m = JSON.parse(raw);
    if (typeof m.version === "string") version = m.version;
  } catch {}
  const { count, bytes } = await totalSize(extDir);
  return NextResponse.json({
    version,
    files: count,
    totalBytes: bytes
  });
});
