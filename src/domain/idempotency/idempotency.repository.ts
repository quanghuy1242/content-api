export type IdempotencyRoute =
  | "POST /posts"
  | "POST /media"
  | "POST /categories"
  | "POST /users"
  | "POST /books/{bookId}/policy-bindings"
  | "POST /books/{bookId}/policy-denials"
  | "POST /books/{bookId}/ownership-transfer"
  | "POST /organizations/{orgId}/policy-bindings"
  | "POST /organizations/{orgId}/policy-denials"
  | "POST /organizations/{orgId}/content-roles"
  | "PUT /organizations/{orgId}/content-roles/{roleId}/permissions"
  | "POST /organizations/{orgId}/content-iam/bootstrap"
  | "POST /organizations/{orgId}/content-iam/admins";

export type IdempotencyRecord = {
  key: string;
  actorId: string;
  route: IdempotencyRoute;
  requestHash: string;
  responseJson: string | null;
  status: number;
  createdAt: Date;
  expiresAt: Date;
};

export interface IdempotencyRepository {
  findActive(params: {
    key: string;
    actorId: string;
    route: IdempotencyRoute;
  }): Promise<IdempotencyRecord | null>;

  deleteExpired(params: {
    key: string;
    actorId: string;
    route: IdempotencyRoute;
  }): Promise<void>;
}
