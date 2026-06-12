/**
 * Cron de purga de papelera. Una vez al día. Borra definitivamente
 * los items que llevan > RETENTION_DAYS en papelera (deletedAt
 * antiguo). No avisa a nadie — es housekeeping silencioso.
 *
 * Seguridad: Authorization: Bearer ${CRON_SECRET} o ?secret=.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { RETENTION_DAYS } from "@/lib/trash";
import { cronAuthOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

async function authorize(req: Request): Promise<boolean> {
  return cronAuthOk(req);
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const where = { deletedAt: { lt: cutoff } } as any;

  const [tasks, projects, documents, clients] = await Promise.all([
    prisma.task.deleteMany({ where }),
    prisma.project.deleteMany({ where }),
    prisma.document.deleteMany({ where }),
    prisma.client.deleteMany({ where })
  ]);

  return NextResponse.json({
    ok: true,
    purged: {
      tasks: tasks.count,
      projects: projects.count,
      documents: documents.count,
      clients: clients.count
    },
    cutoff: cutoff.toISOString()
  });
}
