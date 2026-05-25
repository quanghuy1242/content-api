# Review Batch For Docs 015-017

> Date: 2026-05-25
>
> Status: review complete; amendments incorporated into `docs/015`, `docs/016`, and `docs/017`
>
> Purpose: retain the original review context for presentation, then record the corrected assessment after reading the surrounding product plans, current implementation boundaries, and subsequent product discussion. The accepted and compatible recommendations are now reflected in `docs/015`, `docs/016`, and `docs/017`; explicit unresolved product choices remain marked in those plans.
>
> Context read: `README.md`, `docs/002`, `docs/007`, abandoned `docs/009`, `docs/012` through `docs/017`, Payload schema/access specifications, and relevant current book, Content IAM, media, actor and persistence code.

## Decisions And Boundaries Now Established

- `docs/012` owns editorial lifecycle for `Book` and future `Chapter`: `draft | scheduled | published | archived`, lifecycle actions, and lifecycle timestamps.
- `docs/015` chooses recursive chapters, closed Lexical JSON, tracked media attachments, book-level `origin`, one-way `imported -> platform` promotion, and destructive `/replace` instead of merge/re-import-in-place.
- `docs/017` chooses `book_imports` as the operational import source of truth. Import processing status/history must not be added to `books`.
- Public published books and their eligible published chapters must support anonymous reading without an `id` user.
- Derived count metadata is wanted and should use asynchronous processing.
- Additional book/chapter validation and the schema-invariant fixes are wanted.
- `content_policy_events` remains an IAM-mutation stream unless `docs/014` is explicitly revised; content and moderation audit cannot silently use it.
- `docs/016` moderation authorization is a gap: moderation must not be implemented as IAM policy administration merely to exclude direct-share readers.
- Asynchronous EPUB import remains the direction, but its service-account authority, media integration, work tracking, and hostile-file limits require correction.

## Findings

### 1. `015` Does Not Define The Target `Book` Model

**Original finding/context**

> **Blocker: `015` does not define the target `Book` model.**
>
> It correctly identifies that the current book is minimal, but only proposes incremental additions such as `origin` and cover attachments, while introducing a full chapter model. The Payload-derived book contract includes `author`, slug, publication metadata, subjects, `chapterCount`, `totalWordCount`, EPUB metadata, cover and import/source fields; these need an explicit retain/replace/defer decision. See [015_book-content-model.md](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:201) and [payloadcms-schema-spec.md](/home/quanghuy1242/pjs/content-api/docs/payloadcms-schema-spec.md:229).

**Re-audit: Overstated as a blocker; a narrower contract gap is valid.**

The original issue is useful as an inventory warning, but my earlier proposed solution over-corrected it by implying that `015` must absorb a complete Payload-equivalent book contract. `012` already owns lifecycle fields and transitions. `017` deliberately owns import processing/history through `book_imports`; therefore `importStatus` must not be added to `books`.

There is still a real gap: `015` adds or accepts `description`, `language`, `subjects`, `publisher`, `publicationDate`, `isbn`, cover and origin fields without one authoritative field/API/entity decision table.

**Updated recommendation**

Add a focused "book fields introduced or affected by this plan" table to `015`, with a disposition for every Payload-derived candidate:

- Adopt in `015`: fields that are genuinely part of book content metadata, cover and origin/provenance.
- Reference `012`: publication lifecycle state and lifecycle timestamps.
- Reference `017`: import execution state, failures, progress and history.
- Explicitly defer or reject fields not yet selected, including author-credit/co-author and discovery additions until their product behavior is decided.

This preserves the contract question without rewriting `015` into a full Payload migration specification.

### 2. Public Chapter Reading Is Absent From `015`

**Original finding/context**

> **Blocker: public chapter reading is absent from `015`.**
>
> Payload allowed published chapters of public published books to be read anonymously, subject to password behavior. `015` routes require Content IAM checks for chapter reads, which would make public books unreadable without bindings unless another rule is added. See [015_book-content-model.md](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:544) and [payloadcms-access-control-policy-spec.md](/home/quanghuy1242/pjs/content-api/docs/payloadcms-access-control-policy-spec.md:490).

