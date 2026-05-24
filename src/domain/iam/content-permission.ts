import { ValidationError } from "@/shared/errors";

export type ContentDelegationClass = "ordinary" | "policy_management" | "ownership_transfer" | "organization_admin";

export type ContentResourceType =
  | "org"
  | "book"
  | "post"
  | "category"
  | "chapter"
  | "section"
  | "block"
  | "media"
  | "comment";

export type PrincipalType = "user" | "team" | "service_account";

export type PrincipalRef = {
  readonly type: PrincipalType;
  readonly id: string;
};

export type ContentPermissionKey =
  | "org.create_book"
  | "org.create_post"
  | "org.create_category"
  | "org.create_media"
  | "org.manage_bindings"
  | "org.manage_roles"
  | "post.read"
  | "post.update"
  | "post.delete"
  | "post.publish"
  | "category.read"
  | "category.update"
  | "category.delete"
  | "book.read"
  | "book.update"
  | "book.delete"
  | "book.manage_bindings"
  | "book.transfer_ownership"
  | "chapter.read"
  | "chapter.create"
  | "chapter.update"
  | "chapter.publish"
  | "section.update"
  | "block.comment"
  | "inline_comment.create"
  | "comment.create"
  | "comment.moderate"
  | "media.read"
  | "media.create"
  | "media.update"
  | "media.attach"
  | "media.delete";

export type ContentPermissionDefinition = {
  readonly key: ContentPermissionKey;
  readonly description: string;
  readonly delegationClass: ContentDelegationClass;
};

export type BuiltInRoleDefinition = {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly assignableResourceType: ContentResourceType;
  readonly permissions: readonly ContentPermissionKey[];
  readonly protected: boolean;
};

/** Ordered sensitivity ranks used to derive a role's highest delegation class. */
const ORDINARY_DELEGATION_RANK = 0;
const POLICY_MANAGEMENT_DELEGATION_RANK = 1;
const OWNERSHIP_TRANSFER_DELEGATION_RANK = 2;
const ORGANIZATION_ADMIN_DELEGATION_RANK = 3;

/** Code-owned Content IAM permissions registered into D1 for role composition. */
export const CONTENT_PERMISSIONS = [
  { key: "org.create_book", description: "Create a book inside an organization", delegationClass: "ordinary" },
  { key: "org.create_post", description: "Create a post inside an organization", delegationClass: "ordinary" },
  { key: "org.create_category", description: "Create a category inside an organization", delegationClass: "ordinary" },
  { key: "org.create_media", description: "Create media inside an organization", delegationClass: "ordinary" },
  { key: "org.manage_bindings", description: "Manage organization-scoped Content IAM bindings", delegationClass: "organization_admin" },
  { key: "org.manage_roles", description: "Manage organization-defined Content IAM roles", delegationClass: "organization_admin" },
  { key: "post.read", description: "Read private or draft posts", delegationClass: "ordinary" },
  { key: "post.update", description: "Update posts", delegationClass: "ordinary" },
  { key: "post.delete", description: "Delete posts", delegationClass: "ordinary" },
  { key: "post.publish", description: "Publish or unpublish posts", delegationClass: "ordinary" },
  { key: "category.read", description: "Read categories", delegationClass: "ordinary" },
  { key: "category.update", description: "Update categories", delegationClass: "ordinary" },
  { key: "category.delete", description: "Delete categories", delegationClass: "ordinary" },
  { key: "book.read", description: "Read a private book", delegationClass: "ordinary" },
  { key: "book.update", description: "Update book metadata or content", delegationClass: "ordinary" },
  { key: "book.delete", description: "Delete a book", delegationClass: "ordinary" },
  { key: "book.manage_bindings", description: "Manage book-scoped Content IAM bindings", delegationClass: "policy_management" },
  { key: "book.transfer_ownership", description: "Transfer accountable book ownership", delegationClass: "ownership_transfer" },
  { key: "chapter.read", description: "Read private chapter content", delegationClass: "ordinary" },
  { key: "chapter.create", description: "Create a chapter in a book", delegationClass: "ordinary" },
  { key: "chapter.update", description: "Update chapter content", delegationClass: "ordinary" },
  { key: "chapter.publish", description: "Publish a chapter", delegationClass: "ordinary" },
  { key: "section.update", description: "Update a section", delegationClass: "ordinary" },
  { key: "block.comment", description: "Comment on a block", delegationClass: "ordinary" },
  { key: "inline_comment.create", description: "Create inline comments", delegationClass: "ordinary" },
  { key: "comment.create", description: "Create comments", delegationClass: "ordinary" },
  { key: "comment.moderate", description: "Moderate comments", delegationClass: "ordinary" },
  { key: "media.read", description: "Read private media", delegationClass: "ordinary" },
  { key: "media.create", description: "Create media", delegationClass: "ordinary" },
  { key: "media.update", description: "Update media metadata or visibility", delegationClass: "ordinary" },
  { key: "media.attach", description: "Attach media to content", delegationClass: "ordinary" },
  { key: "media.delete", description: "Delete media", delegationClass: "ordinary" },
] as const satisfies readonly ContentPermissionDefinition[];

