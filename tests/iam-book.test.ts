/// <reference types="@cloudflare/vitest-pool-workers/types" />

import {
  bootstrapContentIamAdmin,
  countRows,
  issueToken,
  issueWorkspaceShareToken,
  request,
  seedBookOwner,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

describe("iam-book", () => {
  beforeAll(setupBeforeAll);
  beforeEach(setupBeforeEach);

it("bootstraps Content IAM, grants a book reader, records denials, and lists audit events", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const bindingRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
      reason: "reader invite",
    }),
  });
  expect(bindingRes.status).toBe(201);
  await expect(bindingRes.json()).resolves.toMatchObject({
    data: {
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
      resource: { type: "book", id: "book-main" },
    },
  });

  const denialRes = await request("/books/book-main/policy-denials", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      permission: "book.read",
      appliesToDescendants: true,
      reason: "temporary hold",
    }),
  });
  expect(denialRes.status).toBe(201);

  const eventsRes = await request("/books/book-main/policy-events", { token });
  expect(eventsRes.status).toBe(200);
  const eventsBody = await eventsRes.json() as { data: Array<{ action: string }> };
  expect(eventsBody.data.map((event) => event.action)).toEqual(
    expect.arrayContaining(["binding.created", "denial.created"]),
  );
});

it("prevents direct-share tokens and sensitive target principals from mutating Content IAM", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const directShareToken = await issueToken("user-alice", { scope: "content:read content:write" });
  const directShareRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: directShareToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(directShareRes.status).toBe(403);

  const teamManagerRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "team", id: "team-authors" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(teamManagerRes.status).toBe(400);

  const ownerGrantRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.owner",
    }),
  });
  expect(ownerGrantRes.status).toBe(400);
});

it("audits workspace self-escalation without creating authority and rejects M2M sensitive targets", async () => {
  const token = await bootstrapContentIamAdmin();
  const unauthorizedToken = await issueWorkspaceShareToken("user-bob");
  const selfGrantRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: unauthorizedToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(selfGrantRes.status).toBe(403);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where principal_id = ? and role_id = ? and resource_id = ?",
    "user-bob",
    "system:book.sharing_manager",
    "book-main",
  )).toBe(0);
  expect(await countRows(
    "select count(*) as count from content_policy_events where action = ? and actor_id = ? and target_id = ?",
    "policy.mutation_denied",
    "user-bob",
    "book-main",
  )).toBe(1);

  const serviceManagementRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "service_account", id: "client-content-bot" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(serviceManagementRes.status).toBe(400);
});

it("allows organization authors to be delegated through ordinary org bindings", async () => {
  const token = await bootstrapContentIamAdmin();
  const res = await request("/organizations/org-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:org.author",
      reason: "author delegation",
    }),
  });
  expect(res.status).toBe(201);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      principal: { type: "user", id: "user-bob" },
      roleId: "system:org.author",
      resource: { type: "org", id: "org-main" },
    },
  });
});

it("permits validated ordinary external and service-account book bindings but rejects workspace mismatch", async () => {
  const token = await bootstrapContentIamAdmin();

  const externalRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "external-reader" },
      roleId: "system:book.reader",
    }),
  });
  expect(externalRes.status).toBe(201);

  const serviceRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "service_account", id: "client-content-bot" },
      roleId: "system:book.reader",
    }),
  });
  expect(serviceRes.status).toBe(201);

  const mismatchedToken = await issueToken("user-alice", {
    orgId: "org-other",
    scope: "content:read content:write content:share",
  });
  const mismatchRes = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: mismatchedToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(mismatchRes.status).toBe(403);
});

it("shows inherited organization bindings only in the effective book binding view", async () => {
  const token = await bootstrapContentIamAdmin();

  const directRes = await request("/books/book-main/policy-bindings?view=direct", { token });
  expect(directRes.status).toBe(200);
  const directBody = await directRes.json() as { data: Array<{ roleId: string }> };
  expect(directBody.data).toEqual([]);

  const effectiveRes = await request("/books/book-main/policy-bindings?view=effective", { token });
  expect(effectiveRes.status).toBe(200);
  const effectiveBody = await effectiveRes.json() as { data: Array<{ roleId: string; resource: { type: string; id: string } }> };
  expect(effectiveBody.data).toEqual(expect.arrayContaining([
    expect.objectContaining({
      roleId: "system:org.content_admin",
      resource: { type: "org", id: "org-main" },
    }),
  ]));
});

it("does not allow book denial rules to remove owner or organization-admin recovery authority", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const ownerDenial = await request("/books/book-main/policy-denials", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-alice" },
      permission: "book.read",
      appliesToDescendants: true,
      reason: "not allowed",
    }),
  });
  expect(ownerDenial.status).toBe(400);
});

it("prevents sharing managers from delegating or revoking protected sharing-manager authority", async () => {
  const adminToken = await bootstrapContentIamAdmin();
  const createManager = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: adminToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(createManager.status).toBe(201);
  const manager = await createManager.json() as { data: { id: string } };
  const managerToken = await issueWorkspaceShareToken("user-bob");

  const ordinaryGrant = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: managerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-admin" },
      roleId: "system:book.reader",
    }),
  });
  expect(ordinaryGrant.status).toBe(201);

  const protectedGrant = await request("/books/book-main/policy-bindings", {
    method: "POST",
    token: managerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-admin" },
      roleId: "system:book.sharing_manager",
    }),
  });
  expect(protectedGrant.status).toBe(403);

  const protectedRevoke = await request(`/books/book-main/policy-bindings/${manager.data.id}`, {
    method: "DELETE",
    token: managerToken,
  });
  expect(protectedRevoke.status).toBe(403);
});
});
