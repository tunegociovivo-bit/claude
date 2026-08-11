/**
 * Devuelve el PHP del plugin Agencia Hub Exporter como ZIP listo para subir
 * a wp-admin.
 *
 * FASE 1 · Punto 1: antes era un `export async function GET()` SIN auth (ruta
 * bajo /api/v1/admin/ pero públicamente accesible). Aunque el plugin no lleva
 * secretos, no debe ser descargable por cualquiera. Ahora pasa por `withApi`,
 * que exige SESIÓN siempre y aplica el gate central de rol admin.
 */

import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { withApi } from "@/lib/api/handler";

// Mínimo ZIP no comprimido (store) construido a mano. Más simple que añadir una
// dep de "jszip" para un solo archivo.
function buildZip(filename: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(filename, "utf-8");
  const crc = crc32(content);
  const size = content.length;

  const localHeader = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),  // signature
    Buffer.from([20, 0]),                    // version needed 2.0
    Buffer.from([0, 0]),                     // gp bit
    Buffer.from([0, 0]),                     // method 0 = store
    Buffer.from([0, 0, 0, 0]),               // modtime+date
    u32(crc),
    u32(size),
    u32(size),
    u16(nameBuf.length),
    u16(0),                                  // extra len
    nameBuf
  ]);
  const fileData = content;

  const centralOffset = localHeader.length + fileData.length;
  const centralHeader = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    Buffer.from([20, 0]),
    Buffer.from([20, 0]),
    Buffer.from([0, 0]),
    Buffer.from([0, 0]),
    Buffer.from([0, 0, 0, 0]),
    u32(crc),
    u32(size),
    u32(size),
    u16(nameBuf.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),       // offset of local header = 0
    nameBuf
  ]);

  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0),
    u16(1), u16(1),
    u32(centralHeader.length),
    u32(centralOffset),
    u16(0)
  ]);

  return Buffer.concat([localHeader, fileData, centralHeader, eocd]);
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

// CRC32 table-less implementation, suficiente para tamaños pequeños
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = c ^ buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

export const GET = withApi({ admin: true }, async () => {
  const phpPath = path.join(process.cwd(), "scripts", "wp-exporter", "agencia-exporter.php");
  let php: Buffer;
  try {
    php = await readFile(phpPath);
  } catch (e) {
    return NextResponse.json(
      { error: { code: "missing", message: "Plugin source not found on server." } },
      { status: 500 }
    );
  }
  const zip = buildZip("agencia-exporter/agencia-exporter.php", php);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="agencia-exporter.zip"`,
      "Content-Length": String(zip.length)
    }
  });
});
