---
name: content-api-architecture-lint
description: Maintain the local content-api oxlint architecture plugin in scripts/oxlint-js-plugins/architecture.js. Use only when explicitly asked to extend architecture lint rules, rename/configure the plugin, investigate a suspected linter bug, or update linter documentation/fixtures. Do not use for ordinary lint failures while implementing features; in those cases fix the codebase instead of loosening rules.
---

# Content API Architecture Lint

## Purpose

Maintain the strict architecture lint gate for `content-api`. The linter exists to prevent clean-architecture drift, not to make code easier to pass.

## Non-Negotiables

- Prefer stricter rules. Do not loosen or disable a rule unless the architecture docs are wrong or the rule is provably catching valid architecture.
- When lint fails during feature work, fix the codebase. Do not use this skill to work around lint failures.
- Use this skill only for linter maintenance: requested rule extensions, bug fixes, renames, config wiring, docs sync, or negative-test checks.
- Keep rule names, `.oxlintrc.json`, docs, and skill text in sync.
- Preserve test/fixture integrity. Temporary negative fixtures are allowed, but remove them before finishing.

## Files

- Plugin: `scripts/oxlint-js-plugins/architecture.js`
- Config: `.oxlintrc.json`
- Proposal/reference doc: `docs/003_entity-classes-and-oxlint-arch-linting.md`
- Architecture skill: `.agents/skills/content-api-architecture/SKILL.md`
- Detailed architecture rules: `.agents/skills/content-api-architecture/references/architecture-rules.md`

Read [references/rule-contract.md](references/rule-contract.md) before changing rule behavior.

## Workflow

1. Identify the architectural invariant, not just the syntax to catch.
2. Inspect current code for valid exceptions before writing the rule.
3. Make the rule as strict as the invariant allows.
4. Update `.oxlintrc.json` when adding, renaming, or removing rule namespaces.
5. Update docs and architecture skills in the same change.
6. Run a temporary negative fixture for every new/changed rule behavior and confirm `corepack pnpm lint` fails for the intended reason.
7. Remove temporary fixtures.
8. Run `corepack pnpm check`.

## Adding A Rule

Use this checklist for every new `architecture/*` rule:

1. Name the rule after the invariant, not the current bug. Prefer names like `entity-class` or `repository-workflow`, not `no-bad-pattern`.
2. Define the allowed pattern first. Write down the exact shape developers should use before coding the rejection logic.
3. Define the forbidden pattern broadly enough to catch obvious variations, including aliases, different parameter names, string and template literals, and equivalent AST shapes.
4. Filter by path as narrowly as possible, but do not add broad opt-outs to make the current code pass.
5. Add the rule to `plugin.rules` and `.oxlintrc.json` at `"error"`.
6. Add matching overrides only for generated files, tests, or declarations when those files are intentionally outside the architecture boundary.
7. Update human-readable docs in the main architecture skill, detailed architecture rules, proposal/reference doc, and `references/rule-contract.md`.
8. Add a temporary negative fixture that fails only because of the new architecture rule. If the fixture can pass with a small variation, tighten the rule.
9. Remove the fixture and run `corepack pnpm check`.

Strictness requirements:

- A new rule should fail closed. If a shape is ambiguous, prefer requiring the repo's canonical pattern.
- Do not encode exceptions as stringly broad allowlists. If an exception is valid, make it path-specific and document why.
- Do not add rule options that let callers weaken architecture boundaries unless there is a documented architecture need.
- Do not silently skip unsupported AST forms when those forms could express the forbidden pattern; either support them or report a clear error for the canonical replacement.

## Rule Style

- Keep rules deterministic and local-file unless cross-file state is absolutely necessary.
- Prefer explicit AST checks over regex on source text when practical.
- Avoid broad false positives by filtering to relevant paths early.
- Use clear messages that tell the developer what strict pattern to use.
- If a rule has intentional exceptions, encode them narrowly and document them.

## Negative Fixture Pattern

Create a small temporary file under the relevant `src/**` path, run `corepack pnpm lint`, verify the architecture rule fails, then delete the file. Do not leave fixtures committed unless the user explicitly asks for permanent rule tests.
