/// <reference types="@cloudflare/vitest-pool-workers/types" />

import {
  issueToken,
  issueWorkspaceShareToken,
  request,
  setupBeforeAll,
  setupBeforeEach,
} from "./helpers";

beforeAll(setupBeforeAll);
beforeEach(setupBeforeEach);

it("publishes a draft post for its author", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/posts/post-draft/publish", { method: "POST", token });
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: "post-draft", status: "published" },
  });
});

it("allows anonymous reads of published posts", async () => {
  const res = await request("/posts/post-published");
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    data: { id: "post-published", status: "published" },
  });
});

it("lists only published posts publicly and private drafts through Content IAM", async () => {
  const publicRes = await request("/posts");
  expect(publicRes.status).toBe(200);
  const publicBody = await publicRes.json() as { data: Array<{ id: string }> };
  expect(publicBody.data.map((post) => post.id)).toEqual(["post-published"]);

  const ownerToken = await issueToken("user-alice", { scope: "content:read" });
  const ownerRes = await request("/posts", { token: ownerToken });
  expect(ownerRes.status).toBe(200);
  const ownerBody = await ownerRes.json() as { data: Array<{ id: string }> };
  expect(ownerBody.data.map((post) => post.id)).toEqual(["post-published", "post-draft"]);
});

it("allows the owner to publish media and anonymous users to read it after publish", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const publishRes = await request("/media/media-alice/publish", { method: "POST", token });
  expect(publishRes.status).toBe(200);

  const getRes = await request("/media/media-alice");
  expect(getRes.status).toBe(200);
  await expect(getRes.json()).resolves.toMatchObject({
    data: {
      id: "media-alice",
      visibility: "public",
      variantUrls: { medium: "/media/media-alice/v/1/variants/medium" },
    },
  });
});

it("creates pending media upload rows and returns presigned upload instructions", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const res = await request("/media", {
    method: "POST",
    token,
    body: JSON.stringify({
      alt: "Queued upload",
      filename: "queued-upload.png",
      mimeType: "image/png",
      filesize: 2048,
    }),
  });
  expect(res.status).toBe(201);
  await expect(res.json()).resolves.toMatchObject({
    data: {
      media: {
        alt: "Queued upload",
        filename: "queued-upload.png",
        mimeType: "image/png",
        filesize: 2048,
        status: "pending_upload",
        visibility: "private",
      },
      upload: {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
      },
    },
  });
});

it("does not allow pending media to be published", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const createRes = await request("/media", {
    method: "POST",
    token,
    body: JSON.stringify({
      alt: "Pending publish",
      filename: "pending-publish.png",
      mimeType: "image/png",
      filesize: 2048,
    }),
  });
  const created = await createRes.json() as { data: { media: { id: string } } };

  const publishRes = await request(`/media/${created.data.media.id}/publish`, {
    method: "POST",
    token,
  });
  expect(publishRes.status).toBe(409);
});

it("does not allow anonymous reads of pending media", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const createRes = await request("/media", {
    method: "POST",
    token,
    body: JSON.stringify({
      alt: "Pending anonymous read",
      filename: "pending-anon.png",
      mimeType: "image/png",
      filesize: 2048,
    }),
  });
  const created = await createRes.json() as { data: { media: { id: string } } };

  const getRes = await request(`/media/${created.data.media.id}`);
  expect(getRes.status).toBe(403);
});

it("streams a stored media variant through the API worker", async () => {
  const token = await issueWorkspaceShareToken("user-alice");
  const publishRes = await request("/media/media-alice/publish", { method: "POST", token });
  expect(publishRes.status).toBe(200);

  const variantRes = await request("/media/media-alice/v/1/variants/medium");
  expect(variantRes.status).toBe(200);
  expect(variantRes.headers.get("content-type")).toBe("image/webp");
  expect(variantRes.headers.get("cache-control")).toContain("public");
  const variantBody = await variantRes.arrayBuffer();
  expect(new TextDecoder().decode(variantBody)).toBe("medium-image");
});
