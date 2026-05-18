import { z } from "@hono/zod-openapi";
import { MAX_NAME_LENGTH, MAX_SLUG_LENGTH, SLUG_BASE_MAX_LENGTH, SLUG_SUFFIX_LENGTH } from "@/shared/constants";

export const idSchema = z.string().min(1);
export const emailSchema = z.email();
export const fullNameSchema = z.string().min(1).max(MAX_NAME_LENGTH);
export const slugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const roleSchema = z.enum(["admin", "user"]);
export const statusSchema = z.enum(["draft", "published"]);
export const mediaStatusSchema = z.enum(["pending_upload", "processing", "ready", "failed", "expired"]);
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
  const suffix = crypto.randomUUID().slice(0, SLUG_SUFFIX_LENGTH);
  const base = slugify(title).slice(0, SLUG_BASE_MAX_LENGTH).replace(/-+$/g, "");
  return `${base || "untitled"}-${suffix}`;
}
