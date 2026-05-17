/**
 * Ejecuta un AiDraft aprobado. Cada `kind` se ejecuta de forma distinta:
 *  - EMAIL          → Resend vía sendEmail()
 *  - WHATSAPP       → WAHA vía sendText()
 *  - EDITORIAL_POST → crea EditorialPost en estado DRAFT (el user lo
 *                     edita después en /editorial — NO se publica aquí
 *                     automáticamente, dos niveles de aprobación a
 *                     propósito porque publicar es muy visible).
 *  - CUSTOM         → no-op, solo se marca EXECUTED (el humano hace
 *                     manualmente lo que el draft propone).
 *
 * Idempotente: si el draft no está en APPROVED, lanza error.
 * Devuelve { ok, externalId?, error? } y lo persiste en
 * executionResult del draft.
 */

import { prisma } from "@/lib/db/prisma";
import { sendEmail, isEmailEnabled } from "@/lib/integrations/email";
import { sendText } from "@/lib/leads/waha";
import { createDriveNativeFile } from "@/lib/integrations/google-drive";
import { checkCompliance } from "./compliance";

export async function executeDraft(draftId: string): Promise<{
  ok: boolean;
  externalId?: string;
  error?: string;
}> {
  const draft = await prisma.aiDraft.findUnique({ where: { id: draftId } });
  if (!draft) return { ok: false, error: "draft no encontrado" };
  if (draft.status !== "APPROVED") {
    return { ok: false, error: `draft no aprobado (status=${draft.status})` };
  }
  const payload = (draft.payload as any) ?? {};

  // Fase 36: filtro compliance pre-ejecución para canales de salida
  // que comunican con humanos externos (email/whatsapp/post/gmb).
  // Bloquea si encuentra problema serio; marca el draft como FAILED
  // con la razón y propone re-redacción. Drive files y calendar
  // events se saltan el filtro (no son comunicación externa pura).
  if (["EMAIL", "WHATSAPP", "EDITORIAL_POST", "CUSTOM"].includes(draft.kind)) {
    const contentText =
      payload.text ??
      payload.body ??
      payload.content ??
      JSON.stringify(payload).slice(0, 4000);
    const check = await checkCompliance({
      workspaceId: draft.workspaceId,
      kind: draft.kind,
      contentText,
      context: `draft id: ${draftId}`
    });
    if (!check.ok) {
      await prisma.aiDraft.update({
        where: { id: draftId },
        data: {
          status: "FAILED",
          executedAt: new Date(),
          executionResult: {
            ok: false,
            error: `COMPLIANCE BLOCKED: ${check.reason ?? "razón no especificada"}` +
              (check.suggestion ? `\nSugerencia: ${check.suggestion}` : "")
          } as any
        }
      });
      return {
        ok: false,
        error: `Compliance bloqueó: ${check.reason ?? "sin detalle"}`
      };
    }
  }

  try {
    let result: { ok: boolean; externalId?: string; error?: string };
    switch (draft.kind) {
      case "EMAIL": {
        if (!isEmailEnabled()) {
          result = { ok: false, error: "Resend no configurado (falta RESEND_API_KEY)" };
          break;
        }
        const r = await sendEmail({
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text
        });
        result = { ok: true, externalId: r.id };
        break;
      }
      case "WHATSAPP": {
        const r = await sendText({
          workspaceId: draft.workspaceId,
          phoneNormalized: payload.phoneNormalized,
          text: payload.text
        });
        result = { ok: true, externalId: r.messageId };
        break;
      }
      case "EDITORIAL_POST": {
        const created = await prisma.editorialPost.create({
          data: {
            workspaceId: draft.workspaceId,
            clientId: payload.clientId ?? null,
            title: payload.title,
            content: payload.content ?? null,
            networks: payload.networks ?? [],
            status: "DRAFT" // el user lo programa/publica desde /editorial
          } as any
        });
        result = { ok: true, externalId: created.id };
        break;
      }
      case "DRIVE_FILE": {
        const f = await createDriveNativeFile({
          workspaceId: draft.workspaceId,
          fileName: payload.fileName,
          kind: payload.kind,
          content: payload.content
        });
        result = { ok: true, externalId: f.id };
        break;
      }
      case "CALENDAR_EVENT": {
        const ev = await prisma.calendarEvent.create({
          data: {
            workspaceId: draft.workspaceId,
            clientId: payload.clientId ?? null,
            title: payload.title,
            description: payload.description ?? null,
            startAt: new Date(payload.startIso),
            endAt: payload.endIso ? new Date(payload.endIso) : null,
            allDay: payload.allDay === true,
            type: payload.type ?? "MEETING"
          }
        });
        result = { ok: true, externalId: ev.id };
        break;
      }
      case "CUSTOM":
      default: {
        result = { ok: true }; // marcar como executed sin acción
        break;
      }
    }

    await prisma.aiDraft.update({
      where: { id: draftId },
      data: {
        status: result.ok ? "EXECUTED" : "FAILED",
        executedAt: new Date(),
        executionResult: result as any
      }
    });
    return result;
  } catch (e: any) {
    const error = String(e?.message ?? e);
    await prisma.aiDraft.update({
      where: { id: draftId },
      data: {
        status: "FAILED",
        executedAt: new Date(),
        executionResult: { ok: false, error } as any
      }
    });
    return { ok: false, error };
  }
}