**Re-audit: Confirmed gap after product decision.**

The codebase already permits anonymous reads of public published books in [get-book.usecase.ts](/home/quanghuy1242/pjs/content-api/src/application/books/get-book.usecase.ts:14). You have now confirmed that public content will have anonymous readers. Therefore a chapter API that only permits IAM-authorized identity-bearing actors is inconsistent with both the current public-book behavior and the intended product.

**Updated recommendation**

Specify two chapter-read paths in `015`:

- Anonymous/public path: a published, publicly readable chapter within a public published book is readable without an `id` user, subject to any separate chapter lock gate selected under finding 6.
- IAM path: identified collaborators/readers can read private, draft or restricted content according to bindings and denials.

The public table-of-contents contract must also distinguish a listed locked chapter from hidden/unlisted content. A body lock must not silently make a listed chapter disappear from public navigation.

### 3. Word Count And Derived Metadata Are Not Designed

**Original finding/context**

> **High: word-count and derived metadata are not designed.**
>
> Payload had `chapterWordCount`, `totalWordCount`, and `chapterCount`; the plans do not define when these are computed, stored, recalculated after edits/imports, or exposed. This affects reading time, sorting, progress UX and imports. See [payloadcms-schema-spec.md](/home/quanghuy1242/pjs/content-api/docs/payloadcms-schema-spec.md:241) and [payloadcms-schema-spec.md](/home/quanghuy1242/pjs/content-api/docs/payloadcms-schema-spec.md:320).

**Re-audit: Confirmed product gap; async computation is now the preferred direction.**

The known missing parity surface is count metadata. My initial expansion into excerpts, hero-image extraction and other post-processing was not justified by an accepted decision. Reading time may be derived later from word count, but it does not need to be a stored first-release field.

**Updated recommendation**

Design asynchronous derived-count processing as follows:

1. A validated chapter-content write commits canonical content and a new content version.
2. The same durable workflow records an outbox/job item keyed by `chapterId` and expected content version; a direct D1-write-plus-queue-send flow is insufficient because enqueue failure would lose recomputation.
3. A metadata worker extracts visible text from the accepted Lexical document and computes `wordCount`.
4. It writes only when the chapter still has the expected version; stale or duplicate jobs are no-ops.
5. It schedules a coalesced book rollup that recomputes `chapterCount` and `totalWordCount` rather than applying unsafe concurrent deltas.

Store the eventually consistent values as derived projection data, for example `chapter_content_metrics` and `book_content_metrics`, while allowing the API to present those values as chapter/book metadata. Expose a pending/ready condition where a client needs to distinguish missing from not-yet-computed values.

EPUB import must use the same extraction rules, but should issue one final coalesced book rollup after chapter imports settle rather than recomputing totals for every intermediate write.

### 4. Content Validation Is Substantially Incomplete

**Original finding/context**

> **High: content validation is substantially incomplete.**
>
> `015` limits document size and code-block size, but does not specify title/description/slug limits, metadata constraints, chapter count/depth limits, media count, link limits, import limits or HTML/Lexical normalization rules. User-authored books require a product validation contract, not only transport-size checks. See [015_book-content-model.md](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:349).

**Re-audit: Partly confirmed; the original issue understated existing validation.**

`015` already defines a closed node union, block-id rules, chapter-link/media validation, code-block/document size limits, optimistic concurrency and configurable depth. `016` also defines limits for interactions. The confirmed gaps are additional metadata and chapter-input validation plus untrusted EPUB extraction bounds.

**Updated recommendation**

Add validation contract tables without discarding the existing rules:

- Normal authoring: book title/description/slug/metadata constraints; chapter title/slug/order input limits; media attachment count and ownership restrictions; publication preconditions.
- Lexical input: preserve the closed node union and normalization behavior already selected; add only limits required for accepted nodes and links.
- Import input: compressed and expanded total sizes, entry count, per-entry size, chapter/image count, path traversal rejection, compression-ratio limits and XML/XHTML/parser limits.

