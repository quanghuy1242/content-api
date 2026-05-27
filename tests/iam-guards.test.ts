/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import {
  bootstrapContentIamAdmin,
  countRows,
  issueToken,
  issueWorkspaceShareToken,
  request,
  seedBookOwner,
  setIntrospectionBehavior,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

describe("iam-guards", () => {
  beforeAll(setupBeforeAll);
  beforeEach(setupBeforeEach);

it("requires organization membership for sensitive direct-user Content IAM targets", async () => {
  const token = await bootstrapContentIamAdmin();

  const sharingManagerRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "wrong-org" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(sharingManagerRes.status).toBe(400);

  await seedBookOwner();
  const ownershipRes = await request("/books/book-main/ownership-transfer", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedCurrentOwnerUserId: "user-alice",
      nextOwnerUserId: "wrong-org",
    }),
  });
  expect(ownershipRes.status).toBe(400);
});

it("rejects cross-organization use of tenant-owned content roles", async () => {
  const orgMainToken = await bootstrapContentIamAdmin();
  const createRole = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token: orgMainToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "tenant-reader",
      name: "Tenant Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  expect(createRole.status).toBe(201);
  const role = await createRole.json() as { data: { id: string } };

  await env.DB.prepare("insert into books (id, org_id, title, created_by_user_id, visibility, status) values (?, ?, ?, ?, ?, ?)")
    .bind("book-other-org", "org-other", "Other Organization Book", "user-bob", "private", "draft")
    .run();
  const otherToken = await issueToken("user-bob", {
    orgId: "org-other",
    scope: "content:read content:write content:share",
  });
  const bootstrapOther = await request("/organizations/org-other/content-iam/bootstrap", {
    method: "POST",
    token: otherToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-bob" }),
  });
  expect(bootstrapOther.status).toBe(201);

  const bindForeignRole = await request("/books/book-other-org/policy-bindings", {
    method: "POST",
    token: otherToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: role.data.id,
    }),
  });
  expect(bindForeignRole.status).toBe(404);
});

it("requires the dedicated route and preserves the final organization Content IAM administrator", async () => {
  const token = await bootstrapContentIamAdmin();
  const row = await env.DB.prepare(
    "select id from content_policy_bindings where role_id = ? and resource_type = ? and resource_id = ?",
  )
    .bind("system:org.content_admin", "org", "org-main")
    .first<{ id: string }>();
  expect(row?.id).toBeTruthy();

  const res = await request(`/organizations/org-main/policy-bindings/${row!.id}`, {
    method: "DELETE",
    token,
  });
  expect(res.status).toBe(400);

  const dedicatedRes = await request(`/organizations/org-main/content-admins/${row!.id}`, {
    method: "DELETE",
    token,
  });
  expect(dedicatedRes.status).toBe(400);
});

it("enforces organization bootstrap and final-admin invariants under competing requests", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const bootstrapResults = await Promise.all([
    request("/organizations/org-main/content-iam/bootstrap", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ userId: "user-alice" }),
    }),
    request("/organizations/org-main/content-iam/bootstrap", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ userId: "user-alice" }),
    }),
  ]);
  expect(bootstrapResults.filter((result) => result.status === 201)).toHaveLength(1);
  expect([403, 409]).toContain(bootstrapResults.find((result) => result.status !== 201)?.status);
  expect(await countRows("select count(*) as count from content_iam_bootstrap_organizations where org_id = ?", "org-main")).toBe(1);
  expect(await countRows("select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ?", "system:org.content_admin", "org-main")).toBe(1);

  const delegate = await request("/organizations/org-main/content-admins", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-bob" }),
  });
  expect(delegate.status).toBe(201);
  const delegateBody = await delegate.json() as { data: { id: string } };
  const aliceBinding = await env.DB.prepare(
    "select id from content_policy_bindings where role_id = ? and resource_id = ? and principal_id = ?",
  )
    .bind("system:org.content_admin", "org-main", "user-alice")
    .first<{ id: string }>();
  expect(aliceBinding?.id).toBeTruthy();

  const revokes = await Promise.all([
    request(`/organizations/org-main/content-admins/${aliceBinding!.id}`, { method: "DELETE", token }),
    request(`/organizations/org-main/content-admins/${delegateBody.data.id}`, { method: "DELETE", token }),
  ]);
  expect(revokes.filter((result) => result.status === 204)).toHaveLength(1);
  expect(await countRows("select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ?", "system:org.content_admin", "org-main")).toBe(1);
});

