import { ValidationError } from "@/shared/errors";

export type ContentDelegationClass = "ordinary" | "policy_management" | "ownership_transfer" | "organization_admin";

export type ContentResourceType = "org" | "book" | "chapter" | "section" | "block" | "media" | "comment";

export type PrincipalType = "user" | "team" | "service_account";

export type PrincipalRef = {
  readonly type: PrincipalType;
  readonly id: string;
};

export type ContentPermissionKey =
  | "org.create_book"
  | "org.manage_bindings"
  | "org.manage_roles"
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
  { key: "org.manage_bindings", description: "Manage organization-scoped Content IAM bindings", delegationClass: "organization_admin" },
  { key: "org.manage_roles", description: "Manage organization-defined Content IAM roles", delegationClass: "organization_admin" },
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
    permissions: ["org.manage_bindings", "org.manage_roles", "org.create_book", "book.manage_bindings", "book.transfer_ownership"],
  },
  {
    id: "system:org.author",
    key: "org.author",
    name: "Organization Author",
    assignableResourceType: "org",
    protected: false,
    permissions: ["org.create_book"],
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
