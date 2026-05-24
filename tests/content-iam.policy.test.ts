import { describe, expect, it } from "vitest";
import type { Actor } from "@/domain/auth/actor";
import { deriveDelegationClass, type PrincipalRef } from "@/domain/iam/content-permission";
import { LocalContentPolicy, principalsForActor } from "@/domain/iam/content-policy";
import type { PolicyBindingRepository } from "@/domain/iam/policy-binding.repository";
import type { PolicyDenialRepository } from "@/domain/iam/policy-denial.repository";

const bookResource = {
  type: "book" as const,
  id: "book-main",
  orgId: "org-main",
  ancestors: [{ type: "org" as const, id: "org-main" }],
};

describe("Content IAM policy", () => {
  it("derives the most sensitive delegation class from permission composition", () => {
    expect(deriveDelegationClass(["book.read", "comment.create"])).toBe("ordinary");
    expect(deriveDelegationClass(["book.read", "book.manage_bindings"])).toBe("policy_management");
    expect(deriveDelegationClass(["book.transfer_ownership", "book.read"])).toBe("ownership_transfer");
  });

  it("applies denial precedence over matching allow bindings", async () => {
    const policy = new LocalContentPolicy(
      bindingRepository({ allowed: true }),
      denialRepository({ denied: true }),
    );

    const allowed = await policy.can({
      actor: workspaceActor(),
      permission: "book.read",
      resource: bookResource,
    });

    expect(allowed).toBe(false);
  });

  it("expands workspace, direct-share, and service-account principals without hot-path id calls", () => {
    expect(principalsForActor(workspaceActor(), "org-main")).toEqual([
      { type: "user", id: "user-alice" },
      { type: "team", id: "team-authors" },
    ]);
    expect(principalsForActor(directShareActor(), "org-main")).toEqual([
      { type: "user", id: "user-alice" },
    ]);
    expect(principalsForActor(serviceAccountActor(), "org-main")).toEqual([
      { type: "service_account", id: "client-content-bot" },
    ]);
  });

  it("batches canMany denial and allow lookups", async () => {
    let allowBatchCalls = 0;
    let denialBatchCalls = 0;
    const policy = new LocalContentPolicy(
      {
        ...bindingRepository({ allowed: true }),
        findAllowedResourceRefs: async (input) => {
          allowBatchCalls += 1;
          return [...input.resources];
        },
      },
      {
        ...denialRepository({ denied: false }),
        findDeniedResourceRefs: async () => {
          denialBatchCalls += 1;
          return [];
        },
      },
    );

    const decisions = await policy.canMany({
      actor: workspaceActor(),
      permission: "book.read",
      resources: [
        bookResource,
        { ...bookResource, id: "book-secondary" },
      ],
    });

    expect(decisions.get("book-main")).toBe(true);
    expect(decisions.get("book-secondary")).toBe(true);
    expect(allowBatchCalls).toBe(1);
    expect(denialBatchCalls).toBe(1);
  });
});

function workspaceActor(): Actor {
  return {
    type: "user",
    id: "user-alice",
    subject: "user-alice",
    role: "user",
    scopes: ["content:read", "content:write", "content:share"],
    organizationId: "org-main",
    teamIds: ["team-authors"],
  };
}

function directShareActor(): Actor {
  return {
    type: "user",
    id: "user-alice",
    subject: "user-alice",
    role: "user",
    scopes: ["content:read", "content:write"],
    teamIds: [],
  };
}

function serviceAccountActor(): Actor {
  return {
    type: "service_account",
    clientId: "client-content-bot",
    organizationId: "org-main",
    scopes: ["content:read", "content:write"],
  };
}

function bindingRepository(params: { allowed: boolean }): PolicyBindingRepository {
  return {
    findMany: async () => ({ data: [], page: {} }),
    findManyForResources: async () => ({ data: [], page: {} }),
    findById: async () => null,
    findActiveBookOwner: async () => null,
    hasActiveDirectUserRoleBinding: async () => false,
    countActiveRoleBindings: async () => 0,
    countActiveBindingsForRole: async () => 0,
    create: async (binding) => binding,
    delete: async () => false,
    hasAllowedPermission: async () => params.allowed,
    findAllowedResourceRefs: async (input) => params.allowed ? [...input.resources] : [],
  };
}

function denialRepository(params: { denied: boolean }): PolicyDenialRepository {
  return {
    findMany: async () => ({ data: [], page: {} }),
    findById: async () => null,
    create: async (denial) => denial,
    delete: async () => false,
    findDeniedResourceRefs: async (input) => params.denied ? [...input.resources] : [],
    hasActiveDenial: async (input) => {
      expect(input.principals.map((principal: PrincipalRef) => principal.id)).toContain("user-alice");
      return params.denied;
    },
  };
}