This is not a massive new subsystem for ordinary writes. Product-visible lengths require explicit values; hostile-import safety ceilings can be conservative engineering constraints.

### 5. Several Proposed Schema Invariants Are Not Enforceable As Written

**Original finding/context**

> **High: several proposed schema invariants are not actually enforceable as written.**
>
> Root chapter slugs can duplicate because `parentChapterId` is nullable in the unique key; chapter ordering is described as unique/dense but only indexed; parent chapters do not have a self-FK; nullable cover attachment keys permit multiple covers; and the image node requires `mediaId` while failure handling writes `mediaId: null`. See [015_book-content-model.md](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:249), [015_book-content-model.md](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:332) and [015_book-content-model.md](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:380).

**Re-audit: Confirmed technical findings.**

These issues do not challenge recursive chapters, attachment indexing or broken-media presentation. They mean the written schema cannot currently enforce the behavior that the plan states.

**Updated recommendation**

Correct `015` before implementation:

- Use separate or expression-based uniqueness enforcement for root and child chapter slugs.
- Make sibling ordering enforcement and reorder semantics explicit instead of describing a merely indexed field as dense/unique.
- Add a restrictive self-reference rule or clearly specify the workflow invariant for parent integrity.
- Make one-cover-per-book enforceable when attachment fields are nullable.
- Define a valid broken-image node variant or a separate failure representation so `mediaId: null` satisfies the declared content contract.

### 6. Password Lock And IAM Solve Different Problems

**Original finding/context**

> **High: password lock and IAM solve different problems; they should not overlap.**
>
> IAM is identity-based authorization for owners, editors, reviewers and readers. A chapter password is an anonymous/shared-secret gate. Payload itself left unresolved whether passwords applied only to anonymous users or all non-owners. Implementing both without an access matrix creates contradictory behavior. See [payloadcms-access-control-policy-spec.md](/home/quanghuy1242/pjs/content-api/docs/payloadcms-access-control-policy-spec.md:1210) and [content-permission.ts](/home/quanghuy1242/pjs/content-api/src/domain/iam/content-permission.ts:79).

**Re-audit: The distinction is correct; my initial treatment violated the explicit decision in `015`, but the new anonymous-reader decision requires the issue to be discussed again.**

`015` expressly rejects chapter passwords in favor of Content IAM/direct-share access. Direct-share access, however, still requires an identified `id` user. It cannot provide anonymous locked reading. Because the product now requires anonymously readable public content, `015` must either state that public published chapters are never locked or introduce an orthogonal anonymous content gate.

`015` does not presently handle gated chapters. If a chapter is modeled only as private/IAM-readable, it will be absent from an anonymous TOC. That is not appropriate for a publicly discoverable locked chapter.

**Updated recommendation**

If publicly listed locked chapters are wanted, add a narrow chapter audience gate separate from IAM and lifecycle:

| Chapter situation | Anonymous public reader | IAM-authorized reader/editor |
|---|---|---|
| Published, public, unlocked | Read metadata and body | Read metadata and body |
| Published, listed, locked | See TOC metadata; unlock proof required for body | Read body without password |
| Unlisted or private/unpublished | No anonymous disclosure | Read only when authorized |

Treat discoverability (`listed`/`unlisted`) separately from body access (`public`/`locked`). For a password-based locked chapter, exchange a successful password for a short-lived proof bound to the chapter/book and lock version; do not transmit or persist raw passwords as an ongoing authorization mechanism.

This is a deliberate amendment to the no-password decision in `015`, not an automatic parity correction. If public locked chapters are not required, retain the current rejection and state that published public chapters are fully anonymous-readable.

### 7. `015` And `016` Misuse IAM Audit Storage For Product Events

**Original finding/context**

