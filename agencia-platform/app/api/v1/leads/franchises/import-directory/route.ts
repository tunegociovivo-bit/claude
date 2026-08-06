/**
 * Franquicias — importar desde los DIRECTORIOS de franquicias.
 *  POST → scrapea los portales, extrae contacto de expansión/marketing (email
 *  deducido con Hunter si falta), guarda como leads de central y los devuelve.
 */
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { importFranchiseDirectory } from "@/lib/leads/search-manager";

export const dynamic = "force-dynamic";

export const POST = withApi({ scope: "*" }, async (_req, { api }) => {
  const res = await importFranchiseDirectory(api.workspaceId);
  return NextResponse.json({ ok: true, ...res });
});
