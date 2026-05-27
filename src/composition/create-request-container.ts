import { parseEnv, type AppBindings } from "@/config/env";
import { AuthenticateBearerTokenUseCase } from "@/application/auth/authenticate-bearer-token.usecase";
import { CreateBookUseCase } from "@/application/books/create-book.usecase";
import { GetBookUseCase } from "@/application/books/get-book.usecase";
import { ListBooksUseCase } from "@/application/books/list-books.usecase";
import { UpdateBookUseCase } from "@/application/books/update-book.usecase";
import { CreateCategoryUseCase } from "@/application/categories/create-category.usecase";
import { DeleteCategoryUseCase } from "@/application/categories/delete-category.usecase";
import { GetCategoryUseCase } from "@/application/categories/get-category.usecase";
import { ListCategoriesUseCase } from "@/application/categories/list-categories.usecase";
import { UpdateCategoryUseCase } from "@/application/categories/update-category.usecase";
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
import { CreateMediaUploadUseCase } from "@/application/media/create-media-upload.usecase";
import { DeleteMediaUseCase } from "@/application/media/delete-media.usecase";
import { GetMediaUseCase } from "@/application/media/get-media.usecase";
import { ListMediaUseCase } from "@/application/media/list-media.usecase";
import { PublishMediaUseCase } from "@/application/media/publish-media.usecase";
import { ServeMediaVariantUseCase } from "@/application/media/serve-media-variant.usecase";
import { UnpublishMediaUseCase } from "@/application/media/unpublish-media.usecase";
import { UpdateMediaUseCase } from "@/application/media/update-media.usecase";
import { ArchiveUseCase } from "@/application/lifecycle/archive.usecase";
import { BookLifecycleManager } from "@/application/lifecycle/book-lifecycle-manager";
import { PostLifecycleManager } from "@/application/lifecycle/post-lifecycle-manager";
import { PublishUseCase } from "@/application/lifecycle/publish.usecase";
import { SchedulePublishUseCase } from "@/application/lifecycle/schedule-publish.usecase";
import { UnpublishUseCase } from "@/application/lifecycle/unpublish.usecase";
import { CreatePostUseCase } from "@/application/posts/create-post.usecase";
import { DeletePostUseCase } from "@/application/posts/delete-post.usecase";
import { GetPostUseCase } from "@/application/posts/get-post.usecase";
import { ListPostsUseCase } from "@/application/posts/list-posts.usecase";
import { UpdatePostUseCase } from "@/application/posts/update-post.usecase";
import { CreateUserUseCase } from "@/application/users/create-user.usecase";
import { DeleteUserUseCase } from "@/application/users/delete-user.usecase";
import { GetUserUseCase } from "@/application/users/get-user.usecase";
import { ListUsersUseCase } from "@/application/users/list-users.usecase";
import { UpdateUserUseCase } from "@/application/users/update-user.usecase";
import { ContentAdministrationPolicy } from "@/domain/iam/content-administration.policy";
import { LocalContentPolicy } from "@/domain/iam/content-policy";
import { UserPolicy } from "@/domain/users/user.policy";
import { createDb } from "@/infrastructure/db/client";
import { ClientCredentialsTokenProvider } from "@/infrastructure/identity/client-credentials-token-provider";
import { ScimContentPrincipalDirectory } from "@/infrastructure/identity/scim-content-principal-directory";
import { DrizzleCategoryRepository } from "@/infrastructure/repositories/drizzle-category.repository";
import { DrizzleCategoryCreateWorkflow } from "@/infrastructure/repositories/drizzle-category-create.workflow";
import { DrizzleBookRepository } from "@/infrastructure/repositories/drizzle-book.repository";
import { DrizzleBookCreateWorkflow } from "@/infrastructure/repositories/drizzle-book-create.workflow";
import { DrizzleContentIamMutationWorkflow } from "@/infrastructure/repositories/drizzle-content-iam-mutation.workflow";
import { DrizzleContentRoleRepository } from "@/infrastructure/repositories/drizzle-content-role.repository";
import { DrizzleIdempotencyRepository } from "@/infrastructure/repositories/drizzle-idempotency.repository";
import { DrizzleMediaRepository } from "@/infrastructure/repositories/drizzle-media.repository";
import { DrizzleMediaCreateWorkflow } from "@/infrastructure/repositories/drizzle-media-create.workflow";
import { DrizzlePostRepository } from "@/infrastructure/repositories/drizzle-post.repository";
import { DrizzlePostCreateWorkflow } from "@/infrastructure/repositories/drizzle-post-create.workflow";
import { DrizzlePolicyBindingRepository } from "@/infrastructure/repositories/drizzle-policy-binding.repository";
import { DrizzlePolicyDenialRepository } from "@/infrastructure/repositories/drizzle-policy-denial.repository";
import { DrizzlePolicyEventRepository } from "@/infrastructure/repositories/drizzle-policy-event.repository";
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
  const bookCreateWorkflow = new DrizzleBookCreateWorkflow(db);
  const categoryRepository = new DrizzleCategoryRepository(db);
  const mediaRepository = new DrizzleMediaRepository(db);
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
    policyBindingRepository,
    (roleId) => contentRoleRepository.findPermissionKeys(roleId),
  );
  const scimTokenProvider = new ClientCredentialsTokenProvider({
    tokenUrl: config.ID_SCIM_TOKEN_URL ?? new URL("/api/auth/oauth2/token", config.ID_SCIM_URL).toString(),
    clientId: config.ID_SCIM_CLIENT_ID,
    clientSecret: config.ID_SCIM_CLIENT_SECRET,
    audience: config.ID_SCIM_AUDIENCE,
    scope: config.ID_SCIM_SCOPE,
    cache: env.ID_SCIM_TOKEN_CACHE,
    fetchImpl: options?.fetchImpl,
  });
  const principalDirectory = new ScimContentPrincipalDirectory({
    idBaseUrl: config.ID_SCIM_URL,
    accessTokenProvider: scimTokenProvider,
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
      list: new ListCategoriesUseCase(categoryRepository, contentPolicy),
      get: new GetCategoryUseCase(categoryRepository, contentPolicy),
      create: new CreateCategoryUseCase(
        categoryRepository,
        userRepository,
        contentRoleRepository,
        idempotencyRepository,
        categoryCreateWorkflow,
        contentPolicy,
      ),
      update: new UpdateCategoryUseCase(categoryRepository, contentPolicy),
      delete: new DeleteCategoryUseCase(categoryRepository, contentPolicy),
    },
    posts: {
      list: new ListPostsUseCase(postRepository, contentPolicy),
      get: new GetPostUseCase(postRepository, contentPolicy),
      create: new CreatePostUseCase(
        postRepository,
        userRepository,
        contentRoleRepository,
        idempotencyRepository,
        postCreateWorkflow,
        contentPolicy,
      ),
      update: new UpdatePostUseCase(postRepository, contentPolicy),
      publish: new PublishUseCase(new PostLifecycleManager(postRepository, contentPolicy)),
      unpublish: new UnpublishUseCase(new PostLifecycleManager(postRepository, contentPolicy)),
      schedule: new SchedulePublishUseCase(new PostLifecycleManager(postRepository, contentPolicy)),
      archive: new ArchiveUseCase(new PostLifecycleManager(postRepository, contentPolicy)),
      delete: new DeletePostUseCase(postRepository, contentPolicy),
    },
    media: {
      list: new ListMediaUseCase(mediaRepository, contentPolicy),
      get: new GetMediaUseCase(mediaRepository, contentPolicy),
      create: new CreateMediaUploadUseCase(
        mediaRepository,
        userRepository,
        contentRoleRepository,
        idempotencyRepository,
        mediaCreateWorkflow,
        contentPolicy,
        mediaUploadSigner,
        config.MAX_IMAGE_UPLOAD_BYTES,
        config.UPLOAD_URL_TTL_SECONDS,
      ),
      update: new UpdateMediaUseCase(mediaRepository, contentPolicy),
      publish: new PublishMediaUseCase(mediaRepository, contentPolicy),
      unpublish: new UnpublishMediaUseCase(mediaRepository, contentPolicy),
      delete: new DeleteMediaUseCase(mediaRepository, contentPolicy),
      serveVariant: new ServeMediaVariantUseCase(mediaRepository, contentPolicy, mediaStorage),
    },
    books: {
      list: new ListBooksUseCase(bookRepository, contentPolicy),
      get: new GetBookUseCase(bookRepository, contentPolicy),
      create: new CreateBookUseCase(
        userRepository,
        contentRoleRepository,
        idempotencyRepository,
        bookCreateWorkflow,
        principalDirectory,
        contentPolicy,
      ),
      update: new UpdateBookUseCase(bookRepository, contentPolicy),
      publish: new PublishUseCase(new BookLifecycleManager(bookRepository, contentPolicy)),
      unpublish: new UnpublishUseCase(new BookLifecycleManager(bookRepository, contentPolicy)),
      schedule: new SchedulePublishUseCase(new BookLifecycleManager(bookRepository, contentPolicy)),
      archive: new ArchiveUseCase(new BookLifecycleManager(bookRepository, contentPolicy)),
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
        policyBindingRepository,
        contentIamMutationWorkflow,
        contentAdministrationPolicy,
      ),
      roles: contentRoleRepository,
    },
  };
}
