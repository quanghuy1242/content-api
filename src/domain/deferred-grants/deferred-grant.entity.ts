export type DeferredGrant = {
  id: string;
  betterAuthUserId: string;
  tupleId: string;
  entityType: string;
  entityId: string;
  relation: string;
  sourceSubjectType: "user" | "group";
  hasCondition: boolean;
  status: "pending" | "processed" | "expired";
  processedAt: Date | null;
  type: "grant" | "revocation_tombstone";
  createdAt: Date;
};
