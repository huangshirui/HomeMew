import { describe, expect, it } from "vitest";
import { createFamily, createUser, request } from "./helpers";

async function createTask(familyId: string, token: string, input: Record<string, unknown>) {
  return request(`/api/v1/families/${familyId}/tasks`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

describe("family task API", () => {
  it("creates, updates, and clears a date-only dueDate", async () => {
    const family = await createFamily("Tasks");
    const response = await createTask(family.id, family.admin.token, {
      name: "Homework",
      dueDate: "2026-08-01",
      assigneeIds: [family.admin.id],
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const task = (await response.json<any>()).data;
    expect(task).toMatchObject({ dueDate: "2026-08-01", status: "pending", version: 1 });
    expect(task).not.toHaveProperty("due");

    const updated = await request(`/api/v1/families/${family.id}/tasks/${task.id}`, family.admin.token, {
      method: "PATCH",
      body: JSON.stringify({ dueDate: null, version: 1 }),
    });
    expect((await updated.json<any>()).data).toMatchObject({ dueDate: null, version: 2 });
  });

  it("rejects a PATCH that contains no task change", async () => {
    const family = await createFamily("Task empty patch");
    const task = (await (await createTask(family.id, family.admin.token, {
      name: "No-op",
    })).json<any>()).data;

    const response = await request(
      `/api/v1/families/${family.id}/tasks/${task.id}`,
      family.admin.token,
      {
        method: "PATCH",
        body: JSON.stringify({ version: task.version }),
      },
    );

    expect(response.status).toBe(400);
    expect((await response.json<any>()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects the old due field and timestamp due dates", async () => {
    const family = await createFamily("Task dates");
    expect((await createTask(family.id, family.admin.token, {
      name: "Old",
      due: "2026-08-01",
    })).status).toBe(400);
    expect((await createTask(family.id, family.admin.token, {
      name: "Timestamp",
      dueDate: "2026-08-01T00:00:00Z",
    })).status).toBe(400);
  });

  it("validates family assignees and duplicate IDs", async () => {
    const family = await createFamily("Task validation");
    const outsider = await createUser("Task outsider");
    expect((await createTask(family.id, outsider.token, { name: "No" })).status).toBe(403);
    const nonMember = await createTask(family.id, family.admin.token, {
      name: "Bad",
      assigneeIds: [outsider.id],
    });
    expect((await nonMember.json<any>()).error.code).toBe("ASSIGNEE_NOT_FAMILY_MEMBER");
    const duplicate = await createTask(family.id, family.admin.token, {
      name: "Bad",
      assigneeIds: [family.admin.id, family.admin.id],
    });
    expect((await duplicate.json<any>()).error.code).toBe("DUPLICATE_ASSIGNEE");
  });

  it("completes and reopens with canonical UTC audit timestamps", async () => {
    const family = await createFamily("Task actions");
    const task = (await (await createTask(family.id, family.admin.token, {
      name: "Action",
    })).json<any>()).data;
    const completed = await request(`/api/v1/families/${family.id}/tasks/${task.id}/complete`, family.admin.token, {
      method: "POST",
      body: JSON.stringify({ version: 1 }),
    });
    const data = (await completed.json<any>()).data;
    expect(data).toMatchObject({
      status: "completed",
      version: 2,
      completedBy: { type: "user", id: family.admin.id },
    });
    expect(data.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(data.updatedAt).toMatch(/Z$/);

    const reopened = await request(`/api/v1/families/${family.id}/tasks/${task.id}/reopen`, family.admin.token, {
      method: "POST",
      body: JSON.stringify({ version: 2 }),
    });
    expect((await reopened.json<any>()).data).toMatchObject({
      status: "pending",
      completedAt: null,
      completedBy: null,
      version: 3,
    });
  });

  it("filters and paginates with dueDateFrom and dueDateTo", async () => {
    const family = await createFamily("Task lists");
    for (const [name, dueDate] of [["Later", "2026-08-30"], ["Soon", "2026-08-02"], ["No due", null]]) {
      await createTask(family.id, family.admin.token, {
        name,
        dueDate,
        assigneeIds: [family.admin.id],
      });
    }

    const query = "status=pending&assigneeId=me&dueDateFrom=2026-08-01&dueDateTo=2026-08-31&includeNoDue=true&sort=due_asc&limit=2";
    const first = await request(`/api/v1/families/${family.id}/tasks?${query}`, family.admin.token);
    expect(first.status, await first.clone().text()).toBe(200);
    const page = await first.json<any>();
    expect(page.data.items.map((item: any) => item.name)).toEqual(["Soon", "Later"]);
    expect(page.data.nextCursor).toBeTypeOf("string");
    const second = await request(
      `/api/v1/families/${family.id}/tasks?${query}&cursor=${encodeURIComponent(page.data.nextCursor)}`,
      family.admin.token,
    );
    expect((await second.json<any>()).data.items.map((item: any) => item.name)).toEqual(["No due"]);

    expect((await request(
      `/api/v1/families/${family.id}/tasks?dueFrom=2026-08-01`,
      family.admin.token,
    )).status).toBe(400);
  });
});