> **High: `015` and `016` misuse IAM audit storage for product events.**
>
> Both plans propose writing content promotion/moderation events to `content_policy_events`, but the existing design explicitly treats that stream as IAM-only, and its domain event union contains only policy actions. Product audit requires a separate audit stream or an explicit revision of `014`. See [014_audit-service-stub.md](/home/quanghuy1242/pjs/content-api/docs/014_audit-service-stub.md:38) and [policy-event.entity.ts](/home/quanghuy1242/pjs/content-api/src/domain/iam/policy-event.entity.ts:3).

**Re-audit: Confirmed document contradiction.**

`docs/014` and current code make `content_policy_events` an IAM-policy mutation stream. A book replacement, imported-origin promotion or moderation outcome is an operational/content action, not a binding, denial or role mutation. Storing them together would corrupt the meaning of the IAM audit route and retention/security boundary.

**Updated recommendation**

Do not use `content_policy_events` for these events. Choose one of two explicit first-release positions:

- If general action audit remains deferred, remove the mandatory product-event writes from `015` and `016` and retain these actions as candidate triggers in `014`.
- If destructive replacement and moderation must be auditable at launch, promote a minimal `audit_events` capability from `014`: an append-only store and `AuditRecorder` for `book.replaced`, `book.origin_promoted` and `comment.moderated`.

My recommendation is the second option if replacement and moderation ship in the first release, because those are high-accountability actions. `book_imports` remains the operational import history and must not be replaced by either audit stream.

### 8. `016` Conflates Moderation With IAM Administration

**Original finding/context**

> **High: `016` conflates moderation with IAM administration.**
>
> Promoting `comment.moderate` to `policy_management` would make ordinary moderator roles impossible because `policy_management` is intentionally restricted to role/binding administration. Moderation should remain a content action, with a workspace-membership restriction if direct-share readers must never moderate. See [016_book-interactions.md](/home/quanghuy1242/pjs/content-api/docs/016_book-interactions.md:432) and [content-administration.policy.ts](/home/quanghuy1242/pjs/content-api/src/domain/iam/content-administration.policy.ts:38).

**Re-audit: Confirmed gap in mechanism; the security intent is valid.**

`016` correctly intends that an external direct-share reader must not acquire moderation power. Its proposed use of `policy_management` is not a coherent enforcement mechanism: delegation class governs IAM role assignment constraints, while the comment use case still checks a content permission. It also prevents a normal workspace moderator role.

**Updated recommendation**

Keep `comment.moderate` as a content permission and make the actor restriction explicit:

- Moderation requires an authenticated workspace actor for the resource organization.
- Direct-share actors cannot satisfy the moderation guard, even if they have ordinary read/comment collaboration access.
- Expose moderation through an organization moderator role or another constrained workspace-only binding path, without granting binding/role administration.

This gives moderators only moderation authority, not Content IAM administration authority.

### 9. `017` Cannot Execute Through Current Actor And Media Boundaries

**Original finding/context**

> **High: `017` cannot execute through current actor and media boundaries.**
>
> The plan alternates between a `systemImporterActor` and an importer service account. Current content-scope enforcement rejects system actors, while current media creation requires user-owned creation context and therefore cannot be reused by an importer service account. See [017_epub-import.md](/home/quanghuy1242/pjs/content-api/docs/017_epub-import.md:497), [scopes.ts](/home/quanghuy1242/pjs/content-api/src/domain/auth/scopes.ts:9), [create-media-upload.usecase.ts](/home/quanghuy1242/pjs/content-api/src/application/media/create-media-upload.usecase.ts:98) and [content-ownership.ts](/home/quanghuy1242/pjs/content-api/src/application/content-ownership.ts:14).

**Re-audit: Confirmed implementation incompatibility; async import and the service-account direction should be retained.**

The EPUB importer performs user-initiated delegated content writes. It is not the same as a low-level processor operating with system authority. The initiator must remain attributable, while the machine doing work must have narrowly authorized execution rights.

**Updated recommendation**

Define one consistent flow in `017`:

