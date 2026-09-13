import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { withApi } from "@/lib/api/handler";
import { prisma } from "@/lib/db/prisma";

function linkedinProfileVariants(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "validation_error", "URL de LinkedIn no válida");
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) {
    throw new ApiError(400, "validation_error", "El perfil debe pertenecer a LinkedIn");
  }
  const match = url.pathname.match(/^\/in\/([^/]+)/i);
  if (!match) throw new ApiError(400, "validation_error", "La URL no corresponde a un perfil de LinkedIn");
  const base = `https://www.linkedin.com/in/${match[1]}`;
  return [base, `${base}/`];
}

export const GET = withApi({ scope: "*", admin: true, rate: "admin" }, async (req, { api }) => {
  const rawUrl = new URL(req.url).searchParams.get("url");
  if (!rawUrl) throw new ApiError(400, "validation_error", "Falta la URL del perfil");
  const variants = linkedinProfileVariants(rawUrl);
  const prospect = await prisma.prospectingProspect.findFirst({
    where: {
      workspaceId: api.workspaceId,
      linkedinUrl: { in: variants },
      activities: { some: { status: "awaiting_review", channel: "linkedin_message" } }
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      companyName: true,
      metadata: true,
      activities: {
        where: { status: "awaiting_review", channel: "linkedin_message" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, detail: true, payload: true }
      }
    }
  });
  const activity = prospect?.activities[0];
  if (!prospect || !activity?.detail) return NextResponse.json({ draft: null });
  const metadata = prospect.metadata && typeof prospect.metadata === "object" && !Array.isArray(prospect.metadata)
    ? prospect.metadata as Record<string, any>
    : {};
  return NextResponse.json({
    activityId: activity.id,
    prospectId: prospect.id,
    person: [prospect.firstName, prospect.lastName].filter(Boolean).join(" "),
    company: prospect.companyName,
    jobTitle: typeof metadata.job?.title === "string" ? metadata.job.title : null,
    message: activity.detail
  });
});
