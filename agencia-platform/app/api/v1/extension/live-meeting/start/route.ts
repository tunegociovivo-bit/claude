/**
 * POST /api/v1/extension/live-meeting/start
 * body: { platform, meetingUrl?, meetingTitle? }
 *
 * Crea una LiveMeetingSession en estado LIVE. La extensión va a
 * empezar a mandar chunks de audio cada N segundos al endpoint
 * /chunk con sessionId. Al colgar la reunión, /end finaliza y crea
 * task con el transcript.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { withApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  platform: z.string().min(2).max(40),
  meetingUrl: z.string().max(2000).optional(),
  meetingTitle: z.string().max(200).optional()
});

export const POST = withApi({ scope: "*" }, async (req, { api }) => {
  if (!api.userId) throw new ApiError(401, "no_user", "Sesión requerida");
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", parsed.error.message);

  const session = await prisma.liveMeetingSession.create({
    data: {
      workspaceId: api.workspaceId,
      userId: api.userId,
      platform: parsed.data.platform.toLowerCase(),
      meetingUrl: parsed.data.meetingUrl ?? null,
      meetingTitle: parsed.data.meetingTitle ?? null,
      status: "LIVE"
    }
  });
  return NextResponse.json({ ok: true, sessionId: session.id, startedAt: session.startedAt });
});
