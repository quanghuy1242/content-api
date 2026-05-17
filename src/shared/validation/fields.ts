import { z } from "@hono/zod-openapi";

export const idSchema = z.string().min(1);
export const emailSchema = z.email();
export const fullNameSchema = z.string().min(1).max(255);
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const roleSchema = z.enum(["admin", "user"]);
export const statusSchema = z.enum(["draft", "published"]);
export const mediaStatusSchema = z.enum(["ready"]);
export const mediaVisibilitySchema = z.enum(["private", "public"]);
export const grantMirrorEntityTypeSchema = z.enum(["book", "chapter", "comment"]);
export const subjectTypeSchema = z.enum(["user", "group", "api_key"]);
export const sourceSubjectTypeSchema = z.enum(["user", "group"]);
export const syncStatusSchema = z.enum(["active", "revoked", "pending"]);
export const deferredGrantStatusSchema = z.enum(["pending", "processed", "expired"]);
export const deferredGrantTypeSchema = z.enum(["grant", "revocation_tombstone"]);

/**
 * Deterministic slug generation for resources whose docs use `createSlugHook`.
 */
export function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug || "untitled";
}

/**
 * Post slugs intentionally include entropy because the Payload source uses
 * `createRandomizedSlugHook('title')` for posts rather than deterministic slugs.
 */
export function randomizedSlugFromTitle(title: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const base = slugify(title).slice(0, 111).replace(/-+$/g, "");
  return `${base || "untitled"}-${suffix}`;
}