1. A user starts an import after authorization; the import row records initiator, target, requested mode and authorization context.
2. Queue workers operate as a dedicated importer service account scoped to active import work, not as `systemImporterActor`.
3. Ownership and author attribution for created content remain associated with the initiating/chosen human owner; machine activity is represented by the import record and, if adopted, general audit.
4. Create an import-compatible media creation workflow that accepts importer execution plus initiator ownership attribution, then reuses the existing derivative-processing pipeline.
5. Create an import-specific chapter-write workflow that applies normal chapter/content validation without misrepresenting the operation as a normal interactive edit.

System actors remain appropriate for infrastructure processing that does not perform policy-gated delegated authoring, such as derivative media processing.

### 10. The Proposed Importer Is Overprivileged And Its Queue Model Is Unsafe

**Original finding/context**

> **High: the proposed importer is overprivileged and its queue model is unsafe.**
>
> Giving the importer `system:org.content_admin` grants IAM and ownership-management capabilities beyond import. Concurrent chapter jobs also update shared JSON/counters, permitting lost updates and unclear conflict behavior if an author edits during import. EPUB decompression, entry-count, path, XML/HTML and media limits are not specified. See [017_epub-import.md](/home/quanghuy1242/pjs/content-api/docs/017_epub-import.md:311), [017_epub-import.md](/home/quanghuy1242/pjs/content-api/docs/017_epub-import.md:536) and [content-permission.ts](/home/quanghuy1242/pjs/content-api/src/domain/iam/content-permission.ts:114).

**Re-audit: Confirmed technical gaps; edit-during-import behavior was a stated trade-off but should be changed if normal editing is exposed.**

The role is both broader than necessary and incompatible with the implemented IAM restrictions on sensitive service-account assignments. Shared mutable scratch JSON/counters are unsuitable for parallel idempotent queue processing. The ZIP/parser restrictions are necessary security boundaries, not optional UX enhancement.

**Updated recommendation**

- Introduce organization-level authorization to start a new import and book-level authorization for replacement/import into an existing book.
- Authorize the worker with only import-specific content operations for the active `importId` and target `bookId`; do not grant organization content-admin or IAM management.
- Track processing in normalized per-item import state or immutable manifest plus item rows, with idempotent completion and finalization, rather than mutating common JSON counters in parallel.
- While an import owns an incomplete book, reject ordinary editor chapter mutations with `409 Import in progress` or keep the book unavailable to editors. Do not silently accept overwritten human edits.
- Add decompression, entry, path, parser, chapter, image and media safety ceilings before implementation.
- Complete `book_imports` at finalization and enqueue one derived-metrics rollup; do not add operational import status to `books`.

### 11. `016` Does Not Define Behavior After Chapter Access Is Revoked

**Original finding/context**

> **Medium: `016` does not define behavior after chapter access is revoked.**
>
> Bookmarks and reading progress validate read access when created, but the plan does not state whether later list/read operations hide, redact, retain or delete private state after a reader loses access. Comment orphaning is also described as asynchronous while comments may remain visible against removed blocks. See [016_book-interactions.md](/home/quanghuy1242/pjs/content-api/docs/016_book-interactions.md:359) and [016_book-interactions.md](/home/quanghuy1242/pjs/content-api/docs/016_book-interactions.md:350).

**Re-audit: Mixed. Access-revocation behavior is genuinely missing; asynchronous orphan handling is already an accepted availability trade-off.**

`016` deliberately keeps bookmarks and reading progress private to their subject and chooses best-effort orphan marking so that chapter saves are not rejected when comment reconciliation fails. It does not decide how a subject sees historical progress/bookmarks after losing content access.

**Updated recommendation**

For v1, retain the subject's private bookmark/progress rows after access revocation but redact or omit inaccessible chapter/book presentation data until access returns. Do not delete private history as a side effect of an IAM change unless that privacy/product behavior is explicitly chosen.

Keep post-save best-effort orphan reconciliation. If orphaned comments must not remain publicly visible during the reconciliation window, require read/presentation queries to exclude comments whose block is no longer resolvable or has already been marked orphaned.

