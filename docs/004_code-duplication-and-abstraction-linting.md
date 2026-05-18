# Two-Pass Code Quality Checks For Duplication And Agent Output

> Status: implemented in current codebase
>
> Date: 2026-05-18
>
> Scope:
>
> - `package.json` scripts for a hard gate and an advisory pass
> - `scripts/oxlint-js-plugins/architecture.js` route-handler boundary rule
> - `AGENTS.md` workflow guidance for agent-run advisory checks
> - Narrow source cleanup for stable relationship/ReBAC duplication
>
> Source docs:
>
> - `AGENTS.md`
> - `.agents/skills/content-api-architecture-lint/SKILL.md`
> - `.agents/skills/content-api-architecture-lint/references/rule-contract.md`
> - `.agents/skills/content-api-architecture/references/architecture-rules.md`
> - `docs/003_entity-classes-and-oxlint-arch-linting.md`
>
> External sources verified on 2026-05-18:
>
> - [Fallow](https://github.com/fallow-rs/fallow) — npm `fallow@2.75.0`, TS/JS codebase intelligence with duplication, dead-code, circular-dependency, and complexity analysis
> - [Oxlint JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins) — Oxlint can load npm ESLint-compatible JavaScript plugins through `jsPlugins`; this support is alpha
> - [eslint-plugin-unslop](https://github.com/skhoroshavin/eslint-plugin-unslop) — npm `eslint-plugin-unslop@0.6.1`, rules for AI-generated code smells, false sharing, and single-use constants
> - [Aislop](https://github.com/scanaislop/aislop) — npm `aislop@0.9.0`, advisory scanner for formatting, lint, quality, AI-slop, and security signals
>
> Related docs:
>
> - `.oxlintrc.json`
> - `README.md`

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current-State Findings](#2-current-state-findings)
  - [2.1 Existing Hard Gate](#21-existing-hard-gate)
  - [2.2 Existing Architecture Policy](#22-existing-architecture-policy)
  - [2.3 Fallow Measurements](#23-fallow-measurements)
  - [2.4 Aislop Measurements](#24-aislop-measurements)
  - [2.5 Unslop Trial Result](#25-unslop-trial-result)
- [3. Target Model](#3-target-model)
  - [3.1 Hard Gate](#31-hard-gate)
  - [3.2 Advisory Pass](#32-advisory-pass)
  - [3.3 Agent Workflow](#33-agent-workflow)
- [4. Architecture Decisions](#4-architecture-decisions)
  - [4.1 Adopt Fallow With Cleanup-First Gating](#41-adopt-fallow-with-cleanup-first-gating)
  - [4.2 Use Aislop As Advisory Only](#42-use-aislop-as-advisory-only)
  - [4.3 Do Not Adopt Unslop As A Hard Gate](#43-do-not-adopt-unslop-as-a-hard-gate)
  - [4.4 Implement A Narrow Route Boundary Rule](#44-implement-a-narrow-route-boundary-rule)
  - [4.5 Defer Broader AI-Slop Integrators](#45-defer-broader-ai-slop-integrators)
- [5. Implemented Commands](#5-implemented-commands)
- [6. Implementation Plan](#6-implementation-plan)
- [7. Implementation Backlog](#7-implementation-backlog)
- [8. Future Backlog](#8-future-backlog)
- [9. Risks And Failure Modes](#9-risks-and-failure-modes)
- [10. Test And Verification Plan](#10-test-and-verification-plan)
- [11. Definition Of Done](#11-definition-of-done)
- [12. Final Model](#12-final-model)

## 1. Goal

Create a two-pass quality model for this repository:

1. `pnpm check` stays the **hard gate** for correctness, architecture invariants, type safety, tests, and eventually a controlled duplicate-code threshold.
2. `pnpm advise` gives agents and humans broader quality feedback after implementation without blocking every PR on noisy or context-dependent findings.

The problem this solves is not just "AI slop." The repository already has strict local architecture rules, but it does not yet detect:

- repeated blocks or near-repeated use-case flows that should be extracted;
- repeated helper logic that indicates a missing shared module;
- local wrappers, exported helpers, comments, or large files that may be acceptable in context but deserve review;
- duplicated imports and other fixable cleanup that is beneath the architecture linter's current scope.

Non-goals:

- Do not add ESLint as a parallel runner.
- Do not turn generic "AI slop" scores into CI blockers.
- Do not weaken the existing architecture lint plugin to satisfy generic tools.
- Do not extract a generic idempotent-create runner while the explicit use-case flow is still clearer.

## 2. Current-State Findings

### 2.1 Existing Hard Gate

`package.json` now defines:

```json
{
  "lint": "oxlint",
  "check": "pnpm lint && pnpm check:dup && pnpm typecheck && pnpm test",
  "check:dup": "node scripts/check-duplication-threshold.mjs",
  "advise": "pnpm advise:aislop && pnpm advise:dupes",
  "advise:aislop": "aislop scan --exclude node_modules,dist,coverage,.wrangler,migrations",
  "advise:dupes": "fallow dupes --mode semantic --min-tokens 150 --min-lines 10 --skip-local --ignore-imports --format compact --quiet",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

`pnpm check` is therefore the CI-grade gate:

1. `pnpm lint` runs Oxlint plus the local `architecture/*` JS plugin rules.
2. `pnpm check:dup` runs the Fallow mild duplicate-code threshold.
3. `pnpm typecheck` runs `tsc --noEmit`.
4. `pnpm test` runs Vitest in the Cloudflare Workers pool.

This gate should remain strict. New hard checks should be deterministic, low-noise, and aligned with documented architecture invariants.

### 2.2 Existing Architecture Policy

The repository now has 16 local architecture rules in `scripts/oxlint-js-plugins/architecture.js`, including:

- `architecture/layer-imports`
- `architecture/route-module`
- `architecture/route-handler-boundary`
- `architecture/repository-workflow`
- `architecture/mapper-file`
- `architecture/entity-class`
- `architecture/no-raw-entity-serialization`
- `architecture/no-magic-numbers`
- `architecture/constants-placement`
- `architecture/constants-jsdoc`

The constants policy matters for tool selection:

- `.agents/skills/content-api-architecture/references/architecture-rules.md` says numeric literals except `0` and `1` must be extracted in `src/application/**`, `src/domain/**`, `src/http/**`, and `src/shared/**`.
- Cross-cutting constants such as HTTP status codes, pagination limits, and idempotency TTL belong in `src/shared/constants.ts`.
- Resource-specific constants belong in `src/domain/<resource>/`.
- Named constants must use `SCREAMING_SNAKE_CASE` and JSDoc when placed in allowed constant locations.

That means a generic "single-use constants are bad" rule conflicts with this repo unless it can distinguish throwaway implementation constants from architectural vocabulary.

### 2.3 Fallow Measurements

Fallow was run locally against the current codebase with `--skip-local` and `--ignore-imports`.

Pre-implementation results:

| Command shape | Result | Interpretation |
|---|---:|---|
| `fallow dupes --mode strict --min-tokens 50 --min-lines 5 --skip-local --ignore-imports` | `3.7%`, 4 clone groups, 286 duplicated lines | High-signal exact or near-exact duplication. This should be cleaned before gating. |
| `fallow dupes --mode mild --min-tokens 50 --min-lines 5 --skip-local --ignore-imports` | `3.7%`, 4 clone groups, 286 duplicated lines | Same current signal as strict; good candidate for a future hard threshold. |
| `fallow dupes --mode semantic --min-tokens 50 --min-lines 5 --skip-local --ignore-imports` | `17.9%`, 42 clone groups, 1,370 duplicated lines | Too broad for an immediate gate; useful for design review. |
| `fallow dupes --mode semantic --min-tokens 150 --min-lines 10 --skip-local --ignore-imports` | `8.0%`, 9 clone groups, 508 duplicated lines | Better advisory signal for large semantic duplication. |
| `fallow dupes --mode semantic --min-tokens 200 --min-lines 12 --skip-local --ignore-imports` | `6.3%`, 4 clone groups, 369 duplicated lines | Most conservative semantic signal. |

The strict/mild groups currently include repeated application create/idempotency logic and repeated domain-policy/entity shapes. Some of this is real duplication; some is architectural symmetry. The right first action is cleanup and review, not baselining all current duplication as acceptable.

Post-implementation hard-gate result:

| Command shape | Result | Interpretation |
|---|---:|---|
| `pnpm check:dup` | `2.0%`, 2 clone groups, 155 duplicated lines | Passes the wrapper-enforced `3%` hard threshold after targeted cleanup. |

Remaining accepted mild clone groups:

- create use-case idempotency lifecycle across category, media, post, and user use cases;
- short entity getter/update symmetry across deferred-grant and grant-mirror entities.

The idempotency lifecycle is intentionally still explicit. A generic `runIdempotentCreate` abstraction was rejected because it would hide resource-specific domain construction, workflow inputs, replay rehydration, and conflict behavior behind a premature framework. The stable duplicate cleanup was limited to a user-subject relationship factory and a shared ReBAC policy helper.

### 2.4 Aislop Measurements

`aislop@0.9.0` was run locally as:

```bash
pnpm dlx aislop@0.9.0 scan --json --exclude node_modules,dist,coverage,.wrangler,migrations .
```

Result summary:

- Score: `25`
- Label: `Critical`
- Errors: `0`
- Warnings: `38`
- Fixable warnings: `24`

Post-implementation advisory result after duplicate-import cleanup:

- Score: `47`
- Label: `Critical`
- Errors: `0`
- Warnings: `19`
- Fixable warnings: `6`

Useful findings:

- duplicate imports in application, composition, infrastructure repositories, and mapper files;
- duplicate 10-11 line blocks in route modules and mappers;
- potential unnecessary export of `stableStringify` from `src/shared/idempotency.ts`;
- complexity pressure in `src/composition/create-request-container.ts` and route registration functions.

Findings that require local judgment:

- `createDb` in `src/infrastructure/db/client.ts` was flagged as a thin wrapper, but it names the database construction boundary and keeps Drizzle/D1 setup out of composition code.
- `encodeCursor` in `src/shared/pagination/cursor.ts` was flagged as a thin wrapper, but it pairs with `decodeCursor` and names cursor semantics.
- narrative-comment findings overlap with this repository's deliberate JSDoc policy for constants and architecture-critical helpers.
- `scripts/oxlint-js-plugins/architecture.js` was flagged as too large; this is true, but splitting the plugin should be a separate linter-maintenance decision.
- the `esbuild` audit warning is likely dev-tool/transitive noise until confirmed by `pnpm audit` and dependency ownership.

Aislop is therefore useful as an advisory scanner, not as a hard quality gate.

### 2.5 Unslop Trial Result

Oxlint can load npm ESLint-compatible JavaScript plugins via `jsPlugins`; no separate ESLint runner is required for compatible plugins. This was verified against the official Oxlint JS plugin docs.

`eslint-plugin-unslop@0.6.1` was also trialed through Oxlint's JS plugin path. The plugin can run, but these two rules are not suitable as hard gates for this repo today:

- `unslop/no-single-use-constants`
- `unslop/no-false-sharing`

Observed conflicts:

- `no-single-use-constants` flags many constants in `src/shared/constants.ts`, including HTTP status codes and pagination constants. In this repo, those names are architecture/API vocabulary, not only reuse optimizations.
- `no-false-sharing` flags shared boundary symbols such as `AppError`, `toErrorResponse`, and route idempotency constants. These are valid shared-layer concepts even when only one directory imports a given symbol today.
- The rule does expose real review opportunities, for example an exported `stableStringify` with no external consumers, but the valid findings are mixed with architecture-invalid recommendations.

Conclusion: Unslop is a useful reference, but not a hard gate. If adopted later, it should be scoped narrowly to a future `src/shared/utils/**` style area where "shared" means reusable utility, not cross-layer boundary contract.

## 3. Target Model

### 3.1 Hard Gate

`pnpm check` should remain the command that decides whether code is mergeable.

Hard-gated checks must be:

- deterministic in local and CI environments;
- low-noise on the current architecture;
- aligned with `docs/architecture.md` and `.agents/skills/content-api-architecture/references/architecture-rules.md`;
- fixable by changing code, not by arguing with a generic score.

Recommended hard-gate expansion:

1. Review and clean stable strict/mild duplicate groups.
2. Add a Fallow duplicate gate after cleanup.
3. Keep semantic duplication outside the hard gate until reviewed and intentionally abstracted or accepted.

### 3.2 Advisory Pass

Add an advisory command named `pnpm advise` that agents run after completing code changes.

Advisory checks may be noisy. They should:

- produce findings for review;
- exit successfully unless a tool itself crashes;
- avoid becoming a CI blocker by default;
- help agents identify cleanup before the final `pnpm check`;
- surface duplicate imports, duplicate blocks, complexity pressure, suspicious wrappers, and semantic duplication.

The advisory pass should combine:

- Aislop scan for broad agent-output and hygiene signals;
- Fallow semantic duplication scan with conservative thresholds;
- optionally Fallow dead-code scan in a later phase.

### 3.3 Agent Workflow

After implementation, `AGENTS.md` should be updated to require this workflow:

1. Run `pnpm check` for hard verification before finalizing work.
2. Run `pnpm advise` after meaningful code changes.
3. Treat advisory findings as review input:
   - fix clear, local cleanup such as duplicate imports;
   - inspect duplicate blocks and complexity findings;
   - explain intentionally ignored advisory findings in the final answer when they are relevant.
4. Do not weaken architecture lint rules because advisory tools complain.

This keeps the hard gate clean while still making advisory output part of the agent's routine.

## 4. Architecture Decisions

### 4.1 Adopt Fallow With Cleanup-First Gating

Decision: adopt Fallow, but do not immediately baseline all current duplication as acceptable.

Rationale:

- Fallow is fast enough to run locally.
- `strict` and `mild` modes currently produce a small, actionable duplicate set.
- Current semantic duplication is too broad for a first hard gate but valuable for design review.
- A cleanup-first approach prevents the repo from cementing known duplication into a permanent baseline.

Implemented hard-gate command:

```bash
node scripts/check-duplication-threshold.mjs
```

Threshold policy:

- `--threshold 3` is used because the targeted cleanup reduced mild duplication to `2.0%`.
- `scripts/check-duplication-threshold.mjs` parses Fallow JSON and exits nonzero when the measured rate exceeds `3%`, because local verification showed the raw Fallow threshold output did not fail the package script in this setup.
- Remaining mild duplication is documented as accepted architecture symmetry.
- If future cleanup reduces mild duplication further, lower the threshold deliberately instead of leaving permanent slack.
- If a legitimate feature increases mild duplication, review the clone group and either extract a stable abstraction or document why the threshold should change.

Rejected option: immediately use `--threshold 3` without cleanup.

Reason: the original mild result was `3.7%`, so this would have failed before the cleanup pass. The implemented gate was added only after the measured rate dropped to `2.0%`.

Rejected option: semantic duplication in `pnpm check`.

Reason: semantic mode at low thresholds reports broad entity/use-case symmetry. It is useful, but too noisy for merge blocking until the team has decided which abstractions are healthy.

### 4.2 Use Aislop As Advisory Only

Decision: add Aislop to the advisory lane, not `pnpm check`.

Rationale:

- Aislop catches useful cleanup that existing lint does not currently catch, especially duplicate imports and duplicate blocks.
- Its complexity and thin-wrapper findings require architectural judgment.
- Its score is too broad and generic to be treated as a mergeability signal.
- Its bundled toolchain and audit checks may report dependency or ecosystem noise outside the code change.

Target use:

```bash
aislop scan --exclude node_modules,dist,coverage,.wrangler,migrations
```

Advisory handling:

- Fix duplicate imports when they are straightforward.
- Inspect duplicate-block findings before extracting.
- Do not remove boundary wrappers solely because Aislop says "thin wrapper."
- Do not remove JSDoc/comments required by architecture rules.
- Confirm security findings with `pnpm audit` or direct dependency analysis before changing dependencies.

Rejected option: `aislop ci` in `pnpm check`.

Reason: current output contains mixed true positives and context-dependent warnings. Blocking on the aggregate score would create noise and encourage local exceptions instead of better design.

### 4.3 Do Not Adopt Unslop As A Hard Gate

Decision: do not enable `unslop/no-single-use-constants` or `unslop/no-false-sharing` as errors in this repository now.

Rationale:

- The rules are reasonable for generic utility-heavy codebases.
- This repo's `src/shared/**` is not only a utility folder. It is also the home for cross-layer errors, constants, validation primitives, pagination primitives, and documented boundary types.
- The existing `architecture/no-magic-numbers` rule intentionally extracts numeric values into named constants for meaning, not only reuse.
- Trial output showed many findings that conflict with valid architecture.

Keep from Unslop:

- The idea that shared utility modules should not become a dumping ground.
- The idea that exported helpers with zero consumers, such as `stableStringify`, deserve review.
- The idea that tiny algorithmic numeric constants may not need the same policy as protocol or domain constants.

Possible future scoped adoption:

- Create a dedicated `src/shared/utils/**` boundary if the repo starts accumulating generic utilities.
- Apply `unslop/no-false-sharing` only to that utility boundary through Oxlint `jsPlugins`.
- Do not apply false-sharing rules to `src/shared/errors.ts`, `src/shared/constants.ts`, validation schemas, or pagination contracts.

### 4.4 Implement A Narrow Route Boundary Rule

Decision: do not implement the broad IOSP-style `architecture/no-mixed-concerns` rule as originally drafted.

The broad version would flag too many valid application use cases. Application methods legitimately contain orchestration and branch logic for:

- idempotency;
- authorization;
- conflict handling;
- replay handling;
- domain construction;
- repository/workflow sequencing.

Implemented target:

- Scope the rule to `src/http/routes/**/*.routes.ts`.
- Enforce route handlers as thin HTTP orchestration:
  - validate input through `c.req.valid(...)`;
  - call `requireActor(c)` when protected;
  - call exactly one use case `.execute(...)` (already enforced by `architecture/route-module`);
  - present response through presenter functions and constants;
  - avoid direct storage, environment binding, global fetch, crypto, JSON parsing/serialization, and manual `Request`/`Response` construction.

Application-layer mixed-concern checks should be designed later around concrete forbidden dependencies or operations, not a generic "calls helper plus has logic" heuristic.

### 4.5 Defer Broader AI-Slop Integrators

Decision: defer Archlint, Drift, agent-slop-lint, and similar broad integrators.

Rationale:

- Fallow covers the immediate duplication need with a small dependency surface.
- Aislop gives broad advisory coverage without committing to a hard score.
- Existing Oxlint architecture rules already cover clean-architecture layer boundaries.
- Adding several broad scanners at once would make it harder to identify which signal is trustworthy.

## 5. Implemented Commands

Hard gate after initial duplication cleanup:

```json
{
  "scripts": {
    "check": "pnpm lint && pnpm check:dup && pnpm typecheck && pnpm test",
    "check:dup": "node scripts/check-duplication-threshold.mjs"
  }
}
```

Advisory pass:

```json
{
  "scripts": {
    "advise": "pnpm advise:aislop && pnpm advise:dupes",
    "advise:aislop": "aislop scan --exclude node_modules,dist,coverage,.wrangler,migrations",
    "advise:dupes": "fallow dupes --mode semantic --min-tokens 150 --min-lines 10 --skip-local --ignore-imports --format compact --quiet"
  }
}
```

Machine-readable advisory pass:

```json
{
  "scripts": {
    "advise:json": "aislop scan --json --exclude node_modules,dist,coverage,.wrangler,migrations"
  }
}
```

Implementation choice:

- `fallow@2.75.0` and `aislop@0.9.0` are pinned dev dependencies for repeatability.
- `pnpm-workspace.yaml` allows their build scripts because both packages install bundled CLI/tool binaries.
- `scripts/check-duplication-threshold.mjs` is the hard-gate wrapper around Fallow's JSON report.

## 6. Implementation Plan

### Phase 1. Clean Current High-Signal Duplication

Run:

```bash
fallow dupes --mode mild --min-tokens 50 --min-lines 5 --skip-local --ignore-imports --format compact --quiet
```

Review and fix the current 4 clone groups where extraction improves the design.

Expected focus areas:

- repeated create/idempotency flow across category, media, post, and user use cases;
- repeated idempotency replay/conflict handling;
- repeated small policy/entity blocks only if extraction improves readability and preserves domain explicitness.

Implemented outcome:

- extracted `createUserSubjectRelationship(...)` for stable user-subject relationship creation;
- extracted `canUserActorAccessByRelation(...)` for stable admin-or-relationship ReBAC checks;
- left the idempotent create lifecycle explicit in each use case by design;
- documented the remaining mild clone groups as accepted architecture symmetry.

Acceptance criteria:

- strict/mild duplicate percentage is reduced or explicitly documented as accepted architecture symmetry;
- no use-case abstraction hides resource-specific domain behavior;
- `pnpm check` still passes.

### Phase 2. Add Fallow As A Hard Duplicate Gate

Tasks:

- Add `fallow` as a dev dependency.
- Add `check:dup` with the approved `3%` threshold.
- Insert `pnpm check:dup` into `pnpm check` after `pnpm lint`.
- Document the threshold and why it is acceptable.

Acceptance criteria:

- `pnpm check:dup` passes on the cleaned codebase.
- A temporary duplicate fixture or local duplicate edit can make `pnpm check:dup` fail.
- README documents the new hard gate.

### Phase 3. Add Advisory Scripts

Tasks:

- Add `aislop` as a dev dependency or document a pinned `pnpm dlx` invocation.
- Add `advise`, `advise:aislop`, and `advise:dupes`.
- Keep advisory scripts out of `pnpm check`.
- Document expected agent behavior in `AGENTS.md`.

Acceptance criteria:

- `pnpm advise` runs successfully.
- Advisory findings do not block `pnpm check`.
- Agent instructions require running advisory checks after substantial code changes.

### Phase 4. Decide On Route Mixed-Concern Rule

Tasks:

- Write the exact invariant for route handlers.
- Update `.agents/skills/content-api-architecture-lint/references/rule-contract.md`.
- Implement a narrow `architecture/route-handler-boundary` rule after the invariant is approved.
- Add a temporary negative fixture and verify lint fails for the intended reason.

Acceptance criteria:

- The rule catches direct low-level work in route handlers.
- The rule does not block existing canonical route handler patterns.
- `corepack pnpm check` passes after fixture removal.

## 7. Implementation Backlog

### Q4-A. Duplicate Cleanup Review

Scope:

- `src/application/**`
- `src/domain/**`
- Fallow mild duplicate output

Tasks:

- [x] Run Fallow mild duplicate scan.
- [x] Classify each clone group as "extract", "leave explicit", or "needs design discussion".
- [x] Extract only repeated behavior with stable semantics.
- [x] Keep domain-specific entity/policy code explicit when abstraction would obscure resource rules.

Acceptance criteria:

- Current mild duplicate rate is `2.0%`, and accepted groups are documented.
- `pnpm check` passes.

Tests:

- `pnpm check`
- Fallow mild duplicate scan

### Q4-B. Fallow Hard Gate

Scope:

- `package.json`
- lockfile
- README quality-check section

Tasks:

- [x] Install `fallow`.
- [x] Add `check:dup`.
- [x] Add `check:dup` to `check`.
- [x] Verify failure behavior with a temporary cross-directory duplicate fixture.
- [x] Remove temporary verification changes.

Acceptance criteria:

- `pnpm check` includes duplicate gating.
- The threshold is based on the post-cleanup measurement, not the current unreviewed baseline.

Tests:

- `pnpm check:dup`
- `pnpm check`

### Q4-C. Advisory Pass

Scope:

- `package.json`
- `AGENTS.md`
- README quality-check section

Tasks:

- [x] Install or pin `aislop`.
- [x] Add `advise`, `advise:aislop`, and `advise:dupes`.
- [x] Document that advisory findings are review input, not automatic blockers.
- [x] Add agent guidance for when to run `pnpm advise`.

Acceptance criteria:

- `pnpm advise` runs locally.
- Agents have explicit instructions to run it after code changes.
- The final response convention includes mentioning important ignored advisory findings when relevant.

Tests:

- `pnpm advise`
- `pnpm check`

### Q4-D. Route Boundary Rule Spec

Scope:

- `scripts/oxlint-js-plugins/architecture.js`
- `.oxlintrc.json`
- `.agents/skills/content-api-architecture-lint/references/rule-contract.md`
- architecture docs and skills

Tasks:

- [x] Define the route-handler invariant.
- [x] List allowed AST shapes.
- [x] List forbidden route-handler operations.
- [x] Review current route modules for valid exceptions.
- [x] Implement after approval.

Acceptance criteria:

- The rule is narrow enough to avoid application-use-case false positives.
- The rule blocks low-level work in HTTP route handlers.

Tests:

- temporary negative fixture
- `corepack pnpm lint`
- `corepack pnpm check`

## 8. Future Backlog

- Review whether `architecture/no-magic-numbers` should exempt tiny algorithmic local constants such as `HEX_RADIX` when they are private and self-explanatory.
- Consider a dedicated `src/shared/utils/**` boundary if generic utility functions accumulate.
- Reconsider scoped Unslop adoption only for that utility boundary.
- Evaluate Fallow dead-code checks after duplicate gating is stable.
- Revisit plugin splitting for `scripts/oxlint-js-plugins/architecture.js` if linter maintenance becomes difficult.

## 9. Risks And Failure Modes

| Risk | Failure mode | Mitigation |
|---|---|---|
| Duplicate gate added before cleanup | `pnpm check` fails immediately or threshold is set too high forever | Clean high-signal duplicates before setting the threshold |
| Semantic duplication treated as hard failure | Valid domain symmetry becomes forced abstraction | Keep semantic Fallow in `pnpm advise` first |
| Aislop score treated as truth | Agents remove valid boundary wrappers or required comments | Document advisory handling and keep Aislop out of `pnpm check` |
| Unslop added globally | Valid shared constants/errors are flagged as bad design | Do not adopt globally; consider future narrow utility scope only |
| Advisory command ignored | Agents finish with obvious cleanup still present | Add `pnpm advise` expectation to `AGENTS.md` in implementation phase |
| Too many tools at once | Developers cannot tell which signal matters | Start with Fallow hard gate and Aislop advisory only |

## 10. Test And Verification Plan

Implementation verification:

1. Run current baseline scans:

```bash
fallow dupes --mode mild --min-tokens 50 --min-lines 5 --skip-local --ignore-imports --summary --quiet
fallow dupes --mode semantic --min-tokens 150 --min-lines 10 --skip-local --ignore-imports --summary --quiet
aislop scan --exclude node_modules,dist,coverage,.wrangler,migrations
```

2. After duplicate cleanup, run:

```bash
pnpm check
pnpm check:dup
pnpm advise
```

3. For the route-handler boundary rule, follow the local linter rule contract:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
```

4. Negative verification:

- Temporarily add a cross-directory duplicate block above the approved threshold and confirm `pnpm check:dup` fails.
- Temporarily add a forbidden route-handler operation if a route boundary rule is implemented and confirm `architecture/*` reports the intended violation.
- Remove all fixtures before finishing.

## 11. Definition Of Done

This planning document is complete when:

- [x] It describes the hard/advisory two-pass model.
- [x] It records current Fallow, Aislop, and Unslop findings.
- [x] It explains why Unslop is not adopted as a hard gate now.
- [x] It gives concrete implemented `package.json` scripts.
- [x] It includes a sequenced implementation backlog.
- [x] `README.md` lists this proposal and its status.

The implementation is complete when:

- [x] Current high-signal duplicate groups are reviewed and cleaned or documented.
- [x] `fallow` is installed or otherwise pinned.
- [x] `pnpm check` includes a Fallow mild duplicate gate with an approved threshold.
- [x] `aislop` is installed or otherwise pinned.
- [x] `pnpm advise` runs Aislop and conservative semantic Fallow checks.
- [x] `AGENTS.md` instructs agents to run `pnpm advise` after substantial code changes.
- [x] `README.md` documents both `pnpm check` and `pnpm advise`.
- [x] `pnpm check` passes.

## 12. Final Model

The recommended model is:

- `pnpm check` is the strict merge gate.
- Fallow mild duplication is part of `pnpm check` after cleanup and threshold selection.
- `pnpm advise` is the agent/human review assistant.
- Aislop and semantic Fallow belong in `pnpm advise`.
- Unslop is deferred because its generic shared/constant heuristics conflict with this repo's architecture.
- Any new `architecture/*` rule must be narrow, invariant-based, and validated through the existing architecture-lint rule contract.
