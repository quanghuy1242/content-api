import { ContentRole, type ContentRoleProps } from "@/domain/iam/content-role.entity";
import type { ContentPermissionKey } from "@/domain/iam/content-permission";
import { PolicyBinding, type PolicyBindingProps } from "@/domain/iam/policy-binding.entity";
import { PolicyDenial, type PolicyDenialProps } from "@/domain/iam/policy-denial.entity";
import { PolicyEvent, type PolicyEventProps } from "@/domain/iam/policy-event.entity";

export function serializeBindingMutation(binding: PolicyBinding, event: PolicyEvent) {
  return JSON.stringify({ binding: binding.toSnapshot(), event: event.toSnapshot() });
}

export function deserializeBindingMutation(value: string) {
  const snapshot = JSON.parse(value) as {
    binding: SerializedPolicyBindingProps;
    event: SerializedPolicyEventProps;
  };
  return {
    binding: PolicyBinding.reconstitute(deserializeBindingSnapshot(snapshot.binding)),
    event: PolicyEvent.reconstitute(deserializeEventSnapshot(snapshot.event)),
  };
}

export function serializeDenialMutation(denial: PolicyDenial, event: PolicyEvent) {
  return JSON.stringify({ denial: denial.toSnapshot(), event: event.toSnapshot() });
}

export function deserializeDenialMutation(value: string) {
  const snapshot = JSON.parse(value) as {
    denial: SerializedPolicyDenialProps;
    event: SerializedPolicyEventProps;
  };
  return {
    denial: PolicyDenial.reconstitute(deserializeDenialSnapshot(snapshot.denial)),
    event: PolicyEvent.reconstitute(deserializeEventSnapshot(snapshot.event)),
  };
}

export function serializeOwnershipTransfer(currentOwner: PolicyBinding, nextOwner: PolicyBinding, event: PolicyEvent) {
  return JSON.stringify({
    currentOwner: currentOwner.toSnapshot(),
    nextOwner: nextOwner.toSnapshot(),
    event: event.toSnapshot(),
  });
}

export function deserializeOwnershipTransfer(value: string) {
  const snapshot = JSON.parse(value) as {
    currentOwner: SerializedPolicyBindingProps;
    nextOwner: SerializedPolicyBindingProps;
    event: SerializedPolicyEventProps;
  };
  return {
    currentOwner: PolicyBinding.reconstitute(deserializeBindingSnapshot(snapshot.currentOwner)),
    nextOwner: PolicyBinding.reconstitute(deserializeBindingSnapshot(snapshot.nextOwner)),
    event: PolicyEvent.reconstitute(deserializeEventSnapshot(snapshot.event)),
  };
}

export function serializeRoleMutation(role: ContentRole, event: PolicyEvent, permissions: readonly string[] = []) {
  return JSON.stringify({ role: role.toSnapshot(), permissions, event: event.toSnapshot() });
}

export function deserializeRoleMutation(value: string) {
  const snapshot = JSON.parse(value) as {
    role: SerializedContentRoleProps;
    permissions?: string[];
    event: SerializedPolicyEventProps;
  };
  return {
    role: ContentRole.reconstitute(deserializeRoleSnapshot(snapshot.role)),
    permissions: (snapshot.permissions ?? []) as ContentPermissionKey[],
    event: PolicyEvent.reconstitute(deserializeEventSnapshot(snapshot.event)),
  };
}

type SerializedPolicyBindingProps = Omit<PolicyBindingProps, "expiresAt" | "createdAt"> & {
  expiresAt: string | null;
  createdAt: string;
};

type SerializedPolicyDenialProps = Omit<PolicyDenialProps, "expiresAt" | "createdAt"> & {
  expiresAt: string | null;
  createdAt: string;
};

type SerializedPolicyEventProps = Omit<PolicyEventProps, "createdAt"> & {
  createdAt: string;
};

type SerializedContentRoleProps = Omit<ContentRoleProps, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

function deserializeBindingSnapshot(snapshot: SerializedPolicyBindingProps): PolicyBindingProps {
  return {
    ...snapshot,
    expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt) : null,
    createdAt: new Date(snapshot.createdAt),
  };
}

function deserializeDenialSnapshot(snapshot: SerializedPolicyDenialProps): PolicyDenialProps {
  return {
    ...snapshot,
    expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt) : null,
    createdAt: new Date(snapshot.createdAt),
  };
}

function deserializeEventSnapshot(snapshot: SerializedPolicyEventProps): PolicyEventProps {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
  };
}

function deserializeRoleSnapshot(snapshot: SerializedContentRoleProps): ContentRoleProps {
  return {
    ...snapshot,
    createdAt: new Date(snapshot.createdAt),
    updatedAt: new Date(snapshot.updatedAt),
  };
}
