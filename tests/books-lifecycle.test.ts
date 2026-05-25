/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:test";
import { createDb } from "@/infrastructure/db/client";
import { DrizzleBookRepository } from "@/infrastructure/repositories/drizzle-book.repository";
import {
  bootstrapContentIamAdmin,
  issueToken,
  issueWorkspaceShareToken,
  request,
  seedBookOwner,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";


async function createBook(token: string): Promise<string> {
  const res = await request("/books", {
    method: "POST",
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ title: "Lifecycle Test Book" }),
  });
  expect(res.status).toBe(201);
  const body = await res.json() as { data: { id: string } };
  return body.data.id;
}

describe("books-lifecycle", () => {
  beforeAll(setupBeforeAll);
  beforeEach(setupBeforeEach);

it("publishes a draft book and makes it publicly readable when visibility is public", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);

  await request(`/books/${bookId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ visibility: "public" }),
  });

  const publish = await request(`/books/${bookId}/publish`, { method: "POST", token });
  expect(publish.status).toBe(200);
  await expect(publish.json()).resolves.toMatchObject({
    data: { id: bookId, status: "published", visibility: "public" },
  });

  const anon = await request(`/books/${bookId}`);
  expect(anon.status).toBe(200);
});

it("unpublishes a published book back to draft", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);
  await request(`/books/${bookId}/publish`, { method: "POST", token });

  const res = await request(`/books/${bookId}/unpublish`, { method: "POST", token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: bookId, status: "draft" },
  });
});

it("schedules a draft book with a future timestamp", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);
  const future = new Date(Date.now() + 3_600_000).toISOString();

  const res = await request(`/books/${bookId}/schedule`, {
    method: "POST",
    token,
    body: JSON.stringify({ scheduledAt: future }),
  });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: bookId, status: "scheduled", scheduledAt: future },
  });
});

it("rejects a schedule request with a past timestamp", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);
  const past = new Date(Date.now() - 1000).toISOString();

  const res = await request(`/books/${bookId}/schedule`, {
    method: "POST",
    token,
    body: JSON.stringify({ scheduledAt: past }),
  });
  expect(res.status).toBe(400);
});

it("cancels a scheduled book back to draft via unpublish", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await request(`/books/${bookId}/schedule`, {
    method: "POST",
    token,
    body: JSON.stringify({ scheduledAt: future }),
  });

  const res = await request(`/books/${bookId}/unpublish`, { method: "POST", token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: bookId, status: "draft", scheduledAt: null },
  });
});

it("archives a draft book and rejects a second archive attempt", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);

  const first = await request(`/books/${bookId}/archive`, { method: "POST", token });
  expect(first.status).toBe(200);
  await expect(first.json()).resolves.toMatchObject({
    data: { id: bookId, status: "archived" },
  });

  const second = await request(`/books/${bookId}/archive`, { method: "POST", token });
  expect(second.status).toBe(409);
});

it("rejects publish on an already-published book with 409", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);
  await request(`/books/${bookId}/publish`, { method: "POST", token });

  const res = await request(`/books/${bookId}/publish`, { method: "POST", token });
  expect(res.status).toBe(409);
});

it("rejects book lifecycle actions without content:write scope", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);

  const readOnly = await issueToken("user-alice", { scope: "content:read", orgId: "org-main" });
  const responses = await Promise.all([
    request(`/books/${bookId}/publish`, { method: "POST", token: readOnly }),
    request(`/books/${bookId}/archive`, { method: "POST", token: readOnly }),
    request(`/books/${bookId}/schedule`, {
      method: "POST",
      token: readOnly,
      body: JSON.stringify({ scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }),
    }),
  ]);
  expect(responses.every((r) => r.status === 403)).toBe(true);
});

it("rejects book lifecycle actions for a user without a policy binding", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);

  const bob = await issueWorkspaceShareToken("user-bob");
  const publish = await request(`/books/${bookId}/publish`, { method: "POST", token: bob });
  expect(publish.status).toBe(403);

  const archive = await request(`/books/${bookId}/archive`, { method: "POST", token: bob });
  expect(archive.status).toBe(403);
});

it("book.update is rejected on an archived book", async () => {
  const token = await bootstrapContentIamAdmin();
  await seedBookOwner();
  await env.DB.prepare("UPDATE books SET status = 'archived' WHERE id = 'book-main'").run();

  const res = await request("/books/book-main", {
    method: "PATCH",
    token,
    body: JSON.stringify({ title: "Renamed Archived Book" }),
  });
  expect(res.status).toBe(409);
});

it("prevents stale metadata saves from modifying an archived book", async () => {
  const token = await bootstrapContentIamAdmin();
  const bookId = await createBook(token);
  const repo = new DrizzleBookRepository(createDb(env as never));
  const stale = await repo.findById(bookId);
  expect(stale).not.toBeNull();
  stale!.update({ title: "Stale Rename" });

  const archive = await request(`/books/${bookId}/archive`, { method: "POST", token });
  expect(archive.status).toBe(200);
  await expect(repo.save(stale!)).rejects.toThrow("Cannot update an archived book");

  const row = await env.DB.prepare("SELECT status, title FROM books WHERE id = ?")
    .bind(bookId)
    .first<{ status: string; title: string }>();
  expect(row).toMatchObject({ status: "archived", title: "Lifecycle Test Book" });
});
});
