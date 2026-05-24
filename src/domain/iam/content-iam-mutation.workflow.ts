import type { IdempotencyRecord } from "@/domain/idempotency/idempotency.repository";
import type { ContentRole } from "@/domain/iam/content-role.entity";
import type { ContentPermissionKey } from "@/domain/iam/content-permission";
import type { PolicyBinding } from "@/domain/iam/policy-binding.entity";
import type { PolicyDenial } from "@/domain/iam/policy-denial.entity";
import type { PolicyEvent } from "@/domain/iam/policy-event.entity";

export type ContentIamIdempotencyRecord = Omit<IdempotencyRecord, "responseJson"> & { responseJson: string };

export interface ContentIamMutationWorkflow {
  createBinding(params: {
    binding: PolicyBinding;
    event: PolicyEvent;
    idempotency?: ContentIamIdempotencyRecord;
  }): Promise<void>;

  revokeBinding(params: {
    binding: PolicyBinding;
    event: PolicyEvent;
  }): Promise<void>;

  createDenial(params: {
    denial: PolicyDenial;
    event: PolicyEvent;
    idempotency?: ContentIamIdempotencyRecord;
  }): Promise<void>;

  revokeDenial(params: {
    denial: PolicyDenial;
    event: PolicyEvent;
  }): Promise<void>;

  transferBookOwnership(params: {
    currentOwner: PolicyBinding;
    nextOwner: PolicyBinding;
    event: PolicyEvent;
    idempotency: ContentIamIdempotencyRecord;
  }): Promise<void>;

  createRole(params: {
    role: ContentRole;
    permissions: readonly ContentPermissionKey[];
    event: PolicyEvent;
    idempotency: ContentIamIdempotencyRecord;
  }): Promise<void>;

  replaceRolePermissions(params: {
    role: ContentRole;
    permissions: readonly ContentPermissionKey[];
    event: PolicyEvent;
    idempotency: ContentIamIdempotencyRecord;
  }): Promise<void>;

  disableRole(params: {
    role: ContentRole;
    event: PolicyEvent;
  }): Promise<void>;

  recordEvent(event: PolicyEvent): Promise<void>;
}
