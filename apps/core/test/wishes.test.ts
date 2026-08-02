import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createId } from "../src/ids";
import { createFamily, createUser, makeSystemToken, makeToken, request } from "./helpers";

async function addMember(familyId: string, name: string) {
  const member = await createUser(name);
  await env.DB.prepare("INSERT INTO family_members (id,family_id,user_id,role) VALUES (?,?,?,'member')")
    .bind(createId("fmem"), familyId, member.id).run();
  return member;
}

async function createWish(familyId: string, token: string, input: Record<string, unknown> = {}) {
  return request(`/api/v1/families/${familyId}/wishes`, token, {
    method: "POST",
    body: JSON.stringify({ title: "新的愿望", ...input }),
  });
}

describe("family wish API", () => {
  it("creates a wish owned by the current member with date-only details", async () => {
    const family = await createFamily("Wish create");
    const response = await createWish(family.id, family.admin.token, {
      description: "一起去看海",
      desiredDate: "2026-10-01",
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const wish = (await response.json<any>()).data;
    expect(wish).toMatchObject({
      title: "新的愿望", description: "一起去看海", desiredDate: "2026-10-01",
      status: "open", owner: { userId: family.admin.id }, claimant: null,
      fulfilledBy: null, version: 1,
    });
    expect(wish.id).toMatch(/^wsh_/);
    expect(wish.createdBy).toMatchObject({ type: "user", id: family.admin.id });

    expect((await createWish(family.id, family.admin.token, { ownerUserId: family.admin.id })).status).toBe(400);
    expect((await createWish(family.id, family.admin.token, { desiredDate: "2026-02-30" })).status).toBe(400);
  });

  it("lets another member claim and fulfill while rejecting self-claim and stale writes", async () => {
    const family = await createFamily("Wish lifecycle");
    const helper = await addMember(family.id, "Helper");
    const wish = (await (await createWish(family.id, family.admin.token)).json<any>()).data;

    const selfClaim = await request(`/api/v1/families/${family.id}/wishes/${wish.id}/claim`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 1 }),
    });
    expect(selfClaim.status).toBe(409);
    expect((await selfClaim.json<any>()).error.code).toBe("WISH_CANNOT_CLAIM_OWN");

    const claimedResponse = await request(`/api/v1/families/${family.id}/wishes/${wish.id}/claim`, helper.token, {
      method: "POST", body: JSON.stringify({ version: 1 }),
    });
    expect(claimedResponse.status, await claimedResponse.clone().text()).toBe(200);
    const claimed = (await claimedResponse.json<any>()).data;
    expect(claimed).toMatchObject({ status: "claimed", claimant: { userId: helper.id }, version: 2 });
    expect(claimed.claimedAt).toMatch(/Z$/);

    const stale = await request(`/api/v1/families/${family.id}/wishes/${wish.id}/unclaim`, helper.token, {
      method: "POST", body: JSON.stringify({ version: 1 }),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json<any>()).error.code).toBe("VERSION_CONFLICT");

    const released = await request(`/api/v1/families/${family.id}/wishes/${wish.id}/unclaim`, helper.token, {
      method: "POST", body: JSON.stringify({ version: 2 }),
    });
    expect((await released.json<any>()).data).toMatchObject({ status: "open", claimant: null, version: 3 });

    await request(`/api/v1/families/${family.id}/wishes/${wish.id}/claim`, helper.token, {
      method: "POST", body: JSON.stringify({ version: 3 }),
    });

    const fulfilled = await request(`/api/v1/families/${family.id}/wishes/${wish.id}/fulfill`, helper.token, {
      method: "POST", body: JSON.stringify({ version: 4 }),
    });
    expect((await fulfilled.json<any>()).data).toMatchObject({
      status: "fulfilled", claimant: { userId: helper.id }, fulfilledBy: { userId: helper.id }, version: 5,
    });
  });

  it("supports owner editing, reopen, archive, restore, and soft delete", async () => {
    const family = await createFamily("Wish owner actions");
    const helper = await addMember(family.id, "Wish viewer");
    let wish = (await (await createWish(family.id, family.admin.token, { description: "old" })).json<any>()).data;

    expect((await request(`/api/v1/families/${family.id}/wishes/${wish.id}`, helper.token, {
      method: "PATCH", body: JSON.stringify({ title: "No", version: 1 }),
    })).status).toBe(403);

    const edited = await request(`/api/v1/families/${family.id}/wishes/${wish.id}`, family.admin.token, {
      method: "PATCH", body: JSON.stringify({ description: null, desiredDate: "2026-12-31", version: 1 }),
    });
    wish = (await edited.json<any>()).data;
    expect(wish).toMatchObject({ description: null, desiredDate: "2026-12-31", version: 2 });

    const fulfilled = await request(`/api/v1/families/${family.id}/wishes/${wish.id}/fulfill`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 2 }),
    });
    wish = (await fulfilled.json<any>()).data;
    expect(wish).toMatchObject({ status: "fulfilled", fulfilledBy: { userId: family.admin.id }, version: 3 });

    wish = (await (await request(`/api/v1/families/${family.id}/wishes/${wish.id}/reopen`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 3 }),
    })).json<any>()).data;
    expect(wish).toMatchObject({ status: "open", claimant: null, fulfilledBy: null, version: 4 });

    wish = (await (await request(`/api/v1/families/${family.id}/wishes/${wish.id}/archive`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 4 }),
    })).json<any>()).data;
    expect(wish).toMatchObject({ status: "archived", version: 5 });
    expect((await request(`/api/v1/families/${family.id}/wishes/${wish.id}`, family.admin.token, {
      method: "PATCH", body: JSON.stringify({ title: "No", version: 5 }),
    })).status).toBe(409);

    wish = (await (await request(`/api/v1/families/${family.id}/wishes/${wish.id}/restore`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 5 }),
    })).json<any>()).data;
    expect(wish).toMatchObject({ status: "open", version: 6 });
    expect((await request(`/api/v1/families/${family.id}/wishes/${wish.id}?version=6`, family.admin.token, { method: "DELETE" })).status).toBe(204);
    expect((await request(`/api/v1/families/${family.id}/wishes/${wish.id}`, family.admin.token)).status).toBe(404);
  });

  it("lists family wishes with me filters, stable pagination, and bound cursors", async () => {
    const family = await createFamily("Wish lists");
    const helper = await addMember(family.id, "Wish list helper");
    await createWish(family.id, family.admin.token, { title: "Later", desiredDate: "2026-12-01" });
    await createWish(family.id, family.admin.token, { title: "Soon", desiredDate: "2026-09-01" });
    await createWish(family.id, helper.token, { title: "Other", desiredDate: null });

    const first = await request(`/api/v1/families/${family.id}/wishes?ownerUserId=me&sort=default&limit=1`, family.admin.token);
    expect(first.status, await first.clone().text()).toBe(200);
    const page = await first.json<any>();
    expect(page.data.items.map((item: any) => item.title)).toEqual(["Soon"]);
    expect(page.data.nextCursor).toBeTypeOf("string");
    const second = await request(`/api/v1/families/${family.id}/wishes?ownerUserId=me&sort=default&limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`, family.admin.token);
    expect((await second.json<any>()).data.items.map((item: any) => item.title)).toEqual(["Later"]);
    expect((await request(`/api/v1/families/${family.id}/wishes?status=fulfilled&sort=default&limit=1&cursor=${encodeURIComponent(page.data.nextCursor)}`, family.admin.token)).status).toBe(400);
  });

  it("releases a removed member's active claim while retaining owner history", async () => {
    const family = await createFamily("Wish member removal");
    const helper = await addMember(family.id, "Departing helper");
    const wish = (await (await createWish(family.id, family.admin.token)).json<any>()).data;
    const archivedWish = (await (await createWish(family.id, family.admin.token, { title: "Archived claim" })).json<any>()).data;
    await request(`/api/v1/families/${family.id}/wishes/${wish.id}/claim`, helper.token, {
      method: "POST", body: JSON.stringify({ version: 1 }),
    });
    await request(`/api/v1/families/${family.id}/wishes/${archivedWish.id}/claim`, helper.token, {
      method: "POST", body: JSON.stringify({ version: 1 }),
    });
    await request(`/api/v1/families/${family.id}/wishes/${archivedWish.id}/archive`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 2 }),
    });
    expect((await request(`/api/v1/families/${family.id}/members/${helper.id}`, family.admin.token, { method: "DELETE" })).status).toBe(204);
    const after = (await (await request(`/api/v1/families/${family.id}/wishes/${wish.id}`, family.admin.token)).json<any>()).data;
    expect(after).toMatchObject({ status: "open", claimant: null, version: 3 });
    const archivedAfter = (await (await request(`/api/v1/families/${family.id}/wishes/${archivedWish.id}`, family.admin.token)).json<any>()).data;
    expect(archivedAfter).toMatchObject({ status: "archived", claimant: null, version: 4 });
    const restored = await request(`/api/v1/families/${family.id}/wishes/${archivedWish.id}/restore`, family.admin.token, {
      method: "POST", body: JSON.stringify({ version: 4 }),
    });
    expect((await restored.json<any>()).data).toMatchObject({ status: "open", claimant: null, version: 5 });
  });

  it("rejects service principals and outsiders", async () => {
    const family = await createFamily("Wish principal");
    const outsider = await createUser("Wish outsider");
    expect((await request(`/api/v1/families/${family.id}/wishes`, outsider.token)).status).toBe(403);
    expect((await request(`/api/v1/families/${family.id}/wishes`, await makeToken("svc_test", "internal"))).status).toBe(403);
    expect((await request(`/api/v1/families/${family.id}/wishes`, await makeSystemToken("sys_test", "crd_test", "tok_test", "family:read"))).status).toBe(403);
  });
});
