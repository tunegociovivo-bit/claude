export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Agencia Hub API",
    version: "1.0.0",
    description: "API REST interna para integrar Agencia Hub con cualquier sistema externo."
  },
  servers: [{ url: "/api/v1", description: "API v1" }],
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "Formato: `Authorization: Bearer ag_<prefix>.<secret>`"
      }
    },
    schemas: {
      Client: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          industry: { type: "string", nullable: true },
          status: { type: "string", enum: ["ACTIVE", "PAUSED", "PROSPECT", "CHURNED"] },
          email: { type: "string", nullable: true },
          phone: { type: "string", nullable: true },
          mrr: { type: "integer" },
          notes: { type: "string", nullable: true }
        }
      },
      Project: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          clientId: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          progress: { type: "integer" }
        }
      },
      Task: {
        type: "object",
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "CANCELLED"] },
          priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "URGENT"] },
          dueDate: { type: "string", format: "date-time", nullable: true }
        }
      }
    }
  },
  security: [{ apiKey: [] }],
  paths: {
    "/clients": {
      get: { summary: "Listar clientes", responses: { "200": { description: "OK" } } },
      post: { summary: "Crear cliente", responses: { "201": { description: "Creado" } } }
    },
    "/clients/{id}": {
      get: { summary: "Obtener cliente" },
      patch: { summary: "Actualizar cliente" },
      delete: { summary: "Borrar (soft delete) cliente" }
    },
    "/projects": {
      get: { summary: "Listar proyectos" },
      post: { summary: "Crear proyecto" }
    },
    "/tasks": {
      get: { summary: "Listar tareas (filtros: projectId, status, assigneeId)" },
      post: { summary: "Crear tarea" }
    },
    "/tasks/{id}": {
      get: { summary: "Obtener tarea" },
      patch: { summary: "Actualizar tarea" },
      delete: { summary: "Borrar tarea" }
    },
    "/documents": {
      get: { summary: "Listar documentos" },
      post: { summary: "Crear documento" }
    },
    "/events": {
      get: { summary: "Listar eventos (filtros: from, to)" },
      post: { summary: "Crear evento" }
    }
  }
} as const;
