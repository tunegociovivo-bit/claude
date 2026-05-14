/**
 * Cliente mínimo para la Asana REST API v1.0
 * Docs: https://developers.asana.com/reference/rest-api-reference
 */

const BASE = "https://app.asana.com/api/1.0";

export type AsanaUser = { gid: string; name: string; email?: string };
export type AsanaWorkspace = { gid: string; name: string };
export type AsanaProject = { gid: string; name: string; notes?: string; archived?: boolean; team?: { gid: string; name: string } };
export type AsanaSection = { gid: string; name: string };
export type AsanaTag = { gid: string; name: string };
export type AsanaTask = {
  gid: string;
  name: string;
  notes?: string;
  completed: boolean;
  completed_at?: string | null;
  due_on?: string | null;
  due_at?: string | null;
  assignee?: AsanaUser | null;
  parent?: { gid: string } | null;
  memberships?: { project: { gid: string }; section?: { gid: string; name: string } }[];
  tags?: AsanaTag[];
  created_at?: string;
  modified_at?: string;
};
export type AsanaStory = {
  gid: string;
  type?: string;
  resource_subtype?: string;
  text?: string;
  html_text?: string;
  created_at: string;
  created_by?: AsanaUser | null;
};

export class AsanaClient {
  constructor(private token: string) {}

  private async req<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(BASE + path);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json"
      },
      // Asana respeta rate-limit con 429 → simple retry tras Retry-After
      cache: "no-store"
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get("Retry-After") ?? "5");
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this.req<T>(path, params);
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Asana ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  async *paginate<T>(path: string, params: Record<string, string> = {}, key = "data"): AsyncGenerator<T> {
    let offset: string | undefined;
    do {
      const q: Record<string, string> = { ...params, limit: "100" };
      if (offset) q.offset = offset;
      const resp = await this.req<any>(path, q);
      const items = resp[key] ?? [];
      for (const it of items) yield it as T;
      offset = resp.next_page?.offset;
    } while (offset);
  }

  me(): Promise<{ data: AsanaUser & { workspaces: AsanaWorkspace[] } }> {
    return this.req("/users/me", { opt_fields: "gid,name,email,workspaces.gid,workspaces.name" });
  }

  workspaces(): Promise<{ data: AsanaWorkspace[] }> {
    return this.req("/workspaces", { opt_fields: "gid,name" });
  }

  workspaceUsers(workspaceGid: string) {
    return this.paginate<AsanaUser>(`/workspaces/${workspaceGid}/users`, {
      opt_fields: "gid,name,email"
    });
  }

  workspaceProjects(workspaceGid: string) {
    return this.paginate<AsanaProject>(`/workspaces/${workspaceGid}/projects`, {
      archived: "false",
      opt_fields: "gid,name,notes,archived,team.gid,team.name"
    });
  }

  projectSections(projectGid: string) {
    return this.paginate<AsanaSection>(`/projects/${projectGid}/sections`, { opt_fields: "gid,name" });
  }

  projectTasks(projectGid: string) {
    return this.paginate<AsanaTask>(`/projects/${projectGid}/tasks`, {
      opt_fields:
        "gid,name,notes,completed,completed_at,due_on,due_at,assignee.gid,assignee.name,assignee.email,parent.gid,memberships.project.gid,memberships.section.gid,memberships.section.name,tags.gid,tags.name,created_at,modified_at"
    });
  }

  taskSubtasks(taskGid: string) {
    return this.paginate<AsanaTask>(`/tasks/${taskGid}/subtasks`, {
      opt_fields:
        "gid,name,notes,completed,completed_at,due_on,due_at,assignee.gid,assignee.name,assignee.email,parent.gid,tags.gid,tags.name"
    });
  }

  taskStories(taskGid: string) {
    return this.paginate<AsanaStory>(`/tasks/${taskGid}/stories`, {
      opt_fields: "gid,type,resource_subtype,text,created_at,created_by.gid,created_by.name,created_by.email"
    });
  }
}
