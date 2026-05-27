## Commands

- `pnpm check` — full CI gate: lint (oxlint) → duplicate gate (Fallow mild) → typecheck → test
- `pnpm lint` — oxlint with strict architecture rules (the architecture gate)
- `pnpm lint:fix` — auto-correct safe lint issues
- `pnpm check:dup` — hard duplicate-code gate with Fallow mild mode and the repo's 3% wrapper threshold
- `pnpm advise` — advisory quality pass: Aislop + conservative semantic Fallow (filtered: suppresses known noise)
- `pnpm advise:raw` — unfiltered advisory output (shows all findings including known noise)
- `pnpm advise:aislop` — broad advisory scanner for duplicate imports, duplicate blocks, complexity, wrapper, and security signals
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — vitest with Cloudflare Workers pool

## Architecture lint

The oxlint plugin at `scripts/oxlint-js-plugins/architecture.js` enforces clean-architecture layer boundaries. Rules are wired in `.oxlintrc.json`. Fix the code — never loosen rules to pass lint.

## Advisory checks

Run `pnpm advise` after substantial code changes. The filter script (`scripts/filter-advise.mjs`) suppresses known noise via `.advise-suppressions.json` and shows only new findings.

When new findings appear, handle them autonomously:

1. **Auto-suppress** these categories without asking (patterns mandated by architecture):
   - `complexity/file-too-large` in `scripts/oxlint-js-plugins/architecture.js`
   - `complexity/function-too-long` in route registration (`authz.routes.ts`) or composition wiring (`create-request-container.ts`)
   - `code-quality/duplicate-block` in route files (`*.routes.ts`) — each route validates + calls use case + presents, extracting adds indirection
   - `code-quality/duplicate-block` in mapper files (`*.mapper.ts`) — explicit one-to-one field mapping is the architecture rule
   - `ai-slop/narrative-comment` in any file — JSDoc at architectural boundaries is required by the JSDoc Standard
   - `ai-slop/thin-wrapper` — `createDb`, `encodeCursor` are intentional public APIs
   - `ai-slop/double-type-assertion` in `crud-adapter.ts` — Drizzle query return type limitation
   - `security/vulnerable-dependency` — note it, do not auto-upgrade deps

2. **Auto-suppress** fallow clone groups between known file-sets:
   - `*/*.entity.ts` files with other entity files — getter/update/toSnapshot pattern mandated by Entity Class Rules
   - `create-*.usecase.ts` files with other create use cases — idempotent create/replay pattern is structurally similar by design
   - Entity-mapper files — explicit field mapping pattern

3. **Review** (do NOT auto-suppress):
   - New rule types not in the list above
   - Clone groups involving files not in any existing suppression entry
   - `security/*` (except the known esbuild one)
   - Any finding with `severity: error`

4. **To add a suppression**: append to the `suppressions` array in `.advise-suppressions.json`:
   - aislop: `{ "tool": "aislop", "file": "<filePath>", "rule": "<rule>", "reason": "<why>" }`
   - fallow: `{ "tool": "fallow", "files": "<sorted|paths>", "reason": "<why>" }`

5. **Final check**: after suppressing findings, re-run `pnpm advise` to verify clean (green line).
6. **To see everything** (unfiltered): `pnpm advise:raw`

## Tests

- `@cloudflare/vitest-pool-workers` — tests run in a worker context, import from `cloudflare:test`
- D1 migrations are seeded via `import migrationSql from "../drizzle/0000_*.sql?raw"`
- No external services needed; JWKS is mocked via `createApp({ fetchImpl })`

### Test performance rules (do not regress these)

The suite runs in ~10 s. Several optimizations keep it there; violating any one of them can push it back to 80 s+.

**One worker for all tests** — `vitest.config.mts` sets `include: ["tests/all.test.ts"]`. The barrel `tests/all.test.ts` imports every test file. Every new test file must be added to that barrel. Never add a new entry to `include` — that spawns a second worker and incurs the full workerd startup cost again.

**Wrap every test file's tests in a `describe` block** — top-level `beforeAll`/`beforeEach` hooks in an imported barrel file apply globally to all tests, not just the file they came from. Every test file must wrap its tests and hooks in `describe("file-name", () => { ... })` so hooks are scoped.

**`setupBeforeAll` is idempotent** — it guards key-pair generation (`keyPairInitialized`) and D1 migrations (`migrationsApplied`) with module-level flags. Adding a second `setupBeforeAll` call from a new describe block is safe; the expensive work only runs once.

**`setupBeforeEach` runs the minimal seed** — `seed()` does a single `env.DB.batch()` combining all DELETEs and INSERTs. Do not split it back into two sequential batches. R2 fixture objects are seeded once (`r2Seeded` flag) because nothing deletes them between tests.

**`bootstrapContentIamAdmin()` is direct D1, not HTTP** — it calls `seedBootstrapAdmin()` which writes two rows (bootstrap org record + `system:org.content_admin` binding) directly into D1. Never revert it to an HTTP request; that adds ~44 × 300 ms of JWT-sign + JWT-verify + SCIM directory overhead per test. Tests that explicitly test the bootstrap HTTP endpoint call `request("/organizations/…/content-iam/bootstrap", …)` directly and are unaffected.

**`ensureSystemCatalog()` runs once per Worker** — `DrizzleContentRoleRepository` has a module-level `catalogSynced` flag. The method fires on every write use case (create post/book/category/media/binding/role) but the ~200-statement catalog batch only executes once per Worker lifetime. Workers restart on deployment, resetting the flag. Do not remove the flag or call the method unconditionally.

**Media-upload and pure-unit tests have no DB setup hooks** — `tests/media-upload.test.ts` uses in-memory repositories; its describe block has no `beforeAll`/`beforeEach`. The `runScheduledPublish` describe in `tests/scheduled-publish.test.ts` uses stub managers. Only add setup hooks to describes that actually touch D1.

## Aliases

`@/*` → `src/*` (tsconfig paths + vitest resolve.alias)

## Package manager

`pnpm@11.1.2` via corepack

## Rules

1. Always keep README.md up to date when public commands, topology, or setup changes. (hard gate — do not skip)
2. When work from a planning document is completed, update status metadata or implementation notes in that document when the document asks for it.
3. Name planning documents with a leading numbered prefix in the `xxx_...` format so their sequence stays trackable.
4. Never craft migration SQL or snapshot files manually. After changing `src/infrastructure/db/schema.ts`, run `pnpm db:generate`. Hand-written SQL drifts the journal, snapshot, and column ordering away from Drizzle's expected state and breaks future runs.
5. During review, absolutely honor any user-provided implementation plan and do not change that plan; gather recommendations about edge cases, concurrent use cases, architectural design, or race conditions and present them to the user after plan-conforming code review and fixes, for explicit approval before implementation.
