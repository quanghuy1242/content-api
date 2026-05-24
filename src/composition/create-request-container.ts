import { parseEnv, type AppBindings } from "@/config/env";
import { AuthenticateBearerTokenUseCase } from "@/application/auth/authenticate-bearer-token.usecase";
import { CreateCategoryUseCase } from "@/application/categories/create-category.usecase";
import { DeleteCategoryUseCase } from "@/application/categories/delete-category.usecase";
import { GetCategoryUseCase } from "@/application/categories/get-category.usecase";
import { ListCategoriesUseCase } from "@/application/categories/list-categories.usecase";
import { UpdateCategoryUseCase } from "@/application/categories/update-category.usecase";
import { CreateDeferredGrantUseCase } from "@/application/deferred-grants/create-deferred-grant.usecase";
import { DeleteDeferredGrantUseCase } from "@/application/deferred-grants/delete-deferred-grant.usecase";
import { GetDeferredGrantUseCase } from "@/application/deferred-grants/get-deferred-grant.usecase";
import { ListDeferredGrantsUseCase } from "@/application/deferred-grants/list-deferred-grants.usecase";
import { UpdateDeferredGrantUseCase } from "@/application/deferred-grants/update-deferred-grant.usecase";
import { BootstrapOrganizationContentAdminUseCase } from "@/application/content-iam/bootstrap-organization-content-admin.usecase";
import { CreateContentRoleUseCase } from "@/application/content-iam/create-content-role.usecase";
import { CreatePolicyBindingUseCase } from "@/application/content-iam/create-policy-binding.usecase";
import { CreatePolicyDenialUseCase } from "@/application/content-iam/create-policy-denial.usecase";
import { DelegateOrganizationContentAdminUseCase } from "@/application/content-iam/delegate-organization-content-admin.usecase";
import { DisableContentRoleUseCase } from "@/application/content-iam/disable-content-role.usecase";
import { ListContentRolesUseCase } from "@/application/content-iam/list-content-roles.usecase";
import { ListPolicyBindingsUseCase } from "@/application/content-iam/list-policy-bindings.usecase";
import { ListPolicyDenialsUseCase } from "@/application/content-iam/list-policy-denials.usecase";
import { ListPolicyEventsUseCase } from "@/application/content-iam/list-policy-events.usecase";
import { ReplaceContentRolePermissionsUseCase } from "@/application/content-iam/replace-content-role-permissions.usecase";
import { RevokePolicyBindingUseCase } from "@/application/content-iam/revoke-policy-binding.usecase";
import { RevokePolicyDenialUseCase } from "@/application/content-iam/revoke-policy-denial.usecase";
import { TransferBookOwnershipUseCase } from "@/application/content-iam/transfer-book-ownership.usecase";
import { CreateGrantMirrorUseCase } from "@/application/grant-mirror/create-grant-mirror.usecase";
import { DeleteGrantMirrorUseCase } from "@/application/grant-mirror/delete-grant-mirror.usecase";
import { GetGrantMirrorUseCase } from "@/application/grant-mirror/get-grant-mirror.usecase";
import { ListGrantMirrorUseCase } from "@/application/grant-mirror/list-grant-mirror.usecase";
import { UpdateGrantMirrorUseCase } from "@/application/grant-mirror/update-grant-mirror.usecase";
import { CreateMediaUploadUseCase } from "@/application/media/create-media-upload.usecase";
import { DeleteMediaUseCase } from "@/application/media/delete-media.usecase";
import { GetMediaUseCase } from "@/application/media/get-media.usecase";
import { ListMediaUseCase } from "@/application/media/list-media.usecase";
import { PublishMediaUseCase } from "@/application/media/publish-media.usecase";
import { ServeMediaVariantUseCase } from "@/application/media/serve-media-variant.usecase";
import { UnpublishMediaUseCase } from "@/application/media/unpublish-media.usecase";
import { UpdateMediaUseCase } from "@/application/media/update-media.usecase";
import { CreatePostUseCase } from "@/application/posts/create-post.usecase";
import { DeletePostUseCase } from "@/application/posts/delete-post.usecase";
import { GetPostUseCase } from "@/application/posts/get-post.usecase";
import { ListPostsUseCase } from "@/application/posts/list-posts.usecase";
import { PublishPostUseCase } from "@/application/posts/publish-post.usecase";
import { UnpublishPostUseCase } from "@/application/posts/unpublish-post.usecase";
import { UpdatePostUseCase } from "@/application/posts/update-post.usecase";
import { CreateRelationshipUseCase } from "@/application/relationships/create-relationship.usecase";
import { DeleteRelationshipUseCase } from "@/application/relationships/delete-relationship.usecase";
import { ListRelationshipsUseCase } from "@/application/relationships/list-relationships.usecase";
import { CreateUserUseCase } from "@/application/users/create-user.usecase";
import { DeleteUserUseCase } from "@/application/users/delete-user.usecase";
import { GetUserUseCase } from "@/application/users/get-user.usecase";
import { ListUsersUseCase } from "@/application/users/list-users.usecase";
import { UpdateUserUseCase } from "@/application/users/update-user.usecase";
import { CategoryPolicy } from "@/domain/categories/category.policy";
import { DeferredGrantPolicy } from "@/domain/deferred-grants/deferred-grant.policy";
import { GrantMirrorPolicy } from "@/domain/grant-mirror/grant-mirror.policy";
import { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import { LocalContentPolicy } from "@/domain/iam/content-policy";
import { MediaPolicy } from "@/domain/media/media.policy";
import { PostPolicy } from "@/domain/posts/post.policy";
import { UserPolicy } from "@/domain/users/user.policy";
import { createDb } from "@/infrastructure/db/client";
import { ClientCredentialsTokenProvider } from "@/infrastructure/identity/client-credentials-token-provider";
import { IdContentPrincipalDirectory } from "@/infrastructure/identity/id-content-principal-directory";
import { DrizzleCategoryRepository } from "@/infrastructure/repositories/drizzle-category.repository";
import { DrizzleCategoryCreateWorkflow } from "@/infrastructure/repositories/drizzle-category-create.workflow";
import { DrizzleBookRepository } from "@/infrastructure/repositories/drizzle-book.repository";
import { DrizzleContentIamMutationWorkflow } from "@/infrastructure/repositories/drizzle-content-iam-mutation.workflow";
import { DrizzleContentRoleRepository } from "@/infrastructure/repositories/drizzle-content-role.repository";
import { DrizzleDeferredGrantRepository } from "@/infrastructure/repositories/drizzle-deferred-grant.repository";
import { DrizzleGrantMirrorRepository } from "@/infrastructure/repositories/drizzle-grant-mirror.repository";
import { DrizzleIdempotencyRepository } from "@/infrastructure/repositories/drizzle-idempotency.repository";
import { DrizzleMediaRepository } from "@/infrastructure/repositories/drizzle-media.repository";
import { DrizzleMediaCreateWorkflow } from "@/infrastructure/repositories/drizzle-media-create.workflow";
import { DrizzlePostRepository } from "@/infrastructure/repositories/drizzle-post.repository";
import { DrizzlePostCreateWorkflow } from "@/infrastructure/repositories/drizzle-post-create.workflow";
import { DrizzlePolicyBindingRepository } from "@/infrastructure/repositories/drizzle-policy-binding.repository";
import { DrizzlePolicyDenialRepository } from "@/infrastructure/repositories/drizzle-policy-denial.repository";
import { DrizzlePolicyEventRepository } from "@/infrastructure/repositories/drizzle-policy-event.repository";
import { DrizzleRelationshipRepository } from "@/infrastructure/repositories/drizzle-relationship.repository";
import { DrizzleUserRepository } from "@/infrastructure/repositories/drizzle-user.repository";
import { DrizzleUserCreateWorkflow } from "@/infrastructure/repositories/drizzle-user-create.workflow";
import { R2PresignedUrlSigner } from "@/infrastructure/storage/r2-presigned-url-signer";
import { R2ObjectStorage } from "@/infrastructure/storage/r2-object-storage";

/**
 * Builds the request-scoped object graph at the outer edge of the Worker.
 *
 * This is the only place where HTTP runtime bindings, infrastructure
 * repositories, domain policies, and application use cases are wired together.
 * Domain/application code should receive interfaces and must not import this
 * composition layer.
 */
export function createRequestContainer(env: AppBindings, options?: { fetchImpl?: typeof fetch }) {
  const config = parseEnv(env);
  const db = createDb(env);
  const userRepository = new DrizzleUserRepository(db);
  const bookRepository = new DrizzleBookRepository(db);
  const categoryRepository = new DrizzleCategoryRepository(db);
  const mediaRepository = new DrizzleMediaRepository(db);
  const grantMirrorRepository = new DrizzleGrantMirrorRepository(db);
  const deferredGrantRepository = new DrizzleDeferredGrantRepository(db);
  const relationshipRepository = new DrizzleRelationshipRepository(db);
  const postRepository = new DrizzlePostRepository(db);
  const idempotencyRepository = new DrizzleIdempotencyRepository(db);
  const contentRoleRepository = new DrizzleContentRoleRepository(db);
  const policyBindingRepository = new DrizzlePolicyBindingRepository(db);
  const policyDenialRepository = new DrizzlePolicyDenialRepository(db);
  const policyEventRepository = new DrizzlePolicyEventRepository(db);
  const contentIamMutationWorkflow = new DrizzleContentIamMutationWorkflow(db);
  const contentPolicy = new LocalContentPolicy(policyBindingRepository, policyDenialRepository);
  const contentAdministrationPolicy = new ContentAdministrationPolicy(
    contentPolicy,
    (roleId) => contentRoleRepository.findPermissionKeys(roleId),
  );
  const principalValidationTokenProvider = new ClientCredentialsTokenProvider({
    tokenUrl: config.ID_PRINCIPAL_VALIDATION_TOKEN_URL ?? new URL("/api/auth/oauth2/token", config.ID_PRINCIPAL_VALIDATION_URL).toString(),
    clientId: config.ID_PRINCIPAL_VALIDATION_CLIENT_ID,
    clientSecret: config.ID_PRINCIPAL_VALIDATION_CLIENT_SECRET,
    audience: config.ID_PRINCIPAL_VALIDATION_AUDIENCE,
    scope: config.ID_PRINCIPAL_VALIDATION_SCOPE,
    cache: env.ID_PRINCIPAL_VALIDATION_TOKEN_CACHE,
    fetchImpl: options?.fetchImpl,
  });
  const principalDirectory = new IdContentPrincipalDirectory({
    baseUrl: config.ID_PRINCIPAL_VALIDATION_URL,
    accessTokenProvider: principalValidationTokenProvider,
    fetchImpl: options?.fetchImpl,
  });
  const mediaStorage = new R2ObjectStorage(env.MEDIA_R2);
  const mediaUploadSigner = new R2PresignedUrlSigner({
    accountId: config.R2_ACCOUNT_ID,
    bucketName: config.R2_BUCKET_NAME,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
  });
  const postCreateWorkflow = new DrizzlePostCreateWorkflow(db);
  const mediaCreateWorkflow = new DrizzleMediaCreateWorkflow(db);
  const categoryCreateWorkflow = new DrizzleCategoryCreateWorkflow(db);
  const userCreateWorkflow = new DrizzleUserCreateWorkflow(db);
  const userPolicy = new UserPolicy();
  const categoryPolicy = new CategoryPolicy(relationshipRepository);
  const mediaPolicy = new MediaPolicy(relationshipRepository);
  const postPolicy = new PostPolicy(relationshipRepository);
  const grantMirrorPolicy = new GrantMirrorPolicy();
  const deferredGrantPolicy = new DeferredGrantPolicy();

  return {
    auth: new AuthenticateBearerTokenUseCase(
      {
        issuer: config.AUTH_ISSUER,
        audience: config.AUTH_AUDIENCE,
        jwksUrl: config.AUTH_JWKS_URL,
        requiredScope: config.AUTH_REQUIRED_SCOPE,
        fetchImpl: options?.fetchImpl,
      },
      userRepository,
    ),
    users: {
      list: new ListUsersUseCase(userRepository, userPolicy),
      get: new GetUserUseCase(userRepository, userPolicy),
      create: new CreateUserUseCase(userRepository, idempotencyRepository, userCreateWorkflow, userPolicy),
      update: new UpdateUserUseCase(userRepository, userPolicy),
      delete: new DeleteUserUseCase(userRepository, userPolicy),
    },
    categories: {
      list: new ListCategoriesUseCase(categoryRepository, categoryPolicy),
      get: new GetCategoryUseCase(categoryRepository, categoryPolicy),
      create: new CreateCategoryUseCase(
        categoryRepository,
        relationshipRepository,
        userRepository,
        idempotencyRepository,
        categoryCreateWorkflow,
        categoryPolicy,
      ),
      update: new UpdateCategoryUseCase(categoryRepository, categoryPolicy),
      delete: new DeleteCategoryUseCase(categoryRepository, categoryPolicy),
    },
    posts: {
      list: new ListPostsUseCase(postRepository),
      get: new GetPostUseCase(postRepository, postPolicy),
      create: new CreatePostUseCase(
        postRepository,
        relationshipRepository,
        userRepository,
        idempotencyRepository,
        postCreateWorkflow,
        postPolicy,
      ),
      update: new UpdatePostUseCase(postRepository, postPolicy),
      publish: new PublishPostUseCase(postRepository, postPolicy),
      unpublish: new UnpublishPostUseCase(postRepository, postPolicy),
      delete: new DeletePostUseCase(postRepository, postPolicy),
    },
    media: {
      list: new ListMediaUseCase(mediaRepository),
      get: new GetMediaUseCase(mediaRepository, mediaPolicy),
      create: new CreateMediaUploadUseCase(
        mediaRepository,
        relationshipRepository,
        userRepository,
        idempotencyRepository,
        mediaCreateWorkflow,
        mediaPolicy,
        mediaUploadSigner,
        config.MAX_IMAGE_UPLOAD_BYTES,
        config.UPLOAD_URL_TTL_SECONDS,
      ),
      update: new UpdateMediaUseCase(mediaRepository, mediaPolicy),
      publish: new PublishMediaUseCase(mediaRepository, mediaPolicy),
      unpublish: new UnpublishMediaUseCase(mediaRepository, mediaPolicy),
      delete: new DeleteMediaUseCase(mediaRepository, mediaPolicy),
      serveVariant: new ServeMediaVariantUseCase(mediaRepository, mediaPolicy, mediaStorage),
    },
    contentIam: {
      bootstrapOrganizationAdmin: new BootstrapOrganizationContentAdminUseCase(
        contentRoleRepository,
        policyBindingRepository,
        idempotencyRepository,
        contentIamMutationWorkflow,
        principalDirectory,
      ),
      delegateOrganizationAdmin: new DelegateOrganizationContentAdminUseCase(
        contentRoleRepository,
        idempotencyRepository,
        contentIamMutationWorkflow,
        principalDirectory,
        contentPolicy,
      ),
      listBindings: new ListPolicyBindingsUseCase(bookRepository, policyBindingRepository, contentPolicy),
      createBinding: new CreatePolicyBindingUseCase(
        bookRepository,
        contentRoleRepository,
        idempotencyRepository,
        contentIamMutationWorkflow,
        principalDirectory,
        contentAdministrationPolicy,
        config.AUTH_AUDIENCE,
      ),
      revokeBinding: new RevokePolicyBindingUseCase(
        bookRepository,
        policyBindingRepository,
        contentIamMutationWorkflow,
        contentAdministrationPolicy,
      ),
      listDenials: new ListPolicyDenialsUseCase(bookRepository, policyDenialRepository, contentPolicy),
      createDenial: new CreatePolicyDenialUseCase(
        bookRepository,
        idempotencyRepository,
        contentIamMutationWorkflow,
        principalDirectory,
        contentAdministrationPolicy,
        config.AUTH_AUDIENCE,
      ),
      revokeDenial: new RevokePolicyDenialUseCase(
        bookRepository,
        policyDenialRepository,
        contentIamMutationWorkflow,
        contentAdministrationPolicy,
      ),
      listEvents: new ListPolicyEventsUseCase(bookRepository, policyEventRepository, contentPolicy),
      transferOwnership: new TransferBookOwnershipUseCase(
        bookRepository,
        policyBindingRepository,
        idempotencyRepository,
        contentIamMutationWorkflow,
        principalDirectory,
        contentAdministrationPolicy,
      ),
      listRoles: new ListContentRolesUseCase(contentRoleRepository, contentPolicy),
      createRole: new CreateContentRoleUseCase(
        contentRoleRepository,
        idempotencyRepository,
        contentIamMutationWorkflow,
        contentAdministrationPolicy,
      ),
      replaceRolePermissions: new ReplaceContentRolePermissionsUseCase(
        contentRoleRepository,
        idempotencyRepository,
        contentIamMutationWorkflow,
        contentAdministrationPolicy,
      ),
      disableRole: new DisableContentRoleUseCase(
        contentRoleRepository,
        contentIamMutationWorkflow,
        contentAdministrationPolicy,
      ),
      roles: contentRoleRepository,
    },
    grantMirror: {
      list: new ListGrantMirrorUseCase(grantMirrorRepository, grantMirrorPolicy),
      get: new GetGrantMirrorUseCase(grantMirrorRepository, grantMirrorPolicy),
      create: new CreateGrantMirrorUseCase(grantMirrorRepository, grantMirrorPolicy),
      update: new UpdateGrantMirrorUseCase(grantMirrorRepository, grantMirrorPolicy),
      delete: new DeleteGrantMirrorUseCase(grantMirrorRepository, grantMirrorPolicy),
    },
    deferredGrants: {
      list: new ListDeferredGrantsUseCase(deferredGrantRepository, deferredGrantPolicy),
      get: new GetDeferredGrantUseCase(deferredGrantRepository, deferredGrantPolicy),
      create: new CreateDeferredGrantUseCase(deferredGrantRepository, deferredGrantPolicy),
      update: new UpdateDeferredGrantUseCase(deferredGrantRepository, deferredGrantPolicy),
      delete: new DeleteDeferredGrantUseCase(deferredGrantRepository, deferredGrantPolicy),
    },
    relationships: {
      list: new ListRelationshipsUseCase(relationshipRepository, grantMirrorPolicy),
      create: new CreateRelationshipUseCase(relationshipRepository, grantMirrorPolicy),
      delete: new DeleteRelationshipUseCase(relationshipRepository, grantMirrorPolicy),
    },
  };
}
