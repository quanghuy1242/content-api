/// <reference types="@cloudflare/vitest-pool-workers/types" />

import {
  bootstrapContentIamAdmin,
  countRows,
  issueServiceAccountToken,
  issueToken,
  issueWorkspaceShareToken,
  request,
  seedBookOwner,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

beforeAll(setupBeforeAll);
beforeEach(setupBeforeEach);

it("creates a book with its owner binding atomically and replays the result idempotently", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  const first = await request("/organizations/org-main/books", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ title: "Atomic Book" }),
  });
  expect(first.status).toBe(201);
  const firstBody = await first.json() as { data: { id: string; createdByUserId: string } };
  expect(firstBody.data.createdByUserId).toBe("user-alice");

  const replay = await request("/organizations/org-main/books", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ title: "Atomic Book" }),
  });
  expect(replay.status).toBe(201);
  await expect(replay.json()).resolves.toMatchObject({ data: { id: firstBody.data.id } });
  expect(await countRows("select count(*) as count from books where id = ?", firstBody.data.id)).toBe(1);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ? and principal_id = ?",
    "system:book.owner",
    firstBody.data.id,
    "user-alice",
  )).toBe(1);
  expect(await countRows(
    "select count(*) as count from content_policy_events where action = ? and target_id = ?",
    "binding.created",
    firstBody.data.id,
  )).toBe(1);

  const mismatch = await request("/organizations/org-main/books", {
    method: "POST",
    token,
    headers: { "idempotency-key": key },
    body: JSON.stringify({ title: "Changed Input" }),
  });
  expect(mismatch.status).toBe(409);
});

it("allows an organization author to create a privately owned draft book", async () => {
  const adminToken = await bootstrapContentIamAdmin();
  const authorGrant = await request("/organizations/org-main/policy-bindings", {
    method: "POST",
    token: adminToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:org.author",
    }),
  });
  expect(authorGrant.status).toBe(201);
  const authorToken = await issueWorkspaceShareToken("user-bob");
  const created = await request("/organizations/org-main/books", {
    method: "POST",
    token: authorToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Authored Book" }),
  });
  expect(created.status).toBe(201);
  await expect(created.json()).resolves.toMatchObject({
    data: { createdByUserId: "user-bob", visibility: "private", status: "draft" },
  });
});

it("commits only one owned book for concurrent identical idempotent creates", async () => {
  const token = await bootstrapContentIamAdmin();
  const key = crypto.randomUUID();
  const responses = await Promise.all([
    request("/organizations/org-main/books", {
      method: "POST",
      token,
      headers: { "idempotency-key": key },
      body: JSON.stringify({ title: "Concurrent Book" }),
    }),
    request("/organizations/org-main/books", {
      method: "POST",
      token,
      headers: { "idempotency-key": key },
      body: JSON.stringify({ title: "Concurrent Book" }),
    }),
  ]);
  expect(responses.every((r) => r.status === 201)).toBe(true);
  const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ data: { id: string } }>));
  expect(bodies[0].data.id).toBe(bodies[1].data.id);
  expect(await countRows("select count(*) as count from books where title = ?", "Concurrent Book")).toBe(1);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ?",
    "system:book.owner",
    bodies[0].data.id,
  )).toBe(1);
});

it("rejects direct-share creation of an organization-root book", async () => {
  const directShare = await issueToken("user-alice", { scope: "content:write" });
  const directShareCreate = await request("/organizations/org-main/books", {
    method: "POST",
    token: directShare,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Outside Workspace" }),
  });
  expect(directShareCreate.status).toBe(403);
});

it("requires an explicit direct owner for authorized service-account book creation", async () => {
  const adminToken = await bootstrapContentIamAdmin();
  const grantImporter = await request("/organizations/org-main/policy-bindings", {
    method: "POST",
    token: adminToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "service_account", id: "client-content-bot" },
      roleId: "system:org.author",
    }),
  });
  expect(grantImporter.status).toBe(201);

  const importer = await issueServiceAccountToken({ scope: "content:write" });
  const missingOwner = await request("/organizations/org-main/books", {
    method: "POST",
    token: importer,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Ownerless Import" }),
  });
  expect(missingOwner.status).toBe(400);

  const created = await request("/organizations/org-main/books", {
    method: "POST",
    token: importer,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Imported Book", ownerUserId: "user-bob" }),
  });
  expect(created.status).toBe(201);
  const body = await created.json() as { data: { id: string; createdByUserId: string } };
  expect(body.data.createdByUserId).toBe("user-bob");
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where role_id = ? and resource_id = ? and principal_id = ?",
    "system:book.owner",
    body.data.id,
    "user-bob",
  )).toBe(1);
});

