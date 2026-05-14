import { PrismaClient, ClientStatus, TaskStatus, TaskPriority, EventType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  clients as mockClients,
  projects as mockProjects,
  tasks as mockTasks,
  team as mockTeam,
  events as mockEvents,
  docs as mockDocs
} from "../lib/mock-data";

const prisma = new PrismaClient();

const statusMap: Record<string, ClientStatus> = {
  activo: "ACTIVE",
  pausa: "PAUSED",
  prospecto: "PROSPECT"
};

const taskStatusMap: Record<string, TaskStatus> = {
  todo: "TODO",
  in_progress: "IN_PROGRESS",
  review: "REVIEW",
  done: "DONE"
};

const priorityMap: Record<string, TaskPriority> = {
  baja: "LOW",
  media: "MEDIUM",
  alta: "HIGH"
};

const eventTypeMap: Record<string, EventType> = {
  publicacion: "PUBLICATION",
  reunion: "MEETING",
  deadline: "DEADLINE",
  campaña: "CAMPAIGN"
};

async function main() {
  console.log("Limpiando datos antiguos…");
  await prisma.$transaction([
    prisma.webhookDelivery.deleteMany(),
    prisma.webhook.deleteMany(),
    prisma.apiKey.deleteMany(),
    prisma.calendarEvent.deleteMany(),
    prisma.taskAssignee.deleteMany(),
    prisma.taskTag.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.task.deleteMany(),
    prisma.project.deleteMany(),
    prisma.block.deleteMany(),
    prisma.document.deleteMany(),
    prisma.client.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.user.deleteMany()
  ]);

  console.log("Creando workspace y usuarios…");
  const workspace = await prisma.workspace.create({
    data: { name: "Agencia Hub", slug: "agencia-hub" }
  });

  const passwordHash = await bcrypt.hash("agencia123", 10);

  const userIdMap = new Map<string, string>();
  for (const m of mockTeam) {
    const u = await prisma.user.create({
      data: {
        email: `${m.id}@agencia.local`,
        name: m.name,
        passwordHash,
        role: m.id === "u1" ? UserRole.ADMIN : UserRole.MEMBER,
        memberships: { create: { workspaceId: workspace.id, role: m.id === "u1" ? UserRole.ADMIN : UserRole.MEMBER } }
      }
    });
    userIdMap.set(m.id, u.id);
  }

  console.log("Creando clientes…");
  const clientIdMap = new Map<string, string>();
  for (const c of mockClients) {
    const created = await prisma.client.create({
      data: {
        workspaceId: workspace.id,
        name: c.name,
        industry: c.industry,
        status: statusMap[c.status] ?? "ACTIVE",
        contactName: c.contactName,
        email: c.email,
        phone: c.phone,
        mrr: c.mrr,
        since: new Date(c.since),
        notes: c.notes
      }
    });
    clientIdMap.set(c.id, created.id);
  }

  console.log("Creando proyectos…");
  const projectIdMap = new Map<string, string>();
  for (const p of mockProjects) {
    const created = await prisma.project.create({
      data: {
        workspaceId: workspace.id,
        clientId: clientIdMap.get(p.clientId),
        name: p.name,
        description: p.description,
        color: p.color,
        progress: p.progress
      }
    });
    projectIdMap.set(p.id, created.id);
  }

  console.log("Creando tags y tareas…");
  const allTags = new Set<string>();
  mockTasks.forEach((t) => t.tags.forEach((tag) => allTags.add(tag)));
  const tagIdMap = new Map<string, string>();
  for (const t of allTags) {
    const tag = await prisma.tag.create({ data: { workspaceId: workspace.id, name: t } });
    tagIdMap.set(t, tag.id);
  }

  for (const t of mockTasks) {
    await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        projectId: projectIdMap.get(t.projectId)!,
        clientId: t.clientId ? clientIdMap.get(t.clientId) : null,
        title: t.title,
        status: taskStatusMap[t.status] ?? "TODO",
        priority: priorityMap[t.priority] ?? "MEDIUM",
        dueDate: new Date(t.dueDate),
        assignees: { create: t.assigneeIds.map((id) => ({ userId: userIdMap.get(id)! })) },
        tags: { create: t.tags.map((tag) => ({ tagId: tagIdMap.get(tag)! })) }
      }
    });
  }

  console.log("Creando documentos…");
  for (const d of mockDocs) {
    const doc = await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        title: d.title,
        icon: d.icon,
        category: d.category
      }
    });
    for (const [idx, b] of d.blocks.entries()) {
      const type =
        b.type === "heading"
          ? "HEADING_2"
          : b.type === "paragraph"
          ? "PARAGRAPH"
          : b.type === "list"
          ? "BULLET_LIST"
          : "CALLOUT";
      await prisma.block.create({
        data: {
          documentId: doc.id,
          type: type as any,
          content: { text: b.text },
          order: idx
        }
      });
    }
  }

  console.log("Creando eventos del calendario…");
  for (const e of mockEvents) {
    const [hours, minutes] = (e.time ?? "09:00").split(":").map(Number);
    const startAt = new Date(e.date);
    startAt.setHours(hours, minutes, 0, 0);
    await prisma.calendarEvent.create({
      data: {
        workspaceId: workspace.id,
        clientId: e.clientId ? clientIdMap.get(e.clientId) : null,
        title: e.title,
        startAt,
        type: eventTypeMap[e.type] ?? "MEETING",
        allDay: !e.time
      }
    });
  }

  console.log("");
  console.log("Seed completado.");
  console.log("");
  console.log("Login de prueba:");
  console.log("  email:    u1@agencia.local");
  console.log("  password: agencia123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
