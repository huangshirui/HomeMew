import { describe, expect, it } from "vitest";
import { createFamily, createUser, request } from "./helpers";

async function createTask(familyId: string, token: string, input: Record<string, unknown>) {
  return request(`/api/v1/families/${familyId}/tasks`, token, { method: "POST", body: JSON.stringify(input) });
}

describe("family task API", () => {
  it("creates, reads, updates, and soft deletes tasks", async () => {
    const family = await createFamily("Tasks");
    const response = await createTask(family.id, family.admin.token, { name: " 购买足球鞋 ", description: "周末前", due: "2026-07-25", assigneeIds: [family.admin.id] });
    expect(response.status).toBe(201);
    const task = (await response.json<any>()).data;
    expect(task).toMatchObject({ name: "购买足球鞋", due: "2026-07-25", status: "pending", version: 1 });
    expect(task.assignees).toHaveLength(1);
    expect((await request(`/api/v1/families/${family.id}/tasks/${task.id}`, family.admin.token)).status).toBe(200);
    const updated = await request(`/api/v1/families/${family.id}/tasks/${task.id}`, family.admin.token, { method: "PATCH", body: JSON.stringify({ due: null, assigneeIds: [], version: 1 }) });
    expect((await updated.json<any>()).data).toMatchObject({ due: null, version: 2, assignees: [] });
    const conflict = await request(`/api/v1/families/${family.id}/tasks/${task.id}`, family.admin.token, { method: "PATCH", body: JSON.stringify({ name: "Stale", version: 1 }) });
    expect((await conflict.json<any>()).error.code).toBe("TASK_VERSION_CONFLICT");
    expect((await request(`/api/v1/families/${family.id}/tasks/${task.id}?version=2`, family.admin.token, { method: "DELETE" })).status).toBe(204);
    expect((await request(`/api/v1/families/${family.id}/tasks/${task.id}`, family.admin.token)).status).toBe(404);
  });

  it("validates family assignees, duplicate IDs, and due dates", async () => {
    const family = await createFamily("Task Validation"), outsider = await createUser("Task Outsider");
    expect((await createTask(family.id, outsider.token, { name: "No", assigneeIds: [] })).status).toBe(403);
    const nonMember = await createTask(family.id, family.admin.token, { name: "Bad", assigneeIds: [outsider.id] });
    expect((await nonMember.json<any>()).error.code).toBe("ASSIGNEE_NOT_FAMILY_MEMBER");
    const duplicate = await createTask(family.id, family.admin.token, { name: "Bad", assigneeIds: [family.admin.id, family.admin.id] });
    expect((await duplicate.json<any>()).error.code).toBe("DUPLICATE_ASSIGNEE");
    expect((await createTask(family.id, family.admin.token, { name: "Bad due", due: "2026-07-25T10:00:00Z", assigneeIds: [] })).status).toBe(400);
  });

  it("completes and reopens a task with optimistic locking", async () => {
    const family = await createFamily("Actions");
    const task = (await (await createTask(family.id, family.admin.token, { name: "Action", assigneeIds: [] })).json<any>()).data;
    const completed = await request(`/api/v1/families/${family.id}/tasks/${task.id}/complete`, family.admin.token, { method: "POST", body: JSON.stringify({ version: 1 }) });
    expect((await completed.json<any>()).data).toMatchObject({ status: "completed", version: 2, completedBy: { userId: family.admin.id } });
    const again = await request(`/api/v1/families/${family.id}/tasks/${task.id}/complete`, family.admin.token, { method: "POST", body: JSON.stringify({ version: 2 }) });
    expect((await again.json<any>()).error.code).toBe("TASK_ALREADY_COMPLETED");
    const reopened = await request(`/api/v1/families/${family.id}/tasks/${task.id}/reopen`, family.admin.token, { method: "POST", body: JSON.stringify({ version: 2 }) });
    expect((await reopened.json<any>()).data).toMatchObject({ status: "pending", completedAt: null, completedBy: null, version: 3 });
  });

  it("filters, sorts, and paginates tasks with no due dates last", async () => {
    const family = await createFamily("Task Lists");
    for (const [name, due] of [["Later", "2026-07-30"], ["Soon", "2026-07-22"], ["No due", null]]) {
      await createTask(family.id, family.admin.token, { name, due, assigneeIds: [family.admin.id] });
    }
    const first = await request(`/api/v1/families/${family.id}/tasks?status=pending&assigneeId=me&dueFrom=2026-07-01&dueTo=2026-07-31&includeNoDue=true&sort=due_asc&limit=2`, family.admin.token);
    expect(first.status, await first.clone().text()).toBe(200);
    const page = await first.json<any>();
    expect(page.data.items.map((item: any) => item.name)).toEqual(["Soon", "Later"]);
    expect(page.data.nextCursor).toBeTypeOf("string");
    const second = await request(`/api/v1/families/${family.id}/tasks?status=pending&assigneeId=me&dueFrom=2026-07-01&dueTo=2026-07-31&includeNoDue=true&sort=due_asc&limit=2&cursor=${encodeURIComponent(page.data.nextCursor)}`, family.admin.token);
    expect((await second.json<any>()).data.items.map((item: any) => item.name)).toEqual(["No due"]);
  });
});