### 12. The Payload/Wattpad Parity Inventory Needs Correction And Expansion

**Original finding/context**

> **Medium: the Payload/Wattpad parity inventory needs correction and expansion.**
>
> `gaps.md` is right about missing book fields, metrics, validation and password decisions. However, the extracted Payload spec associates YouTube/table/code editor features with posts, not chapters; adding them to chapters would be a new product decision. Missing disposition items include preview/share access, EPUB export/generation, revision history/autosave, author credits/co-author workflow, discovery metadata and engagement features. See [payloadcms-schema-spec.md](/home/quanghuy1242/pjs/content-api/docs/payloadcms-schema-spec.md:768) and [payloadcms-schema-spec.md](/home/quanghuy1242/pjs/content-api/docs/payloadcms-schema-spec.md:818).

**Re-audit: Useful product inventory, not a defect in the foundational plans.**

`015` through `017` are not intended to deliver every authoring, discovery and engagement feature. The inventory remains valuable because omitted behavior should be a deliberate defer/reject decision rather than an accidental loss from Payload. Chapter support for post-only rich nodes would be a new feature choice.

**Updated recommendation**

Create a separate disposition matrix, not a rewrite of the three foundational plans. For each candidate, record `retain`, `replace`, `defer` or `reject`, ownership document and dependency:

- Book metadata and author credits/co-author behavior.
- Public reading, listed locked chapters and preview/share capability.
- Derived counts and any reading-time presentation.
- EPUB import and later export/generation.
- Revision history/autosave.
- Chapter editor node types beyond the currently selected Lexical contract.
- Discovery metadata and engagement/social features.

Only accepted dependencies should cause targeted amendments in `015` through `017`.

## Additional Findings Exposed By The Re-Audit

### A. `015` Contradicts Itself On The First Human Edit Of An Imported Book

**Disposition: Confirmed correction needed.**

The goal and edge-case table state that the first non-system chapter edit succeeds and atomically promotes `origin` from `imported` to `platform`. The restriction paragraph instead says ordinary content writes are rejected until explicit promotion ([docs/015](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:439), [docs/015](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:449), [docs/015](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:901)).

**Updated recommendation:** keep the stated auto-promotion decision: after import is complete, the first accepted human chapter-content edit atomically promotes origin to `platform`; correct the reject-write paragraph to match. During an active import, apply the import-in-progress editing rule from finding 10.

### B. `015` Replacement Bypasses The Lifecycle Boundary Owned By `012`

**Disposition: Confirmed integration question.**

`012` requires archive to be an explicit lifecycle transition guarded through `book.archive`, and prohibits generic status mutation. `015` replacement directly writes the predecessor's archived status while authorizing only `book.update` and `book.import` ([docs/012](/home/quanghuy1242/pjs/content-api/docs/012_content-lifecycle-plugin.md:1028), [docs/012](/home/quanghuy1242/pjs/content-api/docs/012_content-lifecycle-plugin.md:1034), [docs/015](/home/quanghuy1242/pjs/content-api/docs/015_book-content-model.md:459)).

**Updated recommendation:** define replacement as a dedicated destructive workflow whose authorization explicitly includes the authority to archive the replaced predecessor and whose transition is recorded through the lifecycle boundary. Avoid requiring clients to orchestrate two independently failing requests.

### C. `016` Uses Comment Moderation Authority To Mutate Private Reading State

**Disposition: Needs product/security decision.**

`016` says reading state is private to the subject and excluded from IAM, then adds an administrative reading-progress reset guarded by `comment.moderate` ([docs/016](/home/quanghuy1242/pjs/content-api/docs/016_book-interactions.md:387), [docs/016](/home/quanghuy1242/pjs/content-api/docs/016_book-interactions.md:538), [docs/016](/home/quanghuy1242/pjs/content-api/docs/016_book-interactions.md:737)).