it("rejects stale concurrent role replacements at the write boundary", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "racing-reader",
      name: "Racing Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const created = await createRes.json() as { data: { id: string; version: number } };
  const replacements = await Promise.all([
    request(`/organizations/org-main/content-roles/${created.data.id}/permissions`, {
      method: "PUT",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: created.data.version, permissions: ["book.read", "comment.create"] }),
    }),
    request(`/organizations/org-main/content-roles/${created.data.id}/permissions`, {
      method: "PUT",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ expectedVersion: created.data.version, permissions: ["book.read", "inline_comment.create"] }),
    }),
  ]);
  expect(replacements.filter((result) => result.status === 201)).toHaveLength(1);
  expect(replacements.filter((result) => result.status === 409)).toHaveLength(1);
});

it("preserves role lifecycle consistency during competing bind and disable requests", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "racing-disable",
      name: "Racing Disable",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  expect(createRes.status).toBe(201);
  const role = await createRes.json() as { data: { id: string } };

  const [bindResult, disableResult] = await Promise.all([
    request("/books/book-main/policy-bindings", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        principal: { type: "user", id: "user-bob" },
        roleId: role.data.id,
      }),
    }),
    request(`/organizations/org-main/content-roles/${role.data.id}`, {
      method: "DELETE",
      token,
    }),
  ]);

  expect([bindResult, disableResult].filter((result) => result.status >= 200 && result.status < 300)).toHaveLength(1);
  expect([bindResult, disableResult].filter((result) => result.status === 400)).toHaveLength(1);
  const bindings = await countRows("select count(*) as count from content_policy_bindings where role_id = ?", role.data.id);
  const disabled = await countRows("select count(*) as count from content_roles where id = ? and enabled = 0", role.data.id);
  expect(bindings + disabled).toBe(1);
});

it("rejects a sensitive upgrade to an already-defined ordinary custom role", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "ordinary-bound-role",
      name: "Ordinary Bound Role",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const role = await createRes.json() as { data: { id: string; version: number } };
  const upgrade = await request(`/organizations/org-main/content-roles/${role.data.id}/permissions`, {
    method: "PUT",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedVersion: role.data.version,
      permissions: ["book.read", "book.manage_bindings"],
    }),
  });
  expect(upgrade.status).toBe(400);
});

it("bounds denied Content IAM audit storage and prunes expired denied events", async () => {
  const token = await bootstrapContentIamAdmin();
  await env.DB.prepare(
    "insert into content_policy_events (id, org_id, target_type, target_id, action, actor_type, actor_id, reason, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind("old-denial-event", "org-main", "org", "org-main", "policy.mutation_denied", "user", "user-alice", "old", Date.now() - (91 * 24 * 60 * 60 * 1000))
    .run();

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const response = await request("/organizations/org-main/content-roles", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        key: `blocked-${attempt}`,
        name: "Blocked Sensitive Role",
        assignableResourceType: "book",
        permissions: ["book.manage_bindings"],
      }),
    });
    expect(response.status).toBe(400);
  }

  expect(await countRows("select count(*) as count from content_policy_events where id = ?", "old-denial-event")).toBe(0);
  expect(await countRows(
    "select count(*) as count from content_policy_events where action = ? and actor_id = ? and target_id = ?",
    "policy.mutation_denied",
    "user-alice",
    "org-main",
  )).toBe(5);
}, 10_000);

it("can recreate expired Content IAM bindings after cleanup", async () => {
  const token = await bootstrapContentIamAdmin();
  await env.DB.prepare(
    "insert into content_policy_bindings (id, org_id, principal_type, principal_id, role_id, resource_type, resource_id, expires_at, created_by_type, created_by_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      "expired-reader-binding",
      "org-main",
      "user",
      "user-bob",
      "system:book.reader",
      "book",
      "book-main",
      Date.now() - 60_000,
      "user",
      "user-alice",
    )
    .run();

  const res = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(res.status).toBe(201);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where principal_id = ? and role_id = ? and resource_id = ?",
    "user-bob",
    "system:book.reader",
    "book-main",
  )).toBe(1);
});

it("Gate B: denies authority-changing mutations when introspection returns inactive", async () => {
  const token = await bootstrapContentIamAdmin();
  setIntrospectionBehavior("inactive");

  const bootstrapRes = await request("/organizations/org-main/content-iam/bootstrap", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-alice" }),
  });
  expect(bootstrapRes.status).toBe(401);

  const bindingRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(bindingRes.status).toBe(401);

  const roleRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "inactive-test-role",
      name: "Inactive Test Role",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  expect(roleRes.status).toBe(401);
});

it("Gate B: denies authority-changing mutations when introspection transport fails", async () => {
  const token = await bootstrapContentIamAdmin();
  setIntrospectionBehavior("transport_error");

  const bindingRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(bindingRes.status).toBe(401);
});
});
