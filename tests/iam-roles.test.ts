/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { assertContentPermissionKey, BUILT_IN_CONTENT_ROLES } from "@/domain/iam/content-permission";
import {
  bootstrapContentIamAdmin,
  countRows,
  principalValidationTokenRequests,
  request,
  seedBookOwner,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

beforeAll(setupBeforeAll);
beforeEach(setupBeforeEach);

it("registers lifecycle and site-config permissions in the built-in role catalog", () => {
  expect(() => assertContentPermissionKey("post.archive")).not.toThrow();
  expect(() => assertContentPermissionKey("book.publish")).not.toThrow();
  expect(() => assertContentPermissionKey("site_config.publish")).not.toThrow();

  const siteManager = BUILT_IN_CONTENT_ROLES.find((role) => role.id === "system:org.site_manager");
  expect(siteManager?.permissions).toEqual([
    "org.create_site_config",
    "site_config.read",
    "site_config.update",
    "site_config.publish",
    "site_config.archive",
    "site_config.delete",
  ]);
});

it("manages ordinary organization-defined roles and rejects sensitive custom role composition", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "commenter",
      name: "Commenter",
      assignableResourceType: "book",
      permissions: ["book.read", "comment.create"],
      reason: "test role",
    }),
  });
  expect(createRes.status).toBe(201);
  const created = await createRes.json() as { data: { id: string; version: number } };

  const updateRes = await request(`/organizations/org-main/content-roles/${created.data.id}/permissions`, {
    method: "PUT",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedVersion: created.data.version,
      permissions: ["book.read", "comment.create", "inline_comment.create"],
    }),
  });
  expect(updateRes.status).toBe(201);

  const sensitiveRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "sensitive",
      name: "Sensitive",
      assignableResourceType: "book",
      permissions: ["book.read", "book.manage_bindings"],
    }),
  });
  expect(sensitiveRes.status).toBe(400);

  const eventsRes = await request("/organizations/org-main/policy-events", { token });
  expect(eventsRes.status).toBe(200);
  const events = await eventsRes.json() as { data: Array<{ action: string }> };
  expect(events.data.map((event) => event.action)).toContain("policy.mutation_denied");
});

it("rejects disabling roles with active bindings", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "lifecycle-reader",
      name: "Lifecycle Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const created = await createRes.json() as { data: { id: string } };

  const bindRoleRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: created.data.id,
    }),
  });
  expect(bindRoleRes.status).toBe(201);
  const boundRole = await bindRoleRes.json() as { data: { id: string } };

  const activeDisableRes = await request(`/organizations/org-main/content-roles/${created.data.id}`, {
    method: "DELETE",
    token,
  });
  expect(activeDisableRes.status).toBe(400);
  expect(boundRole.data.id).toBeTruthy();
});

it("rejects assigning disabled roles", async () => {
  const token = await bootstrapContentIamAdmin();
  const createRes = await request("/organizations/org-main/content-roles", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      key: "disabled-reader",
      name: "Disabled Reader",
      assignableResourceType: "book",
      permissions: ["book.read"],
    }),
  });
  const created = await createRes.json() as { data: { id: string } };

  const disableRes = await request(`/organizations/org-main/content-roles/${created.data.id}`, {
    method: "DELETE",
    token,
  });
  expect(disableRes.status).toBe(204);

  const disabledBindRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: created.data.id,
    }),
  });
  expect(disabledBindRes.status).toBe(400);
});

it("returns 400 when Content IAM principal validation fails for durable writes", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const missingUserRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "missing-user" },
      roleId: "system:book.reader",
    }),
  });
  expect(missingUserRes.status).toBe(400);

  const missingTeamRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "team", id: "missing-team" },
      roleId: "system:book.reader",
    }),
  });
  expect(missingTeamRes.status).toBe(400);

  const wrongOrgTeamRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "team", id: "wrong-org" },
      roleId: "system:book.reader",
    }),
  });
  expect(wrongOrgTeamRes.status).toBe(400);
});

it("uses M2M client credentials for principal validation and caches the token", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const bindingRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(bindingRes.status).toBe(201);

  const denialRes = await request("/books/book-main/policy-denials", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      permission: "book.read",
      appliesToDescendants: true,
      reason: "test denial",
    }),
  });
  expect(denialRes.status).toBe(201);
  expect(principalValidationTokenRequests).toBe(1);
});

it("rejects bootstrap after a local organization Content IAM admin exists", async () => {
  const token = await bootstrapContentIamAdmin();
  const res = await request("/organizations/org-main/content-iam/bootstrap", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ userId: "user-alice", reason: "second bootstrap" }),
  });
  expect(res.status).toBe(403);
});

it("does not replay Content IAM idempotency across different resource path params", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  await env.DB.prepare("insert into books (id, org_id, title, created_by_user_id, visibility, status) values (?, ?, ?, ?, ?, ?)")
    .bind("book-other", "org-main", "Other Book", "user-alice", "private", "draft")
    .run();

  const body = {
    principal: { type: "user", id: "user-bob" },
    roleId: "system:book.reader",
  };
  const first = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);

  const second = await request("/books/book-other/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(second.status).toBe(409);
});

it("replays identical Content IAM mutations once and rejects mismatched idempotency reuse", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  const body = {
    principal: { type: "user", id: "external-idempotent-reader" },
    roleId: "system:book.reader",
  };
  const first = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  const second = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify(body),
  });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  await expect(second.json()).resolves.toEqual(await first.json());
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where principal_id = ? and resource_id = ?",
    "external-idempotent-reader",
    "book-main",
  )).toBe(1);

  const mismatch = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ ...body, roleId: "system:book.reviewer" }),
  });
  expect(mismatch.status).toBe(409);
});

it("allows exactly one concurrent duplicate binding create to commit", async () => {
  const token = await bootstrapContentIamAdmin();
  const body = JSON.stringify({
    principal: { type: "user", id: "external-race-reader" },
    roleId: "system:book.reader",
  });
  const creates = await Promise.all([
    request("/books/book-main/policy-bindings", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body,
    }),
    request("/books/book-main/policy-bindings", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body,
    }),
  ]);
  expect(creates.filter((r) => r.status === 201)).toHaveLength(1);
  expect(creates.filter((r) => r.status === 409)).toHaveLength(1);
}, 10_000);
