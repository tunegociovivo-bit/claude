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
import { resolveRunOwnerId } from "@/lib/ai/nv-ia/run-owner";
import { sendEmail, isEmailEnabled } from "@/lib/integrations/email";
import { sendText } from "@/lib/leads/waha";
import { createDriveNativeFile } from "@/lib/integrations/google-drive";
import { holdedCreateInvoice, holdedCreateQuote } from "@/lib/integrations/holded";
import { stripeCreatePaymentLink } from "@/lib/integrations/stripe-light";
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
        // Preferimos enviar desde la CUENTA propia del negocio (SMTP, p.ej.
        // info@negociovivo.com) si está configurada; con relay Resend de
        // respaldo dentro de sendEmailFromAccount. Si no hay cuenta, Resend.
        const acc = await prisma.emailAccount.findFirst({
          where: { workspaceId: draft.workspaceId },
          select: { userId: true }
        });
        if (acc) {
          const { sendEmailFromAccount } = await import("@/lib/integrations/email-account");
          const r = await sendEmailFromAccount({
            userId: acc.userId,
            workspaceId: draft.workspaceId,
            to: payload.to,
            subject: payload.subject,
            body: payload.html ?? payload.text ?? "",
            html: !!payload.html,
            cc: payload.cc
          });
          result = { ok: true, externalId: r.messageId };
          break;
        }
        if (!isEmailEnabled()) {
          result = { ok: false, error: "Sin cuenta de correo conectada ni Resend (RESEND_API_KEY) configurado" };
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
        if (payload.fileId) {
          if (!draft.taskId) {
            result = { ok: false, error: "El borrador de archivo no está vinculado a una tarea" };
            break;
          }
          const file = await prisma.file.findFirst({
            where: {
              id: String(payload.fileId),
              workspaceId: draft.workspaceId,
              targetType: "TASK",
              targetId: draft.taskId
            }
          });
          if (!file) {
            result = { ok: false, error: "El archivo adjunto ya no existe o no pertenece a la tarea" };
            break;
          }
          if (file.sizeBytes > 50 * 1024 * 1024) {
            result = { ok: false, error: "El archivo supera el límite de 50 MB" };
            break;
          }
          const { downloadBuffer } = await import("@/lib/storage/r2");
          const { sendFile } = await import("@/lib/leads/waha");
          const buffer = await downloadBuffer(file.s3Key);
          const r = await sendFile({
            workspaceId: draft.workspaceId,
            phoneNormalized: payload.phoneNormalized,
            file: buffer,
            filename: file.name,
            mimetype: file.mimeType || "application/octet-stream",
            caption: payload.text || ""
          });
          result = { ok: true, externalId: r.messageId };
          break;
        }
        if (payload.voice) {
          const { elevenlabsSynthesize } = await import("@/lib/integrations/elevenlabs");
          const { sendVoice } = await import("@/lib/leads/waha");
          const audio = await elevenlabsSynthesize({ workspaceId: draft.workspaceId, text: payload.text });
          const r = await sendVoice({
            workspaceId: draft.workspaceId,
            phoneNormalized: payload.phoneNormalized,
            audio
          });
          result = { ok: true, externalId: r.messageId };
          break;
        }
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
        // Privacidad: si es un evento PERSONAL (sin cliente), lo marcamos
        // como propiedad de quien se lo encargó a Sonia, para que NO aparezca
        // en el calendario de otros usuarios. Los eventos con cliente se
        // dejan compartidos (reuniones de cliente que el equipo debe ver).
        const ownerUserId = payload.clientId
          ? null
          : await resolveRunOwnerId({
              workspaceId: draft.workspaceId,
              taskId: draft.taskId,
              requesterId: null
            });
        const ev = await prisma.calendarEvent.create({
          data: {
            workspaceId: draft.workspaceId,
            clientId: payload.clientId ?? null,
            ownerUserId: ownerUserId ?? null,
            title: payload.title,
            description: payload.description ?? null,
            startAt: new Date(payload.startIso),
            endAt: payload.endIso ? new Date(payload.endIso) : null,
            allDay: payload.allDay === true,
            type: payload.type ?? "MEETING"
          } as any
        });
        result = { ok: true, externalId: ev.id };
        break;
      }
      case "HOLDED_INVOICE": {
        const r = await holdedCreateInvoice({
          workspaceId: draft.workspaceId,
          payload: {
            contactId: payload.contactId ?? undefined,
            contactName: payload.contactName ?? undefined,
            desc: payload.desc ?? undefined,
            items: payload.items ?? [],
            notes: payload.notes ?? undefined
          }
        });
        result = { ok: true, externalId: r.id ?? r.docNumber ?? "?" };
        break;
      }
      case "HOLDED_QUOTE": {
        const r = await holdedCreateQuote({
          workspaceId: draft.workspaceId,
          payload: {
            contactId: payload.contactId ?? undefined,
            contactName: payload.contactName ?? undefined,
            desc: payload.desc ?? undefined,
            items: payload.items ?? [],
            notes: payload.notes ?? undefined
          }
        });
        result = { ok: true, externalId: r.id ?? r.docNumber ?? "?" };
        break;
      }
      case "STRIPE_PAYMENT_LINK": {
        const r = await stripeCreatePaymentLink({
          workspaceId: draft.workspaceId,
          productName: payload.productName,
          amount: payload.amount,
          currency: payload.currency ?? "eur"
        });
        // Guardamos URL en executionResult para que el admin la copie
        result = { ok: true, externalId: r.url };
        break;
      }
      case "PHONE_CALL": {
        const { startVoiceCall } = await import("@/lib/integrations/voice-calls");
        const r = await startVoiceCall({
          workspaceId: draft.workspaceId,
          toNumber: String(payload.toNumber ?? ""),
          goal: String(payload.goal ?? ""),
          customerName: payload.customerName ? String(payload.customerName) : undefined,
          taskId: draft.taskId ?? undefined,
          userId: draft.reviewedById ?? undefined,
          clientId: payload.clientId ?? undefined
        });
        result = { ok: true, externalId: r.providerCallId ?? r.id };
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
