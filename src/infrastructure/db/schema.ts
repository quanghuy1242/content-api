import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  avatar: text("avatar"),
  bioJson: text("bio_json", { mode: "json" }),
  role: text("role").notNull().default("user"),
  betterAuthUserId: text("better_auth_user_id").unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  image: text("image").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  excerpt: text("excerpt"),
  contentJson: text("content_json", { mode: "json" }).notNull(),
  coverImage: text("cover_image"),
  author: text("author").notNull().references(() => users.id, { onDelete: "restrict" }),
  category: text("category").notNull().references(() => categories.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("draft"),
  publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  alt: text("alt").notNull(),
  lowResUrl: text("low_res_url"),
  optimizedUrl: text("optimized_url"),
  owner: text("owner").notNull().references(() => users.id, { onDelete: "restrict" }),
  url: text("url"),
  thumbnailURL: text("thumbnail_url"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  filesize: integer("filesize").notNull(),
  width: integer("width"),
  height: integer("height"),
  focalX: real("focal_x"),
  focalY: real("focal_y"),
  originalKey: text("original_key"),
  variantKeysJson: text("variant_keys_json", { mode: "json" }).notNull().default("{}"),
  uploadExpiresAt: integer("upload_expires_at", { mode: "timestamp_ms" }),
  status: text("status").notNull().default("pending_upload"),
  visibility: text("visibility").notNull().default("private"),
  version: integer("version").notNull().default(1),
  failureReason: text("failure_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  uniqueIndex("media_original_key_unique").on(table.originalKey),
  index("media_status_upload_expires_idx").on(table.status, table.uploadExpiresAt),
]);

export const grantMirror = sqliteTable(
  "grant_mirror",
  {
    id: text("id").primaryKey(),
    autherTupleId: text("auther_tuple_id").notNull().unique(),
    payloadUserId: text("payload_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    relation: text("relation").notNull(),
    sourceSubjectType: text("source_subject_type").notNull(),
    requiresLiveCheck: integer("requires_live_check", { mode: "boolean" }).notNull().default(false),
    syncStatus: text("sync_status").notNull().default("active"),
    syncedAt: integer("synced_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("grant_mirror_payload_user_entity_status_idx").on(table.payloadUserId, table.entityType, table.syncStatus),
    index("grant_mirror_source_subject_payload_user_idx").on(table.sourceSubjectType, table.payloadUserId),
    index("grant_mirror_sync_status_synced_at_idx").on(table.syncStatus, table.syncedAt),
  ],
);

export const deferredGrants = sqliteTable("deferred_grants", {
  id: text("id").primaryKey(),
  betterAuthUserId: text("better_auth_user_id").notNull(),
  tupleId: text("tuple_id").notNull().unique(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  relation: text("relation").notNull(),
  sourceSubjectType: text("source_subject_type").notNull(),
  hasCondition: integer("has_condition", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("pending"),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  type: text("type").notNull().default("grant"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const relationships = sqliteTable(
  "relationships",
  {
    id: text("id").primaryKey(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    relation: text("relation").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("relationships_unique_idx").on(
      table.subjectType,
      table.subjectId,
      table.relation,
      table.objectType,
      table.objectId,
    ),
    index("relationships_subject_idx").on(table.subjectType, table.subjectId),
    index("relationships_object_idx").on(table.objectType, table.objectId),
  ],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").notNull(),
    actorId: text("actor_id").notNull(),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json"),
    status: integer("status").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.actorId, table.route] }),
    index("idempotency_actor_route_expires_idx").on(table.actorId, table.route, table.expiresAt),
  ],
);
