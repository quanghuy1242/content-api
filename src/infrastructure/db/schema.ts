import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex, index, primaryKey } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  avatar: text("avatar"),
  bioJson: text("bio_json", { mode: "json" }),
  role: text("role").notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
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
  orgId: text("org_id").notNull(),
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
  orgId: text("org_id").notNull(),
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

export const books = sqliteTable("books", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  title: text("title").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  visibility: text("visibility").notNull().default("private"),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("books_org_status_idx").on(table.orgId, table.status),
  index("books_created_by_idx").on(table.createdByUserId),
]);

export const contentPermissions = sqliteTable("content_permissions", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  delegationClass: text("delegation_class").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const contentRoles = sqliteTable(
  "content_roles",
  {
    id: text("id").primaryKey(),
    namespaceId: text("namespace_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    assignableResourceType: text("assignable_resource_type").notNull(),
    builtIn: integer("built_in", { mode: "boolean" }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    version: integer("version").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("content_roles_namespace_key_idx").on(table.namespaceId, table.key),
    index("content_roles_resource_type_idx").on(table.assignableResourceType, table.enabled),
  ],
);

export const contentRolePermissions = sqliteTable(
  "content_role_permissions",
  {
    roleId: text("role_id").notNull().references(() => contentRoles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull().references(() => contentPermissions.key, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("content_role_permissions_unique_idx").on(table.roleId, table.permissionKey),
  ],
);

export const contentPolicyBindings = sqliteTable(
  "content_policy_bindings",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    roleId: text("role_id").notNull().references(() => contentRoles.id, { onDelete: "restrict" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("content_policy_bindings_unique_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.roleId,
      table.resourceType,
      table.resourceId,
    ),
    index("content_policy_bindings_principal_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.resourceType,
      table.resourceId,
    ),
    index("content_policy_bindings_resource_idx").on(table.orgId, table.resourceType, table.resourceId, table.roleId),
    index("content_policy_bindings_expiry_idx").on(table.expiresAt),
    uniqueIndex("content_policy_bindings_single_book_owner_idx")
      .on(table.orgId, table.resourceType, table.resourceId)
      .where(sql`${table.resourceType} = 'book' AND ${table.roleId} = 'system:book.owner'`),
  ],
);

export const contentPolicyDenials = sqliteTable(
  "content_policy_denials",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    permissionKey: text("permission_key").notNull().references(() => contentPermissions.key, { onDelete: "restrict" }),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    appliesToDescendants: integer("applies_to_descendants", { mode: "boolean" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    reason: text("reason"),
    createdByType: text("created_by_type").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("content_policy_denials_unique_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.permissionKey,
      table.resourceType,
      table.resourceId,
    ),
    index("content_policy_denials_lookup_idx").on(
      table.orgId,
      table.principalType,
      table.principalId,
      table.permissionKey,
      table.resourceType,
      table.resourceId,
    ),
    index("content_policy_denials_expiry_idx").on(table.expiresAt),
  ],
);

export const contentPolicyEvents = sqliteTable("content_policy_events", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  action: text("action").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  requestId: text("request_id"),
  reason: text("reason"),
  snapshotJson: text("snapshot_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
}, (table) => [
  index("content_policy_events_target_idx").on(table.orgId, table.targetType, table.targetId, table.createdAt),
  index("content_policy_events_actor_idx").on(table.orgId, table.actorType, table.actorId, table.createdAt),
]);

export const contentIamBootstrapOrganizations = sqliteTable("content_iam_bootstrap_organizations", {
  orgId: text("org_id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

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
