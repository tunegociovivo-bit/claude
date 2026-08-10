import { NextResponse } from "next/server";
import archiver from "archiver";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/api/admin";
import { assertSameOrigin } from "@/lib/api/csrf";
import { ApiError } from "@/lib/api/auth";
import { enrollAgent } from "@/lib/facturacion/sepa/agent";
import { ensureReconciliationConfig } from "@/lib/facturacion/reconciliation/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ name: z.string().min(1).max(80) });

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  await requireAdmin(api);
  assertSameOrigin(req);
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", "Falta el nombre del ordenador");
  const agentRoot = join(process.cwd(), "agent");
  const selectors = await readFile(join(agentRoot, "selectors.default.json"));
  const [{ token }, config] = await Promise.all([
    enrollAgent(api.workspaceId, parsed.data.name, api.userId),
    ensureReconciliationConfig(api.workspaceId)
  ]);
  const env = [
    "HUB_URL=https://hub.negociovivo.app",
    `AGENT_TOKEN=${token}`,
    "SANTANDER_ORIGIN=https://empresas3.gruposantander.es",
    "CHROME_CDP_URL=http://127.0.0.1:9222",
    "SANTANDER_MODE=live",
    "SELECTORS_FILE=./selectors.json",
    "HEARTBEAT_SECONDS=30",
    "POLL_SECONDS=15",
    "LOG_LEVEL=info",
    ""
  ].join("\r\n");
  const readme = `AGENTE BANCARIO NEGOCIO VIVO\r\n\r\n1. Descomprime el ZIP en una carpeta permanente.\r\n2. Instala Node.js LTS si no está instalado.\r\n3. Ejecuta PowerShell como tu usuario: .\\install\\install-windows.ps1 -AutoStart\r\n4. Ejecuta: .\\install\\configure-bank-login.ps1\r\n5. Ejecuta: .\\install\\start-chrome.ps1\r\n6. Inicia sesión en Santander en ese Chrome.\r\n\r\nLa contraseña/clave se cifra con Windows y nunca se guarda en el HUB.\r\nConciliación activa desde: ${config.startsAt.toISOString()}\r\n`;

  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks: Buffer[] = [];
  archive.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve, reject) => { archive.on("end", resolve); archive.on("error", reject); });
  for (const dir of ["dist", "src", "install"]) archive.directory(join(agentRoot, dir), dir);
  for (const file of ["package.json", "tsconfig.json", ".env.example"]) archive.file(join(agentRoot, file), { name: file });
  archive.append(env, { name: ".env" });
  archive.append(selectors, { name: "selectors.json" });
  archive.append(readme, { name: "LEEME-INSTALACION.txt" });
  archive.finalize();
  await done;
  return new NextResponse(new Uint8Array(Buffer.concat(chunks)), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="agente-negocio-vivo-${new Date().toISOString().slice(0, 10)}.zip"`,
      "Cache-Control": "no-store"
    }
  });
});
