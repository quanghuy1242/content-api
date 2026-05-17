export type GrantMirror = {
  id: string;
  autherTupleId: string;
  payloadUserId: string;
  entityType: "book" | "chapter" | "comment";
  entityId: string;
  relation: string;
  sourceSubjectType: "user" | "group";
  requiresLiveCheck: boolean;
  syncStatus: "active" | "revoked" | "pending";
  syncedAt: Date;
};
