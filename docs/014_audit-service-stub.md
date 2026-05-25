# Audit Service — Stub

> Status: stub — placeholder; design intentionally deferred
>
> Date: 2026-05-25
>
> Scope:
>
> - `/home/quanghuy1242/pjs/content-api`
>
> Source docs:
>
> - `docs/architecture.md` — §20 "Audit Logging"
> - `docs/007_content-iam-policy-binding-model.md` — `content_policy_events` is binding-scoped only
> - `src/infrastructure/db/schema.ts` — `content_policy_events` table
>
> Related docs:
>
> - `docs/015_book-content-model.md`
> - `docs/016_book-interactions.md`
> - `docs/017_epub-import.md`
>
> Assumptions:
>
> - Design is deferred until at least one operator-visible incident or compliance ask makes the gap concrete. Do not pre-build an audit subsystem on speculation.

## Table Of Contents

- [1. Purpose](#1-purpose)
- [2. Current State](#2-current-state)
- [3. Gap](#3-gap)
- [4. Candidate Triggers When Design Resumes](#4-candidate-triggers-when-design-resumes)
- [5. Out Of Scope For This Stub](#5-out-of-scope-for-this-stub)
- [6. Resumption Checklist](#6-resumption-checklist)

## 1. Purpose

Record that there is no general resource-mutation audit log in `content-api`. The repo has one narrow audit table (`content_policy_events`) that covers IAM binding/denial/role mutations. There is no audit for book/chapter content edits, comment moderation outcomes, media deletes, or import lifecycle transitions. This stub names the gap so future work can resume from a known baseline without re-discovering it.

## 2. Current State

Implemented today:

- `content_policy_events` table in [src/infrastructure/db/schema.ts](../src/infrastructure/db/schema.ts) — written by Content IAM mutation use cases (`create-policy-binding.usecase.ts`, `create-policy-denial.usecase.ts`, `replace-content-role-permissions.usecase.ts`, ownership-transfer workflows, and the bounded denied-mutation rate-limit recorder).
- The architecture doc [docs/architecture.md](architecture.md) §20 sketches a general `audit_events` table (`actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, `metadata_json`, `request_id`, `created_at`). That table is not implemented.
- Lifecycle transitions (publish/unpublish/schedule/archive) are encoded as status changes on the resource row; their *who/when/why* metadata is not separately persisted.

## 3. Gap

`content_policy_events` is not a general resource audit:

- It is keyed on (`orgId`, `targetType`, `targetId`) of policy targets — bindings, denials, role-permission sets, ownership-transfer rows. It does not record book updates, chapter content edits, media deletes, or import attempts.
- It uses snapshot JSON whose shape is owned by IAM use cases. New resource types cannot reuse the schema without overloading the `targetType` enum.
- Its retention policy is rate-limit-driven, not "keep for N days of operator forensics".

So the current answer to questions like "who archived this book yesterday?", "who moderated comment X to rejected?", or "which user triggered the failed import on book Y?" is: read git-blame on the application code and hope the request id is in a log line somewhere.

## 4. Candidate Triggers When Design Resumes

When this work resumes, the first pass should design a generic `audit_events` table covering — at minimum — these triggers from the other planning docs. None of these need to ship in the first release of their parent doc; this list exists so the audit doc has a concrete starting backlog.

From [docs/015_book-content-model.md](015_book-content-model.md):

- Book create / update / delete.
- Book `origin` promotion (`imported → platform`) — operator-visible because it gates re-import behavior.
- Book "replace existing book" destructive workflow — the archived predecessor's id, the new book's id, the actor.
- Chapter create / update / delete / move (parent change).
- Media attach / detach on a chapter; media-attached-when-deleted (cascade decisions).

From [docs/016_book-interactions.md](016_book-interactions.md):

- Comment moderation status transitions (`pending → approved | rejected`).
- Comment hard-delete (separate from soft delete).
- Inline comment resolution / unresolution.
- Rate-limit rejections that block a user comment — useful for abuse forensics; only sample if volume becomes a problem.

From [docs/017_epub-import.md](017_epub-import.md):

- `book_imports` lifecycle transitions (`pending → parsing → processing → completed | failed | cancelled`).
- Import-driven book creation (the `book_imports` row already records this, but the audit log is the cross-resource read surface).
- Import-driven media creation (each uploaded image creates a media row whose `createdBy` is the importer's actor).

From operational concerns not yet documented elsewhere:

- Login-equivalent events for service-account M2M actors hitting content mutation routes.
- Permission-denied path: failed `ContentPolicy.can(...)` decisions are not audited today (architecture §20 explicitly says failed checks do not create success audit events; the question is whether they should create *denial* audit events on sensitive resources). Cross-check with the bounded denied-mutation recorder that IAM already has.

## 5. Out Of Scope For This Stub

The following are intentionally not designed here:

- Table schema for `audit_events`.
- Sampling vs full retention policy.
- Read API for operators.
- Whether audit writes use the request DB connection or a separate, best-effort path.
- Cross-cutting middleware vs explicit use-case calls.
- Integration with external SIEM / log shipping.

## 6. Resumption Checklist

When the audit doc moves from stub to implementation-grade:

- [ ] Replace this file with a full document following [references/implementation-grade-structure.md](../../.claude/skills/research-doc-writer/references/implementation-grade-structure.md).
- [ ] Read all four "From docs/0xx_*" trigger lists above and reconcile with their then-current state.
- [ ] Decide cardinality vs `content_policy_events`. The simplest answer is one new `audit_events` table sitting next to `content_policy_events`, with IAM events still in their dedicated table to preserve their existing retention rules.
- [ ] Decide write path. Recommended starting point: each use case calls a thin `AuditRecorder` port from `domain/audit/`, implemented by `infrastructure/repositories/drizzle-audit.repository.ts`. Best-effort writes (do not fail the parent use case if the audit write fails) unless a follow-up incident justifies otherwise.
- [ ] Decide retention. Recommended starting point: 90 days, with a daily cron in `workers/audit-prune/` or as a job on the existing cron worker.
- [ ] Update [README.md](../README.md) and the relevant 015/016/017 docs to point each trigger row at the audit table once it exists.
