import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
const schema = z.object({ id: z.string().min(1), email: z.string().email() });
const blockedMailbox = /^(privacy|privacidad|legal|soporte|support|atencion[^@]*|clientes?|rrhh|empleo|jobs|facturacion|billing|compras|proveedores)@/i;

export const POST = withApi({ scope: "*", rate: "admin" }, async (req, { api }) => {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);
  if (blockedMailbox.test(parsed.data.email)) throw new ApiError(400, "wrong_department", "Ese correo pertenece a un departamento que no debe recibir la prospección");
  const lead = await prisma.lead.findFirst({ where: { id: parsed.data.id, workspaceId: api.workspaceId }, select: { id: true, rawData: true } });
  if (!lead) throw new ApiError(404, "not_found", "Cuenta de franquicia no encontrada");
  const raw: any = lead.rawData ?? {};
  const research = raw.decisionMakerResearch ?? {};
  const candidate = (Array.isArray(research.candidates) ? research.candidates : []).find((item: any) => item?.email?.toLowerCase() === parsed.data.email.toLowerCase());
  if (!candidate) throw new ApiError(404, "candidate_not_found", "El correo no pertenece a la última investigación");
  const selected = { ...candidate, sendAllowed: true, manuallySelected: true, reasons: [...(candidate.reasons ?? []), "seleccionado manualmente por administración"] };
  const updatedResearch = { ...research, status: "verified_manual", selected };
  await prisma.lead.update({ where: { id: lead.id }, data: { email: selected.email, rawData: { ...raw, email: selected.email, directorName: selected.name, directorRole: selected.role, decisionMakerResearch: updatedResearch } } });
  return NextResponse.json({ ok: true, research: updatedResearch });
});
