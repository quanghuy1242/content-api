# Content IAM Recipes

Worked end-to-end examples. Each recipe gives the minimum diff and the test surface to update.

## Recipe A — Gate A New Feature Route Behind A Permission

Goal: add `POST /books/{bookId}/archive` requiring `book.archive`.

1. **Add the permission key** in `src/domain/iam/content-permission.ts`:

   ```ts
   { key: "book.archive", description: "Archive a book", delegationClass: "ordinary" },
   ```

2. **Add it to relevant built-in roles** in the same file: `system:book.owner` should carry it; `system:book.editor` should not (archive is owner-level).

3. **Create the use case** `src/application/books/archive-book.usecase.ts`:

   ```ts
   export class ArchiveBookUseCase {
     constructor(
       private readonly books: BookRepository,
       private readonly contentPolicy: ContentPolicy,
     ) {}
     async execute(params: { actor: Actor; bookId: string }) {
       requireContentScope(params.actor, "content:write");
       const book = await this.books.findById(params.bookId);
       if (!book) throw new NotFoundError("Book not found");
       const allowed = await this.contentPolicy.can({
         actor: params.actor,
         permission: "book.archive",
         resource: bookResource(book),
       });
       if (!allowed) throw new ForbiddenError("You cannot archive this book");
       book.archive();
       await this.books.save(book);
       return book;
     }
   }
   ```

4. **Wire it** in `src/composition/create-request-container.ts` and add the route in `src/http/routes/books.routes.ts` (validate → call use case → present).

5. **Tests** (`tests/`): owner allows, editor denies, missing scope rejects, missing book → 404, archived book idempotent.

6. `pnpm check`.

## Recipe B — Add A New Resource Type With Inheritance (Chapter)

Goal: chapters inherit from their parent book.

1. Extend `ContentResourceType` with `"chapter"` (already present in the catalog as of `0003_content_iam_policy`).
2. Define `Chapter` entity + repository in `src/domain/chapters/`.
3. Add `chapterResource(chapter)` to `src/domain/iam/resource-loader.ts`:

   ```ts
   export function chapterResource(chapter: Chapter): ContentResourceRef {
     return {
       type: "chapter",
       id: chapter.id,
       orgId: chapter.orgId,
       ancestors: [
         { type: "book", id: chapter.bookId },
         { type: "org", id: chapter.orgId },
       ],
     };
   }
   ```

4. Permission keys (`chapter.read`, `chapter.create`, `chapter.update`, `chapter.publish`) already exist in `CONTENT_PERMISSIONS`. Confirm they are listed for `system:book.owner`, `system:book.author`, etc.
5. In use cases for chapter actions, follow the standard scope → policy pattern. A binding on the parent book inherits via `bindingRefsForResource` (book becomes an ancestor for the chapter ref). No extra binding rows required.
6. Tests: ancestor inheritance (book.editor binding allows chapter.update), denial at book blocks descendant chapter, direct-share user with book.author binding can create chapter.

## Recipe C — Bootstrap The First Org Content Admin

Performed once per organization by an existing Better Auth org owner/admin.

1. Caller authenticates with their workspace user token (must have org owner/admin role in Better Auth).
2. `POST /organizations/{orgId}/content-admins` with `Idempotency-Key`. Route runs `BootstrapOrganizationContentAdminUseCase`.
3. The use case calls `principalDirectory.validateOrganizationAdministrator({ userId: caller, orgId })`.
4. On success, a single-use reservation is committed (`0004_content_iam_guards`); a `policy_binding` for `system:org.content_admin` is written; a `policy_event` is emitted.
5. Subsequent bootstrap attempts for the same org are rejected (single-use). Use `delegate` to add more.

For delegation by an existing org content-admin (no `id` admin role needed): `POST /organizations/{orgId}/content-admins` with the new user payload; the policy enforces `org.manage_bindings`.

## Recipe D — Issue A Direct-Share Invitation (External Collaborator)

You want to grant `user_external` `system:book.author` on `book_500` without making them an org member.

1. Caller (must hold `book.manage_bindings` on `book_500`, e.g. `system:book.sharing_manager`) calls `POST /books/{bookId}/policy-bindings` with `Idempotency-Key` and body:

   ```json
   { "principal": { "type": "user", "id": "user_external" },
     "roleId": "system:book.author" }
   ```

2. `CreatePolicyBindingUseCase` runs `ContentAdministrationPolicy.authorizeBindingCreate(...)`. `system:book.author` has `delegationClass = "ordinary"`, so requires `book.manage_bindings` on the book.
3. `principalDirectory.validateUser({ userId: "user_external" })` — note **no org check**, since this is a direct-share target.
4. Binding persists; policy event recorded.
5. The external user can authenticate at `id` via direct-share consent and use `content:read`/`content:write` on `book_500` (and its descendants by inheritance).

Pitfall: do **not** call `validateUserInOrganization` here — it would block legitimate external collaborators.

## Recipe E — Service-Account Binding For An Importer

You want `import_bot_client` to be able to upload media into `org_1`.

Prerequisite (in `~/pjs/auth`): an `oauthClientOrganizationGrant` exists with `clientId=import_bot_client`, `organizationId=org_1`, `resourceServerId=rs_content`, `allowedScopes=["content:write"]`.

1. Caller (org content-admin) calls `POST /organizations/{orgId}/policy-bindings` with:

   ```json
   { "principal": { "type": "service_account", "id": "import_bot_client" },
     "roleId": "system:media.owner" }
   ```

2. Use case runs `principalDirectory.validateServiceAccountForOrganization({ clientId: "import_bot_client", orgId: "org_1", resource: AUTH_AUDIENCE })`.
3. Binding persists.
4. The importer authenticates with `client_credentials`, gets a token with `org_id=org_1`, `client_id=import_bot_client`, scope `content:write`, calls `POST /media`. Policy resolves SA principal and allows.

Service-account principals **cannot** receive sensitive roles (`policy_management`, `ownership_transfer`, `organization_admin`) in v1 — the administration policy rejects them.

## Recipe F — Add A Denial (Block Specific Principal)

You want to revoke comment-moderation for `team_drafts` on `book_100`.

1. `POST /books/{bookId}/policy-denials` with body:

   ```json
   { "principal": { "type": "team", "id": "team_drafts" },
     "permission": "comment.moderate" }
   ```

2. `CreatePolicyDenialUseCase` validates the team via `validateTeamInOrganization({ teamId: "team_drafts", orgId: resource.orgId })`.
3. Denial wins over any allowing binding at the same or higher level.

Revoke later with `DELETE /books/{bookId}/policy-denials/{denialId}` via `RevokePolicyDenialUseCase`.

## Recipe G — Transfer Book Ownership

Only the owner can transfer. `system:book.owner` has `delegationClass = "ownership_transfer"`, which `authorizeBindingCreate` flatly rejects — there is a dedicated workflow:

1. `POST /books/{bookId}/transfer-ownership` with new owner user id and `Idempotency-Key`.
2. `TransferBookOwnershipUseCase` checks `book.transfer_ownership`, validates new owner via `validateUserInOrganization` (must be in the same org — owner is org-bound), atomically swaps the `system:book.owner` binding, emits a policy event.

Never write two `system:book.owner` bindings — the workflow enforces uniqueness.
