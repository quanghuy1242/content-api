export type IdempotencyRoute = "POST /posts" | "POST /media" | "POST /categories" | "POST /users";

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
