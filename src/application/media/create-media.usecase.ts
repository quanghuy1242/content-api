import { assertAllowed } from "@/domain/authz/assert-can";
import type { Actor } from "@/domain/authz/actor";
import type { RelationshipRepository } from "@/domain/authz/relationship.repository";
import { Media } from "@/domain/media/media.entity";
import type { CreateMediaProps } from "@/domain/media/media.entity";
import type { MediaRepository } from "@/domain/media/media.repository";
import { MediaPolicy } from "@/domain/media/media.policy";
import { NotFoundError } from "@/shared/errors";

export type CreateMediaInput = Pick<CreateMediaProps, "alt" | "filename"> &
  Partial<Omit<CreateMediaProps, "id" | "owner" | "alt" | "filename">>;

export class CreateMediaUseCase {
  constructor(
    private readonly mediaRepository: MediaRepository,
    private readonly relationships: RelationshipRepository,
    private readonly mediaPolicy: MediaPolicy,
  ) {}

  async execute(params: { actor: Actor; input: CreateMediaInput }) {
    await assertAllowed(this.mediaPolicy.canCreate(params.actor), "Authentication required");

    const ownerId = params.actor.type === "user" ? params.actor.localUserId : null;
    if (!ownerId) {
      throw new NotFoundError("Linked local user not found");
    }

    const media = Media.create({
      id: crypto.randomUUID(),
      alt: params.input.alt,
      owner: ownerId,
      url: params.input.url ?? null,
      thumbnailURL: params.input.thumbnailURL ?? null,
      filename: params.input.filename,
      mimeType: params.input.mimeType ?? null,
      filesize: params.input.filesize ?? null,
      width: params.input.width ?? null,
      height: params.input.height ?? null,
      focalX: params.input.focalX ?? null,
      focalY: params.input.focalY ?? null,
    });

    const created = await this.mediaRepository.create(media);
    await this.relationships.create({
      id: crypto.randomUUID(),
      subjectType: "user",
      subjectId: ownerId,
      relation: "owner",
      objectType: "media",
      objectId: created.id,
      createdAt: new Date(),
    });

    return created;
  }
}