**Updated recommendation:** keep self-reset only in v1. If administrative reset later becomes necessary, give it a dedicated support/privacy permission and audit behavior rather than inheriting comment moderation authority.

### D. `017` Contains Stale Lifecycle/Import Wording

**Disposition: Confirmed wording fix.**

`017` correctly says `book_imports` owns import status, but its summary also says finalization "bump[s] `book.status` to `draft`" ([docs/017](/home/quanghuy1242/pjs/content-api/docs/017_epub-import.md:163), [docs/017](/home/quanghuy1242/pjs/content-api/docs/017_epub-import.md:599)). A newly imported book is already created as lifecycle `draft`.

**Updated recommendation:** finalization completes the import row and makes the completed draft available for the next permitted workflow; publication lifecycle remains entirely governed by `012`.

## Original Consolidated Recommendations Context

The earlier review summarized its recommendations as follows. It is retained here so reviewers can see the original basis; the per-finding re-audit and updated recommendations above control where this text overreached or has been superseded.

1. Revise `015` first with authoritative `Book` and `Chapter` field tables covering persistence, API shape, validation, authorization and migration decisions. Separate `authorCredits`/contributors from IAM role bindings: attribution and editing authority are not the same concept.
2. Add derived metadata explicitly: compute `chapter.wordCount` whenever validated chapter content changes; update `book.chapterCount` and `book.totalWordCount` transactionally or via reliable delta processing; derive reading time from stored word count. Import must use the same calculation path.
3. Keep IAM for identifiable collaborators and readers. Do not implement static chapter passwords in the first implementation unless anonymous secret-based reading is a required product feature. A revocable, expiring read-only preview/share capability is cleaner for sharing; co-author invitations must result in IAM bindings.
4. Define a validation standard in `015`: title/slug/description limits, allowed Lexical nodes, chapter depth and ordering rules, maximum document/block/media/link sizes, media ownership rules, publication requirements and import bounds.
5. Fix the chapter schema before implementation: enforce root and child slug uniqueness separately, add parent constraints, define reorder semantics, make cover uniqueness enforceable, and make image failure-state JSON valid under the declared node schema.
6. Revise `016` so comment moderation remains an ordinary chapter-scoped permission with a workspace-only policy guard. Keep progress/bookmarks private to their owner in v1, define access-revocation behavior, and make orphan reconciliation reliable.
7. Revise `017` around a dedicated least-privilege importer role and import workflow. Introduce an org-level start-import authorization for new books, normalized import-item state instead of shared JSON counters, explicit edit-during-import behavior, an import-specific media path, and ZIP/decompression/security limits.
8. Create a product disposition matrix for former Payload functionality: `retain`, `replace`, `defer`, or `reject`. It should cover book metadata, public chapters, counts, password/preview access, EPUB export/import, comments, drafts/revisions, co-authors, discovery fields and engagement.

The earlier product-direction summary agreed with recursive chapters, structured Lexical content, separate media attachment indexing, comments/bookmarks/progress outside IAM bindings, and asynchronous EPUB import. It proposed changing the use of `content_policy_events` for content audit, moderation as IAM policy management, importer organization-content-admin authority, and anonymous sharing as a substitute for editor/co-author IAM membership. Those four corrections remain valid, with chapter locking now explicitly reopened because anonymous public readers are required.

## Recommended Next Discussion Order

1. Decide whether public locked chapters are required, and if so confirm the listed-by-default TOC and IAM-bypass behavior recommended in finding 6.
2. Decide the word-count text extraction rule and public API pending/ready presentation for async metrics.
3. Decide whether replacement and moderation require `audit_events` in the first release or remain unaudited candidate triggers under `014`.
4. Confirm the workspace-only moderator role/guard shape and whether administrative reading-progress reset is deferred.
5. Confirm import-in-progress editor blocking and the least-privilege importer authorization model.

The non-controversial corrections and accepted direction have been incorporated into `015` through `017` without replacing those plans. The remaining explicit decisions above must be settled before implementation begins for the affected surfaces.
