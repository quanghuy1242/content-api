import type { Actor } from "@/domain/auth/actor";
import type { ContentIamMutationWorkflow } from "@/domain/iam/content-iam-mutation.workflow";
import type { ContentResourceRef } from "@/domain/iam/content-resource";
import { PolicyEvent } from "@/domain/iam/policy-event.entity";

export async function recordDeniedPolicyMutation(params: {
  workflow: ContentIamMutationWorkflow;
  actor: Actor;
  resource: ContentResourceRef;
  operation: string;
  reason: string;
  requestId?: string;
}) {
  await params.workflow.recordDeniedEvent(PolicyEvent.create({
    orgId: params.resource.orgId,
    targetType: params.resource.type,
    targetId: params.resource.id,
    action: "policy.mutation_denied",
    actorType: params.actor.type === "service_account" ? "service_account" : "user",
    actorId: actorAuditId(params.actor),
    requestId: params.requestId ?? null,
    reason: params.reason,
    snapshotJson: JSON.stringify({ operation: params.operation }),
  }));
}

function actorAuditId(actor: Actor) {
  switch (actor.type) {
    case "user":
      return actor.subject;
    case "service_account":
      return actor.clientId;
    case "system":
      return actor.id;
  }
}