it("uses Content IAM for private book reads and updates", async () => {
  const ownerToken = await bootstrapContentIamAdmin();
  const create = await request("/organizations/org-main/books", {
    method: "POST",
    token: ownerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Collaborative Book" }),
  });
  const book = await create.json() as { data: { id: string } };

  const privateAnonymous = await request(`/books/${book.data.id}`);
  expect(privateAnonymous.status).toBe(403);

  const grantReader = await request(`/books/${book.data.id}/policy-bindings`, {
    method: "POST",
    token: ownerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.reader",
    }),
  });
  expect(grantReader.status).toBe(201);

  const reader = await issueToken("user-bob", { scope: "content:read" });
  const privateReader = await request(`/books/${book.data.id}`, { token: reader });
  expect(privateReader.status).toBe(200);

  const readerUpdate = await request(`/books/${book.data.id}`, {
    method: "PATCH",
    token: await issueToken("user-bob", { scope: "content:write" }),
    body: JSON.stringify({ title: "Forbidden Rename" }),
  });
  expect(readerUpdate.status).toBe(403);
});

it("allows public published book reads after an authorized update", async () => {
  const ownerToken = await bootstrapContentIamAdmin();
  const create = await request("/organizations/org-main/books", {
    method: "POST",
    token: ownerToken,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Published Book" }),
  });
  const book = await create.json() as { data: { id: string } };

  const publish = await request(`/books/${book.data.id}`, {
    method: "PATCH",
    token: ownerToken,
    body: JSON.stringify({ visibility: "public", status: "published" }),
  });
  expect(publish.status).toBe(200);

  const publicRead = await request(`/books/${book.data.id}`);
  expect(publicRead.status).toBe(200);

  const publicList = await request("/books");
  expect(publicList.status).toBe(200);
  const listBody = await publicList.json() as { data: Array<{ id: string }> };
  expect(listBody.data.map((b) => b.id)).toContain(book.data.id);
});

it("transfers book ownership atomically and rejects stale ownership transfers", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const transferRes = await request("/books/book-main/ownership-transfer", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedCurrentOwnerUserId: "user-alice",
      nextOwnerUserId: "user-bob",
      reason: "handoff",
    }),
  });
  expect(transferRes.status).toBe(201);
  await expect(transferRes.json()).resolves.toMatchObject({
    nextOwner: {
      principal: { type: "user", id: "user-bob" },
      roleId: "system:book.owner",
    },
  });

  const staleRes = await request("/books/book-main/ownership-transfer", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      expectedCurrentOwnerUserId: "user-alice",
      nextOwnerUserId: "user-admin",
    }),
  });
  expect(staleRes.status).toBe(409);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where resource_type = ? and resource_id = ? and role_id = ?",
    "book",
    "book-main",
    "system:book.owner",
  )).toBe(1);
});

it("allows only one competing book ownership transfer to commit", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();

  const transfers = await Promise.all([
    request("/books/book-main/ownership-transfer", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        expectedCurrentOwnerUserId: "user-alice",
        nextOwnerUserId: "user-bob",
      }),
    }),
    request("/books/book-main/ownership-transfer", {
      method: "POST",
      token,
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        expectedCurrentOwnerUserId: "user-alice",
        nextOwnerUserId: "user-admin",
      }),
    }),
  ]);
  expect(transfers.filter((r) => r.status === 201)).toHaveLength(1);
  expect(transfers.filter((r) => r.status === 409)).toHaveLength(1);
  expect(await countRows(
    "select count(*) as count from content_policy_bindings where resource_type = ? and resource_id = ? and role_id = ?",
    "book",
    "book-main",
    "system:book.owner",
  )).toBe(1);
});