/** Protected system role templates seeded locally and referenced by deterministic IDs. */
export const BUILT_IN_CONTENT_ROLES = [
  {
    id: "system:org.content_admin",
    key: "org.content_admin",
    name: "Organization Content Administrator",
    assignableResourceType: "org",
    protected: true,
    permissions: [
      "org.manage_bindings",
      "org.manage_roles",
      "org.create_book",
      "org.create_post",
      "org.create_category",
      "org.create_media",
      "book.manage_bindings",
      "book.transfer_ownership",
      "post.read",
      "post.update",
      "post.delete",
      "post.publish",
      "category.read",
      "category.update",
      "category.delete",
      "media.read",
      "media.create",
      "media.update",
      "media.delete",
    ],
  },
  {
    id: "system:org.author",
    key: "org.author",
    name: "Organization Author",
    assignableResourceType: "org",
    protected: false,
    // Categories are org-owned resources, not per-user-owned. Any org author who can create
    // categories can also read, update, and delete them — they collectively manage the shared
    // org taxonomy. See docs/012 for the full decision rationale.
    permissions: [
      "org.create_book",
      "org.create_post",
      "org.create_category",
      "org.create_media",
      "category.read",
      "category.update",
      "category.delete",
    ],
  },
  {
    id: "system:post.owner",
    key: "post.owner",
    name: "Post Owner",
    assignableResourceType: "post",
    protected: true,
    permissions: ["post.read", "post.update", "post.delete", "post.publish", "media.read"],
  },
  {
    id: "system:category.owner",
    key: "category.owner",
    name: "Category Owner",
    assignableResourceType: "category",
    protected: true,
    // Deprecated: no longer assigned on category creation. Categories are org-owned resources
    // managed entirely through org-level roles (system:org.author, system:org.content_admin).
    // This role definition is kept to preserve any historical bindings that may exist in
    // production. See docs/012 for the decision rationale.
    permissions: ["category.read", "category.update", "category.delete", "media.read"],
  },
  {
    id: "system:media.owner",
    key: "media.owner",
    name: "Media Owner",
    assignableResourceType: "media",
    protected: true,
    permissions: ["media.read", "media.create", "media.update", "media.delete"],
  },
  {
    id: "system:book.owner",
    key: "book.owner",
    name: "Book Owner",
    assignableResourceType: "book",
    protected: true,
    permissions: [
      "book.read",
      "book.update",
      "book.delete",
      "book.manage_bindings",
      "book.transfer_ownership",
      "chapter.read",
      "chapter.create",
      "chapter.update",
      "chapter.publish",
      "section.update",
      "inline_comment.create",
      "comment.create",
      "comment.moderate",
      "media.read",
      "media.create",
      "media.update",
      "media.attach",
      "media.delete",
    ],
  },
  {
    id: "system:book.sharing_manager",
    key: "book.sharing_manager",
    name: "Book Sharing Manager",
    assignableResourceType: "book",
    protected: true,
    permissions: ["book.manage_bindings"],
  },
  {
    id: "system:book.author",
    key: "book.author",
    name: "Book Author",
    assignableResourceType: "book",
    protected: false,
    permissions: [
      "book.read",
      "book.update",
      "chapter.read",
      "chapter.create",
      "chapter.update",
      "section.update",
      "inline_comment.create",
      "comment.create",
      "media.read",
      "media.create",
      "media.attach",
    ],
  },
  {
    id: "system:book.editor",
    key: "book.editor",
    name: "Book Editor",
    assignableResourceType: "book",
    protected: false,
    permissions: [
      "book.read",
      "book.update",
      "chapter.read",
      "chapter.update",
      "section.update",
      "inline_comment.create",
      "comment.create",
      "media.read",
      "media.attach",
    ],
  },
  {
    id: "system:book.reviewer",
    key: "book.reviewer",
    name: "Book Reviewer",
    assignableResourceType: "book",
    protected: false,
    permissions: ["book.read", "chapter.read", "inline_comment.create", "comment.create", "media.read"],
  },
  {
    id: "system:book.reader",
    key: "book.reader",
    name: "Book Reader",
    assignableResourceType: "book",
    protected: false,
    permissions: ["book.read", "chapter.read", "media.read"],
  },
] as const satisfies readonly BuiltInRoleDefinition[];

export function delegationRank(delegationClass: ContentDelegationClass): number {
  switch (delegationClass) {
    case "ordinary":
      return ORDINARY_DELEGATION_RANK;
    case "policy_management":
      return POLICY_MANAGEMENT_DELEGATION_RANK;
    case "ownership_transfer":
      return OWNERSHIP_TRANSFER_DELEGATION_RANK;
    case "organization_admin":
      return ORGANIZATION_ADMIN_DELEGATION_RANK;
  }
}

export function deriveDelegationClass(permissionKeys: readonly ContentPermissionKey[]): ContentDelegationClass {
  const definitions = new Map(CONTENT_PERMISSIONS.map((permission) => [permission.key, permission.delegationClass]));
  return permissionKeys.reduce<ContentDelegationClass>((highest, permissionKey) => {
    const next = definitions.get(permissionKey) ?? "ordinary";
    return delegationRank(next) > delegationRank(highest) ? next : highest;
  }, "ordinary");
}

export function assertContentPermissionKey(value: string): asserts value is ContentPermissionKey {
  if (!CONTENT_PERMISSIONS.some((permission) => permission.key === value)) {
    throw new ValidationError("Unsupported content permission", { permission: value });
  }
}
